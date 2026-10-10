# Bab 07 — Setup & Operasional Sistem

Dokumen ini menjelaskan isi tiap slide Bab 07. Fokus ceritanya adalah bagaimana
sistem Jaga Padi berjalan di perangkat portable berbasis Raspberry Pi: server
lokal, storage data, database, SmartGIS, chatbot, dan deteksi penyakit.

Alur utama:

```txt
Raspberry Pi Portable
  -> menjalankan frontend + backend
  -> menerima data mapping dari Jetson Orin NX
  -> menyimpan file imagery di storage
  -> mencatat metadata di database
  -> menampilkan SmartGIS
  -> menghubungkan Chatbot dan Deteksi Penyakit
```

## Slide 1 — Cover Bab

### Tujuan

Mengenalkan Bab 07 sebagai bagian setup dan operasional sistem portable.

### Isi Utama

```text
BAB 07
Setup & Operasional Sistem
```

### Subjudul

```text
Raspberry Pi, Server Lokal, dan Layanan AI
SmartGIS • Chatbot • Deteksi Penyakit
```

### Visual

- Background putih bersih.
- Raspberry Pi atau mini computer sebagai pusat visual.
- Elemen kecil: Server Lokal, Database/Storage, SmartGIS, Chatbot, Deteksi Penyakit.
- Garis koneksi tipis antar elemen.
- Aksen hijau tua, hijau padi, dan kuning panen.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait untuk cover BAB 07 buku panduan Jaga Padi.
Gunakan background putih bersih, gaya minimal, modern, dan profesional. Visual
utama adalah Raspberry Pi atau mini computer di tengah sebagai pusat sistem.

Di sekitarnya tampilkan elemen kecil yang terhubung garis tipis:
Server Lokal, Database/Storage, SmartGIS, Chatbot, Deteksi Penyakit.

Teks besar:
BAB 07
Setup & Operasional Sistem

Subjudul:
Raspberry Pi, Server Lokal, dan Layanan AI
SmartGIS • Chatbot • Deteksi Penyakit

Gunakan aksen hijau tua, hijau padi, dan kuning panen. Jangan gunakan background
gelap, jangan full foto sawah, dan jangan jadikan drone sebagai fokus utama.
```

## Slide 2 — Peran Raspberry Pi Portable

### Tujuan

Menjelaskan bahwa Raspberry Pi adalah pusat sistem pada perangkat portable.

### Isi Utama

```text
Peran Raspberry Pi Portable
```

### Teks Slide

```text
Raspberry Pi 5 menjadi pusat sistem pada perangkat portable Jaga Padi. Unit ini
menjalankan frontend web, backend API, database lokal, dan penyimpanan file
imagery yang dipakai SmartGIS.

Dengan pola ini, perangkat tetap dapat dipakai mandiri di lapangan dan tidak
bergantung penuh pada komputer utama.
```

### Poin Penting

```text
- Menjalankan frontend SmartGIS.
- Menjalankan backend API.
- Menyimpan database lokal.
- Menyimpan file imagery RGB/NDVI.
- Menerima data hasil proses dari Jetson Orin NX.
- Dapat menjalankan deteksi penyakit lokal jika model dipasang di Raspi.
```

### Visual

- Diagram Raspberry Pi di tengah.
- Cabang ke Frontend, Backend, Database, Storage, AI Service.
- Tampilan perangkat portable/box sebagai konteks.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Peran Raspberry Pi Portable". Background
putih/krem dengan aksen hijau. Tampilkan Raspberry Pi atau mini computer sebagai
pusat diagram. Hubungkan dengan 5 kartu kecil: Frontend Web, Backend API,
Database Lokal, Storage Imagery, AI Service.

Tambahkan ilustrasi sederhana perangkat portable/box dengan layar dashboard
SmartGIS sebagai konteks. Gunakan visual realistis/minimal, bukan kartun ramai.
Teks harus mudah dibaca.
```

## Slide 3 — Struktur Project

### Tujuan

Menjelaskan pembagian folder utama project agar operator/tim teknis tahu bagian
mana yang dijalankan.

### Isi Utama

```text
Struktur Project
```

### Teks Slide

```text
Project Jaga Padi dibagi menjadi dua bagian utama. Folder web berisi frontend
SmartGIS, Chatbot, dan Deteksi Penyakit. Folder server berisi backend FastAPI
yang mengelola API, proses imagery, dan koneksi database.
```

### Struktur Ringkas

```text
web/      Frontend React + Vite
server/   Backend FastAPI
storage/  Penyimpanan imagery RGB/NDVI
```

### Catatan Cerita

Slide ini menjadi jembatan sebelum masuk ke setup server. User teknis perlu
tahu bahwa web dan server dijalankan dari folder berbeda.

### Visual

