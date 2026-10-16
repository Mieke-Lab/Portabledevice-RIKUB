# Migrasi Soerogis GCS Next.js ke SmartGIS Vite

Tujuan: frontend GCS dari `docs/soerogis_frontend-main/` dipindah ke app Vite SmartGIS di `web/`, lalu tombol drone di `/maps` membuka halaman GCS full page.

Pendekatan paling aman: port frontend dulu sebagai sub-app GCS, backend Next API route dipindah belakangan ke FastAPI `server/`.

## Target Akhir

Route SmartGIS:

| Fitur | Route Vite |
| --- | --- |
| SmartGIS map | `/maps` |
| GCS dashboard | `/drone-dashboard` |
| GCS mapping list | `/drone-dashboard/mapping` |
| GCS mapping detail | `/drone-dashboard/mapping/:id` |
| GCS new mapping | `/drone-dashboard/mapping/new` |
| GCS spraying | `/drone-dashboard/spraying` |
| GCS flight test | `/drone-dashboard/flight-test` |
| GCS copilot | `/drone-dashboard/copilot` |
| GCS drone settings | `/drone-dashboard/drone-settings` |
| GCS logs | `/drone-dashboard/logs` |
| GCS app settings | `/drone-dashboard/settings` |

Tombol drone di `/maps` cukup `navigate("/drone-dashboard")`.

## Prinsip Migrasi

1. Jangan convert seluruh repo Next jadi app Vite terpisah.
2. Ambil komponen, halaman, dan lib frontend yang dipakai.
3. Jangan import `src/lib/server/backend.ts` ke Vite. File itu Node/gRPC server-side.
4. Endpoint `/api/...` tetap dipanggil dari browser, tapi implementasinya nanti pindah ke FastAPI.
5. UI harus tetap render walau backend drone offline.

## Struktur Folder Vite yang Disarankan

```txt
web/src/pages/DroneDashboard.jsx
web/src/pages/gcs/
  Dashboard.jsx
  Mapping.jsx
  MappingDetail.jsx
  MappingNew.jsx
  Spraying.jsx
  DroneTest.jsx
  Copilot.jsx
  DroneSettings.jsx
  Logs.jsx
  Settings.jsx
web/src/components/gcs/
  GcsLayout.jsx
  Header.jsx
  Sidebar.jsx
  DroneTelemetryProvider.jsx
  ActiveMissionCard.jsx
  CameraCaptureModal.jsx
  ConfirmationModal.jsx
  DroneMap.jsx
  MapCard.jsx
  PreFlightAuditModal.jsx
  SensorReadModal.jsx
  SensorReadingCard.jsx
web/src/lib/gcs/
  api.js
  api-types.js
  basemap.js
  copilot.js
  diagnostics.js
  drone-settings.js
  fetch-progress.js
  geo.js
  kml.js
  mercator.js
  mission-plan.js
  ndvi.js
  path-planner.js
  use-active-job.js
```

Pola ini mengikuti struktur SmartGIS yang sudah ada: page tetap di `pages`, UI reusable tetap di `components`, helper tetap di `lib`. Folder `gcs` hanya jadi namespace supaya tidak campur dengan komponen `/maps`.

## File dari Next yang Dipindah ke Vite

### Layout

| Next source | Vite target | Catatan |
| --- | --- | --- |
| `src/app/layout.tsx` | `web/src/components/gcs/GcsLayout.jsx` | Buang `<html>`, `<head>`, `<body>`, metadata, dan `next/font`. |
| `src/components/Header.tsx` | `web/src/components/gcs/Header.jsx` | Tetap client component biasa. |
| `src/components/Sidebar.tsx` | `web/src/components/gcs/Sidebar.jsx` | Ganti `next/link` dan `usePathname`. |
| `src/components/DroneTelemetryProvider.tsx` | `web/src/components/gcs/DroneTelemetryProvider.jsx` | Tetap jadi poller global GCS. |

### Pages

