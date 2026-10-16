# Bab 05 — SmartGIS: Peta & Analisis Lahan

Dokumen ini menjelaskan isi tiap slide Bab 05. Fokus ceritanya adalah alur kerja
SmartGIS dari memilih peta sampai membuat rute penyemprotan.

Alur utama:

```txt
Pilih lahan
  -> pilih tipe peta
  -> lihat RGB/NDVI
  -> generate polygon di NDVI Zones
  -> simpan polygon menjadi Spray Targets
  -> buat Spraying Route
```

## Slide 1 — Cover Bab

### Tujuan

Mengenalkan SmartGIS sebagai fitur peta dan analisis lahan pada Jaga Padi.

### Isi Utama

```text
BAB 05
SmartGIS
Peta & Analisis Lahan
```

### Teks Pendukung

```text
SmartGIS membantu pengguna melihat kondisi sawah melalui peta udara, citra NDVI,
zona bermasalah, target semprot, dan rute penyemprotan.
```

### Visual

- Foto/peta sawah asli sebagai visual utama.
- Overlay NDVI hijau-kuning-merah.
- Nuansa peta digital/GIS.
- Jangan terlalu ramai, judul harus paling menonjol.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait untuk cover BAB 05 buku panduan Jaga Padi.
Background putih/krem bersih dengan aksen hijau tua dan kuning panen. Visual
utama berupa foto udara sawah realistis atau peta sawah, diberi overlay NDVI
hijau-kuning-merah secara halus. Tambahkan nuansa GIS modern seperti garis peta
tipis atau marker lokasi, tetapi jangan terlalu ramai.

Teks besar:
BAB 05
SmartGIS
Peta & Analisis Lahan

Teks kecil:
Memantau sawah melalui peta udara, NDVI, zona bermasalah, target semprot, dan
rute penyemprotan.

Pastikan judul paling menonjol dan mudah dibaca.
```

## Slide 2 — Akses & Pilih Lahan

### Tujuan

Menjelaskan langkah awal masuk ke SmartGIS dan memilih sawah yang akan dianalisis.

### Isi Utama

```text
Akses & Pilih Lahan
```

### Teks Slide

```text
1. Dari menu utama, buka SmartGIS.
2. Pada panel Pilih Lahan, pilih nama sawah.
3. Tekan tombol penanda untuk memusatkan peta ke lokasi lahan.
4. Gunakan kolom pencarian jika ingin menuju lokasi tertentu.
```

### Catatan Cerita

Slide ini adalah pintu masuk. Sebelum memakai layer analisis, pengguna harus
memilih lahan agar data peta, imagery, dan polygon yang tampil sesuai.

### Visual

- Screenshot/mockup dashboard SmartGIS.
- Panel kiri "Pilih Lahan".
- Search bar lokasi.
- Peta di area utama.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Akses & Pilih Lahan". Gunakan background
putih/krem dengan aksen hijau tua. Tampilkan mockup dashboard SmartGIS: peta
besar di sisi kanan dan panel kiri berisi dropdown "Pilih Lahan", tombol penanda
lokasi, dan search bar. Buat tampilan seperti UI aplikasi nyata, bukan kartun.

Tambahkan 4 langkah singkat di bawah atau samping mockup:
1. Buka SmartGIS.
2. Pilih lahan.
3. Fokuskan peta ke lokasi lahan.
4. Gunakan pencarian lokasi jika dibutuhkan.

Desain bersih, modern, dan mudah dibaca.
```

## Slide 3 — Tipe Peta

### Tujuan

Menjelaskan base map yang dipakai sebagai tampilan dasar sebelum layer imagery
dan analisis dinyalakan.

### Isi Utama

```text
Tipe Peta
```

### Teks Slide

```text
SmartGIS menyediakan beberapa tipe peta dasar untuk membantu pengguna membaca
kondisi lokasi.

Default digunakan untuk tampilan peta umum.
Satelit digunakan untuk melihat kondisi area nyata dari citra satelit.
Terrain digunakan untuk melihat bentuk permukaan dan kontur wilayah.
```

### Catatan Cerita

Tipe peta adalah latar. Setelah latar dipilih, pengguna bisa menyalakan imagery
RGB/NDVI di atasnya.

