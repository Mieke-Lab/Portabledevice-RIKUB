# Dokumentasi Tema Warna & Sistem — Jaga Padi / SmartGIS Web

Sumber kebenaran warna: `web/tailwind.config.js` (token warna) dan `web/src/index.css` (variabel CSS `:root` + kelas custom). Warna hex tambahan yang dipakai langsung inline di beberapa halaman didaftarkan terpisah di bagian bawah.

Web ini punya **dua "skin" berbeda** yang hidup berdampingan:

1. **Jaga Padi (halaman utama/publik)** — tema hijau ala Starbucks + cream, dipakai di Splash, Menu, Maps, Detection, Chatbot, DroneDashboard.
2. **GCS Mode (Ground Control Station)** — tema biru abu-abu Material Design 3-ish, dipakai khusus di `pages/gcs/*` dan `components/gcs/*`.

Ditambah 1 sub-sistem warna khusus data: **NDVI health gradient** (merah → kuning → hijau).

---

## 0. Gambaran Sistem & Fitur

"Jaga Padi" adalah aplikasi web untuk pemantauan sawah padi berbasis GIS, computer vision, dan drone otonom. Frontend React (Vite) di `web/`, backend FastAPI di `server/`.

### 0.1 Peta Navigasi (Routing)

Router utama (`web/src/app.jsx`):

| Path | Halaman | Fungsi |
|---|---|---|
| `/` | Splash | Layar pembuka/loading dengan animasi siput & tunas (branding) |
| `/menu` | Menu | Halaman utama, kartu navigasi ke 3 fitur besar: SmartGIS, Chatbot AI, Deteksi Penyakit |
| `/maps` | Maps (SmartGIS) | Peta interaktif utama |
| `/detection` | Detection | Deteksi penyakit daun padi dari foto |
| `/chatbot` | Chatbot | Asisten AI percakapan pertanian |
| `/drone-dashboard/*` | DroneDashboard | Sub-router terpisah untuk mode GCS (drone), pakai skin biru-abu |

Sub-route di dalam `/drone-dashboard/*` (`pages/DroneDashboard.jsx`):

| Sub-path | Halaman | Fungsi |
|---|---|---|
| *(index)* | Dashboard | Ringkasan misi aktif, peta drone real-time, status GPS/telemetri |
| `mapping` | Mapping | Daftar job pemetaan (mapping) yang sudah/lagi diproses |
| `mapping/new` | MappingNew | Bikin misi mapping baru: gambar area (polygon/obstacle/circle) → generate flight path → atur settings → kirim ke drone |
| `mapping/:id` | MappingDetail | Detail hasil satu job mapping |
| `spraying` | Spraying | Perencanaan misi semprot: pilih peta hasil mapping → tentukan zona & dosis chamber → generate rute terbang → atur setting semprot → eksekusi |
| `flight-test` | DroneTest | Kontrol manual drone: arm/disarm, set mode terbang, takeoff/land, goto titik, kirim mission — untuk pengujian |
| `copilot` | Copilot | "Agro-Copilot" — chat asisten AI + kamera capture + pembacaan sensor tanah 7-in-1 |
| `drone-settings` | DroneSettings | Konfigurasi koneksi drone (host:port), interval polling diagnostik |
| `logs` | Logs | *(placeholder, belum diimplementasi)* |
| `settings` | Settings | *(placeholder, belum diimplementasi)* |

### 0.2 Fitur Utama (ringkas per modul)

**SmartGIS (`/maps`)** — peta Leaflet interaktif dengan banyak layer opsional (lewat `LayerPanel`):
- Base layer (satelit/peta biasa)
- Zona NDVI (kesehatan tanaman, lihat gradient warna di bagian 3)
- Titik target semprot (spray targets) dari hasil deteksi, dengan popup chamber (fungisida/insektisida) dan riwayat deteksi
- Overlay rute & telemetri drone real-time (posisi, heading, status GPS) lewat `DroneTelemetryProvider`
- Pencarian lokasi/alamat
- Panel statistik kesehatan NDVI dan panel zona semprot

**Chatbot AI (`/chatbot`)** — asisten percakapan pertanian (`sendChatMessage`, `analyzeParameters`), riwayat sesi tersimpan di `localStorage`, saran pertanyaan cepat (kenapa daun menguning, hama wereng, jadwal pupuk, pH tanah ideal).

