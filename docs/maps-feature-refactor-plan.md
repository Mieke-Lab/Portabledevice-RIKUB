# Maps.jsx Feature Refactor Plan

Tujuan: memecah `web/src/pages/Maps.jsx` per fitur agar lebih mudah dirawat, tanpa mengubah perilaku map yang sudah jalan.

## Prinsip

- `Maps.jsx` tetap menjadi koordinator utama untuk Leaflet map, refs, state utama, dan effects.
- Komponen baru dipisah berdasarkan fitur yang terlihat oleh user.
- Jangan pindahkan logic Leaflet dulu: init map, add/remove layer, marker, polygon, dan mutation tetap di `Maps.jsx`.
- Mulai dari UI presentational yang hanya menerima props.
- Build setelah tiap tahap: `npm run build` dari folder `web`.

## Struktur Target

```text
web/src/components/maps/
├─ mapConfig.js
├─ mapUtils.js
├─ layers/
│  └─ LayerPanel.jsx
├─ ndvi/
│  └─ NdviPanel.jsx
├─ spray-targets/
│  └─ SprayTargetsPanel.jsx
├─ spraying-route/
│  └─ SprayingRoutePanel.jsx
└─ drone/
   ├─ DroneFloatingButton.jsx
   └─ DroneTelemetryBar.jsx
```

## Tahap Refactor

### 1. Extract Config

Pindahkan constant yang tidak butuh React atau Leaflet instance:

- `BASE_LAYERS`
- `MAP_IMAGERY_LAYERS`
- `MAP_ANALYSIS_LAYERS`
- NDVI stat/config/default

Target file:

```text
web/src/components/maps/mapConfig.js
```

### 2. Extract Drone Feature

Pindahkan UI drone yang batasnya jelas:

- tombol floating icon drone
- telemetry/status bar drone

Target files:

```text
web/src/components/maps/drone/DroneFloatingButton.jsx
web/src/components/maps/drone/DroneTelemetryBar.jsx
```

`Maps.jsx` hanya mengirim props seperti `routeActive`, `onOpenDashboard`, `telemetryCollapsed`, dan `onToggleTelemetry`.

### 3. Extract Spraying Route Feature

Pindahkan panel "Misi Penyemprotan":

- target count
- waypoint count
- ready count
- altitude/speed input
- generate/upload/execute buttons
- empty state jika belum ada target

Target file:

```text
web/src/components/maps/spraying-route/SprayingRoutePanel.jsx
```

### 4. Extract Spray Targets Feature

Pindahkan panel daftar target semprot:

- list target
- area
- chamber
- tombol focus target

Target file:

```text
web/src/components/maps/spray-targets/SprayTargetsPanel.jsx
```

### 5. Extract Layer Panel

Pindahkan panel layer setelah fitur di atas stabil, karena props-nya lebih banyak:

- base layer
- imagery layer
- analysis layer
- active layer state

Target file:

```text
web/src/components/maps/layers/LayerPanel.jsx
```

### 6. Extract Helper Murni

Pindahkan function kecil yang tidak bergantung pada React/Leaflet:

- formatter angka
- helper warna/status
- summary calculation
- payload builder kecil jika ada

Target file:

```text
web/src/components/maps/mapUtils.js
```

## Jangan Dilakukan Dulu

- Jangan membuat hook besar seperti `useMapLayers`, `useNdviZones`, atau `useSprayTargets` di awal.
- Jangan memindahkan `useEffect` Leaflet sebelum UI sudah rapi.
- Jangan port fitur dashboard drone ke dalam `Maps.jsx`.

## Acceptance Check

Setiap tahap harus:

- `npm run build` berhasil dari `web`.
- Tampilan map tetap sama.
- Klik layer, NDVI, spray target, route, locate, dan drone tetap sesuai perilaku sebelumnya.

## Urutan Kerja yang Disarankan

1. `mapConfig.js`
2. `drone/DroneFloatingButton.jsx`
3. `drone/DroneTelemetryBar.jsx`
4. `spraying-route/SprayingRoutePanel.jsx`
5. `spray-targets/SprayTargetsPanel.jsx`
6. `layers/LayerPanel.jsx`
7. `mapUtils.js`

Skipped hooks dulu, add when component extraction sudah stabil.
