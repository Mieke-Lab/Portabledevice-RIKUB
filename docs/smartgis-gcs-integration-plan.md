# Rencana Integrasi SmartGIS dan GCS

Dokumen ini menjelaskan rencana penggabungan fitur GCS ke dalam aplikasi Jaga
Padi tanpa membuat alur SmartGIS menjadi terlalu rumit.

## Keputusan Utama

GCS tidak dibuat sebagai aplikasi utama yang terpisah dari SmartGIS.

GCS dibagi menjadi dua bagian:

```text
1. Mission Operation
   Masuk ke alur utama SmartGIS, khususnya pada layer Spraying Route.

2. Drone Tools / Advanced GCS
   Dipakai untuk testing, konfigurasi, dan debugging drone.
```

Dengan keputusan ini, menu utama Jaga Padi tetap sederhana:

```text
SmartGIS
Chatbot AI
Deteksi Penyakit
```

Fitur drone tetap ada, tetapi tidak memenuhi menu utama.

## Alur Final

Alur utama operator:

```text
1. SmartGIS menampilkan RGB + NDVI orthomosaic
        |
        v
2. User mengatur threshold NDVI
        |
        v
3. Sistem generate polygon zona bermasalah
        |
        v
4. User memilih / menghapus / approve polygon
        |
        v
5. User validasi penyakit dan menentukan chamber
        |
        v
6. Sistem membuat Spraying Route dari target semprot
        |
        v
7. User mengatur altitude dan speed
        |
        v
8. Sistem upload / execute mission ke drone
        |
        v
9. SmartGIS menampilkan telemetry ringkas dan mission status
```

Ringkasnya:

```text
RGB + NDVI
  -> NDVI Threshold
  -> Spray Zones
  -> Disease Validation + Chamber
  -> Spraying Route
  -> Send Mission
  -> Telemetry + Mission Status
```

## Pembagian Tanggung Jawab

### SmartGIS Utama

SmartGIS adalah alur utama untuk analisis lahan sampai pengiriman misi.

Fitur:

- tampilkan RGB orthomosaic,
- tampilkan NDVI orthomosaic,
- generate NDVI Zones dari threshold,
- approve polygon menjadi Spray Targets,
- validasi penyakit / hama,
- pilih chamber,
- generate Spraying Route,
- atur altitude,
- atur speed,
- upload mission,
- execute mission,
- tampilkan telemetry ringkas,
- tampilkan mission status.

### Drone Tools / Advanced GCS

Drone Tools dipakai oleh teknisi atau operator lanjutan.

Fitur:

- dashboard telemetry lengkap,
- Flight Test,
- arm,
- disarm,
- set mode,
- takeoff manual,
- goto manual,
- land manual,
- raw diagnostics,
- drone settings,
- system logs.

Fitur ini tidak muncul sebagai alur utama agar user tidak bingung saat memakai
SmartGIS.

## UI Yang Disarankan

UI yang sekarang sudah berbasis peta penuh dengan fitur Lapisan. Struktur itu
dipertahankan.

Menu utama tetap:

```text
SmartGIS
Chatbot AI
Deteksi Penyakit
```

Di halaman SmartGIS, fitur Lapisan tetap menjadi pusat visual:

```text
Map type
- Default
- Satelit
- Terrain

Map Imagery
- RGB
- NDVI

Map Analysis
- NDVI Zones
- Spray Targets
- Spraying Route
```

Prinsip UI:

```text
Lapisan = apa yang ditampilkan di peta
Panel kiri = tools untuk layer yang sedang aktif
Drone Tools = testing / konfigurasi lanjutan
```

Jadi tidak perlu menambah sidebar besar atau stepper panjang.

## Perilaku Panel Kiri

Panel kiri berubah sesuai layer yang aktif.

### RGB / NDVI

Panel kiri menampilkan:

- pilih lahan,
- lokasi lahan,
- metadata imagery,
- tanggal capture,
- informasi dasar NDVI.

### NDVI Zones

Panel kiri menampilkan:

- NDVI min,
- NDVI max,
- minimum area,
- merge distance,
- tombol Generate Zones,
- ringkasan polygon,
- tombol Approve Zones.

Output:

```text
polygon preview
```

### Spray Targets

Panel kiri menampilkan:

- daftar polygon final,
- zone code,
- area,
- mean NDVI,
- chamber,
- tombol focus polygon,
- tombol menuju deteksi penyakit.

Output:

```text
spray target final + chamber
```

### Spraying Route

Panel kiri menampilkan:

- target count,
- waypoint count,
- altitude,
- speed,
- generate route,
- upload mission,
- execute mission,
- mission status ringkas.

