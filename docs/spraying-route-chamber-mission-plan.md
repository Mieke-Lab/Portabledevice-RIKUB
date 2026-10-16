# Spraying Route + Chamber Mission Plan

Dokumen ini menggabungkan [spraying-route-parameter-plan.md](./spraying-route-parameter-plan.md)
(parameter altitude/spray width/lane spacing/overlap) dengan
[spray-target-chamber-selection-knowledge.md](./spray-target-chamber-selection-knowledge.md)
(chamber per polygon) menjadi satu rencana lengkap: dari `spray_polygons` yang
sudah punya `selected_chambers`, sampai jadi satu mission drone yang siap
dieksekusi.

Ini rencana MVP. `docs/drone_api.md` (mission API yang sudah ada) **tidak
dijadikan patokan** untuk skema mission per-chamber di dokumen ini — bagian
mission di sini adalah proposal baru yang belum diimplementasikan di sisi
drone/firmware.

---

## Tujuan

Satu field bisa punya beberapa `spray_polygons` dengan `selected_chambers`
berbeda-beda (fungisida saja, insektisida saja, atau keduanya sekaligus).
Tujuannya: dari kondisi itu, hasilkan **satu mission** (satu take-off, satu
landing) yang rutenya menyesuaikan lebar semprot tiap kombinasi chamber, dan
menandai valve/chamber mana yang harus aktif di tiap titik rute.

---

## Alur End-to-End

```txt
spray_polygons (sudah ready, punya selected_chambers)
        |
        v
[BACKEND] Group berdasarkan kombinasi unik selected_chambers
        |
        v
[BACKEND] Tiap grup: tentukan spray width & lane spacing
        |
        v
[BACKEND] Tiap grup: generate rute zig-zag (lat/lng asli dari geometry)
        |
        v
[BACKEND] Gabung semua grup jadi satu list waypoint,
          tiap titik ditandai chamber aktifnya
        |
        v
[BACKEND] Simpan ke DB (generate ulang menimpa yang lama)
        |
        v
[FRONTEND] Preview di peta + tombol Upload Mission / Execute
        |
        v
Drone (mission API baru, lihat bagian Mission)
```

Semua perhitungan (grouping, spray width, lane spacing, zig-zag geometry)
dikerjakan di **backend** (Python), bukan di frontend. Alasannya: backend
sudah punya kode proyeksi geometri (UTM, dsb.) yang dipakai untuk NDVI zones,
jadi tidak perlu re-implementasi proyeksi lagi di JS.

---

## 1. Grouping Berdasarkan Chamber

Sebelumnya sempat dipikirkan grouping per chamber tunggal dengan double-pass
untuk polygon yang butuh 2 chamber. **Itu salah** — drone bisa menyalakan 2
chamber sekaligus dalam satu lintasan, jadi grouping yang benar adalah per
**kombinasi unik** `selected_chambers`.

Contoh:

| Zona | selected_chambers |
|------|--------------------|
| Z01 | `["fungisida"]` |
| Z02 | `["insektisida"]` |
| Z03 | `["fungisida", "insektisida"]` |

Hasil grouping:

```txt
Grup A: chambers=["fungisida"]                 -> Z01
Grup B: chambers=["insektisida"]               -> Z02
Grup C: chambers=["fungisida","insektisida"]   -> Z03
```

Tiap grup = **satu kali lintasan** (bukan double-pass). Polygon yang butuh 2
chamber disemprot sekaligus di grupnya sendiri, bukan dilewati dua kali.

---

## 2. Spray Width & Lane Spacing per Grup

Spray width dasar tetap lookup dari tabel altitude (lihat
[spraying-route-parameter-plan.md](./spraying-route-parameter-plan.md)):

| Altitude | Spray Width (2 chamber aktif) |
|----------|-------------------------------|
| 3 m | 2 m |
| 5 m | 3 m |
| 7 m | 4 m |
| 10 m | 5 m |
| 15 m | 7 m |

