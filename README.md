# Remi RT — Papan Skor Kartu Remi

Papan skor digital untuk permainan kartu remi 4 pemain, dibuat dengan HTML, CSS, dan JavaScript murni. Data disimpan di perangkat lewat `localStorage`; tidak ada backend, akun, atau dependensi runtime.

## Menjalankan

```bash
npm start
```

Lalu buka `http://localhost:4173`. Anda juga bisa membuka `index.html` lewat server statis apa pun.

Untuk menguji logika inti:

```bash
npm test
```

## Fitur

- Papan skor 4 kolom dengan total besar, nama pemain, riwayat nilai, serta input cepat `+5`, `+10`, `+50`, `−5`, `−10`, `−50`, dan nilai manual.
- Aturan bom otomatis di atas ambang 100, termasuk pemilihan satu korban dengan total tertinggi, undo atomik, dan pencegahan bom berantai.
- Animasi bom berdurasi ±2 detik yang bisa dilewati dengan ketukan, mendukung `prefers-reduced-motion`, getaran perangkat, dan suara opsional.
- Undo berulang, tersimpan sebagai riwayat entri dan tetap tersedia setelah halaman dimuat ulang.
- Multi-game: game baru, buka lagi, ganti nama, duplikat pemain, hapus dengan konfirmasi.
- Tema terang, gelap, atau mengikuti sistem tanpa kedip tema saat pertama dimuat.
- Ekspor/impor JSON, penanganan penyimpanan penuh/tidak tersedia, serta shell PWA untuk pemakaian offline.

## Struktur

| Berkas | Isi |
| --- | --- |
| `index.html` | Struktur UI, dialog, dan konten awal |
| `styles.css` | Tema, tata letak responsif, dan animasi bom |
| `core.js` | Fungsi murni: `evaluateBomb`, perhitungan total, langkah, dan undo |
| `app.js` | State, penyimpanan, render, interaksi, dan alur bom |
| `test/core.test.js` | Uji aturan bom dan model langkah |
| `sw.js` | Cache offline untuk shell aplikasi |
| `manifest.webmanifest` | Metadata PWA |

## Catatan aturan bom

Entri bom adalah penyesuaian yang membuat total korban menjadi `0`. Pada kasus umum nilainya negatif. Untuk pengurangan skor yang membuat pemain meledak sendiri, nilainya dihitung dari total pemain **setelah** pengurangan, bukan total sebelum pengurangan. Contoh: pemain `120` lalu `−20` menjadi `100`, kemudian meledak; entri bomnya `−100`.

Jika total korban setelah pengurangan sudah negatif, penyesuaian bom akan bernilai positif agar total kembali ke `0` dan tetap sama dengan jumlah seluruh entri. Undo tetap menghapus seluruh langkah secara atomik.

Semua contoh pada PRD bagian 6.3 tercakup di `test/core.test.js`.
