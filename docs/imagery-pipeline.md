# Imagery Pipeline RGB dan NDVI

Dokumen ini menjelaskan rancangan alur data dari hasil stitching drone sampai tampil sebagai overlay di web mapping.

## Tujuan

Sistem perlu menerima hasil stitching dari DJIAG berupa:

- `RGB.tif`
- `NDVI.tif`

File tersebut kemudian disimpan sebagai data asli, diproses menjadi gambar siap tampil, dicatat ke PostgreSQL, lalu ditampilkan di Leaflet sebagai image overlay.

## Ringkasan Alur

```txt
Drone mengambil foto
        |
        v
DJIAG melakukan stitching
        |
        v
Repo Playwright mengunduh:
  RGB.tif
  NDVI.tif
        |
        v
Repo Playwright menyimpan file dan memanggil API backend
        |
        v
Backend membaca GeoTIFF, mengambil corner points, dan membuat PNG display
        |
        v
PostgreSQL menyimpan metadata file, koordinat, dan tanggal
        |
        v
Frontend mengambil metadata dari backend
        |
        v
Leaflet menampilkan RGB/NDVI dengan L.imageOverlay
```

## Pembagian Tanggung Jawab

### Repo Playwright

Repo Playwright bertugas sebagai otomasi DJIAG.

Tanggung jawab:

- membuka DJIAG
- upload foto drone
- menunggu proses stitching selesai
- download `RGB.tif` dan `NDVI.tif`
- menyimpan file ke folder atau storage
- memanggil API backend untuk mendaftarkan hasil stitching

Repo Playwright sebaiknya tidak menjadi tempat utama untuk:

- analisis NDVI
- colormap NDVI
- insert langsung ke PostgreSQL
- perhitungan zona merah
- perhitungan dosis
- mission planning

Playwright cukup menjadi producer data.

### Backend

Backend menjadi pusat pengolahan dan pencatatan data.

Tanggung jawab:

- menerima laporan hasil stitching dari Playwright
- menyimpan metadata ke PostgreSQL
- menjalankan `gdalinfo` untuk membaca corner points GeoTIFF
- mengubah `RGB.tif` menjadi PNG display
- mengubah `NDVI.tif` menjadi PNG berwarna atau colormap
- menyimpan path file asli dan file display
- menyediakan API untuk frontend

Backend adalah tempat yang tepat untuk aturan GIS karena semua proses data berada di satu lapisan yang konsisten.

### PostgreSQL

PostgreSQL menyimpan metadata, bukan file besar.

Yang disimpan:

- data sawah
- tanggal pengambilan data
- path file `RGB.tif`
- path file `NDVI.tif`
- path file `rgb.png`
- path file `ndvi_colormap.png`
- corner points gambar
- tanggal capture

File besar seperti `.tif` dan `.png` sebaiknya tetap disimpan di filesystem atau object storage.

### Frontend Maps

Frontend bertugas menampilkan data.

Tanggung jawab:

- mengambil daftar sawah dari backend
- mengambil imagery terbaru atau imagery berdasarkan tanggal
- menampilkan RGB/NDVI sebagai image overlay
- menyediakan kontrol layer RGB dan NDVI
- melakukan `fitBounds` ke area sawah

Frontend tidak perlu membaca `.tif` secara langsung.

## Kenapa TIF Asli Tetap Disimpan

`RGB.tif` dan `NDVI.tif` adalah data sumber.

TIF asli tetap penting karena:

- punya georeference
- dapat diproses ulang
- dapat dibuat ulang menjadi PNG dengan style berbeda
- NDVI float asli dapat dipakai untuk threshold
- dapat dipakai untuk menghitung zona merah
- dapat dipakai untuk validasi dan analisis lanjutan

PNG hanya digunakan sebagai data display untuk browser.

## Kenapa NDVI Perlu Colormap

`NDVI.tif` biasanya berisi nilai numerik, bukan gambar warna siap tampil.

Contoh nilai NDVI:

```txt
0.12
0.35
0.78
0.91
```

