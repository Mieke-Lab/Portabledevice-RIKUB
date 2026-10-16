# Alur Orin ke Raspberry untuk SmartGIS

Dokumen ini menjelaskan alur pengiriman hasil stitching dari Jetson Orin NX ke Raspberry Pi portable sampai data tampil sebagai overlay RGB/NDVI di SmartGIS.

## Tujuan

Jetson Orin NX bertugas menghasilkan file hasil stitching:

- `rgb.tif`
- `ndvi.tif`

Raspberry Pi portable bertugas:

- menerima file dari Orin
- memproses TIF menjadi PNG display
- mengambil corner koordinat dari GeoTIFF
- menyimpan metadata ke database
- menampilkan overlay di web SmartGIS

## Ringkasan Alur

```txt
Jetson Orin NX
  ODM / stitching
  menghasilkan rgb.tif dan ndvi.tif
        |
        | rsync file besar
        v
Raspberry Pi Portable
  menyimpan file di storage/imagery
        |
        | API register
        v
Backend Raspberry
  cek file
  convert TIF -> PNG
  baca corner
  insert database
        |
        v
Frontend SmartGIS
  ambil data dari backend
  tampilkan overlay RGB/NDVI
```

## Pembagian Tugas

### Jetson Orin NX

Tugas Orin:

- menjalankan ODM atau proses stitching
- menghasilkan `rgb.tif`
- menghasilkan `ndvi.tif`
- mengirim file ke Raspberry
- memanggil API backend Raspberry untuk mendaftarkan file baru

Orin tidak menjadi database utama SmartGIS.

### Raspberry Pi Portable

Tugas Raspberry:

- menjalankan backend FastAPI
- menjalankan database lokal
- menjalankan frontend web
- menyimpan file imagery
- memproses TIF menjadi PNG display
- menyajikan file PNG ke frontend

Raspberry menjadi pusat data untuk unit portable tersebut.

## Struktur Folder di Raspberry

Struktur folder dibuat sederhana tetapi tetap mendukung satu sawah punya banyak capture.

```txt
server/
  storage/
    imagery/
      {field_slug}/
        {capture_slug}/
          rgb.tif
          ndvi.tif
          rgb.png
          ndvi.png
```

Contoh:

```txt
server/storage/imagery/
  sawah-demo/
    2026-06-16-0930/
      rgb.tif
      ndvi.tif
      rgb.png
      ndvi.png
```

Makna:

- `rgb.tif`: file RGB asli dari Orin
- `ndvi.tif`: file NDVI asli dari Orin
- `rgb.png`: file display untuk frontend
- `ndvi.png`: file display NDVI yang sudah diberi colormap

## Langkah 1: Orin Mengirim File ke Raspberry

File orthomosaic biasanya besar, jadi gunakan `rsync` melalui Wi-Fi/LAN.

Contoh command dari Orin:

```bash
rsync -avP rgb.tif ndvi.tif \
  pi@RASPI_IP:/home/pi/Portabledevice-RIKUB/server/storage/imagery/sawah-demo/2026-06-16-0930/
```

Setelah command ini berhasil, file ada di Raspberry:

```txt
server/storage/imagery/sawah-demo/2026-06-16-0930/rgb.tif
server/storage/imagery/sawah-demo/2026-06-16-0930/ndvi.tif
```

## Langkah 2: Orin Mendaftarkan File ke Backend Raspberry

Setelah file terkirim, Orin memanggil API backend Raspberry.

Endpoint:

```txt
POST /fields/{field_id}/imagery/register
```

Contoh:

```bash
curl -X POST http://RASPI_IP:8000/fields/FIELD_ID/imagery/register \
  -H "Content-Type: application/json" \
  -d '{
    "capture_at": "2026-06-16T09:30:00",
    "rgb_tif_path": "storage/imagery/sawah-demo/2026-06-16-0930/rgb.tif",
    "ndvi_tif_path": "storage/imagery/sawah-demo/2026-06-16-0930/ndvi.tif"
  }'
```

API `register` tidak mengirim file. API ini hanya memberi tahu backend:

```txt
File sudah ada di folder ini, tolong proses dan catat.
```

Analogi:

```txt
rsync = menaruh paket di meja Raspberry
register API = memberi tahu backend bahwa paket sudah sampai
```

## Langkah 3: Backend Raspberry Memproses File