| Next source | Vite target |
| --- | --- |
| `src/app/dashboard/page.tsx` | `web/src/pages/gcs/Dashboard.jsx` |
| `src/app/mapping/page.tsx` | `web/src/pages/gcs/Mapping.jsx` |
| `src/app/mapping/[id]/page.tsx` | `web/src/pages/gcs/MappingDetail.jsx` |
| `src/app/mapping/new/page.tsx` | `web/src/pages/gcs/MappingNew.jsx` |
| `src/app/spraying/page.tsx` | `web/src/pages/gcs/Spraying.jsx` |
| `src/app/drone-test/page.tsx` | `web/src/pages/gcs/DroneTest.jsx` |
| `src/app/copilot/page.tsx` | `web/src/pages/gcs/Copilot.jsx` |
| `src/app/drone_settings/page.tsx` | `web/src/pages/gcs/DroneSettings.jsx` |
| `src/app/logs/page.tsx` | `web/src/pages/gcs/Logs.jsx` |
| `src/app/settings/page.tsx` | `web/src/pages/gcs/Settings.jsx` |

### Shared Components

Pindahkan:

```txt
ActiveMissionCard.tsx
CameraCaptureModal.tsx
ConfirmationModal.tsx
DroneMap.tsx
MapCard.tsx
PreFlightAuditModal.tsx
SensorReadModal.tsx
SensorReadingCard.tsx
```

### Browser-safe Lib

Pindahkan:

```txt
api-types.ts
api.ts
basemap.ts
copilot.ts
diagnostics.ts
drone-settings.ts
fetch-progress.ts
geo.ts
kml.ts
mercator.ts
mission-plan.ts
ndvi.ts
path-planner.ts
use-active-job.ts
```

Jangan pindahkan ke frontend:

```txt
src/lib/server/backend.ts
src/app/api/**/route.ts
```

Alasannya: file itu bergantung pada `@grpc/grpc-js`, `NextResponse`, dan `process.env` server. Vite browser tidak bisa menjalankan itu.

## Konversi Next ke Vite

### Routing

Ganti:

```tsx
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
```

Menjadi:

```jsx
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
```

Pola pengganti:

| Next | Vite |
| --- | --- |
| `useRouter().push("/x")` | `useNavigate()("/x")` |
| `usePathname()` | `useLocation().pathname` |
| `Link href="/x"` | `Link to="/x"` |
| route `[id]` | route `:id` + `useParams()` |
| `redirect("/dashboard")` | `<Navigate to="/drone-dashboard" replace />` |

### Import Alias

Project teman pakai `@/...`.

Vite kamu sudah pakai alias `@` kalau `vite.config.ts` mengarah ke `src`. Kalau belum, tambahkan:

```ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
  },
}
```

### Environment Variable

Ganti semua `NEXT_PUBLIC_...` menjadi `VITE_...`.

| Next env | Vite env |
| --- | --- |
| `NEXT_PUBLIC_TILESERVER_URL` | `VITE_TILESERVER_URL` |
| `NEXT_PUBLIC_MAP_STYLE` | `VITE_MAP_STYLE` |
| `NEXT_PUBLIC_MAP_CENTER` | `VITE_MAP_CENTER` |
| `NEXT_PUBLIC_MAP_ZOOM` | `VITE_MAP_ZOOM` |
| `NEXT_PUBLIC_COPILOT_API_URL` | `VITE_COPILOT_API_URL` |
| `NEXT_PUBLIC_COPILOT_API_KEY` | `VITE_COPILOT_API_KEY` |
| `NEXT_PUBLIC_COPILOT_MODEL` | `VITE_COPILOT_MODEL` |

Ganti akses:

```ts
process.env.NEXT_PUBLIC_TILESERVER_URL
```

Menjadi:

```js
import.meta.env.VITE_TILESERVER_URL
```

Server env seperti `BACKEND_GRPC_ADDR`, `FILE_SERVER_BASE_URL`, dan `METERS_PER_PIXEL` jangan dipakai di Vite. Itu nanti milik FastAPI.

### Font

Next:

```tsx
import { Anton, Oswald, JetBrains_Mono } from "next/font/google";
```

Vite:

1. Tambah Google Fonts link di `web/index.html`, atau install package font.
2. Pakai CSS variable/class biasa.

Minimal di `web/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=JetBrains+Mono:wght@400;600;700&family=Oswald:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
```

### CSS/Tailwind

Project teman pakai Tailwind 4 syntax:

```css
@import "tailwindcss";
@theme { ... }
```