Output:

```text
waypoint / mission untuk drone
```

## Telemetry Di SmartGIS

Telemetry tetap dibutuhkan di SmartGIS, tetapi ditampilkan ringkas.

Telemetry ringkas:

- connected / offline,
- GPS fix,
- armed,
- mode,
- mission running,
- last error.

Telemetry detail tidak perlu selalu muncul di alur utama. Detail lengkap masuk ke
Drone Tools.

## Drone Tools

Tambahkan tombol kecil di header SmartGIS, misalnya:

```text
Drone Tools
```

Atau ikon drone / wrench.

Ketika dibuka, tampilkan drawer atau halaman advanced dengan tab:

```text
Status
Test
Settings
Logs
```

Isi minimal:

```text
Status:
- telemetry lengkap
- GPS
- IMU
- global position
- flight state

Test:
- arm
- disarm
- set mode
- takeoff
- goto
- land

Settings:
- backend drone address
- poll interval

Logs:
- command log
- error log
```

## Integrasi Dengan Soerogis / GCS

Fitur Soerogis yang masuk ke SmartGIS utama:

```text
PushMission
ExecuteMission
MissionStatus
Diagnostics ringkas
```

Fitur Soerogis yang masuk ke Drone Tools:

```text
Arm
Disarm
SetMode
Takeoff
Goto
Land
Diagnostics lengkap
Drone Settings
System Logs
Flight Test
```

## Data Yang Mengalir

SmartGIS menghasilkan Spray Targets:

```json
{
  "zone_code": "Z01",
  "geometry": {},
  "area_m2": 120.5,
  "mean_ndvi": 0.38,
  "chamber": "fungisida"
}
```

Spraying Route memakai data itu untuk membuat waypoint:

```json
{
  "waypoints": [],
  "altitude": 5,
  "speed": 2
}
```

Mission Operation mengirim ke backend drone:

```text
POST /api/drone/mission
POST /api/drone/mission/execute
GET  /api/drone/status
GET  /api/drone/diagnostics
```

## Tahap Implementasi

### Tahap 1: Rapikan Konsep UI

- SmartGIS tetap menjadi halaman utama peta.
- Pertahankan layer control yang sudah ada.
- Tambahkan konsep bahwa panel kiri mengikuti layer aktif.
- Jangan tambah menu GCS di menu utama.

### Tahap 2: Spraying Route Panel

- Saat layer Spraying Route aktif, tampilkan panel mission.
- Tambahkan altitude dan speed.
- Tambahkan waypoint count.
- Tambahkan tombol Generate Route.
- Tambahkan tombol Upload Mission.
- Tambahkan tombol Execute Mission.

### Tahap 3: Telemetry Ringkas

- Tambahkan status drone ringkas di SmartGIS.
- Status muncul saat Spraying Route aktif atau mission sedang running.
- Jangan tampilkan raw telemetry penuh di alur utama.

### Tahap 4: Drone Tools

- Tambahkan tombol Drone Tools.
- Buat drawer atau halaman advanced.
- Port fitur Flight Test dan Drone Settings dari GCS.
- Tambahkan logs jika sudah tersedia.

### Tahap 5: Integrasi Backend Drone

- Hubungkan SmartGIS ke endpoint mission Soerogis.
- Gunakan PushMission untuk upload waypoint.
- Gunakan ExecuteMission untuk menjalankan mission.
- Gunakan MissionStatus / Diagnostics untuk monitoring.

## Jawaban Konsep Untuk Dosen

Kalimat singkat:

> Aplikasi tetap dibuat satu sebagai Jaga Padi. SmartGIS menjadi alur utama dari
> analisis NDVI sampai pengiriman misi drone. Fitur GCS tidak dibuat sebagai app
> terpisah, tetapi dibagi dua: fitur mission operation masuk ke layer Spraying
> Route, sedangkan fitur testing dan konfigurasi drone disimpan di Drone Tools
> untuk teknisi.

Kalimat teknis:

> Layer menentukan tampilan peta, panel kiri menampilkan tools sesuai layer, dan
> Drone Tools menyediakan kontrol teknis seperti arm, takeoff, goto, land,
> settings, serta telemetry lengkap.

## Kesimpulan

Finalnya:

```text
GCS digabung ke SmartGIS,
tetapi hanya fitur mission operation yang masuk alur utama.

Fitur testing GCS tetap ada,
tetapi ditempatkan di Drone Tools / Advanced GCS.
```

Ini menjaga UI tetap sederhana untuk operator, tetapi tetap menyediakan kontrol
lengkap untuk teknisi.
