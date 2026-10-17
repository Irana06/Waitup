import { Lockup } from './Logo.tsx';

/** Public privacy page; Google requires its link before a sign-in app can go to production. */
export function Privacy() {
  return (
    <div className="home">
      <header className="app-header">
        <a href="/" aria-label="Kembali ke Waitup">
          <Lockup height={30} />
        </a>
      </header>
      <main className="home-main privacy">
        <h1>Kebijakan privasi</h1>
        <p className="muted">Terakhir diperbarui 17 Oktober 2026.</p>

        <h2>Tanpa akun</h2>
        <p>
          Kamu bisa bikin dan join room tanpa login. Yang dikirim ke server cuma nama yang kamu ketik, jenis perangkat (misalnya "PC" atau
          "HP Android"), pesan chat, dan posisi video supaya semua orang tetap sinkron. Data room disimpan di server selama room masih
          dipakai, lalu dihapus beberapa menit setelah semua orang keluar.
        </p>

        <h2>Kalau login dengan Google</h2>
        <p>
          Login cuma dipakai buat daftar teman. Dari akun Google kamu, Waitup menyimpan ID akun, nama, alamat email, dan foto profil. Waitup
          nggak meminta akses ke Gmail, Drive, kontak, atau data Google lain.
        </p>
        <ul>
          <li>Nama dan foto profil kelihatan oleh teman kamu dan oleh orang yang satu room sama kamu.</li>
          <li>Email nggak ditampilkan ke orang lain.</li>
          <li>Teman kamu bisa lihat kamu lagi online dan lagi di room mana.</li>
          <li>Kode teman cuma berguna kalau kamu bagikan sendiri.</li>
        </ul>

        <h2>Penyimpanan</h2>
        <p>
          Semua data disimpan di server milik pengelola Waitup di Indonesia, tidak dijual, dan tidak dibagikan ke pihak lain. Video YouTube
          diputar lewat pemutar YouTube, jadi berlaku juga kebijakan privasi Google untuk YouTube.
        </p>

        <h2>Menghapus data</h2>
        <p>
          Kirim email ke <a href="mailto:kirainova11@gmail.com">kirainova11@gmail.com</a> untuk menghapus akun dan seluruh daftar teman
          kamu. Kamu juga bisa mencabut akses Waitup kapan saja dari pengaturan akun Google (Keamanan, Koneksi pihak ketiga).
        </p>

        <p>
          <a href="/">Kembali ke Waitup</a>
        </p>
      </main>
    </div>
  );
}
