# Spray Target Chamber Selection Knowledge

Dokumen ini merangkum konsep pemilihan chamber untuk Spray Targets setelah
ground check / fitur deteksi penyakit.

## Inti Konsep

Satu polygon target semprot bisa memiliki beberapa hasil deteksi penyakit/hama.
Setiap hasil deteksi dapat membawa rekomendasi chamber sendiri.

Karena itu, sistem membedakan dua hal:

```txt
target_detections.chamber
= chamber dari satu hasil deteksi

spray_polygons.selected_chambers
= chamber final yang dipakai drone untuk polygon itu
```

`target_detections` adalah sumber data deteksi. `spray_polygons` menyimpan
keputusan akhir untuk misi penyemprotan.

## Chamber Yang Tersedia

Untuk MVP, chamber hanya ada dua:

```txt
fungisida
insektisida
```

Satu polygon bisa memakai satu atau dua chamber sekaligus.

Contoh:

```json
["fungisida"]
```

atau:

```json
["fungisida", "insektisida"]
```

## Mode Pemilihan Chamber

User memilih mode chamber per polygon target:

```txt
manual
auto
none
```

Makna:

```txt
manual
= user memilih chamber sendiri

auto
= sistem mengambil chamber dari target_detections

none
= belum ada chamber final
```

## Schema MVP

### `spray_polygons`

Menyimpan polygon final hasil Approve Zones dan chamber final untuk spraying.

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
selected_chambers JSONB
chamber_mode TEXT
created_at
```

Catatan:

- `selected_chambers` adalah daftar chamber final yang dipakai Spraying Route.
- `chamber_mode` menjelaskan sumber keputusan chamber.
- Field lama `chamber` tunggal tidak cukup jika satu polygon bisa memakai dua
  chamber.

### `target_detections`

Menyimpan hasil ground check / fitur deteksi pada satu polygon target.

```txt
id
polygon_id
disease_name
confidence
sample_lat
sample_lng
chamber
image_path
created_at
```

Catatan:

- `disease_name` adalah nama penyakit/hama dari fitur deteksi.
- `confidence` adalah confidence score dari model deteksi.
- `sample_lat` dan `sample_lng` adalah titik pengambilan sample / ground check.
- `chamber` adalah chamber yang dikembalikan fitur deteksi untuk hasil tersebut.

## Alur Manual

```txt
1. Spray Target sudah ada.
2. User memilih mode manual.
3. User mencentang chamber:
   - fungisida
   - insektisida
4. Backend menyimpan:
   chamber_mode = "manual"
   selected_chambers = pilihan user
5. Spraying Route memakai selected_chambers.
```

Contoh:

```json
{
  "chamber_mode": "manual",
  "selected_chambers": ["fungisida"]
}
```

## Alur Otomatis

```txt
1. Spray Target sudah ada.
2. Fitur deteksi / ground check mengirim hasil deteksi ke target_detections.
3. User memilih mode auto.
4. Backend membaca chamber unik dari target_detections untuk polygon itu.
5. Backend menyimpan hasilnya ke selected_chambers.
6. Spraying Route memakai selected_chambers.
```

Contoh data deteksi:

```txt
Z01:
- blast, confidence 0.91, chamber fungisida
- bercak daun, confidence 0.78, chamber fungisida
- wereng, confidence 0.84, chamber insektisida
```

Maka hasil otomatis:

```json
{
  "chamber_mode": "auto",
  "selected_chambers": ["fungisida", "insektisida"]
}
```

## Rule Auto MVP

Untuk MVP, rule otomatis dibuat sederhana:

```txt
selected_chambers = unique chamber dari target_detections untuk polygon itu
```

Jika belum ada deteksi:

```json
{
  "chamber_mode": "none",
  "selected_chambers": []
}
```

Jika semua deteksi hanya mengarah ke fungisida:

```json
{
  "chamber_mode": "auto",
  "selected_chambers": ["fungisida"]
}
```

Jika ada deteksi fungisida dan insektisida:

```json
{
  "chamber_mode": "auto",
  "selected_chambers": ["fungisida", "insektisida"]
}
```

## Relasi Dengan Spraying Route

Spraying Route tidak perlu membaca `target_detections` langsung.

Spraying Route hanya membaca:

```txt
spray_polygons.selected_chambers
```

Alasannya:

- `target_detections` adalah data observasi.
- `selected_chambers` adalah keputusan final.
- Keputusan final bisa otomatis atau manual.

## Ringkasan Alur Sistem

```txt
NDVI Zones
  -> Approve Zones
  -> spray_polygons
  -> ground check / detection
  -> target_detections
  -> select chamber mode
     - manual: user pilih chamber
     - auto: baca chamber dari target_detections
  -> spray_polygons.selected_chambers
  -> Spraying Route
  -> Drone Mission
```

## Keputusan Desain

- Tidak membuat tabel baru untuk chamber selection pada MVP.
- Chamber hasil deteksi disimpan di `target_detections.chamber`.
- Chamber final disimpan di `spray_polygons.selected_chambers`.
- User tetap bisa override rekomendasi otomatis dengan mode manual.
- Satu polygon bisa memakai lebih dari satu chamber.
