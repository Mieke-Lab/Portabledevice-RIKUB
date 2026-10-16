# NDVI Zones On-Demand Plan

Dokumen ini menjelaskan rencana fitur NDVI Zones yang digenerate on-demand dari web. Tujuannya supaya user bisa mencoba beberapa threshold NDVI dan minimum luas polygon sampai hasil zonanya terasa pas, sebelum hasil tersebut disimpan permanen sebagai polygon kerja.

## Tujuan

Fitur NDVI Zones dipakai untuk mengubah data `NDVI.tif` menjadi polygon area bermasalah.

Pada tahap awal, hasil polygon belum langsung disimpan ke database. User dapat:

- memilih sawah dan imagery aktif
- mengatur threshold NDVI dari web
- mengatur minimum luas polygon
- mengatur jarak merge polygon
- generate polygon secara sementara
- melihat polygon di peta
- klik polygon untuk melihat statistik

Setelah threshold dan hasil polygon sudah cocok, tahap berikutnya baru menambahkan tombol `Simpan Zona`.

## Posisi Dalam Workflow SmartGIS

```txt
RGB/NDVI imagery
        |
        v
User atur threshold NDVI
        |
        v
Backend generate polygon on-demand
        |
        v
Frontend tampilkan polygon
        |
        v
User evaluasi hasil
        |
        v
Nanti: simpan zona ke ndvi_polygons
        |
        v
Ground check -> chamber -> mission planning
```

## Prinsip Desain

- `NDVI.tif` tetap menjadi sumber kebenaran.
- Frontend hanya mengirim parameter threshold dan menampilkan hasil.
- Backend melakukan semua proses raster, polygon, area, merge, dan statistik.
- Hasil awal bersifat preview/on-demand, bukan data permanen.
- Output web utama adalah GeoJSON karena mudah dirender Leaflet.
- Shapefile tidak dipakai untuk web MVP.

## Parameter Dari Web

### MVP Parameter

| Parameter | Default | Keterangan |
| --- | ---: | --- |
| `ndvi_min` | `0.0` | Nilai NDVI minimum yang dianggap target. |
| `ndvi_max` | `0.6` | Nilai NDVI maksimum yang dianggap target. |
| `min_area_m2` | `2.0` | Polygon lebih kecil dari ini dibuang sebagai noise. |
| `merge_distance_m` | `0.5` | Polygon yang berdekatan digabung. |

### Catatan UX

- `ndvi_max` adalah kontrol utama.
- `ndvi_min` bisa tetap tampil, tapi secara default `0.0`.
- `min_area_m2` penting untuk membuang noise kecil.
- `merge_distance_m` membantu saat hasil polygon terlalu pecah-pecah.

## Backend API

### Endpoint Preview

```txt
POST /imagery/{imagery_id}/ndvi-zones/preview
```

Request:

```json
{
  "ndvi_min": 0.0,
  "ndvi_max": 0.6,
  "min_area_m2": 2.0,
  "merge_distance_m": 0.5
}
```

Response:

```json
{
  "imagery_id": "uuid",
  "settings": {
    "ndvi_min": 0.0,
    "ndvi_max": 0.6,
    "min_area_m2": 2.0,
    "merge_distance_m": 0.5
  },
  "summary": {
    "polygon_count": 12,
    "total_area_m2": 134.5,
    "total_area_ha": 0.0135,
    "mean_ndvi": 0.38
  },
  "geojson": {
    "type": "FeatureCollection",
    "features": []
  }
}
```

## Backend Processing

Backend membaca `ndvi_tif_path` dari `field_imagery`.

Langkah proses:

1. Buka `NDVI.tif` dengan `rasterio`.
2. Baca band NDVI.
3. Buat valid mask:
   - `src.read_masks(1) > 0`
   - `np.isfinite(ndvi)`
   - exclude `src.nodata` jika tersedia
4. Clip NDVI ke range `-1..1`.
5. Buat binary mask:
   - `ndvi >= ndvi_min`
   - `ndvi <= ndvi_max`
   - `valid_mask`
6. Convert mask ke polygon dengan `rasterio.features.shapes`.
7. Convert ke projected CRS/UTM untuk operasi meter.
8. Merge polygon dengan buffer:
   - buffer `merge_distance_m / 2`
   - dissolve/union
   - explode
   - buffer balik `-merge_distance_m / 2`