Project SmartGIS pakai Tailwind 3:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Jangan upgrade Tailwind dulu. Lebih murah:

1. Ambil CSS variable GCS dari `src/app/globals.css`.
2. Taruh dalam selector pembungkus `.gcs-app`.
3. Tambah font family dan helper class yang dipakai GCS.
4. Warna seperti `text-primary`, `bg-surface`, `font-headline` harus ditambahkan ke `web/tailwind.config.js`, atau diganti ke arbitrary class.

Contoh wrapper:

```css
.gcs-app {
  --primary: #005bb3;
  --secondary: #656100;
  --secondary-fixed: #fbef00;
  --on-secondary-fixed: #1e1c00;
  --surface: #f7f9fb;
  --on-surface: #191c1e;
  --on-surface-variant: #414754;
  --outline-variant: #c0c6d6;
  --error: #ba1a1a;
}
```

## Route Setup di SmartGIS

Di `web/src/app.jsx`:

```jsx
<Route path="/drone-dashboard/*" element={<DroneDashboard />} />
```

Di `web/src/pages/DroneDashboard.jsx`:

```jsx
import { Navigate, Route, Routes } from "react-router-dom";
import { GcsLayout } from "@/components/gcs/GcsLayout";
import { Dashboard } from "@/pages/gcs/Dashboard";

export function DroneDashboard() {
  return (
    <GcsLayout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/drone-dashboard" replace />} />
      </Routes>
    </GcsLayout>
  );
}
```

Tambahkan page lain setelah dashboard hidup.

## API Frontend

Biarkan browser tetap memanggil path ini:

```txt
/api/jobs
/api/jobs/:id
/api/jobs/:id/cancel
/api/drone/config
/api/drone/diagnostics
/api/drone/status
/api/drone/arm
/api/drone/disarm
/api/drone/setmode
/api/drone/takeoff
/api/drone/land
/api/drone/goto
/api/drone/mission
/api/drone/mission/execute
```

Tapi implementasinya nanti bukan Next route handler. Implementasinya pindah ke FastAPI `server/app/routes/`.

Selama backend belum dipindah, UI harus tahan error:

- telemetry tampil `offline`
- command button menampilkan error
- dashboard tetap bisa dibuka
- map tetap render

## Dependency

Sudah ada di `web/package.json`:

```txt
react
react-dom
react-router-dom
lucide-react
leaflet
```

Perlu dicek saat port:

```txt
@turf/turf
fuse.js
geotiff
```

Jangan bawa ke Vite:

```txt
next
@grpc/grpc-js
eslint-config-next
@tailwindcss/postcss
```

`@grpc/grpc-js` nanti jadi dependency backend FastAPI kalau masih perlu bridge Node, tapi idealnya FastAPI langsung bicara ke backend drone.

## Urutan Kerja Frontend

### Fase 1 - Shell GCS

Hasil:

- `/drone-dashboard` terbuka full page.
- Ada header/sidebar GCS.
- Ada tombol balik ke `/maps` atau `/menu`.
- Sidebar link aktif memakai `useLocation`.

File:

```txt
web/src/pages/DroneDashboard.jsx
web/src/components/gcs/GcsLayout.jsx
web/src/components/gcs/Header.jsx
web/src/components/gcs/Sidebar.jsx
```

### Fase 2 - Dashboard Telemetry

Hasil:

- Dashboard teman tampil di Vite.
- `DroneMap` tampil.
- `DroneTelemetryProvider` polling `/api/drone/diagnostics`.
- Kalau endpoint belum ada, tampil offline.

File:

```txt
web/src/pages/gcs/Dashboard.jsx
web/src/components/gcs/DroneTelemetryProvider.jsx
web/src/components/gcs/DroneMap.jsx
web/src/components/gcs/ActiveMissionCard.jsx
web/src/lib/gcs/api.js
web/src/lib/gcs/diagnostics.js
web/src/lib/gcs/drone-settings.js
web/src/lib/gcs/mission-plan.js
web/src/lib/gcs/use-active-job.js
```

### Fase 3 - Drone Settings dan Flight Test

Hasil:

- User bisa set backend drone address.
- Manual command UI tersedia.
- Error command jelas.

Port:

```txt
drone_settings/page.tsx
drone-test/page.tsx
```

