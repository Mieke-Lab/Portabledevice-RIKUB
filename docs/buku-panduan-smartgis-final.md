# Draft Buku Panduan SmartGIS

Naskah ini dibuat mengikuti gaya template Canva buku panduan: ringkas, langsung
ke langkah penggunaan, dan siap dipindah ke slide.

## 05 - SmartGIS: Peta & Analisis Lahan

### Halaman 1 - SmartGIS

SmartGIS membantu pengguna melihat kondisi sawah melalui peta udara hasil
pemetaan drone. Peta ini menampilkan citra RGB, citra NDVI, zona tanaman yang
perlu diperiksa, serta target semprot yang dapat digunakan untuk perencanaan
misi drone.

Dengan SmartGIS, pengguna tidak perlu mengecek seluruh area sawah satu per satu.
Area yang terlihat bermasalah dapat langsung ditandai, diperiksa di lapangan,
dan dijadikan dasar penyemprotan yang lebih tepat.

### Halaman 2 - Akses GUI

Langkah penggunaan:

1. Dari menu utama, pilih **SmartGIS**.
2. Pada panel kiri, buka bagian **Pilih Lahan**.
3. Pilih nama sawah yang ingin dilihat.
4. Gunakan tombol penanda untuk memusatkan peta ke lokasi lahan.
5. Gunakan kolom pencarian jika ingin menuju lokasi tertentu.

Setelah lahan dipilih, peta akan menampilkan area sawah beserta lapisan data
yang tersedia.

### Halaman 3 - Lapisan Peta

SmartGIS memiliki beberapa lapisan peta yang dapat dinyalakan sesuai kebutuhan.

**RGB** menampilkan foto udara asli dari hasil pemetaan drone. Lapisan ini
berguna untuk melihat bentuk sawah, batas lahan, jalan, dan kondisi visual
tanaman.

**NDVI** menampilkan kondisi kesehatan tanaman dalam bentuk warna. Warna hijau
menunjukkan tanaman lebih sehat, sedangkan warna kuning sampai merah menunjukkan
area yang perlu diperiksa lebih lanjut.

Kategori NDVI:

| Kategori | Rentang NDVI |
| --- | --- |
| Sangat Sehat | 0.8-1.0 |
| Sehat | 0.6-0.8 |
| Cukup Sehat | 0.4-0.6 |
| Kurang Sehat | 0.21-0.4 |
| Tidak Sehat | 0-0.21 |
| Non-Vegetasi | < 0 |

### Halaman 4 - Zona NDVI

Zona NDVI digunakan untuk memilih area sawah yang perlu mendapat perhatian.

Langkah penggunaan:

1. Buka panel **Zona NDVI**.
2. Atur batas minimum dan maksimum NDVI.
3. Lihat pratinjau zona yang muncul di peta.
4. Jika zona sudah sesuai, tekan **Simpan sebagai Target Semprot**.

Zona yang tersimpan akan menjadi data target untuk pengecekan lapangan dan
perencanaan penyemprotan.

### Halaman 5 - Target Semprot

Target Semprot berisi daftar zona bermasalah yang sudah disimpan dari hasil
analisis NDVI.

Pengguna dapat menekan **Lihat di Peta** untuk memusatkan tampilan ke target
tertentu. Saat area berwarna merah pada peta diklik, sistem menampilkan popup
berisi informasi penyakit, lokasi target, tingkat keyakinan deteksi, foto
pendukung, dan rekomendasi chamber penyemprotan.

Data target semprot ini menjadi dasar untuk menentukan area mana yang perlu
disemprot dan jenis cairan apa yang harus digunakan.

## 07 - Panduan Teknis Sistem

### Halaman 1 - Panduan Teknis Sistem

Bagian ini menjelaskan arsitektur web mapping, pengelolaan data, setup server,
serta petunjuk teknis peta dan chatbot.

Disusun oleh: **Dimas & Nopall**

### Halaman 2 - Arsitektur Web Mapping

Alur utama sistem:

```txt
Drone
  -> Jetson Orin NX
  -> Raspberry Pi Portable
  -> Backend FastAPI
  -> PostgreSQL
  -> Frontend SmartGIS
```

Drone mengambil gambar sawah. Jetson Orin NX memproses gambar tersebut menjadi
hasil stitching berupa `rgb.tif` dan `ndvi.tif`. File hasil proses dikirim ke
Raspberry Pi Portable, lalu backend FastAPI mengubah file TIF menjadi PNG,
membaca koordinat GeoTIFF, dan menyimpan metadata ke database.

Frontend SmartGIS membaca data dari backend dan menampilkannya sebagai overlay
peta menggunakan React, Vite, dan Leaflet.

Prinsip penyimpanan data:

- File TIF adalah data asli.
- File PNG digunakan untuk tampilan web.
- Database menyimpan metadata, bukan file besar.

### Halaman 3 - SOP Pengelolaan Data

SOP pengelolaan data imagery:

1. Jalankan pemetaan drone sampai menghasilkan data orthomosaic.
2. Proses data pada Jetson Orin NX sampai tersedia `rgb.tif` dan `ndvi.tif`.
3. Kirim file besar ke Raspberry Pi menggunakan Wi-Fi, LAN, USB, atau `rsync`.
4. Simpan file pada struktur folder:

```txt
server/storage/imagery/{nama_lahan}/{tanggal_capture}/
  rgb.tif
  ndvi.tif
```

5. Panggil endpoint registrasi imagery agar backend memproses file.
6. Backend mengecek file, membaca corner GeoTIFF, membuat PNG, menghitung
   statistik NDVI, lalu menyimpan metadata.
7. Buka halaman SmartGIS untuk memastikan lahan dan overlay sudah tampil.

Catatan: LoRa tidak digunakan untuk mengirim file citra karena ukuran file
terlalu besar. LoRa hanya cocok untuk data kecil seperti telemetry.

### Halaman 4 - Setup Server

Backend:

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:

```bash
cd web
bun install
bun run dev
```

Dependency server yang dibutuhkan:

- FastAPI
- SQLAlchemy
- PostgreSQL
- GDAL CLI: `gdalinfo`, `gdal_translate`
- rasterio
- numpy
- matplotlib
- Pillow

Jika `gdal_translate` atau package pengolah NDVI belum tersedia, proses
registrasi imagery dapat gagal karena backend tidak bisa membuat file PNG untuk
ditampilkan di peta.

### Halaman 5 - Petunjuk Teknis Peta & Chatbot

Peta SmartGIS menampilkan data lahan, overlay RGB, overlay NDVI, zona NDVI, dan
target semprot. Area merah pada peta dapat diklik untuk melihat informasi
penyakit dan lokasi target.

Alur teknis peta:

1. Frontend meminta daftar lahan dan imagery ke backend.
2. Backend mengirim metadata, path PNG, dan koordinat corner.
3. Leaflet menampilkan PNG sebagai overlay pada posisi koordinat yang sesuai.
4. Zona NDVI dan target semprot ditampilkan sebagai polygon interaktif.
5. Klik polygon membuka popup detail penyakit, lokasi, dan rekomendasi chamber.

Endpoint AI yang digunakan frontend:

| Fitur | Endpoint |
| --- | --- |
| Chatbot | `:5000/api/chat` |
| Analisis parameter | `:5000/api/analyze` |
| Deteksi penyakit | `:5001/api/detect` |

Jika service AI digabung ke backend utama, konfigurasi endpoint pada frontend
perlu diarahkan ke route FastAPI yang baru.