Aturan per jumlah chamber aktif dalam satu grup:

```txt
2 chamber aktif bersamaan -> spray_width = nilai tabel
1 chamber aktif           -> spray_width = nilai tabel / 2
```

Alasan: nilai tabel mengasumsikan kedua nozzle/chamber menyala bersamaan. Kalau
cuma satu yang menyala, lebar efektif semprotan jadi lebih sempit.

### Lane Spacing — tetap satu input

User tetap cuma mengisi **satu** nilai Lane Spacing (mengacu ke grup dengan
spray width penuh/2-chamber untuk altitude yang dipilih). Backend menurunkan
rasio overlap dari nilai itu, lalu memakai rasio yang sama untuk menghitung
lane spacing tiap grup lain dari spray width masing-masing grup.

```txt
overlap_ratio = (spray_width_full - lane_spacing_input) / spray_width_full

lane_spacing_group = spray_width_group × (1 - overlap_ratio)
```

Contoh (altitude 5 m, spray_width_full = 3 m, lane_spacing_input = 2.4 m):

```txt
overlap_ratio = (3 - 2.4) / 3 = 0.2

Grup 2-chamber : spray_width = 3.0 -> lane_spacing = 3.0 × 0.8 = 2.4 m
Grup 1-chamber : spray_width = 1.5 -> lane_spacing = 1.5 × 0.8 = 1.2 m
```

Kenapa satu input, bukan per-grup:

```txt
- Konsisten dengan keputusan awal: user atur jarak (meter), bukan persentase.
- Jumlah kombinasi chamber kecil (maks 3 untuk MVP 2 chamber), tapi tetap
  merepotkan kalau user harus isi satu-satu.
- Kalau grouping berubah (user ubah chamber salah satu zona), sistem tinggal
  derive ulang dari rasio yang sama, tidak perlu input baru.
```

---

## 3. Generate Waypoint (Geometry)

Per grup:

1. Ambil `geometry` (lat/lng asli) dari semua `spray_polygons` yang masuk
   grup itu.
2. Proyeksikan ke UTM (meter akurat) — pakai helper proyeksi yang sudah ada
   di backend untuk NDVI zones.
3. Bikin garis-garis sejajar dengan jarak = `lane_spacing_group` (meter).
4. Potong tiap garis dengan outline polygon grup itu (union kalau lebih dari
   satu polygon per grup).
5. Urutkan potongan garis jadi rute zig-zag (nearest-neighbor antar ujung
   segmen).
6. Proyeksikan balik ke lat/lng.

Ini logic baru di backend, bukan reuse `web/src/lib/gcs/path-planner.js` —
file itu bekerja di koordinat `x,y` palsu (`SCALE` konstan), bukan proyeksi
geografis asli, dan dipakai untuk tool drawing manual yang tidak berhubungan.

---

## 4. Gabungan Jadi Satu Mission

Semua grup digabung berurutan jadi satu list waypoint. Tiap titik ditandai
chamber yang harus aktif untuk segmen menuju titik itu:

```json
{
  "waypoints": [
    { "lat": -7.2756, "lng": 112.7946, "chamber": ["fungisida"] },
    { "lat": -7.2757, "lng": 112.7948, "chamber": ["fungisida"] },
    { "lat": -7.2760, "lng": 112.7952, "chamber": ["insektisida"] },
    { "lat": -7.2762, "lng": 112.7954, "chamber": ["fungisida", "insektisida"] }
  ],
  "altitude": 5.0
}
```

`chamber` pada tiap titik = valve/tangki yang harus aktif selama segmen dari
titik sebelumnya menuju titik ini. Titik pertama tidak punya segmen
sebelumnya, jadi nilainya diabaikan (atau dianggap "belum aktif").

Urutan antar grup untuk MVP: bebas (misal urutan kemunculan grup). Tidak ada
optimasi urutan berdasarkan jarak antar grup di tahap ini.