### Fase 4 - Mapping

Hasil:

- List mapping sessions.
- Detail map/NDVI bisa dibuka.
- New mapping page bisa push mission.

Port:

```txt
mapping/page.tsx
mapping/[id]/page.tsx
mapping/new/page.tsx
MapCard.tsx
PreFlightAuditModal.tsx
ConfirmationModal.tsx
```

### Fase 5 - Spraying

Hasil:

- Import KML/session.
- Generate route.
- Push/execute mission.
- Handoff mission plan ke dashboard.

Port:

```txt
spraying/page.tsx
kml.ts
mercator.ts
path-planner.ts
geo.ts
```

### Fase 6 - Copilot, Logs, Settings

Port terakhir karena tidak kritis untuk integrasi tombol drone dari `/maps`.

## Checklist Konversi per File

Untuk setiap file yang dipindah:

1. Hapus `"use client";`.
2. Rename `.tsx` ke `.jsx` kalau tidak mau pakai TypeScript.
3. Hapus type annotation TypeScript.
4. Ganti `next/link` ke `react-router-dom`.
5. Ganti `next/navigation` ke `react-router-dom`.
6. Ganti `process.env.NEXT_PUBLIC_*` ke `import.meta.env.VITE_*`.
7. Hapus komentar eslint khusus Next seperti `@next/next/no-img-element`.
8. Pastikan import alias mengarah ke `@/components/gcs/...`, `@/pages/gcs/...`, atau `@/lib/gcs/...`.
9. Jalankan `npm run build`.

## Catatan TypeScript vs JSX

Project SmartGIS sekarang mayoritas JSX. Pilihan paling cepat:

- halaman dan komponen GCS dipindah sebagai `.jsx`
- type-only file seperti `api-types.ts` bisa diterjemahkan jadi JSDoc atau dihapus dulu
- validasi runtime cukup pakai fallback sederhana

Kalau ingin mempertahankan TypeScript untuk GCS, boleh, karena Vite sudah punya TS config. Tapi jangan campur setengah-setengah terlalu lama.

## Backend yang Nanti Perlu Dipindah ke FastAPI

Next route handler yang harus diganti:

```txt
src/app/api/jobs/route.ts
src/app/api/jobs/[id]/route.ts
src/app/api/jobs/[id]/cancel/route.ts
src/app/api/drone/arm/route.ts
src/app/api/drone/disarm/route.ts
src/app/api/drone/setmode/route.ts
src/app/api/drone/takeoff/route.ts
src/app/api/drone/land/route.ts
src/app/api/drone/goto/route.ts
src/app/api/drone/status/route.ts
src/app/api/drone/diagnostics/route.ts
src/app/api/drone/config/route.ts
src/app/api/drone/mission/route.ts
src/app/api/drone/mission/execute/route.ts
```

Server logic sumbernya:

```txt
src/lib/server/backend.ts
```

Ini bisa diterjemahkan ke:

```txt
server/app/routes/drone.py
server/app/routes/jobs.py
server/app/services/gcs_backend.py
```

Tapi jangan mulai dari sini kalau target sekarang frontend dulu.

## Definition of Done Frontend Pertama

Frontend fase awal dianggap selesai kalau:

- klik icon drone dari `/maps` masuk ke `/drone-dashboard`
- halaman tidak blank saat API drone mati
- sidebar GCS bisa pindah minimal dashboard/settings placeholder
- `npm run build` sukses
- tidak ada import dari `next/*`
- tidak ada import dari `src/lib/server/backend`
- tidak ada dependency `next` baru di `web/package.json`

## Risiko

1. Tailwind 4 class/theme dari project teman tidak langsung cocok dengan Tailwind 3 SmartGIS.
2. GCS dashboard bergantung pada `/api/drone/diagnostics`; tanpa backend, status akan offline.
3. Mapping/spraying bergantung pada artifacts KML/GeoTIFF dan job API.
4. Copilot memakai env API key; jangan hardcode key di frontend kalau bukan public/test key.

## Rekomendasi Keputusan

Mulai dari Fase 1 dan Fase 2 saja.

Skipped full backend port dan semua fitur mapping/spraying sekaligus; add when shell GCS + telemetry dashboard sudah stabil di Vite.
