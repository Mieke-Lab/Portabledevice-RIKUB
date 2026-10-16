# Spray Targets and Detections Plan

Dokumen ini menjelaskan rancangan lanjutan setelah fitur NDVI Zones preview.
Tujuannya adalah membuat hasil polygon yang sudah dipilih user menjadi data kerja
final untuk ground check, deteksi penyakit/hama, pemilihan chamber, dan nanti
mission planning.

## Inti Alur

```txt
Imagery NDVI
        |
        v
Generate NDVI Zones
        |
        v
Preview polygon di peta
        |
        v
User hapus polygon yang tidak dipakai
        |
        v
Approve Zones
        |
        v
Simpan polygon final ke spray_polygons
        |
        v
Tampilkan polygon final di layer Spray Targets
        |
        v
User cek/capture penyakit atau hama per target
        |
        v
Simpan hasil deteksi ke target_detections
        |
        v
Tentukan chamber di spray_polygons
```

Prinsip utama:

```txt
NDVI menentukan WHERE
Deteksi penyakit/hama menentukan WHAT
Chamber menentukan WITH WHAT
Mission planning menentukan HOW TO GO
```

## Pembagian Konsep

### NDVI Zones

`NDVI Zones` adalah area eksperimen/preview.

User dapat:

- mengatur threshold NDVI
- generate polygon sementara
- melihat polygon di peta
- klik polygon untuk melihat detail
- menghapus polygon preview yang tidak ingin dipakai

Hasil `Generate Zones` belum langsung masuk database.

### Approve Zones

`Approve Zones` adalah aksi untuk mengunci hasil preview.

Saat user klik `Approve Zones`, frontend mengirim polygon preview yang masih
tersisa ke backend. Backend menyimpan setiap polygon sebagai satu baris di
`spray_polygons`.

Penting:

```txt
Yang disimpan adalah polygon yang tersisa setelah user menghapus polygon preview.
```

Jadi backend tidak cukup generate ulang dari threshold saja, karena polygon yang
sudah dihapus user bisa muncul lagi.

### Spray Targets

`Spray Targets` adalah layer untuk polygon final yang sudah di-approve.

Layer ini tidak dipakai untuk generate polygon lagi. Layer ini membaca data dari
database dan menjadi tempat user melakukan ground check atau deteksi penyakit/hama.

### Target Detections

`Target Detections` adalah daftar penyakit/hama yang ditemukan pada satu polygon
final.

Satu polygon final bisa punya beberapa detection.

Contoh:

```txt
Polygon Z01
chamber: fungisida

Detections:
- blas / penyakit / jamur
- bercak daun / penyakit / jamur
```

## Rancangan Database

### `spray_polygons`

Menyimpan polygon final hasil `Approve Zones`.

Field:

```txt
id
field_id
field_imagery_id
zone_code
sequence_no
geometry
area_m2
mean_ndvi
settings
chamber
created_at
```

Keterangan:

- `id`: ID unik polygon.
- `field_id`: relasi ke sawah/lahan.
- `field_imagery_id`: relasi ke imagery/NDVI yang dipakai.
- `zone_code`: kode zona untuk UI, misalnya `Z01`, `Z02`, `Z03`.
- `sequence_no`: urutan numerik zona, misalnya `1`, `2`, `3`.
- `geometry`: bentuk polygon dalam format GeoJSON/JSONB.
- `area_m2`: luas polygon dalam meter persegi.
- `mean_ndvi`: rata-rata NDVI polygon.
- `settings`: parameter generate lengkap.
- `chamber`: chamber yang dipilih/direkomendasikan untuk polygon ini.
- `created_at`: waktu polygon di-approve/disimpan.

Contoh `settings`:

```json
{
  "ndvi_min": 0,
  "ndvi_max": 0.6,
  "min_area_m2": 2,
  "merge_distance_m": 0.5
}
```

Catatan:

- `ndvi_min` dan `ndvi_max` tidak perlu dibuat kolom terpisah untuk MVP karena
  sudah ada di `settings`.
- `status` tidak dipakai untuk MVP agar schema tetap sederhana.

Contoh `chamber`:

```txt
fungisida
bakterisida
insektisida
none
```

### `target_detections`

Menyimpan penyakit/hama yang ditemukan pada satu polygon final.

