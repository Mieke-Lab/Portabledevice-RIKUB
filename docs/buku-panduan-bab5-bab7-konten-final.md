# Konten Final Siap Tempel — Bab 05 (SmartGIS) & Bab 07 (Panduan Teknis Sistem)

Teks di bawah ini sudah final (bukan bullet outline lagi) — tinggal copy-paste
langsung ke text box di Canva begitu editing transaction-nya normal, atau
diketik manual kalau mau dikerjakan lewat Canva langsung.

Rujukan: outline slide ada di `buku-panduan-bab5-bab7-outline.md` di folder yang
sama. Semua isi ditarik dari kode/docs yang sudah ada di repo
(`docs/imagery-pipeline.md`, `docs/orin-to-raspi-imagery-flow.md`, `README.md`,
`web/src/pages/Maps.jsx`) — bukan asumsi.

---

## BAB 05 — SmartGIS: Peta & Analisis Lahan

*Gaya bahasa: santai, untuk petani/end-user. Mengikuti nada bab lain di buku
("Selamat datang di Jaga Padi...").*

### Slide 1 — Cover Bab

**Nomor bab:** 05

**Judul:**
> SmartGIS — Peta & Analisis Lahan

**Body:**
> SmartGIS menampilkan peta udara sawah Anda hasil pemetaan drone, lengkap
> dengan analisis kesehatan tanaman lewat NDVI. Anda bisa langsung melihat
> area mana yang bermasalah tanpa perlu mengecek satu per satu ke seluruh
> sawah, lalu menandainya sebagai target untuk penyemprotan.

**Catatan visual:** screenshot peta SmartGIS full-screen sebagai background cover.

---

### Slide 2 — Akses & Pilih Lahan

**Judul kecil:** Akses GUI

**Langkah:**
> 1. Dari menu utama, buka **SmartGIS**.
> 2. Di panel **Pilih Lahan**, pilih nama sawah yang ingin dilihat.
> 3. Tekan ikon penanda untuk menyorot lokasi lahan di peta.
> 4. Gunakan kolom pencarian untuk langsung menuju lokasi tertentu.

**Catatan visual:** screenshot panel "Pilih Lahan" + kolom pencarian lokasi.

---

### Slide 3 — Lapisan Peta (Layers)

**Judul:** Lapisan Peta — RGB & NDVI

**Body:**
> Aktifkan lapisan **RGB** untuk melihat foto udara asli sawah, atau lapisan
> **NDVI** untuk melihat kondisi kesehatan tanaman dalam warna — hijau
> menandakan tanaman sehat, kuning hingga merah menandakan area yang perlu
> diperiksa.

**Tabel:**

| Kategori | Rentang NDVI |
|---|---|
| Sangat Sehat | 0.8 – 1.0 |
| Sehat | 0.6 – 0.8 |
| Cukup Sehat | 0.4 – 0.6 |
| Kurang Sehat | 0.21 – 0.4 |
| Tidak Sehat | 0 – 0.21 |
| Non-Vegetasi | < 0 |

**Catatan visual:** ikon toggle Layers + contoh overlay NDVI berwarna di atas peta.

---

### Slide 4 — Menentukan Zona Bermasalah

**Judul:** Zona NDVI

**Body:**
> Di panel **Zona NDVI**, geser ambang batas minimum dan maksimum untuk
> menyaring area yang ingin difokuskan. Peta akan langsung menampilkan
> pratinjau zona sesuai ambang yang dipilih. Jika sudah sesuai, tekan
> **Simpan sebagai Target Semprot** agar zona tersebut siap diproses lebih
> lanjut.

**Catatan visual:** screenshot slider ambang NDVI min/maks + pratinjau zona
warna di peta.

---

### Slide 5 — Target Semprot

**Judul:** Target Semprot

**Body:**
> Semua zona yang sudah disimpan akan muncul di panel **Target Semprot**.
> Tekan **Lihat di Peta** pada salah satu target untuk langsung fokus ke
> lokasinya. Klik langsung pada zona merah di peta untuk melihat detailnya:
> nama penyakit, tingkat keyakinan deteksi, foto, dan rekomendasi chamber
> penyemprotan. Target-target ini menjadi dasar pembuatan rute penyemprotan
> otomatis di bab **Mode Drone** berikutnya.

**Catatan visual:** screenshot popup target semprot (merah) yang menampilkan
hasil deteksi penyakit.

---

## BAB 07 — Panduan Teknis Sistem

*Gaya bahasa: teknis, untuk tim/operator — bukan petani. Kredit: Dimas & Nopal.*

### Slide 1 — Cover Bab

**Nomor bab:** 07

**Judul:**
> Panduan Teknis Sistem

**Subjudul:**
> Arsitektur, pengelolaan data, dan setup untuk tim teknis

**Kredit:**
> Disusun oleh Dimas & Nopal

---

### Slide 2 — Arsitektur Web Mapping

