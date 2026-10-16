# Outline Slide — Bab 05 (SmartGIS) & Bab 07 (Panduan Teknis Sistem)

Draft untuk direview sebelum dipindah ke Canva. Jumlah & pembagian slide mengikuti
kepadatan bab lain di template (Sistem Deteksi Penyakit = 4 slide, Perangkat Keras = 3 slide).

---

## Bab 05 — SmartGIS: Peta & Analisis Lahan
*(5 slide, gaya bahasa untuk petani/end-user)*

### Slide 1 — Cover Bab
- Judul: **SmartGIS — Peta & Analisis Lahan**
- Nomor bab: 05
- Paragraf intro (1 kalimat pendek): SmartGIS menampilkan peta udara sawah hasil
  pemetaan drone, lengkap dengan analisis kesehatan tanaman lewat NDVI — membantu
  menemukan area bermasalah tanpa mengecek satu per satu ke seluruh sawah.
- Visual: screenshot peta SmartGIS full-screen sebagai background/cover

### Slide 2 — Akses & Pilih Lahan
- Judul kecil: "Akses GUI" (konsisten dengan pola bab Deteksi Penyakit)
- Langkah bernomor:
  1. Dari menu utama, buka **SmartGIS**
  2. Di panel **Pilih Lahan**, pilih nama sawah
  3. Tekan ikon penanda untuk menyorot lokasi lahan di peta
  4. Gunakan kolom pencarian untuk menuju lokasi tertentu
- Visual: screenshot panel "Pilih Lahan" + search bar

### Slide 3 — Lapisan Peta (Layers)
- Judul: "Lapisan Peta — RGB & NDVI"
- Penjelasan singkat: RGB = foto udara asli, NDVI = kondisi kesehatan tanaman
  dalam warna (hijau sehat → merah perlu diperiksa)
- Tabel kategori NDVI:

  | Kategori | Rentang NDVI |
  |---|---|
  | Sangat Sehat | 0.8 – 1.0 |
  | Sehat | 0.6 – 0.8 |
  | Cukup Sehat | 0.4 – 0.6 |
  | Kurang Sehat | 0.21 – 0.4 |
  | Tidak Sehat | 0 – 0.21 |
  | Non-Vegetasi | < 0 |
- Visual: toggle icon Layers + contoh overlay NDVI berwarna

### Slide 4 — Menentukan Zona Bermasalah
- Judul: "Zona NDVI"
- Isi:
  - Geser ambang batas minimum/maksimum di panel **Zona NDVI**
  - Peta menampilkan pratinjau zona sesuai ambang yang dipilih
  - Tekan **Simpan sebagai Target Semprot** untuk menyimpan zona
- Visual: screenshot slider ambang + preview zona warna di peta

### Slide 5 — Target Semprot
- Judul: "Target Semprot"
- Isi:
  - Semua zona tersimpan muncul di panel **Target Semprot**
  - Tekan **Lihat di Peta** untuk fokus ke lokasi target
  - Klik langsung zona merah di peta → muncul popup: nama penyakit, tingkat
    keyakinan (%), foto, chamber rekomendasi, dan lokasi
  - Data ini jadi dasar rute penyemprotan otomatis di bab **Mode Drone**
- Visual: screenshot popup target semprot (merah) yang menampilkan deteksi penyakit

---

## Bab 07 — Panduan Teknis Sistem
*(5 slide, gaya bahasa teknis untuk tim/operator — kredit: Dimas & Nopal)*

### Slide 1 — Cover Bab
- Judul: **Panduan Teknis Sistem**
- Nomor bab: 07
- Subjudul: Arsitektur, pengelolaan data, dan setup untuk tim teknis
- Kredit: "Disusun oleh Dimas & Nopal"

### Slide 2 — Arsitektur Web Mapping
- Judul: "Arsitektur Web Mapping"
- Diagram alur (5 lapisan):
  ```
  Drone → Jetson Orin NX (stitching, hasilkan rgb.tif & ndvi.tif)
        → rsync → Raspberry Pi Portable (storage/imagery)
        → Backend FastAPI (convert TIF→PNG, baca corner GeoTIFF)
        → PostgreSQL (metadata)
        → Frontend React+Vite+Leaflet (overlay RGB/NDVI di SmartGIS)
  ```
- Stack ringkas: Frontend React 19 + Vite + Leaflet · Backend FastAPI + SQLAlchemy
  · DB PostgreSQL · GIS processing GDAL/rasterio
- Prinsip: TIF asli = sumber data, PNG = tampilan saja, DB simpan metadata bukan file besar

### Slide 3 — SOP Pengelolaan Data
- Judul: "SOP Pengelolaan Data"
- Langkah bernomor:
  1. Kirim `rgb.tif` & `ndvi.tif` dari Orin ke Raspberry lewat `rsync`
     (bukan LoRa — LoRa hanya untuk pesan kecil/telemetry)
  2. Panggil endpoint registrasi (`POST /fields/{field_id}/imagery/register`)
     supaya backend tahu file sudah ada
  3. Backend otomatis: cek file → baca corner GeoTIFF → convert TIF ke PNG →
     hitung statistik NDVI → simpan ke database
  4. Struktur folder konsisten:
     `server/storage/imagery/{field_slug}/{capture_slug}/{rgb,ndvi}.{tif,png}`
- Visual: diagram folder tree / contoh payload curl

### Slide 4 — Setup Server
- Judul: "Setup Server"
- Dependency wajib: Python venv, FastAPI, SQLAlchemy, PostgreSQL, GDAL CLI
  (`gdalinfo`, `gdal_translate`), Python package `rasterio`, `numpy`,
  `matplotlib`, `Pillow`
- Command backend:
  ```bash
  cd server
  python -m venv venv
  source venv/bin/activate   # Windows: venv\Scripts\activate
  pip install -r requirements.txt
  uvicorn main:app --reload
  ```
- Command frontend:
  ```bash
  cd web
  bun install
  bun run dev        # build produksi: bun run build
  ```

### Slide 5 — Petunjuk Teknis Peta & Chatbot
- Judul: "Petunjuk Teknis Peta & Chatbot"
- Peta (Mapping):
  - Sesi pemetaan dikelola lewat gRPC `soerogis.MappingJobService`
  - Status berjalan: `unstitched → stitching → clustering → ready`
  - File besar (orthophoto, cluster KML) disajikan lewat static file server
    terpisah (port `8000`), bukan lewat gRPC
- Chatbot & AI (dari `web/src/api.js`):
  - Chatbot: `:5000/api/chat`
  - Analisis parameter: `:5000/api/analyze`
  - Deteksi penyakit: `:5001/api/detect`
  - Kalau digabung ke backend FastAPI utama, `web/src/api.js` perlu diarahkan
    ke endpoint baru

---

## Catatan
- Total tambahan: 10 slide (5 + 5), semua isinya ditarik dari kode/docs yang
  sudah ada di repo (`docs/imagery-pipeline.md`, `docs/orin-to-raspi-imagery-flow.md`,
  `README.md`, `web/src/pages/Maps.jsx`) — bukan asumsi.
- Setelah direview, tahap selanjutnya: convert jadi konten teks final per
  slide untuk di-push ke file Canva.