Untuk ditampilkan di map, nilai tersebut perlu diubah menjadi warna:

```txt
nilai rendah  -> merah
nilai sedang  -> kuning
nilai tinggi  -> hijau
nodata        -> transparan
```

Hasil akhirnya:

```txt
NDVI.tif -> ndvi_colormap.png
```

Frontend menampilkan `ndvi_colormap.png`, bukan `NDVI.tif`.

## Struktur File yang Disarankan

Contoh struktur storage lokal:

```txt
data/
  imagery/
    sawah-001/
      2026-06-14/
        original/
          RGB.tif
          NDVI.tif
        display/
          rgb.png
          ndvi_colormap.png
```

Jika file display perlu diakses langsung oleh frontend, file dapat disajikan melalui backend static files atau folder public.

Contoh URL display:

```txt
/imagery/sawah-001/2026-06-14/display/rgb.png
/imagery/sawah-001/2026-06-14/display/ndvi_colormap.png
```

## API dari Playwright ke Backend

Setelah Playwright selesai download hasil stitching, Playwright memanggil backend.

Contoh endpoint:

```txt
POST /imagery-runs
```

Contoh payload:

```json
{
  "field_id": "sawah-001",
  "capture_at": "2026-06-14T09:30:00",
  "rgb_tif_path": "/data/imagery/sawah-001/2026-06-14/original/RGB.tif",
  "ndvi_tif_path": "/data/imagery/sawah-001/2026-06-14/original/NDVI.tif"
}
```

Backend kemudian:

1. menerima path file asli dari Playwright
2. membaca metadata GeoTIFF
3. mengambil corner points gambar
4. generate PNG display
5. menyimpan path TIF, path PNG, corner points, dan waktu capture ke database

## API dari Backend ke Frontend

Contoh endpoint:

```txt
GET /fields
GET /fields/{field_id}
GET /fields/{field_id}/imagery
GET /fields/{field_id}/imagery/latest
```

Contoh response imagery:

```json
{
  "id": "imagery-run-001",
  "field_id": "sawah-001",
  "capture_at": "2026-06-14T09:30:00",
  "top_left": {
    "lat": -8.154877823309631,
    "lng": 113.78920882250384
  },
  "top_right": {
    "lat": -8.15434911569647,
    "lng": 113.78933409642616
  },
  "bottom_left": {
    "lat": -8.154970828747976,
    "lng": 113.78960940357385
  },
  "bottom_right": {
    "lat": -8.154442121134815,
    "lng": 113.78973467749617
  },
  "layers": {
    "rgb": {
      "url": "/imagery/sawah-001/2026-06-14/display/rgb.png",
      "opacity": 0.85
    },
    "ndvi": {
      "url": "/imagery/sawah-001/2026-06-14/display/ndvi_colormap.png",
      "opacity": 0.75
    }
  }
}
```

Frontend menggunakan response tersebut untuk membuat rotated overlay jika plugin tersedia:

```js
L.imageOverlay.rotated(
  layer.url,
  [imagery.top_left.lat, imagery.top_left.lng],
  [imagery.top_right.lat, imagery.top_right.lng],
  [imagery.bottom_left.lat, imagery.bottom_left.lng],
  { opacity: layer.opacity },
);
```

Jika masih memakai `L.imageOverlay` bawaan Leaflet, frontend dapat menghitung bounds dari nilai minimum dan maksimum latitude/longitude keempat corner tersebut.

## Schema Database Awal

Schema awal cukup fokus pada sawah dan imagery.

### `fields`

Menyimpan data sawah.