**Judul:** Arsitektur Web Mapping

**Body:**
> Alur data SmartGIS mengalir lewat lima lapisan: drone mengambil foto sawah,
> Jetson Orin NX melakukan stitching dan menghasilkan `rgb.tif` serta
> `ndvi.tif`, file dikirim ke Raspberry Pi Portable lewat `rsync`, backend
> FastAPI mengonversi TIF menjadi PNG dan membaca titik sudut GeoTIFF, lalu
> PostgreSQL menyimpan metadatanya. Frontend React + Vite + Leaflet
> menampilkan hasil akhirnya sebagai overlay RGB/NDVI di SmartGIS.

**Diagram (teks):**
```
Drone → Jetson Orin NX (stitching, hasilkan rgb.tif & ndvi.tif)
      → rsync → Raspberry Pi Portable (storage/imagery)
      → Backend FastAPI (convert TIF→PNG, baca corner GeoTIFF)
      → PostgreSQL (metadata)
      → Frontend React+Vite+Leaflet (overlay RGB/NDVI di SmartGIS)
```

**Stack:**
> Frontend React 19 + Vite + Leaflet · Backend FastAPI + SQLAlchemy ·
> Database PostgreSQL · Pemrosesan GIS dengan GDAL/rasterio.

**Prinsip desain:**
> File `.tif` asli tetap disimpan sebagai sumber data (bisa diproses ulang),
> file `.png` hanya untuk tampilan di browser, dan database hanya menyimpan
> metadata — bukan file besar.

---

### Slide 3 — SOP Pengelolaan Data

**Judul:** SOP Pengelolaan Data

**Langkah:**
> 1. Hasil stitching (`rgb.tif`, `ndvi.tif`) dikirim dari Orin ke Raspberry
>    lewat `rsync` — bukan LoRa (LoRa hanya untuk pesan kecil/telemetry) dan
>    bukan HTTP upload biasa (rsync lebih tahan kalau koneksi putus di
>    lapangan).
> 2. Setelah file sampai, panggil endpoint registrasi supaya backend tahu
>    file sudah siap diproses.
> 3. Backend otomatis memvalidasi file, membaca titik sudut GeoTIFF,
>    mengonversi RGB dan NDVI ke PNG, menghitung statistik kesehatan
>    tanaman, lalu menyimpan semuanya ke database.
> 4. Struktur folder storage konsisten untuk semua sawah dan semua tanggal
>    capture.

**Contoh perintah registrasi:**
```bash
curl -X POST http://RASPI_IP:8000/fields/FIELD_ID/imagery/register \
  -H "Content-Type: application/json" \
  -d '{"capture_at": "...", "rgb_tif_path": "...", "ndvi_tif_path": "..."}'
```

**Struktur folder:**
```
server/storage/imagery/{field_slug}/{capture_slug}/{rgb,ndvi}.{tif,png}
```

---

### Slide 4 — Setup Server

**Judul:** Setup Server

**Dependency wajib:**
> Python venv, FastAPI, SQLAlchemy, PostgreSQL, GDAL CLI (`gdalinfo`,
> `gdal_translate`), serta Python package `rasterio`, `numpy`, `matplotlib`,
> dan `Pillow` untuk pemrosesan imagery.

**Menjalankan backend:**
```bash
cd server
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

**Menjalankan frontend:**
```bash
cd web
bun install
bun run dev        # build produksi: bun run build
```

---

### Slide 5 — Petunjuk Teknis Peta & Chatbot

**Judul:** Petunjuk Teknis Peta & Chatbot

**Peta (Mapping):**
> Sesi pemetaan dan misi drone dikelola lewat gRPC
> `soerogis.MappingJobService`, dengan status berjalan dari `unstitched` →
> `stitching` → `clustering` → `ready`. File besar seperti orthophoto dan
> cluster KML tidak dikirim lewat gRPC, melainkan disajikan lewat static
> file server terpisah di port `8000` sebagai URL HTTP yang bisa langsung
> diambil browser.

**Chatbot & AI:**
> Dipanggil dari `web/src/api.js`, saat ini masih tiga service terpisah:
> Chatbot (`:5000/api/chat`), Analisis Parameter (`:5000/api/analyze`), dan
> Deteksi Penyakit (`:5001/api/detect`). Jika ketiganya nanti digabung ke
> backend FastAPI utama, `web/src/api.js` perlu diarahkan ulang ke endpoint
> barunya.

---

## Catatan Produksi

- Total 10 slide (5 + 5) siap tempel.
- Tabel dan blok kode di atas bisa dimasukkan sebagai elemen tabel/kode di
  Canva, atau disederhanakan jadi teks biasa kalau layout template tidak
  mendukung elemen tabel.
- Setelah ditempel, sesuaikan ukuran font & posisi mengikuti gaya visual
  bab lain di buku (warna hijau/putih, ikon konsisten).
