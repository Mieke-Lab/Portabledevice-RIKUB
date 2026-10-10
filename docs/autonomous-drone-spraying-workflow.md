# Autonomous Drone Spraying Workflow

Alur lengkap penyemprotan otonom drone dari input petani hingga eksekusi di lapangan.

---

## Ringkasan Alur

```
Polygon + Jenis Penyakit + Altitude
        ↓
Lookup Spray Width dari spek drone
        ↓
Hitung Lane Spacing & Rute Zig-zag
        ↓
Hitung Durasi Terbang
        ↓
Hitung Kebutuhan Cairan & Flow Rate Pompa
        ↓
Autonomous Spraying
```

---

## Input dari Petani

| Parameter | Keterangan |
|-----------|------------|
| **Polygon** | Gambar area sawah di peta |
| **Jenis penyakit** | Menentukan chamber mana yang aktif |
| **Altitude** | Ketinggian terbang yang dirasa aman dari obstacle di sawah |

> Parameter lain (spray width, kecepatan, dosis) dihitung otomatis sebagai **default** dan bisa di-override petani jika perlu.

---

## Langkah 1 — Hitung Luas Polygon

**Input:** Koordinat polygon dari peta

**Proses:** Hitung luas area menggunakan formula Shoelace / Haversine

**Output:**
```
Luas = 2.000 m² = 0,2 ha
```

---

## Langkah 2 — Tentukan Chamber

**Input:** Jenis penyakit yang dipilih petani

**Mapping:**

| Jenis Penyakit | Chamber |
|----------------|---------|
| Blast | Chamber A |
| Bercak Daun | Chamber B |
| Wereng | Chamber C |

**Output:**
```
Blast → Chamber A
```

---

## Langkah 3 — Lookup Spray Width dari Altitude

**Input:** Altitude yang diset petani

**Tabel referensi spek drone:**

| Altitude | Spray Width (default) |
|----------|-----------------------|
| 3 m | 2 m |
| 5 m | 3 m |
| 7 m | 4 m |
| 10 m | 5 m |
| 15 m | 7 m |

> Nilai ini default dari spesifikasi drone. Petani bisa override spray width jika kondisi lapangan berbeda.

**Contoh:**
```
Altitude = 5 m → Spray Width = 3 m (default, bisa diubah)
```

---

## Langkah 4 — Generate Spray Route

**Input:**
- Polygon
- Spray Width (dari langkah 3)
- Overlap: 20% (fixed default)

**Proses:**
```
Overlap area  = Spray Width × Overlap
              = 3 m × 20%
              = 0,6 m

Lane Spacing  = Spray Width - Overlap area
              = 3 m - 0,6 m
              = 2,4 m

Rute zig-zag dibuat dengan jarak antar-lane = 2,4 m
```

Visualisasi:
```
Lane 1:  |←——— 3 m ———→|
Lane 2:        |←——— 3 m ———→|
          ←——→|←—————————————→
          0,6m     2,4 m
        (overlap) (lane spacing)
```

**Output:**
```
Waypoint Zig-zag
Panjang rute = 500 m
```

> Kalau altitude diubah → spray width berubah → lane spacing berubah → kerapatan zig-zag otomatis menyesuaikan.

---

## Langkah 5 — Hitung Kebutuhan Cairan

**Input:**
- Luas: 0,2 ha
- Dosis: 20 L/ha (default dari jenis penyakit, bisa override)

**Proses:**
```
Kebutuhan Cairan = Luas × Dosis
                 = 0,2 ha × 20 L/ha
                 = 4 L
```

---

## Langkah 6 — Hitung Durasi Penyemprotan

**Input:**
- Panjang rute: 500 m
- Kecepatan drone: 5 m/s (default dari spek drone, bisa override)

**Proses:**
```
Durasi = Panjang Rute ÷ Kecepatan
       = 500 m ÷ 5 m/s
       = 100 s
```

---

## Langkah 7 — Hitung Flow Rate Pompa

**Input:**
- Total cairan: 4 L
- Durasi semprot: 100 s

**Proses:**
```
Flow Rate = Total Cairan ÷ Durasi
          = 4 L ÷ 100 s
          = 0,04 L/s
          = 2,4 L/min
```

> Flow rate dihitung otomatis agar cairan habis **tepat** saat drone selesai melewati seluruh polygon. Tidak lebih, tidak kurang.

---

## Langkah 8 — Autonomous Spraying

**Input yang dikirim ke drone:**
- Waypoint zig-zag
- Chamber A (aktif)
- Flow rate: 2,4 L/min
- Altitude: 5 m

**Eksekusi:**
```
Drone mengikuti waypoint zig-zag pada altitude 5 m,
mengaktifkan Chamber A,
mengeluarkan cairan 2,4 L/min,
hingga total 4 L habis tepat saat polygon selesai.
```

---

## Contoh Lengkap End-to-End

| Parameter | Nilai |
|-----------|-------|
| Polygon | Area sawah 2.000 m² |
| Jenis penyakit | Blast |
| **Altitude (input petani)** | **5 m** |
| Spray Width (auto) | 3 m |
| Overlap (default) | 20% |
| Lane Spacing (auto) | 2,4 m |
| Panjang Rute (auto) | 500 m |
| Kecepatan Drone (default) | 5 m/s |
| Durasi (auto) | 100 s |
| Dosis (default) | 20 L/ha |
| Kebutuhan Cairan (auto) | 4 L |
| Flow Rate Pompa (auto) | 2,4 L/min |
| Chamber | A |

---

## Parameter yang Bisa Di-override Petani

| Parameter | Default (auto) | Bisa Diubah? |
|-----------|----------------|--------------|
| Spray Width | Dari tabel altitude | ✅ Ya |
| Overlap | 20% | ✅ Ya |
| Dosis | Dari jenis penyakit | ✅ Ya |
| Kecepatan drone | Dari spek drone | ✅ Ya |
| Lane Spacing | Dihitung otomatis | ❌ Tidak langsung (ikut spray width & overlap) |
| Flow Rate | Dihitung otomatis | ❌ Tidak (hasil akhir kalkulasi) |

---

## Catatan

- Altitude adalah **satu-satunya parameter teknis** yang wajib diisi petani secara sadar, karena menyangkut keamanan dari obstacle di lapangan.
- Semua kalkulasi dirancang agar **cairan habis pas** saat drone selesai melewati seluruh area polygon — tidak ada sisa cairan, tidak ada area yang terlewat.
- Jika altitude diubah di tengah konfigurasi, seluruh spray width, lane spacing, dan rute zig-zag dihitung ulang secara otomatis.
