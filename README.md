# Jaga Padi - Portable Device RIKUB

Smart Rice Field Monitoring System untuk monitoring sawah. Aplikasi ini berisi
SmartGIS, Chatbot AI, dan Deteksi Penyakit Padi.

## Stack

| Bagian | Teknologi |
| --- | --- |
| Frontend | React 19, Vite, TypeScript config, Tailwind CSS |
| UI | lucide-react, class-variance-authority, shadcn-style components |
| Peta | Leaflet, Leaflet MarkerCluster |
| Backend | FastAPI di `server/` |
| Database | PostgreSQL |
| Database layer | SQLAlchemy |
| Package manager FE | Bun |

## Struktur Project

```text
web/                  Frontend utama Vite
  src/                Source UI aplikasi
  public/             Static assets yang diserve Vite
  public/data/cover/  Gambar cover menu
  dist/               Output build, bisa dibuat ulang

server/               Backend FastAPI
  main.py             Entry app FastAPI
  requirements.txt    Dependency backend langsung, tanpa pin versi
  venv/               Virtualenv lokal, tidak perlu dicommit

warna.md              Catatan warna/desain
```

Folder legacy seperti `frontend/`, `web-build/`, `app.py`, `tools/`, dan dokumen
pywebview lama sudah dihapus. Source frontend sekarang langsung dikerjakan di
`web/`.

## Menjalankan Frontend

```bash
cd web
bun install
bun run dev
```

Build produksi:

```bash
cd web
bun run build
```

Lint:

```bash
cd web
bun run lint
```

## Menjalankan Backend

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Di Windows, aktivasi venv bisa memakai:

```powershell
venv\Scripts\activate
```

Endpoint backend saat ini masih minimal:

```text
GET /
```

Dependency backend sengaja ditulis tanpa versi dan hanya berisi dependency
langsung:

```text
fastapi
uvicorn[standard]
SQLAlchemy
```

Package transitif seperti `starlette`, `pydantic`, `greenlet`, dan lainnya akan
dipasang otomatis oleh `pip`.

## Menambahkan Lahan (Field) Baru

Belum ada form "tambah lahan" di UI — field baru dibuat otomatis lewat endpoint
registrasi imagery di `server/app/routes/fields.py`.

1. Siapkan GeoTIFF RGB dan NDVI hasil mapping, taruh di dalam
   `server/storage/imagery/<nama-lahan>/...` (path harus relatif ke `server/`,
   tidak boleh path absolut).
2. Panggil:

   ```bash
   curl -X POST http://localhost:8000/imagery/register \
     -H "Content-Type: application/json" \
     -d '{
       "field_name": "Sawah Blok Baru",
       "rgb_tif_path": "storage/imagery/sawah-baru/2026-07-04/rgb.tif",
       "ndvi_tif_path": "storage/imagery/sawah-baru/2026-07-04/ndvi.tif",
       "capture_at": "2026-07-04T09:00:00+07:00"
     }'
   ```

3. Kalau `field_name` belum ada di database, field baru otomatis dibuat.
   Endpoint ini juga generate PNG dari kedua GeoTIFF dan hitung NDVI stats.
4. Buka `/maps` — lahan baru langsung muncul di dropdown pemilih lahan.

Kalau datanya masih foto mentah drone (belum di-stitch jadi orthophoto),
proses dulu lewat Mapping (`/drone-dashboard/mapping`) sebelum didaftarkan ke
`/imagery/register`.

### Yang terjadi di balik layar saat endpoint di-hit

Handler: `register_imagery_with_field` di `server/app/routes/fields.py:646`.

1. **Validasi `field_name`** — kalau kosong/whitespace, response `400`.
2. **Cari atau buat `Field`** — query `Field` berdasarkan `name`. Kalau belum
   ada row-nya, buat baru (`db.add` + `db.flush`, belum commit di titik ini).
3. **Validasi kedua file ada** (`ensure_existing_file`, dipanggil untuk
   `rgb_tif_path` dan `ndvi_tif_path`) — resolve path relatif ke `server/`,
   tolak path absolut/keluar folder (`400`), lalu cek file itu benar ada
   secara fisik. Kalau tidak ada → `404 File not found: <path>`.
4. **Baca koordinat pojok GeoTIFF** (`read_geotiff_corners`, dari file RGB) —
   jalankan `gdalinfo -json` lewat subprocess, ambil `wgs84Extent` untuk 4
   titik sudut (`top_left`, `top_right`, `bottom_left`, `bottom_right`).
   Kalau `gdalinfo` tidak terinstall atau gagal parse, fungsi ini diam-diam
   balik `None` (tidak error) — imagery tetap tersimpan tapi tanpa koordinat
   overlay di peta.
