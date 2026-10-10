# Alur Project SmartGIS

Dokumen ini menjelaskan alur utama project SmartGIS: dari drone mengambil data, hasil NDVI diproses menjadi polygon bermasalah, portable device melakukan ground check, sampai sistem membuat rekomendasi chamber dan mission planning.

## Gambaran Besar

SmartGIS bukan hanya peta NDVI. SmartGIS adalah workflow untuk menentukan:

- area mana yang bermasalah
- penyakit apa yang ada di area tersebut
- chamber penyemprotan apa yang harus dipakai
- polygon mana yang masuk target semprot
- rute misi drone berdasarkan polygon target

Ringkasnya:

```txt
NDVI menentukan WHERE
Penyakit menentukan WHAT TO SPRAY
Luas polygon membantu HOW MUCH
Mission planning menentukan HOW TO GO
```

## Perangkat

Project menggunakan beberapa perangkat portable/edge.

### Raspberry Pi 5 Portable

Raspberry Pi 5 menjadi unit portable yang menjalankan web app.

Tanggung jawab:

- menjalankan frontend web
- menjalankan backend API
- menyimpan database lokal
- menyimpan file imagery yang dipakai oleh web
- menjalankan fitur deteksi penyakit lokal jika model dipasang di Raspi
- menerima data hasil proses dari Jetson Orin NX
- menjadi pusat data untuk unit portable tersebut

Jika ada dua Raspberry Pi portable dengan fungsi yang sama, masing-masing dapat memiliki:

- web sendiri
- backend sendiri
- database lokal sendiri
- data lapangan sendiri

Dengan pola ini, setiap portable tetap bisa berjalan mandiri di lapangan.

### Jetson Orin NX

Jetson Orin NX berperan sebagai worker untuk proses berat.

Tanggung jawab:

- menjalankan ODM atau proses stitching offline
- menghasilkan orthomosaic RGB
- menghasilkan atau membantu proses NDVI
- melakukan proses berat lain jika dibutuhkan
- menjalankan LLM atau reasoning berat jika ditempatkan di Orin
- mengirim hasil proses ke Raspberry Pi portable yang sedang dipakai

Jetson Orin NX bukan tempat utama database SmartGIS. Database utama tetap berada di Raspberry Pi portable yang menjalankan web.

## Alur Data Utama

```txt
1. Drone terbang mengambil gambar sawah
        |
        v
2. Data drone masuk ke Jetson Orin NX
        |
        v
3. Orin menjalankan ODM / stitching
        |
        v
4. Orin menghasilkan RGB.tif dan NDVI.tif
        |
        v
5. NDVI diproses dengan clustering / threshold
        |
        v
6. Sistem menghasilkan polygon area bermasalah
        |
        v
7. Hasil imagery dan polygon dikirim ke Raspberry Pi portable
        |
        v
8. Raspberry Pi menyimpan metadata ke database lokal
        |
        v
9. User melihat polygon di SmartGIS
        |
        v
10. Portable device dibawa ke polygon untuk ground check
        |
        v
11. User input penyakit pada polygon
        |
        v
12. Sistem menentukan chamber berdasarkan penyakit
        |
        v
13. Sistem membuat mission planning berdasarkan polygon target
```

## Alur SmartGIS

### 1. Imagery

Setelah stitching selesai, sistem memiliki:

- `RGB.tif`
- `NDVI.tif`
- `rgb.png`
- `ndvi_colormap.png`
- corner points gambar

`TIF` disimpan sebagai data asli. `PNG` dipakai untuk tampilan web.

SmartGIS menampilkan:

- overlay RGB
- overlay NDVI
- pilihan sawah
- pilihan tanggal capture
- kontrol layer

### 2. NDVI Polygon

NDVI diproses menggunakan clustering atau threshold.

Output proses ini adalah polygon area bermasalah, misalnya:

- polygon merah
- polygon kuning
- polygon prioritas tinggi

Setiap polygon dapat memiliki metadata:

- geometry polygon
- luas area
- kelas NDVI
- severity
- nilai NDVI ringkas jika tersedia

Polygon adalah unit kerja utama SmartGIS.

### 3. Ground Check Polygon

Setelah polygon terbentuk, portable device dibawa ke lokasi polygon.

Di UI SmartGIS, user memilih atau membuka polygon tersebut, lalu mengisi hasil pengecekan lapangan:

- nama penyakit
- kategori penyakit
- jamur
- bakteri
- tidak ada penyakit
- abaikan
- catatan
- foto bukti jika diperlukan