### Visual

- Tiga kartu kecil: Default, Satelit, Terrain.
- Highlight pada tipe peta aktif.
- Background putih/krem agar mirip panel layer SmartGIS.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Tipe Peta". Background putih bersih
dengan aksen hijau. Tampilkan panel pilihan Map type seperti aplikasi GIS,
berisi 3 kartu preview: Default, Satelit, dan Terrain. Kartu Satelit boleh
dibuat aktif dengan border hijau.

Di sisi bawah, tambahkan penjelasan pendek:
Default untuk peta umum.
Satelit untuk melihat kondisi area nyata.
Terrain untuk melihat kontur dan bentuk permukaan.

Gunakan thumbnail peta realistis pada setiap kartu. Jangan pakai ikon kartun.
```

## Slide 4 — Map Imagery: RGB & NDVI

### Tujuan

Menjelaskan dua layer imagery utama yang berasal dari hasil pemetaan sawah.

### Isi Utama

```text
Map Imagery
RGB & NDVI
```

### Teks Slide

```text
RGB menampilkan foto udara asli sawah. Layer ini membantu pengguna melihat
bentuk lahan, batas sawah, jalan, dan kondisi visual tanaman.

NDVI menampilkan kesehatan tanaman dalam warna. Area hijau menunjukkan tanaman
lebih sehat, sedangkan area kuning sampai merah menunjukkan bagian yang perlu
diperiksa.
```

### Tabel Ringkas NDVI

| Kategori | Rentang NDVI |
| --- | --- |
| Sangat Sehat | 0.8-1.0 |
| Sehat | 0.6-0.8 |
| Cukup Sehat | 0.4-0.6 |
| Kurang Sehat | 0.21-0.4 |
| Tidak Sehat | 0-0.21 |
| Non-Vegetasi | < 0 |

### Catatan Cerita

RGB menjawab "sawahnya terlihat seperti apa". NDVI menjawab "area mana yang
terlihat bermasalah".

### Visual

- Perbandingan RGB dan NDVI berdampingan.
- Warna NDVI hijau-kuning-merah.
- Toggle layer RGB dan NDVI.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Map Imagery: RGB & NDVI". Background
putih/krem, aksen hijau tua dan kuning panen. Tampilkan dua kartu besar
berdampingan: kiri "RGB" berisi citra udara sawah realistis, kanan "NDVI" berisi
citra sawah dengan warna hijau-kuning-merah.

Tambahkan panel kecil seperti toggle layer dengan tombol RGB dan NDVI aktif.
Tambahkan tabel kecil kategori NDVI:
Sangat Sehat 0.8-1.0
Sehat 0.6-0.8
Cukup Sehat 0.4-0.6
Kurang Sehat 0.21-0.4
Tidak Sehat 0-0.21
Non-Vegetasi <0

Fokus visual: membandingkan foto asli sawah dengan hasil analisis NDVI.
```

## Slide 5 — NDVI Zones: Membuat Polygon

### Tujuan

Menjelaskan bahwa NDVI Zones dipakai untuk membuat polygon area bermasalah dari
nilai NDVI, bukan sekadar menampilkan warna.

### Isi Utama

```text
NDVI Zones
Membuat Polygon Area Bermasalah
```

### Teks Slide

```text
NDVI Zones digunakan untuk mengubah area NDVI tertentu menjadi polygon kerja.
Pengguna dapat mengatur range NDVI, minimum luas area, dan jarak penggabungan
polygon.

Setelah tombol Generate Zones ditekan, sistem menampilkan polygon sementara di
peta. Polygon ini membantu pengguna melihat area mana yang berpotensi menjadi
target pengecekan.
```

### Poin Penting

```text
- Atur threshold NDVI.
- Atur minimum area agar noise kecil tidak ikut terpilih.
- Generate polygon.
- Klik polygon untuk melihat luas, mean NDVI, dan range NDVI.
```

### Catatan Cerita

Ini titik penting Bab 5. Pengguna mulai dari NDVI, lalu membentuk polygon area
bermasalah yang bisa dievaluasi sebelum disimpan.

### Visual

