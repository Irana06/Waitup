# Waitup brand kit

## Logo

**Mark "Pause bareng":** simbol pause yang ternyata dua orang. Yang tinggi (ungu) berdiri nungguin, yang pendek (pink) masih nyusul. Artinya sama dengan janji aplikasinya: nggak ada yang ditinggal. Warnanya mengikuti gradasi rambut Denia, dari ungu ke pink.

**Wordmark:** huruf "waitup" digambar sebagai garis tunggal dengan ujung bulat, mengikuti bentuk kapsul di mark-nya. Bagian "up" berwarna pink, sama dengan figur yang ditungguin.

## File

| File | Pakai untuk |
|---|---|
| `waitup-mark.svg` | Mark berwarna di latar terang |
| `waitup-mark-dark.svg` | Mark berwarna di latar gelap |
| `waitup-mark-black.svg` | Satu warna (cetak, stempel, latar berwarna terang) |
| `waitup-mark-white.svg` | Satu warna terbalik (foto, latar berwarna gelap) |
| `waitup-wordmark.svg`, `waitup-wordmark-dark.svg` | Wordmark saja |
| `waitup-lockup-horizontal.svg`, `waitup-lockup-horizontal-dark.svg` | Header aplikasi, website, dokumen |
| `waitup-lockup-stacked.svg` | Layar pembuka, poster, ruang yang sempit ke samping |
| `favicon.svg` | Favicon browser. Potongan khusus 16 px, otomatis ganti warna di mode gelap |
| `app-icon.svg` | Ikon aplikasi (PWA, home screen). Sudut 112/512 |

Semua file vektor, tanpa teks hidup dan tanpa gambar raster.

## Warna

| Nama | Hex | Peran |
|---|---|---|
| Ungu rambut (terang) | `#6A3FC8` | Figur yang nungguin di latar terang |
| Ungu rambut (gelap) | `#B79CF5` | Figur yang nungguin dan "wait" di latar gelap, figur di ikon app |
| Pink rambut (terang) | `#B8337F` | Figur yang ditungguin, "up", aksen nunggu di mode terang |
| Pink rambut (gelap) | `#F58BC8` | Sama, untuk latar gelap dan ikon app |
| Tinta | `#0E1830` | Teks dan "wait" di latar terang |
| Malam | `#08121A` | Latar mode gelap dan latar ikon app |
| Kertas | `#F1F3FB` | Latar mode terang |
| Royal | `#2A3FD1` / `#4D63F0` | Tombol utama di UI. Nggak dipakai di logo |
| Glow | `#7FE3F0` | Status sinkron di UI. Nggak dipakai di logo |

Pink nggak pernah dipasangkan dengan putih di logo.

## Aturan pakai

- **Ruang kosong:** sisakan minimal selebar badan figur pendek (14/64 tinggi mark) di semua sisi.
- **Ukuran minimum:** mark 16 px (pakai `favicon.svg` di bawah 24 px). Lockup horizontal minimal 96 px lebarnya.
- **Jangan:** memutar mark, menukar warna ungu dan pink, memasangkan pink dengan putih, menyamakan tinggi dua figur, memberi bayangan atau gradasi, atau menulis ulang wordmark pakai font lain.

## Tipografi UI

- **Fredoka** (judul): huruf bulat seperti busa, cocok dengan sifat Denia yang santai.
- **DM Sans** (teks): jelas di ukuran kecil dan punya angka tabular untuk waktu video.

## Catatan

- File PNG dan ICO belum dibuat. Nanti dibuat dari SVG ini saat build project (misalnya pakai `sharp`).
- Kemiripan dengan merek dagang lain belum dicek. Lakukan pengecekan merek sebelum dipakai resmi.