- Diagram folder tree sederhana.
- Dua blok besar: `web/` dan `server/`.
- Panah dari `server/storage/imagery` ke SmartGIS.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Struktur Project". Background putih
bersih. Tampilkan diagram folder tree modern dengan tiga bagian:
web/ sebagai Frontend React + Vite,
server/ sebagai Backend FastAPI,
server/storage/imagery/ sebagai tempat file RGB/NDVI.

Tambahkan panah sederhana dari storage imagery ke tampilan SmartGIS. Gunakan
ikon folder minimal dan warna hijau-kuning. Jangan terlalu banyak teks.
```

## Slide 4 — Setup Server Lokal

### Tujuan

Menjelaskan cara menjalankan backend dan frontend pada perangkat portable.

### Isi Utama

```text
Setup Server Lokal
```

### Teks Slide

```text
Server lokal menjalankan backend FastAPI dan frontend web. Backend mengelola
API, file imagery, dan proses registrasi data. Frontend menampilkan SmartGIS,
Chatbot, dan Deteksi Penyakit melalui browser.
```

### Command Backend

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Command Frontend

```bash
cd web
bun install
bun run dev
```

### Visual

- Dua terminal/card: Backend dan Frontend.
- Backend: FastAPI.
- Frontend: React + Vite.
- Browser membuka SmartGIS.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Setup Server Lokal". Background putih
bersih dengan aksen hijau. Tampilkan dua kartu terminal modern:
Backend FastAPI dan Frontend React + Vite.

Kartu Backend berisi ringkas:
cd server
source venv/bin/activate
uvicorn main:app --reload

Kartu Frontend berisi ringkas:
cd web
bun run dev

Tambahkan browser kecil yang membuka dashboard SmartGIS. Desain rapi, teknis,
tetapi tetap mudah dibaca untuk buku panduan.
```

## Slide 5 — Alur Data Mapping

### Tujuan

Menjelaskan alur data dari drone mapping sampai hasil RGB/NDVI tampil di
SmartGIS pada perangkat portable.

### Isi Utama

```text
Alur Data Mapping
```

### Teks Slide

```text
Drone melakukan misi pemetaan dan menghasilkan kumpulan foto sawah. Foto hasil
mapping dikirim ke Jetson Orin NX melalui jaringan lokal atau kartu SD.

Di Jetson Orin NX, foto diproses menggunakan OpenDroneMap (ODM) untuk stitching.
Hasil proses ini menghasilkan dua file utama: rgb.tif dan ndvi.tif.

Setelah file siap, Jetson Orin NX mengirim rgb.tif dan ndvi.tif ke Raspberry Pi
portable menggunakan jaringan lokal dengan rsync. Setelah pengiriman selesai,
Jetson Orin NX memanggil endpoint register pada backend Raspberry agar file
tersebut diproses, dicatat, dan ditampilkan di SmartGIS.
```

### Alur Ringkas

```text
Drone mapping
  -> foto mentah sawah
  -> Jetson Orin NX via jaringan lokal / kartu SD
  -> OpenDroneMap (ODM) stitching
  -> rgb.tif + ndvi.tif
  -> rsync ke Raspberry Pi Portable
  -> trigger endpoint register backend Raspberry
  -> convert PNG + simpan metadata
  -> tampil di SmartGIS
```

### Visual

- Diagram alur horizontal/vertikal dari drone sampai SmartGIS.
- Drone mapping sebagai awal alur, bukan fokus utama.
- Kartu file foto mentah masuk ke Jetson Orin NX.
- Label OpenDroneMap (ODM) / Stitching di Jetson Orin NX.
- Dua output file: `rgb.tif` dan `ndvi.tif`.
- Panah `rsync` ke Raspberry Pi Portable.
- Panah `Trigger Register Endpoint` ke backend Raspberry.
- Output akhir: SmartGIS menampilkan RGB/NDVI.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Alur Data Mapping". Background putih
bersih, gaya teknis modern, aksen hijau tua dan kuning panen.

Tampilkan diagram alur sederhana:
Drone Mapping -> Foto Mentah -> Jetson Orin NX -> OpenDroneMap / ODM Stitching
-> rgb.tif + ndvi.tif -> rsync -> Raspberry Pi Portable -> Register Endpoint
-> SmartGIS.

Gunakan visual realistis/minimal: drone kecil di awal, kartu foto mentah,
mini computer Jetson Orin NX, label ODM/Stitching, dua kartu file rgb.tif dan
ndvi.tif, Raspberry Pi portable, lalu mockup layar SmartGIS. Jangan terlalu
ramai; fokus pada alur data dan arah panah.
```

## Slide 6 — Database & Storage

### Tujuan

Menjelaskan pemisahan antara file besar dan metadata.

### Isi Utama

```text
Database & Storage
```

### Teks Slide

```text
File besar seperti rgb.tif, ndvi.tif, rgb.png, dan ndvi.png disimpan di folder
storage. Database tidak menyimpan file besar, tetapi menyimpan metadata seperti
nama lahan, waktu capture, path file, koordinat pojok, dan statistik NDVI.
```

### Struktur Folder

```text
server/storage/imagery/{nama_lahan}/{tanggal_capture}/
  rgb.tif
  ndvi.tif
  rgb.png
  ndvi.png