**Deteksi Penyakit (`/detection`)** — upload foto atau ambil dari kamera → `detectDisease` (klasifikasi penyakit daun padi), plus panel dummy sensor tanah (N, P, K, Na, pH, kelembapan, suhu) dengan status Rendah/Optimal/Tinggi.

**GCS Mode / Drone Dashboard (`/drone-dashboard/*`)** — kontrol penuh drone otonom:
- **Mapping**: rencanakan area pemetaan udara, generate flight path otomatis, kirim & eksekusi misi ke drone, lihat progress job stitching citra
- **Spraying**: alur multi-fase (pilih peta → tentukan zona semprot & dosis per chamber → generate rute lintasan (lane spacing, overlap, spray width) → atur ketinggian/kecepatan/hold time → **Pre-Flight Audit** (modal cek kesiapan sebelum terbang) → eksekusi
- **Flight Test**: kontrol manual (arm, disarm, set mode STABILIZE/GUIDED/AUTO/LOITER/RTL/LAND, takeoff, land, goto, kirim mission) buat testing drone langsung
- **Agro-Copilot**: chatbot khusus GCS + modal capture kamera + modal baca sensor tanah, sesi percakapan tersimpan
- **Drone Settings**: atur alamat host:port drone dan interval polling status
- Semua halaman GCS berbagi diagnostik real-time (`useDiagnostics`) untuk status GPS fix, heading, posisi

### 0.3 Backend (FastAPI, `server/app`)

Endpoint utama per grup (`server/app/routes/`):

| Grup | Prefix | Isi |
|---|---|---|
| `health.py` | `/health` | Health check server |
| `fields.py` | `/fields`, `/imagery`, `/polygons` | Data lahan/field, citra terbaru per field, target semprot per field, polygon lahan |
| `jobs.py` | `/api/jobs` | CRUD job pemetaan: list, buat, ambil detail, cancel, hapus |
| `drone.py` | `/api/drone` | Kontrol & telemetri drone: config, diagnostics, status, kirim & eksekusi mission, arm/disarm, set mode, takeoff, land, goto |

Ada juga `grpc_backend.py` — kemungkinan jembatan komunikasi ke drone/controller lewat gRPC (di luar FastAPI biasa).

### 0.4 Alur Data Singkat

1. Drone terbang misi mapping → citra dikumpulkan → job diproses (stitching) → hasil jadi peta/field baru.
2. Peta hasil mapping dipakai untuk deteksi penyakit (spray target) dan analisis NDVI.
3. Target semprot & zona NDVI ditampilkan di SmartGIS (`/maps`) dan dipakai untuk merencanakan misi **Spraying** di GCS mode.
4. Semua kontrol/telemetri drone real-time mengalir lewat `/api/drone/*` dan dipoll oleh `useDiagnostics`/`useActiveJob` di frontend.

---

## 1. Tema Utama — Jaga Padi (Starbucks-inspired)

Didefinisikan di `web/tailwind.config.js` (blok `colors`) dan diadaptasi ke variabel HSL di `web/src/index.css` (`:root`).

### 1.1 Palet Hijau Bertingkat

| Token Tailwind | Hex | HSL var | Peran |
|---|---|---|---|
| `forest` | `#006241` | — | Warna heading / judul besar |
| `leaf` | `#00754A` | `--primary: 157 100% 23%` | CTA utama, tombol aksi, ring focus |
| `house` | `#1E3932` | — | Band gelap / footer |
| `uplift` | `#2b5148` | — | Aksen dekoratif |
| `sky` | `#00754A` | alias legacy → sama dengan `leaf` | dipakai di kode lama |

### 1.2 Gold — Aksen Cadangan

| Token | Hex | HSL var | Peran |
|---|---|---|---|
| `harvest` | `#cba258` | `--accent: 37 49% 57%` | Aksen emas, dipakai terbatas (badge, garis dekoratif) |

### 1.3 Netral Hangat

| Token | Hex | HSL var | Peran |
|---|---|---|---|
| `cream` | `#f2f0eb` | `--background: 43 23% 93%` | Warna kanvas/background utama |
| `ceramic` | `#edebe9` | `--muted: 40 11% 92%` | Permukaan muted, kartu sekunder |

### 1.4 Variabel Semantic (shadcn-style, `hsl(var(--x))`)

Dipetakan dari palet di atas, dipakai lewat kelas Tailwind seperti `bg-primary`, `text-foreground`, dll:

| Variabel | Nilai HSL | Setara warna | Peran |
|---|---|---|---|
| `--background` | `43 23% 93%` | `#f2f0eb` cream | Latar halaman |
| `--foreground` | `0 0% 13%` | hitam ~87% opacity | Teks utama |
| `--card` / `--popover` | `0 0% 100%` | putih | Latar kartu & popover |
| `--card-foreground` / `--popover-foreground` | `0 0% 13%` | hitam | Teks di atas kartu |
| `--primary` | `157 100% 23%` | `#00754A` (leaf) | Tombol/CTA utama |
| `--primary-foreground` | `0 0% 100%` | putih | Teks di atas tombol primary |
| `--secondary` | `160 33% 87%` | `#d4e9e2` hijau muda | Latar sekunder |
| `--secondary-foreground` | `165 31% 17%` | hijau gelap | Teks di atas secondary |
| `--muted` | `40 11% 92%` | `#edebe9` (ceramic) | Latar muted |
| `--muted-foreground` | `0 0% 42%` | abu | Teks sekunder/soft |
| `--accent` | `37 49% 57%` | `#cba258` (harvest/gold) | Aksen, **dipakai terbatas** |
| `--accent-foreground` | `0 0% 13%` | hitam | Teks di atas aksen |
| `--destructive` | `5 82% 43%` | `#c82014` merah | Error, aksi merusak |
| `--destructive-foreground` | `0 0% 100%` | putih | Teks di atas destructive |
| `--border` / `--input` | `40 10% 86%` | abu hangat muda | Garis batas, input |
| `--ring` | `157 100% 23%` | `#00754A` | Outline focus |
| `--radius` | `0.75rem` (12px) | — | Radius default kartu |

**Aturan pemakaian (dari `body`):** letter-spacing `-0.01em` (tracking rapat ala Starbucks), font dasar Inter, `overflow: hidden` di body (layout full-viewport, bukan scroll halaman biasa).

### 1.5 Warna "GCS-lama" yang nyasar ke tailwind.config

Token ini ada di `tailwind.config.js` tapi sebenarnya untuk skin GCS (lihat bagian 2) — didaftarkan di sini karena letaknya di file yang sama:

| Token | Hex |
|---|---|
| `gcs-primary` | `#005bb3` |
| `gcs-secondary` | `#656100` |
| `gcs-secondary-fixed` | `#fbef00` |
| `gcs-on-secondary-fixed` | `#1e1c00` |
| `gcs-surface` | `#f7f9fb` |
| `gcs-on-surface` | `#191c1e` |
| `gcs-muted` | `#414754` |
| `gcs-outline` | `#c0c6d6` |
| `gcs-error` | `#ba1a1a` |
| `gcs-bg` | `#e2e8f0` |

---

## 2. Tema Kedua — GCS Mode (Ground Control Station)

Dipakai khusus di halaman `web/src/pages/gcs/*.jsx` dan `web/src/components/gcs/*.jsx` (Spraying, MappingNew, PreFlightAuditModal, DroneMap). Nuansanya **biru-abu Material Design 3**, kontras sengaja dengan tema hijau-cream halaman utama karena ini adalah "aplikasi di dalam aplikasi" untuk kontrol drone.

Class pembungkus: `.gcs-app` (di `index.css`):
```css
.gcs-app {
  background-color: #e2e8f0;                       /* gcs-bg */
  background-image: radial-gradient(#cbd5e1 1px, transparent 1px);
  background-size: 24px 24px;                       /* pola dot grid halus */
  font-family: "Oswald", "Oswald Fallback", sans-serif;
  color: #191c1e;                                    /* gcs-on-surface */
}
```

| Warna | Hex | Peran |
|---|---|---|
| Primary (biru) | `#005bb3` | Tombol aksi, ikon aktif, garis rute drone |
| Secondary (olive/kuning tua) | `#656100` | Aksen sekunder |
| Secondary-fixed (kuning terang) | `#fbef00` | Highlight/peringatan ringan |
| On-secondary-fixed | `#1e1c00` | Teks di atas kuning |
| Surface | `#f7f9fb` | Latar panel/card |
| On-surface | `#191c1e` | Teks utama di GCS |
| Muted | `#414754` | Teks sekunder |
| Outline | `#c0c6d6` | Garis batas antar elemen |
| Error | `#ba1a1a` | Peringatan/hapus/berbahaya (juga dipakai dengan opacity: `#ba1a1a50`, `#ba1a1a30`) |
| Background dot-grid | `#e2e8f0` + dot `#cbd5e1` | Latar halaman GCS |

Efek kaca (`glass-panel`, dipakai di dalam `.gcs-app`):
```css
.gcs-app .glass-panel {
  border: 1px solid rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(20px);
}
```

---

## 3. Sub-sistem: NDVI Health Gradient

Dipakai di `components/maps/ndvi/NdviHealthStats.jsx` dan `NdviZonesPanel.jsx` untuk memvisualisasikan kesehatan tanaman (indeks NDVI) sebagai gradient horizontal:

```
#27272a → #27272a (0–50%, abu gelap = no-data/di luar rentang)
       → #ef233c (50%, merah = stres berat)
       → #f59e0b (60.5%, oranye/kuning = stres ringan)
       → #7bd85a (70%, hijau muda = sehat)
       → #1fbf63 (80%, hijau = sehat baik)
       → #0f7a3f (90–100%, hijau tua = sangat sehat)
```

| Hex | Arti kesehatan |
|---|---|
| `#27272a` | Tidak ada data / di luar rentang |
| `#ef233c` | Stres berat (NDVI rendah) |
| `#f59e0b` | Stres ringan |
| `#7bd85a` | Sehat |
| `#1fbf63` | Sehat baik |
| `#0f7a3f` | Sangat sehat (NDVI tinggi) |

Palet ini terpisah dari token Tailwind — ditulis inline sebagai `linear-gradient(...)`, jadi kalau mau ganti skema warna NDVI, edit langsung di dua file itu (nilainya harus identik di keduanya).

---

## 4. Sub-sistem: Peta & Marker (Maps.jsx)

Warna "rose/red" untuk marker **target semprot (spray target)** dan panel deteksi, terpisah dari token global:

| Hex | Peran |
|---|---|
| `#e11d48` | Merah utama — teks label, badge kode zona, tombol aktif |
| `#fb7185` | Merah muda — fill marker, border tombol chamber aktif |
| `#be123c` | Merah tua — teks di atas latar `#fff1f2`, hover state |
| `#fff1f2` | Latar merah sangat muda — badge, tombol icon |
| `#fecaca` | Border/track merah muda pudar (progress bar confidence, dashed border) |

Warna netral pendukung di popup yang sama: `#e2e8f0`, `#334155`, `#f8fafc`, `#64748b`, `#fff`.

Marker spinner lokasi (`.jp-location-spinner`): border `rgba(75,124,99,0.18)` dengan top-color `#4b7c63` (hijau sage, beda lagi dari `leaf`/`forest` — dipakai khusus loading spinner).

---

## 5. Ringkasan "Kapan Pakai Warna Apa"

| Konteks | Palet | Sumber |
|---|---|---|
| Halaman publik/utama (Splash, Menu, Chatbot, Dashboard) | Hijau Starbucks + Cream (`--primary`, `--background`, dst) | `tailwind.config.js` + `:root` di `index.css` |
| Mode GCS / kontrol drone (`pages/gcs/*`) | Biru-abu Material 3 (`gcs-*`) + dot-grid | Class `.gcs-app` di `index.css` |
| Marker & popup target semprot di peta | Merah/rose (`#e11d48`, `#fb7185`, `#be123c`, `#fff1f2`, `#fecaca`) | Inline di `pages/Maps.jsx` |
| Visualisasi kesehatan NDVI | Gradient merah→kuning→hijau (`#ef233c` … `#0f7a3f`) | Inline di `components/maps/ndvi/*.jsx` |
| Error/destructive umum (form, GCS) | `--destructive` (`#c82014`) di halaman utama, `gcs-error` (`#ba1a1a`) di GCS | keduanya |

---

## 6. Font yang Menyertai Tema

- **Inter** — body/teks halaman utama (default)
- **Anton** — `font-headline`, judul besar/bold
- **Oswald** — `font-data`/`font-body`, juga font default seluruh `.gcs-app`
- **JetBrains Mono** — `font-technical`, data teknis/koordinat/angka

---

*Catatan: dokumen ini dihasilkan dari pembacaan langsung `web/tailwind.config.js`, `web/src/index.css`, dan grep warna hex di `web/src/**`. Kalau ada perubahan warna di kode, dokumen ini perlu di-refresh manual (bukan otomatis).*