---

## 5. Persistensi (Database)

Tabel baru, misal `spraying_routes`:

```txt
id
field_id
altitude
lane_spacing_input
groups JSONB       -- [{chambers, spray_width, lane_spacing, polygon_ids, waypoint_count}]
waypoints JSONB    -- daftar lengkap [{lat, lng, chamber}]
generated_at
```

Satu field = satu row aktif. Generate Route ulang **menimpa** row lama (bukan
riwayat berlapis/versioning) — sesuai keputusan MVP.

---

## 6. Endpoint Baru

| Endpoint | Fungsi |
|----------|--------|
| `POST /fields/{id}/spraying-route` | Hitung grouping + geometry + simpan. Input: `altitude`, `lane_spacing`. |
| `GET /fields/{id}/spraying-route` | Ambil rute tersimpan (preview ulang tanpa generate ulang). |

---

## 7. Mission API — Proposal Baru (Terpisah dari `drone_api.md`)

`docs/drone_api.md` (`PushMission`/`ExecuteMission`) tidak punya konsep
"chamber per titik" — waypoint-nya cuma `[lat, lng]` flat, altitude/speed
global untuk seluruh mission. Untuk mendukung switch chamber di tengah
penerbangan, API mission perlu tambahan field seperti `waypoints[].chamber`
pada contoh di atas.

Status: **proposal, belum diimplementasikan** di sisi backend drone/firmware.
Backend drone perlu menerjemahkan perubahan `chamber` antar titik jadi
perintah relay/servo (MAVLink `DO_SET_RELAY`/`DO_SET_SERVO`) yang disisipkan
di antara waypoint saat upload mission. Ini pekerjaan tim yang memegang
`soerogis.DroneService`, bukan bagian dari frontend/backend GIS ini.

---

## 8. Validasi Generate Route

Tetap berdasarkan [spraying-route-parameter-plan.md](./spraying-route-parameter-plan.md),
dengan satu penyesuaian:

```txt
1. Ada Spray Targets.
2. Semua Spray Targets punya selected_chambers.
3. Altitude > 0.
4. Lane Spacing input > 0.
5. Lane Spacing per grup <= Spray Width grup itu, untuk SEMUA grup
   (bukan cuma satu spray width, karena tiap grup nilainya beda).
```

---

## 9. Frontend

- `SprayingRoutePanel.jsx`: tambah field Spray Width (readonly) dan Overlap
  (readonly) di samping Altitude dan Lane Spacing yang sudah ada.
- Tombol `Generate Route` memanggil `POST /fields/{id}/spraying-route`, lalu
  render `waypoints` hasilnya di peta.
- Tombol `Upload Mission` / `Execute` tetap memakai `pushMission()` /
  `executeMission()` yang sudah ada di `web/src/lib/gcs/api.js`, tapi
  payload-nya menunggu skema mission API baru (bagian 7) siap di sisi drone.

---

## 10. Di Luar Cakupan (Belum Diselesaikan)

```txt
- Implementasi command relay/servo per chamber di backend drone/firmware.
- Optimasi urutan antar grup (saat ini asal urutan kemunculan).
- Speed, dose, flow rate, liquid needed, route duration (lihat
  spraying-route-parameter-plan.md — belum dibuka di MVP ini).
- Versioning/riwayat rute (saat ini generate ulang = menimpa).
```

---

## Urutan Implementasi yang Disarankan

```txt
1. Fungsi grouping + spray width/lane spacing per grup (pure logic, tanpa DB/geometry).
2. Fungsi generate waypoint zig-zag per grup (geometry, pakai proyeksi UTM).
3. Endpoint POST/GET /fields/{id}/spraying-route + tabel spraying_routes.
4. Update SprayingRoutePanel.jsx (field baru + wiring ke endpoint).
5. Koordinasi skema mission chamber (bagian 7) dengan tim drone backend.
```