```

### Poin Penting

```text
- TIF adalah data asli.
- PNG dipakai untuk tampilan web.
- Database menyimpan metadata.
- SmartGIS membaca path dan koordinat dari backend.
```

### Visual

- Folder storage di satu sisi.
- Database metadata di sisi lain.
- Panah menuju SmartGIS.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Database & Storage". Background putih
bersih, aksen hijau tua dan kuning. Tampilkan dua kolom:
Kolom kiri: folder storage berisi rgb.tif, ndvi.tif, rgb.png, ndvi.png.
Kolom kanan: database metadata berisi field name, capture time, file path,
corner coordinates, NDVI stats.

Tambahkan panah dari keduanya menuju SmartGIS. Fokus visual: file besar disimpan
di storage, database hanya menyimpan metadata.
```

## Slide 7 — Integrasi SmartGIS

### Tujuan

Menjelaskan bagaimana frontend SmartGIS memakai data dari backend.

### Isi Utama

```text
Integrasi SmartGIS
```

### Teks Slide

```text
SmartGIS mengambil data lahan, path imagery, koordinat, dan polygon dari backend.
Data tersebut ditampilkan sebagai layer peta, seperti RGB, NDVI, NDVI Zones,
Spray Targets, dan Spraying Route.
```

### Poin Penting

```text
- Frontend membaca data dari backend.
- Backend menyediakan metadata dan path file.
- Leaflet menampilkan overlay RGB/NDVI.
- Polygon dan route ditampilkan sebagai layer interaktif.
```

### Visual

- Backend API di kiri.
- SmartGIS UI di kanan.
- Layer panel: RGB, NDVI, NDVI Zones, Spray Targets, Spraying Route.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Integrasi SmartGIS". Background putih
bersih. Tampilkan diagram sederhana: Backend API mengirim data ke SmartGIS Web.
Di sisi SmartGIS, tampilkan mockup peta dengan layer panel berisi RGB, NDVI,
NDVI Zones, Spray Targets, dan Spraying Route.

Gunakan gaya dashboard aplikasi nyata. Sisakan area screenshot/peta sebagai
placeholder yang nanti bisa diganti dengan screenshot asli aplikasi.
```

## Slide 8 — Chatbot & Deteksi Penyakit

### Tujuan

Menjelaskan bahwa layanan AI terhubung sebagai service terpisah untuk chatbot,
analisis parameter, dan deteksi penyakit.

### Isi Utama

```text
Chatbot & Deteksi Penyakit
```

### Teks Slide

```text
Frontend Jaga Padi terhubung dengan layanan AI untuk Chatbot, Analisis
Parameter, dan Deteksi Penyakit. Chatbot membantu konsultasi pertanian, Analisis
Parameter membantu membaca kondisi sawah, sedangkan Deteksi Penyakit menerima
foto daun untuk mengenali penyakit.
```

### Endpoint Ringkas

```text
Chatbot: /api/chat
Analisis Parameter: /api/analyze
Deteksi Penyakit: /api/detect
```

### Catatan Cerita

Dalam project saat ini, Chatbot dan Analisis Parameter berjalan di service
chatbot. Deteksi Penyakit berjalan di service deteksi tersendiri.

### Visual

- Tiga kartu service: Chatbot, Analisis Parameter, Deteksi Penyakit.
- Frontend Jaga Padi terhubung ke masing-masing service.
- Ikon chat, parameter tanah, dan foto daun.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Chatbot & Deteksi Penyakit". Background
putih bersih dengan aksen hijau. Tampilkan frontend Jaga Padi sebagai pusat
kecil, terhubung ke tiga kartu layanan:
Chatbot,
Analisis Parameter,
Deteksi Penyakit.

Kartu Chatbot menampilkan gelembung chat. Kartu Analisis Parameter menampilkan
parameter tanah. Kartu Deteksi Penyakit menampilkan foto daun padi. Gunakan
visual modern dan realistis, bukan kartun ramai. Sisakan area gambar sebagai
placeholder yang bisa diganti screenshot asli.
```

## Ringkasan Narasi Bab

```text
Bab 07 menjelaskan cara sistem Jaga Padi berjalan secara teknis pada perangkat
portable. Raspberry Pi menjadi pusat server lokal yang menjalankan frontend,
backend, database, dan storage. Data mapping dari Jetson Orin NX masuk ke
storage Raspberry, diproses backend, lalu tampil di SmartGIS. Layanan AI seperti
Chatbot dan Deteksi Penyakit terhubung sebagai fitur pendukung pengguna di
lapangan.
```
