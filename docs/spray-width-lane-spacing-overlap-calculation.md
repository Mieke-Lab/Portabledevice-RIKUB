# Cara Hitung Spray Width, Lane Spacing, dan Overlap

Dokumen ini menjelaskan persis gimana tiga angka di Flight Settings (`Spray
Width`, `Lane Spacing`, `Overlap`) dihitung. Implementasinya ada di
`web/src/lib/gcs/chamber-groups.js`.

Sumber angka: [`Spesifikasi ITS Agriculture Drone V3.md`](./Spesifikasi%20ITS%20Agriculture%20Drone%20V3.md)
(`Maximum flight altitude: 10m`, `Effective Swath Width: 5-8m`). Spek itu
nggak kasih rumus altitude→width, jadi hubungan altitude dengan Spray Width
di bawah ini adalah **interpolasi buatan kita** (ditandai jelas di kode
`chamber-groups.js` sebagai asumsi, bukan angka pabrik).

---

## Ringkasan Alur

```txt
Altitude
   |
   v
Spray Width (2 chamber, "full")
   |
   v
Lane Spacing (input user, default 80% dari Spray Width)
   |
   v
Overlap (dihitung dari Spray Width vs Lane Spacing, readonly)
```

Untuk zona yang cuma pakai 1 chamber, Spray Width dan Lane Spacing-nya
masing-masing dibagi dua dari angka di atas — lihat bagian
[Per Grup Chamber](#per-grup-chamber).

---

## 1. Spray Width

`Spray Width` (buat kondisi 2 chamber nyala bareng) dihitung dari `Altitude`
lewat interpolasi linear:

```txt
Altitude 2m  -> Spray Width 5m   (titik bawah)
Altitude 10m -> Spray Width 8m   (titik atas, sesuai spek "Maximum flight altitude: 10m")
```

Di antara 2m dan 10m, Spray Width naik sedikit demi sedikit dari 5m ke 8m
secara proporsional. Kalau Altitude di luar rentang 2-10m, nilainya dipepetin
(clamped) ke titik terdekat (nggak pernah kurang dari 5m atau lebih dari 8m).

Rumus:

```txt
posisi = (altitude - 2) / (10 - 2)
spray_width = 5 + posisi x (8 - 5)
```

Contoh:

```txt
Altitude = 2m  -> posisi = 0.000 -> Spray Width = 5.000 m
Altitude = 5m  -> posisi = 0.375 -> Spray Width = 6.125 m
Altitude = 8m  -> posisi = 0.750 -> Spray Width = 7.250 m
Altitude = 10m -> posisi = 1.000 -> Spray Width = 8.000 m
```

**Catatan penting:** angka `2m` (titik bawah altitude) itu **bukan** dari
spek drone — itu asumsi kita (altitude minimum sebelum downwash/cakupan
semprot mulai nggak reliable). Angka `10m` dan rentang `5-8m` itu yang
beneran dari spek. Kalau nanti ada data kalibrasi lapangan asli, tinggal
ganti konstanta di `chamber-groups.js`.

Status: **readonly** — user nggak bisa mengubah ini langsung, cuma lewat
mengubah Altitude.

---

## 2. Lane Spacing

`Lane Spacing` adalah satu-satunya angka yang **diisi user** (editable),
dengan default:

```txt
lane_spacing_default = spray_width x 0.8
```

Contoh (Altitude 5m, Spray Width 6.125m):

```txt
Lane Spacing default = 6.125 x 0.8 = 4.9 m
```

Kenapa dikali 0.8 (bukan 1.0)? Supaya ada tumpang tindih (overlap) 20% antar
jalur terbang secara default — kalau jalurnya persis selebar Spray Width
tanpa overlap, ada risiko celah tipis di antara dua jalur yang nggak
tersemprot.

User boleh ubah angka ini sesuka hati (lebih rapat atau lebih renggang),
selama masih memenuhi validasi di bagian bawah.

Status: **editable**.

---

## 3. Overlap

`Overlap` **tidak diisi user** — ini murni angka informasi, dihitung balik
dari Spray Width vs Lane Spacing yang sedang aktif:

```txt
overlap_ratio = (spray_width - lane_spacing) / spray_width
overlap_percent = overlap_ratio x 100
```

Contoh (Spray Width 6.125m, Lane Spacing 4.9m):

```txt
overlap_ratio = (6.125 - 4.9) / 6.125 = 0.2
overlap_percent = 20%
```

Kalau Lane Spacing dibuat lebih kecil dari default, Overlap naik (lebih
rapat). Kalau dibuat lebih besar, Overlap turun — bahkan bisa negatif kalau
Lane Spacing melebihi Spray Width (artinya ada celah, bukan tumpang tindih;
lihat [Validasi](#validasi)).

Status: **readonly**.

---

## Per Grup Chamber

Satu field bisa punya beberapa "grup" tergantung kombinasi chamber yang
dipakai zona-zonanya (lihat
[spraying-route-chamber-mission-plan.md](./spraying-route-chamber-mission-plan.md)
buat penjelasan grouping-nya). Spray Width dan Lane Spacing di atas itu
angka buat grup **2 chamber nyala bareng**. Grup yang cuma pakai **1
chamber** dapat angka setengahnya:

```txt
spray_width_1_chamber = spray_width_full / 2
lane_spacing_1_chamber = spray_width_1_chamber x (1 - overlap_ratio)
```

`overlap_ratio` yang dipakai **sama** dengan yang dihitung dari input user di
langkah 2-3 — jadi walau angkanya beda per grup, rasio tumpang-tindihnya
konsisten di semua grup.

Contoh lengkap (Altitude 5m, Lane Spacing input 4.9m -> overlap_ratio 0.2):

| Grup | Spray Width | Lane Spacing |
|------|-------------|--------------|
| 2 chamber (fungisida + insektisida) | 6.125 m | 4.9 m |
| 1 chamber (fungisida saja) | 3.06 m | 2.45 m |
| 1 chamber (insektisida saja) | 3.06 m | 2.45 m |

---

## Validasi

`Generate Route` disabled kalau:

```txt
Lane Spacing input > Spray Width grup manapun (termasuk grup 1-chamber
yang paling sempit)
```

Karena grup 1-chamber selalu punya Spray Width paling kecil (separuh dari
grup 2-chamber), validasi ini otomatis pakai angka grup 1-chamber sebagai
batas paling ketat.

---

## Lokasi Kode

Semua rumus di atas ada di:

```txt
web/src/lib/gcs/chamber-groups.js
  - lookupSprayWidth(altitude)      -> bagian 1
  - defaultLaneSpacing(altitude)    -> bagian 2 (default awal)
  - computeChamberGroups({...})     -> bagian 2-4 (dengan input user)
```

`FlightSettingsWidget.jsx` cuma menampilkan hasil dari fungsi-fungsi itu,
nggak ada logic hitung-hitungan di komponennya sendiri.