5. **Convert RGB TIFF → PNG** (`convert_rgb_tif_to_png`) — jalankan
   `gdal_translate -of PNG -b 1 -b 2 -b 3 <tif> <png>` (PNG disimpan
   bersebelahan dengan file TIFF-nya, ekstensi diganti `.png`). Ini **wajib**:
   kalau `gdal_translate` tidak ada di server atau command-nya gagal, request
   berhenti dengan `500`.
6. **Convert NDVI TIFF → PNG berwarna** (`convert_ndvi_tif_to_png`) — pakai
   `rasterio` untuk baca band NDVI, piksel `< 0` digambar hitam, piksel valid
   `>= 0` diwarnai pakai colormap `RdYlGn` (matplotlib), piksel invalid/nodata
   dibikin transparan. Hasil disimpan sebagai PNG lewat Pillow. Kalau
   `rasterio`/`numpy`/`matplotlib`/`Pillow` tidak terinstall → `500` dengan
   pesan dependency yang kurang.
7. **Hitung statistik kesehatan NDVI** (`compute_ndvi_stats`) — hitung luas
   per kategori kesehatan tanaman dari nilai NDVI (luas dihitung dari ukuran
   piksel, dikonversi ke meter kalau CRS geografis):

   | Kategori | Rentang NDVI |
   | --- | --- |
   | Sangat Sehat | 0.8–1.0 |
   | Sehat | 0.6–0.8 |
   | Cukup Sehat | 0.4–0.6 |
   | Kurang Sehat | 0.21–0.4 |
   | Tidak Sehat | 0–0.21 |
   | Non-Vegetasi | < 0 |

   Kalau library-nya tidak ada atau raster gagal dibaca, fungsi ini diam-diam
   balik `None` (tidak error, tapi `ndvi_stats` field-nya kosong).
8. **Simpan row `FieldImagery`** — `field_id`, `capture_at`, path TIFF asli,
   path PNG hasil convert, 4 koordinat pojok (bisa `None`), dan `ndvi_stats`
   (bisa `None`), lalu `db.commit()` + `db.refresh()`.
9. **Response `201`** — object imagery lengkap dengan key tambahan `"field"`
   berisi data field-nya (termasuk `id` field yang baru dibuat kalau ini
   field pertama kalinya).

**Dependency yang harus terinstall di server** supaya seluruh langkah di atas
sukses: GDAL CLI (`gdalinfo`, `gdal_translate`) dan Python package
`rasterio`, `numpy`, `matplotlib`, `Pillow`. `gdalinfo` opsional (gagal diam-diam),
sisanya wajib.

## Database

Target database project ini adalah PostgreSQL, dengan SQLAlchemy sebagai ORM
agar query tidak ditulis sebagai raw SQL langsung.

Konfigurasi koneksi database nantinya sebaiknya dibaca dari environment
variable, misalnya:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/jaga_padi
```

Untuk saat ini struktur model, session, dan migration belum dibuat di
`server/`. Saat fitur database mulai dikerjakan, dependency driver PostgreSQL
seperti `psycopg` atau `asyncpg` bisa ditambahkan ke
`server/requirements.txt` sesuai pola koneksi yang dipilih.

## Integrasi AI

Frontend masih memanggil service AI berikut dari `web/src/api.js`:

| Service | URL default | Fungsi |
| --- | --- | --- |
| Chatbot | `http://127.0.0.1:5000/api/chat` | Kirim pesan chatbot |
| Analisis parameter | `http://127.0.0.1:5000/api/analyze` | Analisis parameter sawah |
| Deteksi penyakit | `http://127.0.0.1:5001/api/detect` | Upload citra daun |

Kalau service itu mau digabung ke FastAPI `server/`, update `web/src/api.js`
agar mengarah ke endpoint baru.

## Aset Publik

Aset yang dipakai langsung oleh frontend harus berada di `web/public/`, karena
Vite akan menyajikannya dari root URL.

Yang sudah tersedia:

```text
web/public/data/cover/chatbot.jpg
web/public/data/cover/detection.jpg
web/public/data/cover/gis.jpg
```

Halaman Maps masih punya referensi ke beberapa aset yang belum ada di
`web/public/`:

```text
/data/photos.json
/data/icon/ruteits.png
/data/MapsJemberNew2/{z}/{x}/{y}.png
/tiles/index.json
/tiles/<layer>/{z}/{x}/{y}.png
```

Jika fitur Maps offline ingin dipakai penuh, salin aset tersebut ke struktur
yang sesuai di `web/public/` atau ubah kode Maps agar memakai sumber data baru.

## Catatan Development

- Jangan edit output `web/dist/` secara manual.
- `web/node_modules/`, `web/dist/`, `server/venv/`, dan `server/__pycache__/`
  adalah hasil lokal/regenerable.
- UI lama dari `frontend/` sudah dimigrasi ke `web/src/`.

## Author

RIKUB Kemdintisaintek 2025