9. Hitung area polygon dalam meter persegi.
10. Filter polygon dengan `area_m2 >= min_area_m2`.
11. Hitung `mean_ndvi` per polygon.
12. Convert balik ke WGS84.
13. Return GeoJSON.

## Metode Polygon

MVP menggunakan metode **threshold-based polygon extraction**, bukan clustering.

User menentukan sendiri range NDVI dari web. Backend hanya mengambil pixel yang masuk range tersebut, lalu mengubahnya menjadi polygon.

Ringkasnya:

```txt
NDVI.tif
  -> valid mask
  -> threshold mask dari setting user
  -> rasterio.features.shapes
  -> merge polygon
  -> filter minimum area
  -> GeoJSON preview
```

Clustering seperti KMeans, DBSCAN, atau Otsu dapat menjadi opsi lanjutan setelah workflow threshold stabil.

## GeoJSON Feature Properties

Setiap polygon minimal punya:

```json
{
  "id": 1,
  "area_m2": 12.4,
  "area_ha": 0.0012,
  "mean_ndvi": 0.32,
  "ndvi_min": 0.0,
  "ndvi_max": 0.6
}
```

## Frontend UI

Panel `NDVI Zones` muncul saat user memilih layer atau tool NDVI Zones.

Kontrol MVP:

```txt
NDVI Zones

NDVI Range
[0.00] -------- [0.60]

Minimum Area
[2.0] m2

Merge Distance
[0.5] m

[Generate Zones]
```

Setelah generate:

```txt
12 polygon
134.5 m2 target
Mean NDVI 0.38
```

## Frontend Map Behavior

Saat generate sukses:

- hapus layer preview NDVI Zones lama
- render GeoJSON baru
- style polygon sebagai hasil threshold aktif
- fit bounds optional, jangan selalu auto zoom jika user sedang inspeksi map
- polygon bisa diklik

Popup polygon:

```txt
Zona #3
Area: 12.4 m2
Mean NDVI: 0.32
NDVI Range: 0.0 - 0.6
```

## Simpan Zona Nanti

Setelah preview terasa cocok, tahap berikutnya:

```txt
POST /imagery/{imagery_id}/ndvi-zones/save
```

Body bisa memakai settings yang sama.

Backend akan:

- generate ulang polygon dengan settings tersebut
- simpan ke tabel `ndvi_polygons`
- return polygon yang tersimpan

Tabel `ndvi_polygons` nanti menyimpan:

- `id`
- `field_id`
- `field_imagery_id`
- `geometry`
- `area_m2`
- `area_ha`
- `mean_ndvi`
- `settings`
- `created_at`

## Hubungan Dengan Ground Check

Polygon hasil save menjadi unit kerja.

Setelah polygon disimpan:

- user klik polygon
- user input hasil ground check
- data masuk ke `polygon_observations`
- hasil observasi menentukan chamber
- polygon yang valid masuk mission planning

## Checklist Implementasi

### Backend

- [x] Tambah schema request `NdviZonePreviewRequest`.
- [x] Tambah helper valid mask NDVI agar konsisten dengan colormap.
- [x] Tambah helper auto UTM CRS.
- [x] Tambah helper raster mask ke merged polygon.
- [x] Tambah endpoint preview NDVI Zones.
- [x] Return summary dan GeoJSON.
- [x] Handle kasus tidak ada polygon.
- [x] Tambah error message yang jelas saat TIF/CRS rusak.

### Frontend

- [x] Tambah state parameter NDVI Zones.
- [x] Tambah panel kontrol NDVI Zones.
- [x] Tambah tombol Generate Zones.
- [x] Render loading/error.
- [x] Render GeoJSON polygon di Leaflet.
- [x] Style polygon preview berdasarkan threshold aktif.
- [x] Popup detail polygon.
- [x] Clear preview saat ganti sawah atau imagery.

### Nanti

- [ ] Tombol Simpan Zona.
- [ ] Tabel `ndvi_polygons`.
- [ ] Ground check form per polygon.
- [ ] Chamber recommendation.
- [ ] Mission planning dari polygon target.

## Keputusan Saat Ini

Untuk tahap berikutnya, implementasi dimulai dari **preview/on-demand** dulu.

Belum perlu:

- simpan polygon permanen
- ground check
- chamber recommendation
- mission route

Fokusnya adalah membuat user bisa mengatur threshold dan melihat hasil polygon dengan cepat di web.