```sql
CREATE TABLE fields (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

### `field_imagery`

Menyimpan satu hasil penerbangan atau satu hasil stitching.

```sql
CREATE TABLE field_imagery (
  id UUID PRIMARY KEY,
  field_id UUID NOT NULL REFERENCES fields(id) ON DELETE CASCADE,

  capture_at TIMESTAMP,

  rgb_tif_path TEXT NOT NULL,
  ndvi_tif_path TEXT NOT NULL,
  rgb_png_path TEXT,
  ndvi_png_path TEXT,

  top_left JSONB NOT NULL,
  top_right JSONB NOT NULL,
  bottom_left JSONB NOT NULL,
  bottom_right JSONB NOT NULL,

  created_at TIMESTAMP DEFAULT now()
);
```

Catatan:

- `fields` menyimpan identitas sawah.
- `field_imagery` menyimpan satu versi imagery untuk satu sawah.
- Satu sawah dapat memiliki banyak record `field_imagery`.
- Kolom `top_left`, `top_right`, `bottom_left`, dan `bottom_right` memakai `JSONB` berisi pasangan `lat` dan `lng`.
- Format corner point mengikuti bentuk:

```json
{
  "lat": -8.154877823309631,
  "lng": 113.78920882250384
}
```

## GDAL Processing

Backend dapat menggunakan GDAL untuk membaca dan mengolah GeoTIFF.

Ambil metadata:

```bash
gdalinfo RGB.tif
gdalinfo -stats NDVI.tif
```

Convert RGB ke PNG:

```bash
gdal_translate -of PNG RGB.tif rgb.png
```

Colorize NDVI:

```bash
gdaldem color-relief NDVI.tif ndvi-color-ramp.txt ndvi_colormap.tif -alpha
gdal_translate -of PNG ndvi_colormap.tif ndvi_colormap.png
```

Contoh color ramp awal:

```txt
nv 0 0 0 0
0.00 160 32 32 0
0.20 198 45 38 220
0.40 235 120 40 230
0.60 246 210 80 235
0.75 150 205 75 240
0.90 40 150 65 245
1.00 0 104 55 255
```

Color ramp ini bisa diganti nanti berdasarkan kebutuhan agronomis atau validasi ahli.

## Tahapan Implementasi

### Tahap 1: Manual Overlay

Target:

- file `RGB.tif` dan `NDVI.tif` sudah ada
- backend bisa register file secara manual
- backend bisa generate `rgb.png` dan `ndvi_colormap.png`
- frontend bisa menampilkan overlay RGB/NDVI

### Tahap 2: Integrasi Playwright

Target:

- Playwright otomatis download hasil stitching
- Playwright menyimpan file ke struktur folder yang disepakati
- Playwright memanggil endpoint registrasi imagery
- backend memproses file sampai PNG display siap digunakan

### Tahap 3: Pilih Sawah dan Tanggal

Target:

- frontend dapat menampilkan daftar sawah
- user dapat memilih sawah
- user dapat memilih tanggal penerbangan
- map menampilkan overlay sesuai pilihan

### Tahap 4: Observasi Penyakit

Target:

- user dapat klik titik pada map
- user dapat melihat atau mengisi diagnosis penyakit
- data diagnosis tersimpan sebagai observasi
- klasifikasi awal cukup `jamur` atau `bakteri`

### Tahap 5: NDVI Zones

Target:

- backend menganalisis `NDVI.tif`
- area bermasalah dideteksi dari threshold
- area merah disimpan sebagai polygon
- luas area dihitung
- area bisa diklik di peta

### Tahap 6: Rekomendasi Semprot

Target:

- sistem menentukan chamber berdasarkan penyakit
- sistem menghitung dosis sederhana berdasarkan luas area
- sistem menyiapkan data untuk mission planning

## Fokus Saat Ini

Fokus terdekat sebaiknya:

```txt
RGB.tif + NDVI.tif
-> backend register imagery
-> backend generate RGB.png + NDVI_colormap.png
-> frontend tampilkan image overlay
```

Jangan mulai dari `ndvi_zones` dulu sebelum overlay dasar stabil.

## Prinsip Desain

- Simpan TIF asli sebagai sumber kebenaran.
- Tampilkan PNG di browser.
- PostgreSQL menyimpan metadata, bukan file besar.
- Playwright hanya mengurus otomasi DJIAG dan download.
- Backend mengurus validasi dan proses GIS.
- Frontend hanya menampilkan data siap pakai.