- Panel NDVI Zones.
- Slider/range NDVI.
- Input Minimum Area dan Merge Distance.
- Peta dengan polygon preview.
- Popup polygon: Zona, Area, Mean NDVI, NDVI Range.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "NDVI Zones: Membuat Polygon". Background
putih/krem, gaya dashboard SmartGIS modern. Visual utama adalah peta NDVI sawah
dengan beberapa polygon preview berwarna kuning-merah di atas area bermasalah.

Di sisi kiri tampilkan panel "NDVI Zones" berisi:
- NDVI Range slider
- Minimum Area input
- Merge Distance input
- tombol Generate Zones

Tambahkan popup pada salah satu polygon:
Zona Z03
Area 12.4 m2
Mean NDVI 0.32
NDVI Range 0.0-0.6

Pastikan slide menggambarkan bahwa user membuat polygon dari threshold NDVI.
```

## Slide 6 — Evaluasi & Simpan Zona

### Tujuan

Menjelaskan bahwa polygon dari NDVI Zones masih berupa preview. Pengguna dapat
mengevaluasi, menghapus yang tidak sesuai, lalu menyimpan yang dipakai.

### Isi Utama

```text
Evaluasi & Simpan Zona
```

### Teks Slide

```text
Hasil NDVI Zones belum langsung menjadi target semprot. Pengguna perlu memeriksa
polygon yang muncul di peta.

Polygon yang tidak sesuai dapat dihapus atau diabaikan. Setelah hasilnya cocok,
zona disimpan agar menjadi data kerja final untuk pengecekan lapangan dan
penyemprotan.
```

### Poin Penting

```text
- Polygon NDVI Zones = preview.
- User memilih polygon yang benar-benar dipakai.
- Zona yang disimpan menjadi dasar Spray Targets.
```

### Catatan Cerita

Slide ini menjembatani NDVI Zones ke Spray Targets. Yang disimpan adalah polygon
yang sudah dipilih pengguna, bukan semua hasil generate mentah.

### Visual

- Peta dengan beberapa polygon.
- Satu polygon diberi tanda hapus/abaikan.
- Tombol "Approve Zones" atau "Simpan Zona".
- Alur kecil: Preview -> Pilih -> Simpan.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Evaluasi & Simpan Zona". Background
putih/krem dengan aksen hijau dan kuning. Tampilkan peta sawah dengan beberapa
polygon preview dari NDVI Zones. Buat satu polygon terlihat dihapus/diabaikan
dengan ikon X kecil atau opacity rendah, sementara polygon lain tetap aktif.

Tambahkan panel ringkas:
Preview Zones
Z01 aktif
Z02 aktif
Z03 diabaikan

Tambahkan tombol hijau "Simpan Zona" atau "Approve Zones".
Tambahkan alur kecil berbentuk panah:
Preview -> Pilih Polygon -> Simpan Zona

Fokus visual: user mengevaluasi polygon preview sebelum menjadi target final.
```

## Slide 7 — Spray Targets

### Tujuan

Menjelaskan bahwa Spray Targets adalah polygon final yang sudah disimpan dan
dipakai untuk ground check, deteksi penyakit/hama, dan pemilihan chamber.

### Isi Utama

```text
Spray Targets
Polygon Final & Chamber
```

### Teks Slide

```text
Spray Targets berisi polygon final hasil simpan dari NDVI Zones. Pada tahap ini,
polygon sudah menjadi target kerja yang tersimpan.

Pengguna dapat melakukan ground check atau deteksi penyakit pada tiap target.
Satu target bisa memiliki lebih dari satu hasil deteksi.

Dari hasil deteksi tersebut, sistem menentukan chamber penyemprotan. Untuk MVP,
chamber yang digunakan adalah fungisida dan insektisida. Pengguna juga dapat
memilih chamber secara manual jika diperlukan.
```

### Poin Penting

```text
- Spray Targets = polygon final dari NDVI Zones.
- Tiap target punya kode zona, misalnya Z01, Z02, Z03.
- Target dapat menyimpan hasil deteksi penyakit/hama.
- Chamber final bisa otomatis dari hasil deteksi atau manual dari pengguna.
- Spraying Route memakai chamber final dari Spray Targets.
```