Field:

```txt
id
polygon_id
name
category
group_name
confidence
image_path
created_at
```

Keterangan:

- `id`: ID unik hasil deteksi.
- `polygon_id`: relasi ke `spray_polygons`.
- `name`: nama penyakit/hama.
- `category`: jenis object, misalnya `penyakit` atau `hama`.
- `group_name`: kelompok, misalnya `jamur`, `bakteri`, atau `serangga`.
- `confidence`: nilai confidence dari model deteksi, boleh kosong jika manual.
- `image_path`: path foto/capture bukti lapangan, boleh kosong.
- `created_at`: waktu hasil deteksi disimpan.

Contoh:

```txt
name: blas
category: penyakit
group_name: jamur
confidence: 0.87
```

Contoh lain:

```txt
name: wereng
category: hama
group_name: serangga
confidence: 0.82
```

## Relasi Data

```txt
fields
  -> field_imagery
      -> spray_polygons
          -> target_detections
```

Makna:

- `fields`: sawah/lahan.
- `field_imagery`: hasil capture/stitching NDVI per tanggal.
- `spray_polygons`: area final hasil approve sekaligus target semprot.
- `target_detections`: daftar penyakit/hama per polygon.

## Endpoint Backend

### Save Approved Zones

```txt
POST /imagery/{imagery_id}/ndvi-zones/save
```

Request:

```json
{
  "settings": {
    "ndvi_min": 0,
    "ndvi_max": 0.6,
    "min_area_m2": 2,
    "merge_distance_m": 0.5
  },
  "geojson": {
    "type": "FeatureCollection",
    "features": []
  }
}
```

Behavior:

- backend mengambil `field_id` dari `field_imagery`
- backend menyimpan setiap `geojson.features[]` sebagai satu row di
  `spray_polygons`
- backend membuat `zone_code` berurutan, misalnya `Z01`, `Z02`, `Z03`
- backend mengisi `chamber` awal sebagai `none`
- backend mengembalikan daftar polygon yang tersimpan

### List Spray Targets

```txt
GET /fields/{field_id}/spray-targets
```

Behavior:

- mengembalikan polygon final dari `spray_polygons`
- menyertakan `target_detections` jika sudah ada

### Update Polygon Chamber

```txt
PATCH /polygons/{polygon_id}/chamber
```

Request:

```json
{
  "chamber": "fungisida"
}
```

### Add Target Detection

```txt
POST /polygons/{polygon_id}/detections
```

Request:

```json
{
  "name": "blas",
  "category": "penyakit",
  "group_name": "jamur",
  "confidence": 0.87,
  "image_path": "storage/detections/z01/photo.jpg"
}
```

## Chamber Recommendation

Mapping awal:

```txt
group_name = jamur    -> chamber = fungisida
group_name = bakteri  -> chamber = bakterisida
category = hama       -> chamber = insektisida
tidak ada / abaikan   -> chamber = none
```

Jika satu target punya beberapa detection, chamber dapat ditentukan dari prioritas
aturan sederhana.

Contoh:

```txt
Z01:
- blas / penyakit / jamur
- bercak daun / penyakit / jamur

Rekomendasi chamber:
fungisida
```

Contoh lain:

```txt
Z02:
- wereng / hama / serangga

Rekomendasi chamber:
insektisida
```

## Tahap Implementasi

### Tahap 1: Approve Zones

- Buat model/tabel `spray_polygons`.
- Buat endpoint save approved zones.
- Aktifkan tombol `Approve Zones`.
- Simpan polygon preview yang tersisa sebagai polygon final.

### Tahap 2: Spray Targets Layer

- Buat endpoint list spray targets.
- Render polygon final di layer `Spray Targets`.
- Saat user klik polygon final, tampilkan panel target.
- Update `chamber` langsung di `spray_polygons`.

### Tahap 3: Target Detections

- Buat model/tabel `target_detections`.
- Tambahkan form/detection preview untuk penyakit/hama.
- Simpan detection ke target.
- Tampilkan rekomendasi chamber berdasarkan detection.

### Tahap 4: Mission Planning

- Gunakan `spray_polygons` untuk membuat daftar target misi.
- Hitung urutan target, estimasi dosis, dan rute drone.