Setelah menerima request register, backend:

1. mengecek `rgb.tif` dan `ndvi.tif` ada
2. membaca corner koordinat dari GeoTIFF
3. mengubah `rgb.tif` menjadi `rgb.png`
4. mengubah `ndvi.tif` menjadi `ndvi.png` dengan colormap
5. menyimpan metadata ke database
6. mengembalikan response ke Orin/frontend

Output di folder yang sama:

```txt
rgb.tif
ndvi.tif
rgb.png
ndvi.png
```

## Langkah 4: Database Menyimpan Metadata

Untuk tahap overlay, database cukup memakai:

```txt
fields
field_imagery
```

`fields` menyimpan data sawah.

`field_imagery` menyimpan satu capture/stitching milik sawah.

Data yang disimpan di `field_imagery`:

- `field_id`
- `capture_at`
- `rgb_tif_path`
- `ndvi_tif_path`
- `rgb_png_path`
- `ndvi_png_path`
- `top_left`
- `top_right`
- `bottom_left`
- `bottom_right`
- `created_at`

Contoh path:

```txt
rgb_tif_path:
storage/imagery/sawah-demo/2026-06-16-0930/rgb.tif

ndvi_tif_path:
storage/imagery/sawah-demo/2026-06-16-0930/ndvi.tif

rgb_png_path:
/imagery/sawah-demo/2026-06-16-0930/rgb.png

ndvi_png_path:
/imagery/sawah-demo/2026-06-16-0930/ndvi.png
```

## Langkah 5: Frontend SmartGIS Menampilkan Overlay

Frontend meminta data imagery ke backend.

Contoh endpoint:

```txt
GET /fields/{field_id}/imagery/latest
```

Contoh response:

```json
{
  "id": "imagery-id",
  "field_id": "field-id",
  "capture_at": "2026-06-16T09:30:00",
  "rgb_png_path": "/imagery/sawah-demo/2026-06-16-0930/rgb.png",
  "ndvi_png_path": "/imagery/sawah-demo/2026-06-16-0930/ndvi.png",
  "top_left": {
    "lat": -8.1514067,
    "lng": 113.737395
  },
  "top_right": {
    "lat": -8.1514017,
    "lng": 113.7381267
  },
  "bottom_left": {
    "lat": -8.1523375,
    "lng": 113.7374014
  },
  "bottom_right": {
    "lat": -8.1523326,
    "lng": 113.738133
  }
}
```

SmartGIS kemudian menampilkan:

- layer RGB dari `rgb_png_path`
- layer NDVI dari `ndvi_png_path`
- posisi overlay dari corner points

## Kenapa Tidak Upload Langsung Lewat API?

Bisa, tetapi untuk file besar lebih aman memakai `rsync`.

Perbandingan:

```txt
rsync + register:
  lebih kuat untuk file besar
  bisa resume kalau transfer putus
  cocok untuk lapangan

HTTP upload:
  lebih sederhana
  tetapi kalau putus biasanya upload ulang
  backend menerima beban file besar
```

Untuk project ini, rekomendasi utama:

```txt
Orin --rsync--> Raspi
Orin --register API--> Backend Raspi
```

## Simulasi Lokal

Di laptop/repo lokal, simulasi bisa dibuat seperti:

```txt
contoh-orthommosaic-drone/
  rgb.tif
  ndvi.tif
```

dianggap sebagai output Orin.

Lalu file diproses menjadi:

```txt
server/storage/imagery/sawah-demo/2026-06-16-0930/
  rgb.tif
  ndvi.tif
  rgb.png
  ndvi.png
```

Setelah simulasi berhasil, alur yang sama bisa dipakai di Raspberry.

## Fokus Implementasi Berikutnya

Urutan implementasi yang disarankan:

```txt
1. Buat endpoint POST /fields
2. Buat endpoint GET /fields
3. Buat endpoint POST /fields/{field_id}/imagery/register
4. Backend proses TIF menjadi PNG
5. Backend insert ke field_imagery
6. Frontend mengambil imagery dari backend
7. Frontend menampilkan overlay RGB/NDVI
```

Jangan mulai dari polygon atau mission planning dulu. Untuk saat ini, fokusnya:

```txt
Orin menghasilkan TIF
Raspberry menerima TIF
Backend menghasilkan PNG
SmartGIS menampilkan overlay
```