### Catatan Cerita

NDVI menentukan lokasi bermasalah. Deteksi penyakit/hama menentukan chamber yang
akan dipakai. Keputusan chamber disimpan di Spray Targets sebelum route dibuat.

### Visual

- Peta dengan polygon final merah.
- Panel daftar target: Z01, Z02, Z03.
- Popup target berisi:
  - Zone Code
  - Area
  - Mean NDVI
  - Deteksi
  - Chamber
- Label chamber: Fungisida, Insektisida.

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Spray Targets". Background putih/krem
dengan aksen hijau tua dan merah target. Tampilkan peta sawah dengan polygon
final berwarna merah/rose. Di sisi kiri tampilkan panel daftar target:
Z01, Z02, Z03.

Pada peta, tampilkan popup untuk Z01 berisi:
Zone Code: Z01
Area: 12.4 m2
Mean NDVI: 0.32
Deteksi: Blast, Wereng
Chamber: Fungisida + Insektisida

Tambahkan pilihan mode chamber kecil:
Auto / Manual

Fokus visual: polygon sudah final, punya hasil deteksi, dan chamber siap dipakai
untuk route.
```

## Slide 8 — Spraying Route

### Tujuan

Menjelaskan bahwa Spraying Route membuat jalur penyemprotan dari Spray Targets
yang sudah final dan sudah memiliki chamber.

### Isi Utama

```text
Spraying Route
Rute Penyemprotan dari Target Final
```

### Teks Slide

```text
Spraying Route mengubah Spray Targets menjadi rute penyemprotan. Rute hanya
dapat dibuat jika target semprot sudah tersedia dan setiap target sudah memiliki
chamber final.

Sistem membaca polygon target, chamber aktif, altitude, dan lane spacing untuk
membuat jalur zig-zag. Jalur ini dapat dipreview di peta sebelum dikirim ke
drone.
```

### Parameter Utama

```text
Altitude: ketinggian terbang drone.
Spray Width: lebar semprotan, dihitung otomatis dari altitude.
Lane Spacing: jarak antar jalur semprot.
Overlap: tumpang tindih semprotan antar jalur.
```

### Poin Penting

```text
- Route dibuat dari Spray Targets, bukan langsung dari NDVI Zones.
- Semua target harus punya chamber.
- Target dengan chamber berbeda dapat dikelompokkan.
- Sistem membuat waypoint zig-zag sesuai polygon dan chamber.
- Hasil route dipreview di peta sebelum eksekusi.
```

### Catatan Cerita

Spray Targets menjawab "area mana dan chamber apa". Spraying Route menjawab
"jalur mana yang harus dilewati".

### Visual

- Peta dengan polygon target.
- Garis zig-zag di dalam polygon.
- Panel route:
  - Target count
  - Ready count
  - Altitude
  - Spray Width
  - Lane Spacing
  - Overlap
  - Generate Route

### Prompt Visual Mockup

```text
Buat mockup slide A4 portrait berjudul "Spraying Route". Background putih/krem,
aksen hijau tua, biru route, dan kuning panen. Visual utama adalah peta sawah
dengan polygon target merah dan garis zig-zag biru di dalam polygon sebagai rute
penyemprotan.

Di sisi kiri atau kanan tampilkan panel "Spraying Route" berisi:
Target: 3
Ready: 3/3
Altitude: 5 m
Spray Width: Auto
Lane Spacing: 4.9 m
Overlap: 20%
tombol Generate Route

Tambahkan label kecil "Preview rute sebelum dikirim ke drone".
Fokus visual: rute dibuat dari Spray Targets yang sudah punya chamber, bukan
langsung dari NDVI Zones.
```

## Ringkasan Narasi Bab

```text
SmartGIS dimulai dari memilih lahan dan tipe peta. Pengguna kemudian melihat
imagery RGB dan NDVI untuk membaca kondisi sawah. Dari NDVI, pengguna membuat
polygon bermasalah melalui NDVI Zones. Polygon yang sudah sesuai disimpan
menjadi Spray Targets. Setelah target memiliki hasil deteksi dan chamber,
Spraying Route membuat jalur penyemprotan yang siap dipreview.
```
