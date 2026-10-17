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

### Akun, teman, dan room yang tahan refresh

- **Tamu tetap bisa pakai semuanya.** Login Google cuma menambah daftar teman: tambah teman pakai kode (misalnya `ABCD-2345`), lihat siapa yang online dan lagi nge-host apa, lalu join sekali klik.
- Login memakai Google Identity Services. Server cuma butuh `GOOGLE_CLIENT_ID` (publik, isi di `.env`, lihat `.env.example`); token Google diverifikasi dengan kunci publik Google. Akun, sesi, dan pertemanan disimpan di SQLite bawaan Node (`data/waitup.db`).
- **Refresh atau koneksi putus nggak bikin keluar room.** Tiap tab punya ID sendiri (`sessionStorage`), jadi reload kembali ke kursi yang sama, termasuk peran host. Orang yang putus ditahan 90 detik sebelum dikeluarkan.
- **Restart server (misalnya update) nggak menghapus room.** Room disimpan ke `data/rooms.json` dan dipulihkan saat server nyala; semua orang dapat waktu 3 menit untuk nyambung lagi. Stream file/tab perlu dimulai ulang.

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

Server melayani hasil build dari `dist/` dan Socket.IO di port `PORT` (default 3001). Set `HOST=127.0.0.1` kalau dipasang di belakang reverse proxy.

### Deploy ke home server (nginx + Cloudflare Tunnel)

```bash
git clone https://github.com/Irana06/Waitup.git ~/waitup
cd ~/waitup && npm ci && npm run build
sudo sh deploy/install-homeserver.sh waitup.yushika.my.id
```

Skrip itu memasang service systemd `waitup` (port 3001, cuma di 127.0.0.1), situs nginx yang meneruskan WebSocket, dan hostname di `/etc/cloudflared/config.yml`. DNS-nya didaftarkan sekali dengan `cloudflared tunnel route dns <tunnel> <domain>`.

Update berikutnya: `sh deploy/update.sh`.

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

Room kosong dihapus setelah 5 menit.
