# Spraying Route Parameter Plan

Dokumen ini menjelaskan rancangan parameter awal untuk fitur `Spraying Route` di SmartGIS.
Fokus MVP adalah membuat route generation mudah dipahami oleh petani/operator tanpa membuka terlalu banyak parameter teknis.

---

## Tujuan

Fitur `Spraying Route` mengubah `Spray Targets` yang sudah final menjadi rute penyemprotan drone.

Sebelum route dibuat, sistem harus memastikan:

```txt
1. Ada Spray Targets.
2. Semua Spray Targets sudah punya selected_chambers.
3. Parameter route valid.
```

Kalau ada target yang belum punya chamber, route tidak boleh dibuat.

---

## Prinsip Parameter MVP

Untuk MVP, parameter dibatasi menjadi empat nilai utama:

```txt
Editable:
- Altitude
- Lane Spacing

Readonly:
- Spray Width
- Overlap Estimate
```

Parameter lain seperti speed, dose, flow rate, dan kebutuhan cairan tetap penting, tetapi tidak dibuka dulu pada tahap ini agar workflow tidak terlalu kompleks.

---

## Definisi Parameter

### 1. Altitude

`Altitude` adalah ketinggian terbang drone dari permukaan lahan.

```txt
Status: editable
Sumber: input user/operator
Default MVP: 5 m
```

Alasan altitude diisi user:

```txt
Petani/operator paling tahu kondisi obstacle di sawah.
```

Contoh obstacle:

```txt
- pohon
- tiang
- orang-orangan sawah
- kabel
- kontur lahan
```

Altitude memengaruhi `Spray Width`.

---

### 2. Spray Width

`Spray Width` adalah lebar semprotan drone dalam satu kali lewat.

```txt
Status: readonly
Sumber: lookup dari altitude berdasarkan spesifikasi drone
```

Spray Width tidak di-override pada MVP.

Alasannya:

```txt
Spray width dianggap sebagai karakteristik alat/drone pada altitude tertentu.
Kalau user bisa mengubah spray width, hubungan altitude dan spesifikasi drone menjadi membingungkan.
```

Tabel lookup awal:

| Altitude | Spray Width |
|----------|-------------|
| 3 m | 2 m |
| 5 m | 3 m |
| 7 m | 4 m |
| 10 m | 5 m |
| 15 m | 7 m |

Contoh:

```txt
Altitude = 5 m
Spray Width = 3 m
```

---

### 3. Lane Spacing

`Lane Spacing` adalah jarak antar jalur/lane zig-zag drone.

```txt
Status: editable
Sumber: default sistem, bisa diubah user/operator
```

Parameter ini dibuka untuk user karena sesuai masukan lapangan:

```txt
Petani/operator lebih memahami jarak antar lane daripada persentase overlap.
```

Default awal dihitung dari Spray Width dengan asumsi overlap default 20%.

Rumus:

```txt
lane_spacing = spray_width × 0.8
```

Contoh:

```txt
Spray Width = 3 m
Lane Spacing default = 3 × 0.8 = 2.4 m
```

Jika user mengubah lane spacing:

```txt
- route zig-zag menjadi lebih rapat atau lebih renggang
- route length berubah
- durasi route nanti ikut berubah
```

---

### 4. Overlap Estimate

`Overlap Estimate` adalah estimasi tumpang tindih semprotan antar lane.

```txt
Status: readonly
Sumber: dihitung dari spray_width dan lane_spacing
```

Rumus:

```txt
overlap_percent = (spray_width - lane_spacing) / spray_width × 100
```

Contoh:

```txt
Spray Width = 3 m
Lane Spacing = 2.4 m

Overlap = (3 - 2.4) / 3 × 100
Overlap = 20%
```

Jika lane spacing dibuat lebih kecil:

```txt
Spray Width = 3 m
Lane Spacing = 2 m
Overlap = 33%
```

Jika lane spacing sama dengan spray width:

```txt
Spray Width = 3 m
Lane Spacing = 3 m
Overlap = 0%
```

Jika lane spacing lebih besar dari spray width:

```txt
Spray Width = 3 m
Lane Spacing = 4 m
Overlap = -33%
```

Artinya ada gap antar semprotan, sehingga area berisiko tidak terkena semprot.

---

## Hubungan Parameter

