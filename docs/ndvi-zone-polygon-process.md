# Proses Pembentukan Polygon dari Threshold NDVI

Dokumen ini menjelaskan langkah-langkah teknis bagaimana backend membentuk
polygon zona dari file NDVI GeoTIFF, mulai dari threshold input sampai GeoJSON
output.

Kode ada di `server/app/routes/fields.py` → `generate_ndvi_zone_preview()`.

## Parameter Input

```json
{
  "ndvi_min": 0.0,
  "ndvi_max": 0.6,
  "min_area_m2": 2.0,
  "merge_distance_m": 0.5
}
```

- `ndvi_min` / `ndvi_max`: rentang nilai NDVI yang dianggap sebagai target zona.
- `min_area_m2`: polygon lebih kecil dari ini dibuang (noise).
- `merge_distance_m`: polygon yang jaraknya lebih dekat dari ini digabung.

## Alur Proses

```
GeoTIFF NDVI
      |
      v
1. Baca raster (rasterio)
      |
      v
2. Bersihkan nilai NDVI
      |
      v
3. Buat target mask (threshold)
      |
      v
4. Ekstrak polygon dari mask
      |
      v
5. Proyeksikan ke UTM (meter)
      |
      v
6. Merge polygon yang berdekatan
      |
      v
7. Filter area minimum
      |
      v
8. Smooth polygon
      |
      v
9. Hitung mean NDVI per polygon
      |
      v
10. Konversi ke WGS84 → GeoJSON
```

## Penjelasan Per Langkah

### 1. Baca Raster

```python
with rasterio.open(tif_path) as src:
    ndvi = src.read(1)             # band pertama = nilai NDVI per pixel
    valid_mask = src.read_masks(1) # 0 = nodata, >0 = valid
    transform = src.transform      # georeferencing pixel → koordinat
    crs = src.crs                  # sistem koordinat (biasanya EPSG:4326)
```

### 2. Bersihkan Nilai NDVI

```python
ndvi_clean = np.nan_to_num(ndvi, nan=0.0, posinf=1.0, neginf=-1.0)
ndvi_clipped = np.clip(ndvi_clean, -1, 1)
```

NaN, inf, dan nilai di luar [-1, 1] dinormalisasi supaya operasi berikutnya
aman.

### 3. Buat Target Mask

```python
target_mask = (
    (ndvi_clipped >= ndvi_min)
    & (ndvi_clipped <= ndvi_max)
    & valid_mask
)
```

Hasilnya adalah array boolean: `True` untuk pixel yang masuk rentang threshold
dan bukan nodata.

### 4. Ekstrak Polygon dari Mask

```python
from rasterio import features

polygons = [
    shape(geom)
    for geom, value in features.shapes(
        target_mask.astype(np.uint8),
        mask=target_mask,
        transform=transform,
    )
    if value == 1
]
```

`rasterio.features.shapes` mengkonversi kumpulan pixel True yang saling
berdekatan (connected components) menjadi polygon. Hasilnya masih dalam CRS
asli raster (biasanya WGS84).

### 5. Proyeksikan ke UTM

```python
from pyproj import Transformer
from shapely.ops import transform as shapely_transform

epsg_utm = auto_utm_epsg(centroid.x, centroid.y)  # misal EPSG:32749
to_projected = Transformer.from_crs(crs, f"EPSG:{epsg_utm}", always_xy=True)

projected_polygons = [
    shapely_transform(to_projected.transform, polygon)
    for polygon in polygons
]
```

Proyeksi ke UTM diperlukan agar kalkulasi jarak dan luas menggunakan satuan
meter (bukan derajat).

`auto_utm_epsg()` menentukan zona UTM otomatis dari koordinat centroid:

```python
def auto_utm_epsg(lng, lat):
    zone = int((lng + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone
```

### 6. Merge Polygon Berdekatan

```python
buffer_distance = merge_distance_m / 2

merged = unary_union(
    [polygon.buffer(buffer_distance) for polygon in projected_polygons]
).buffer(-buffer_distance)
```

Teknik **buffer positif → union → buffer negatif**:

1. Setiap polygon di-expand sejauh `merge_distance_m / 2`.
2. Polygon yang jaraknya ≤ `merge_distance_m` akan saling overlap setelah
   di-expand, lalu digabung oleh `unary_union`.
3. Buffer negatif mengecilkan kembali ke ukuran semula (dikurangi efek expand).

Jika `merge_distance_m = 0`, langkah ini dilewati dan hanya `unary_union`
biasa yang dipakai.

### 7. Filter Area Minimum

```python
for projected_polygon in iter_polygon_geometries(merged):
    area_m2 = float(projected_polygon.area)
    if area_m2 < min_area_m2:
        continue  # buang polygon terlalu kecil
```

`iter_polygon_geometries()` mengurai `MultiPolygon` atau `GeometryCollection`
menjadi polygon individual sebelum dicek.

### 8. Smooth Polygon

```python
def smooth_polygon_for_preview(polygon, tolerance_m=0.15):
    smoothed = polygon.simplify(tolerance_m, preserve_topology=True)
    # fallback: buffer round-trip jika simplify gagal
    if smoothed.is_empty or not smoothed.is_valid:
        smoothed = polygon.buffer(tolerance_m).buffer(-tolerance_m)
    return smoothed
```

`simplify()` mengurangi jumlah vertex polygon agar tampil lebih bersih di peta.
Tolerance default 0.15 m (dalam CRS UTM).

### 9. Hitung Mean NDVI per Polygon

```python
poly_mask = features.rasterize(
    [(mapping(original_polygon), 1)],
    out_shape=ndvi_clipped.shape,
    transform=transform,
)
ndvi_values = ndvi_clipped[(poly_mask == 1) & target_mask]
mean_ndvi = round(float(np.mean(ndvi_values)), 4)
```

Polygon di-rasterize kembali ke grid pixel untuk mengambil nilai NDVI asli,
lalu dihitung rata-ratanya.

### 10. Output GeoJSON (WGS84)

```python
to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
wgs84_polygon = shapely_transform(to_wgs84.transform, smoothed_polygon)

feature = {
    "type": "Feature",
    "geometry": mapping(wgs84_polygon),
    "properties": {
        "id": index,
        "area_m2": round(area_m2, 2),
        "area_ha": round(area_m2 / 10000, 4),
        "mean_ndvi": mean_ndvi,
        "ndvi_min": ndvi_min,
        "ndvi_max": ndvi_max,
    },
}
```

Hasil akhir dikembalikan sebagai `FeatureCollection` GeoJSON dalam WGS84
supaya langsung bisa dirender Leaflet di frontend.

## Ringkasan Transformasi CRS

```
WGS84 (derajat)       ← raster asli, output GeoJSON
      ↓ proyeksikan
UTM (meter)           ← kalkulasi jarak, area, merge, filter
      ↓ konversi balik
WGS84 (derajat)       ← output final
```

## Nilai yang Dikembalikan

```json
{
  "imagery_id": "...",
  "settings": { "ndvi_min": 0, "ndvi_max": 0.6, ... },
  "summary": {
    "polygon_count": 3,
    "total_area_m2": 1240.5,
    "total_area_ha": 0.1241,
    "mean_ndvi": 0.3812
  },
  "geojson": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

Data ini dipakai frontend sebagai **preview** (belum disimpan ke database).
Setelah user approve, GeoJSON yang sama dikirim ke endpoint
`POST /imagery/{id}/ndvi-zones/save` dan disimpan ke tabel `spray_polygons`.
