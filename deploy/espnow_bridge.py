#!/usr/bin/env python3
"""ESP-NOW -> virtual serial bridge for the 7-in-1 soil sensor.

The field ESP32 (7-in-1 probe) sends its readings over ESP-NOW to the gateway ESP32 in the
device box, which is supposed to forward them to the Pi over UART (/dev/ttyAMA0). When that
UART hop is broken, the Pi can hear the sensor itself: a second USB WiFi dongle (AR9271,
monitor mode) captures the ESP-NOW frames on channel 1, and this bridge re-emits them as the
exact `<PKT>...<END>` lines the gateway would send, on a pseudo-terminal. The backend reads it
like a serial port (SENSOR_SERIAL_PORT=/run/rikub-espnow/tty), so its reader stays unchanged.

Frame: 802.11 Action (FC 0xd0), category 127, OUI 18:fe:34, 4 random bytes, vendor element
0xdd / OUI 18:fe:34 / type 4 / version, then the payload. Payload = MasterPacket from the
gateway firmware (loraConfigure/rx_espnow_lora.ino), ESP32 little-endian + alignment:
    SoilData 7 float | pad 4 | double lat, double lon, float alt, int sats | float bat | pad 4
Runs as root (monitor mode + raw socket): /etc/systemd/system/rikub-espnow.service.
"""
import os
import socket
import struct
import subprocess
import sys
import time

IFACE_MAC = os.getenv("ESPNOW_IFACE_MAC", "ec:08:6b:13:df:df").lower()  # the monitor dongle
CHANNEL = int(os.getenv("ESPNOW_CHANNEL", "1"))
SENDER_MAC = os.getenv("ESPNOW_SENDER_MAC", "d8:bc:38:fa:98:48").lower()  # "" = any sender
PTY_LINK = os.getenv("ESPNOW_PTY_LINK", "/run/rikub-espnow/tty")
EMIT_INTERVAL_S = 1.0  # the sensor repeats frames several times a second; one line per second
SERIAL_GROUP = "dialout"

ESP_OUI = b"\x18\xfe\x34"
MASTER = struct.Struct("<7f4xddfif4x")  # 64 bytes


def log(msg):
    print(msg, flush=True)


def mac(b):
    return ":".join(f"{x:02x}" for x in b)


def find_iface(mac_addr):
    for name in os.listdir("/sys/class/net"):
        try:
            with open(f"/sys/class/net/{name}/address") as f:
                if f.read().strip().lower() == mac_addr:
                    return name
        except OSError:
            continue
    return None


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def setup_monitor(iface):
    # NetworkManager must not manage it (see /etc/NetworkManager/conf.d/99-rikub-espnow.conf).
    run("ip", "link", "set", iface, "down")
    run("iw", "dev", iface, "set", "type", "monitor")
    run("ip", "link", "set", iface, "up")
    run("iw", "dev", iface, "set", "channel", str(CHANNEL))


def open_pty():
    """Pseudo-terminal the backend opens as its serial port; the fixed symlink points at it."""
    master, slave = os.openpty()
    path = os.ttyname(slave)
    import grp
    os.chown(path, 0, grp.getgrnam(SERIAL_GROUP).gr_gid)
    os.chmod(path, 0o660)
    os.set_blocking(master, False)  # never stall the capture when nobody is reading
    os.makedirs(os.path.dirname(PTY_LINK), exist_ok=True)
    tmp = PTY_LINK + ".new"
    if os.path.lexists(tmp):
        os.remove(tmp)
    os.symlink(path, tmp)
    os.replace(tmp, PTY_LINK)
    return master, slave, path


def parse_espnow(pkt):
    """-> (src, dst, payload) for an ESP-NOW frame, else None."""
    if len(pkt) < 4:
        return None
    rt_len = struct.unpack_from("<H", pkt, 2)[0]
    f = pkt[rt_len:]
    if len(f) < 24 + 15 or f[0] != 0xD0:
        return None
    body = f[24:]
    if body[0] != 127 or body[1:4] != ESP_OUI:
        return None
    el = body[8:]
    if len(el) < 7 or el[0] != 0xDD or el[2:5] != ESP_OUI or el[5] != 4:
        return None
    return mac(f[10:16]), mac(f[4:10]), bytes(el[7:2 + el[1]])


def pkt_line(seq, t0, v):
    hum, temp, cond, ph, n, p, k, lat, lon, alt, sat, bat = v
    return (
        f"<PKT>TYPE:SOIL|SEQ:{seq}|TIME:{int((time.monotonic() - t0) * 1000)}|"
        f"SOIL[HUM:{hum:.1f}|TEMP:{temp:.1f}|COND:{cond:.0f}|PH:{ph:.1f}|N:{n:.0f}|P:{p:.0f}|K:{k:.0f}]|"
        f"GPS[LAT:{lat:.6f}|LON:{lon:.6f}|ALT:{alt:.1f}|SAT:{sat}]|"
        f"BAT[{bat:.2f}]|ADC[0]|<END>\r\n"
    )


def main():
    iface = None
    while iface is None:  # the dongle can enumerate after us at boot
        iface = find_iface(IFACE_MAC)
        if iface is None:
            log(f"waiting for monitor dongle {IFACE_MAC} ...")
            time.sleep(5)
    setup_monitor(iface)
    master, _slave, path = open_pty()
    log(f"listening on {iface} ({IFACE_MAC}) channel {CHANNEL}, sender {SENDER_MAC or 'any'}; "
        f"serial {PTY_LINK} -> {path}")

    sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.ntohs(0x0003))
    sock.bind((iface, 0))
    sock.settimeout(1.0)

    t0 = time.monotonic()
    seq = 0
    latest = None
    last_emit = 0.0
    frames = dropped = 0
    last_report = time.monotonic()
    while True:
        try:
            parsed = parse_espnow(sock.recv(4096))
        except socket.timeout:
            parsed = None
        if parsed:
            src, _dst, payload = parsed
            if (not SENDER_MAC or src == SENDER_MAC) and len(payload) == MASTER.size:
                latest = MASTER.unpack(payload)
                frames += 1
        now = time.monotonic()
        if latest is not None and now - last_emit >= EMIT_INTERVAL_S:
            last_emit = now
            try:
                os.write(master, pkt_line(seq, t0, latest).encode("ascii"))
                seq += 1
            except BlockingIOError:
                dropped += 1  # no reader draining the pty right now
            latest = None  # only forward fresh readings; silence stays silence
        if now - last_report >= 60:
            log(f"last 60s: {frames} sensor frames, {seq} lines total, {dropped} dropped")
            frames = 0
            last_report = now


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        log(f"monitor setup failed: {exc.cmd}: {exc.stderr.decode(errors='replace').strip()}")
        sys.exit(1)
