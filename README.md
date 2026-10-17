# Waitup

Nobar dan dengerin lagu bareng temen, dari PC atau HP. Host bikin room, temen join pakai kode 6 angka atau link. Kalau ada yang buffering, video di-pause buat semua orang sampai dia siap.

## Fitur (versi 0.1)

- **Room dengan kode 6 angka** dan link undangan (`/482913`).
- **Sumber:**
  - Link YouTube (watch, youtu.be, shorts, live) dan link file langsung (`.mp4`, `.webm`, `.mp3`, `.m4a`, `.ogg`, `.wav`, `.flac`).
  - **File dari PC host:** di-stream langsung dari browser host ke tiap penonton lewat WebRTC, tanpa upload. Play, pause, dan loncat dari siapa pun tetap mengatur pemutar di host.
  - **Share tab:** host membagikan satu tab browser (TikTok, live dari platform lain, situs apa pun) beserta audionya. Pause dan loncat diatur dari tab itu sendiri.
- **Sinkron:** play, pause, dan loncat dari siapa pun langsung ngikut ke semua orang. Server memegang jam room, dan tiap pemutar dicocokkan ke jam itu setiap 0,4 detik.
- **Mode kalau ada yang ngelag** (diatur host):
  - **Tunggu semua:** satu orang buffering lebih dari 0,6 detik, room di-pause sampai dia siap, lalu lanjut dari detik yang sama.
  - **Yang ngelag ngejar:** room jalan terus, yang ketinggalan loncat menyusul.
- **Strip rombongan:** posisi tiap penonton, kelihatan siapa yang ketinggalan.
- **Layar penuh**, dengan cadangan layar penuh lewat CSS untuk browser yang menolak Fullscreen API (misalnya Safari di iPhone).
- **Tema terang dan gelap**, warna dari palet Denia (lihat `brand/README.md`).
- Chat dan daftar peserta.

### Batasan streaming (file dari PC dan share tab)

- Koneksinya langsung antar-browser: host mengirim satu salinan video ke tiap penonton, jadi enaknya sampai sekitar 5 penonton. Kualitas ngikut kecepatan upload host.
- Cuma pakai STUN publik. Di jaringan yang ketat (sebagian kantor, kampus, atau operator seluler) koneksi langsung bisa gagal, dan perlu server TURN.
- Streaming file butuh `captureStream` (Chrome, Edge, Firefox di PC). Share tab cuma bisa dari browser PC.
- Kalau host me-refresh halaman, file atau tab yang di-share hilang dan perlu dipilih lagi.
- Untuk penonton yang lebih banyak, ganti jalur pengiriman ke SFU seperti LiveKit.

## Menjalankan

Butuh Node.js 20 ke atas.

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`. Server Socket.IO jalan di port 3001, dan Vite meneruskan `/socket.io` ke sana.

Production (satu proses, satu port):

```bash
npm run build
npm start
```

Server melayani hasil build dari `dist/` dan Socket.IO di port `PORT` (default 3001).

## Struktur

| Folder | Isi |
|---|---|
| `shared/protocol.ts` | Tipe event dan state room, plus `positionAt()` yang dipakai server dan klien |
| `server/` | Express + Socket.IO. `rooms.ts` menyimpan state room di memori |
| `src/` | Klien React. `components/MediaSurface.tsx` berisi mesin sinkron untuk YouTube dan `<video>`/`<audio>`. `lib/hostStream.ts` dan `components/RemoteStream.tsx` adalah sisi pengirim dan penerima stream WebRTC |
| `brand/` | Logo, ikon, dan panduan brand |
| `public/` | Favicon, ikon aplikasi, manifest PWA |
| `docs/` | Aturan antislop dan hasil audit desain |

## Cara sinkronnya bekerja

1. Server menyimpan `{ playing, position, updatedAt }`. Posisi room saat ini = `position + (sekarang - updatedAt)` kalau sedang jalan.
2. Klien menyamakan jamnya dengan jam server lewat beberapa ping, lalu menghitung posisi room yang sama.
3. Tiap 0,4 detik pemutar dibandingkan dengan posisi room. Selisih di atas 0,75 detik langsung di-seek. Untuk file langsung, selisih kecil dikoreksi dengan kecepatan 0,95x atau 1,05x.
4. Buffering yang lebih lama dari 0,6 detik dilaporkan ke server. Dalam mode "Tunggu semua" server membekukan jam room sampai semua yang ditunggu melapor siap.

State room cuma disimpan di memori, jadi room hilang kalau server restart. Room kosong dihapus setelah 5 menit.