Ground check ini penting karena NDVI hanya menunjukkan area bermasalah, bukan jenis penyakit secara pasti.

### 4. Chamber Recommendation

Chamber ditentukan dari hasil penyakit pada polygon.

Contoh logic awal:

```txt
jika disease_group = jamur
  chamber = fungisida

jika disease_group = bakteri
  chamber = bakterisida

jika disease_group = tidak ada / abaikan
  chamber = none
```

Jadi:

```txt
NDVI polygon = lokasi target
input penyakit = menentukan chamber
luas polygon = membantu estimasi dosis
```

### 5. Mission Planning

Mission planning dibuat berdasarkan polygon target yang sudah memiliki hasil ground check.

Polygon dapat masuk mission jika:

- severity melewati threshold
- area cukup besar
- tidak diabaikan
- memiliki disease_group yang jelas
- chamber dapat ditentukan

Output mission planning:

- daftar polygon target
- urutan target
- rute geometris
- chamber untuk tiap polygon
- estimasi dosis
- data yang dapat dikirim ke sistem drone

## Alur Pengiriman File dari Orin ke Raspi

File hasil stitching dapat berukuran besar, sehingga tidak dikirim melalui LoRa.

Gunakan jalur data besar:

- Wi-Fi lokal
- kabel LAN
- rsync
- HTTP upload
- USB SSD jika perlu manual

Rekomendasi utama:

```txt
Orin --rsync file besar--> Raspi
Orin --HTTP register metadata--> backend Raspi
```

Contoh alur:

```txt
1. Orin selesai proses ODM
2. Orin mengirim folder hasil ke Raspi memakai rsync
3. Orin memanggil API backend Raspi untuk register file baru
4. Backend Raspi membaca file dan menyimpan metadata ke DB
5. SmartGIS menampilkan data baru
```

LoRa hanya cocok untuk:

- pesan teks kecil
- status
- rekomendasi singkat
- telemetry ringan

LoRa tidak cocok untuk:

- `RGB.tif`
- `NDVI.tif`
- PNG orthomosaic
- file imagery besar

## Database Konseptual

### Tabel Saat Ini

Schema awal yang sudah dipilih:

```txt
fields
field_imagery
```

`fields` menyimpan data sawah.

`field_imagery` menyimpan satu hasil capture/stitching untuk satu sawah.

### Tabel Lanjutan

Untuk workflow polygon sampai mission planning, tabel lanjutan yang dibutuhkan:

```txt
ndvi_polygons
polygon_observations
spray_missions
mission_targets
```

### `ndvi_polygons`

Menyimpan polygon hasil clustering/threshold NDVI.

Contoh data:

- `field_imagery_id`
- `geometry`
- `area_m2`
- `ndvi_class`
- `severity`

### `polygon_observations`

Menyimpan hasil ground check pada polygon.

Contoh data:

- `polygon_id`
- `disease_name`
- `disease_group`
- `notes`
- `photo_path`
- `observed_at`

### `spray_missions`

Menyimpan satu rencana misi penyemprotan.

Contoh data:

- `field_id`
- `field_imagery_id`
- `created_at`
- `status`

### `mission_targets`

Menyimpan target polygon dalam satu mission.

Contoh data:

- `mission_id`
- `polygon_id`
- `sequence_order`
- `chamber`
- `dose`

## UI SmartGIS

SmartGIS sebaiknya dibuat sebagai operational map.

Komponen utama:

- header pilih sawah dan tanggal capture
- map utama
- layer RGB / NDVI
- polygon NDVI
- sidebar daftar polygon
- panel detail polygon
- form input penyakit
- panel mission planning

Tahap UI:

```txt
MVP 1:
  tampilkan RGB/NDVI dan polygon

MVP 2:
  klik polygon dan input penyakit

MVP 3:
  tampilkan chamber recommendation

MVP 4:
  generate dan tampilkan mission route
```

## Fokus Implementasi Terdekat

Fokus terdekat untuk SmartGIS:

```txt
1. Pastikan backend dan database jalan di Raspberry Pi portable
2. Simpan field dan imagery hasil stitching
3. Tampilkan RGB/NDVI di web
4. Tambahkan polygon hasil threshold NDVI
5. Buat UI klik polygon dan input penyakit
6. Tentukan chamber dari disease_group
7. Baru lanjut mission planning
```

Jangan langsung mulai dari mission planning. Fondasi yang harus stabil dulu adalah:

```txt
imagery -> polygon -> ground check -> chamber
```

Mission planning baru masuk setelah polygon dan disease_group sudah jelas.