```txt
Altitude
   ↓
Spray Width
   ↓
Recommended Lane Spacing
```

```txt
Spray Width + Lane Spacing
   ↓
Overlap Estimate
   ↓
Route density
   ↓
Route length
```

Penjelasan sederhana:

```txt
Altitude menentukan Spray Width.
Spray Width memberi rekomendasi Lane Spacing.
Lane Spacing menentukan kerapatan zig-zag.
Overlap Estimate hanya informasi turunan.
```

---

## Behavior UI

### Saat User Mengubah Altitude

Sistem melakukan:

```txt
1. Lookup Spray Width baru dari tabel spesifikasi drone.
2. Reset Lane Spacing ke rekomendasi default.
3. Hitung ulang Overlap Estimate.
4. Tandai route lama, jika ada, perlu regenerate.
```

Contoh:

```txt
Altitude 5 m
Spray Width 3 m
Lane Spacing 2.4 m
Overlap 20%
```

User mengubah altitude ke 10 m:

```txt
Altitude 10 m
Spray Width 5 m
Lane Spacing 4 m
Overlap 20%
```

Catatan MVP:

```txt
Lane Spacing otomatis di-reset saat Altitude berubah.
```

Ini membuat hubungan parameter lebih mudah dipahami pada tahap awal.

---

### Saat User Mengubah Lane Spacing

Sistem melakukan:

```txt
1. Spray Width tetap.
2. Hitung ulang Overlap Estimate.
3. Tandai route lama, jika ada, perlu regenerate.
```

Contoh:

```txt
Spray Width 3 m
Lane Spacing 2.4 m
Overlap 20%
```

User mengubah lane spacing ke 2 m:

```txt
Spray Width 3 m
Lane Spacing 2 m
Overlap 33%
```

---

## Validasi Generate Route

`Generate Route` hanya aktif jika semua syarat terpenuhi:

```txt
1. Ada Spray Targets.
2. Semua Spray Targets punya selected_chambers.
3. Altitude > 0.
4. Lane Spacing > 0.
5. Lane Spacing <= Spray Width.
```

Jika ada Spray Target belum punya chamber:

```txt
Generate Route disabled.
Tampilkan zone_code yang belum lengkap.
```

Contoh pesan:

```txt
Chamber belum lengkap
Lengkapi chamber untuk Z03 sebelum generate route.
```

Jika lane spacing lebih besar dari spray width:

```txt
Generate Route disabled.
Tampilkan warning bahwa jarak lane melebihi lebar semprot.
```

Contoh pesan:

```txt
Lane spacing melebihi spray width. Area bisa tidak tersemprot.
```

---

## UI MVP

Panel `Spraying Route` menampilkan:

```txt
Readiness
- Target count
- Ready count
- Missing chamber zones
```

```txt
Route Parameters
- Altitude        editable
- Spray Width     readonly
- Lane Spacing    editable
- Overlap         readonly
```

Contoh layout ringkas:

```txt
Target      3
Ready       2/3
Waypoint    -

Altitude
[ 5 m ]

Spray Width
3 m
Auto dari altitude

Lane Spacing
[ 2.4 m ]

Overlap Estimate
20%

[Generate Route]
```

---

## Default MVP

```txt
Altitude = 5 m
Spray Width = 3 m
Lane Spacing = 2.4 m
Overlap Estimate = 20%
```

Default lane spacing dihitung dari:

```txt
spray_width × 0.8
```

---

## Yang Tidak Dibuka Dulu

Parameter berikut tidak dibuka pada MVP tahap ini:

```txt
Speed
Dose
Flow Rate
Liquid Needed
Route Duration
```

Alasannya:

```txt
Fokus tahap ini adalah membuat route geometry siap dulu:
Altitude → Spray Width → Lane Spacing → Zig-zag Route.
```

Parameter spraying lanjutan dapat ditambahkan setelah route preview stabil.

---

## Keputusan Desain

- `Spray Width` tidak bisa di-override pada MVP.
- `Overlap` tidak diinput user, hanya dihitung sebagai estimasi.
- User mengatur `Lane Spacing`, bukan `Overlap`.
- Saat `Altitude` berubah, `Spray Width` dan rekomendasi `Lane Spacing` ikut berubah.
- `Generate Route` wajib menunggu semua target punya chamber.
