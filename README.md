# AITQR

Web/PWA penghasil QR **MQ2** (Metaqr) untuk petugas lapangan: login dengan akun, isi metadata sesi,
lalu tampilkan QR yang ditandatangani kunci akun di perangkat dan dienkripsi ke kunci publik decoder.

Akun dibuat oleh **administrator**: username, kata sandi, dan **public key** akun. AITQR tidak pernah
membuat kunci. Petugas menempel kunci privatnya sendiri sekali di browser (diimpor sebagai
non-extractable dan disimpan lokal); kunci privat tidak pernah dikirim ke server.

Login memakai **username + kata sandi** yang dibuat administrator. Tidak ada OAuth, tidak ada akun Freebuff/Google, tidak ada kunci yang dibuat atau disimpan server.

## Menjalankan

```bash
npm ci                     # dependensi build saja (typescript, esbuild, wrangler)
cp .env.example .dev.vars  # isi tiga secret dengan nilai acak Anda sendiri
npm run build              # tsc -> dist/app, menyalin shell + vendor + bundel, bundle Worker
npm start                  # pratinjau statis http://0.0.0.0:3000
npx wrangler dev --port 8787 --local   # Worker + D1 lokal lengkap (login, admin)
```

Pemeriksaan:

```bash
npm run typecheck          # tsc --noEmit untuk aplikasi + Worker
npm test                   # node --test (unit, Node) — tidak butuh file kunci
npm run bundle:lint        # validasi bundel + profil
npm run bundle:budget      # panjang token MQ2 nyata per profil
```

## Konfigurasi

| Nama | Wajib | Isi |
|---|---|---|
| `AITQR_SESSION_KEY` | ya | hex ≥ 32 byte; HMAC cookie sesi (berlaku 12 jam) |
| `AITQR_ADMIN_KEY` | ya | seed Ed25519 penanda tangan bundel; public key-nya tertanam di `src/config/trustedAdminKeys.ts` |
| `AITQR_SETUP_CODE` | saat bootstrap | hex 16–128 digit; hanya untuk membuat administrator pertama |
| `APP_ORIGIN` | ya | origin aplikasi untuk cek same-origin (`http://localhost:8787` saat lokal) |
| `AITQR_PBKDF2_ITERATIONS` | tidak | rounds PBKDF2-SHA256 untuk kata sandi; default `12000` |

Biaya hashing kata sandi sengaja rendah: PBKDF2 120.000 rounds memakan ~20–35 ms CPU, sedangkan
Workers free hanya memberi ~10 ms per permintaan sehingga platform memutus Worker dan membalas
`502 Site unavailable` tepat saat bootstrap/login. Dengan `12000` rounds satu permintaan selesai
dalam hitungan milidetik. Di hosting berbayar (CPU 30 detik) naikkan lewat `AITQR_PBKDF2_ITERATIONS`;
login otomatis menulis ulang hash lama ke biaya baru.
| `DB` | ya | binding D1: akun, kolom metadata, draf/publikasi bundel, kunci decoder |

`.env.example` berisi placeholder keempat nilai di atas. Salin ke `.dev.vars` (git-ignored) untuk
lokal, atau set sebagai secret di dashboard hosting. Repo tidak memuat nilai asli apa pun.

```bash
openssl rand -hex 32   # AITQR_SESSION_KEY / AITQR_ADMIN_KEY
openssl rand -hex 24   # AITQR_SETUP_CODE
```

### Bootstrap administrator pertama

1. Isi `AITQR_SETUP_CODE` (dan secret lain) di `.dev.vars`, jalankan `npx wrangler dev --port 8787 --local`.
2. Buka `/admin` → kartu **Buat administrator pertama** → tempel kode setup → tentukan username
   (3–32 karakter: huruf kecil, angka, `.`, `_`, `-`) dan kata sandi (minimal 8 karakter).
3. Akun langsung login dan bisa membuat akun petugas dari panel yang sama.

Kode setup tidak berguna setelah ada admin: bootstrap berikutnya menjawab `409`. Kode salah `403`,
secret belum diset `503`.

## Rute

| Rute | Akses | Fungsi |
|---|---|---|
| `GET /`, `/admin` | publik | Shell aplikasi petugas dan konsol admin |
| `GET /bundles/latest.bundle.json` | publik | Bundel konfigurasi terbit (bertanda tangan) |
| `GET /api/health` | publik | Status secret, jumlah admin/user, `publishedSeq` |
| `GET /api/session` | publik | Sesi saat ini (`signedIn`, user) |
| `POST /api/bootstrap` | kode setup | Buat administrator pertama (409 bila sudah ada) |
| `POST /api/login` | publik | Login username + kata sandi, set cookie `aitqr_session` |
| `POST /api/logout` | sesi | Hapus cookie sesi |
| `POST /api/password` | sesi | Ganti kata sandi sendiri |
| `GET /api/admin/state` | admin | Akun, draf bundel, kunci, konfigurasi |
| `* /api/admin/users` | admin | CRUD akun (public key, reset sandi, aktif/nonaktif) |
| `* /api/admin/bundle` | admin | Simpan draf bundel |
| `POST /api/admin/publish` | admin | Tanda tangan + terbitkan bundel (`seq` naik) |
| `* /api/admin/keys` | admin | Public key penerima, kunci rahasia decoder |
| `POST /api/admin/verify` | admin | Verifikasi token MQ2 |
| `GET /api/admin/allowlist` | admin | Unduh allowlist akun |

Tanpa sesi, rute `/api/admin/*` menjawab `401`; akun non-admin `403`; mutasi lintas-origin `403`.

## Struktur

| Path | Isi |
|---|---|
| `src/app.ts` | Login → aktivasi kunci → beranda → form → periksa → QR; riwayat lokal |
| `src/admin.ts`, `admin.html` | Konsol admin `/admin`: akun, kolom metadata, kunci, publikasi |
| `src/keys.ts` | Impor kunci privat (non-extractable) dan penyimpanan di IndexedDB |
| `src/mq2.ts` | Satu-satunya adaptor ke encoder Metaqr; tanda tangan di perangkat |
| `src/db.ts` | IndexedDB: riwayat sesi + kunci akun |
| `worker/index.ts` | Worker: login, sesi, akun, bundel, verifikasi token, D1, CSP |
| `src/verify-token.ts` | Buka + verifikasi token MQ2 dengan kunci rahasia decoder |
| `src/config/` | Muat bundel, JCS, verifikasi Ed25519, anti-rollback, cache offline |
| `src/profile.ts`, `src/payload.ts` | Validasi profil/nilai, nilai turunan, payload ringkas, anggaran karakter |
| `src/session.ts` | `session_id` 80 bit, Crockford base32 |
| `src/qr.ts` | Renderer QR (Nayuki, MIT), quiet zone ≥ 4 modul |
| `vendor/metaqr/` | Salinan **tanpa modifikasi** encoder Metaqr 0.4.0 (commit & hash di `SOURCE.md`) |
| `bundles/` | Bundel sumber (belum ditandatangani) dan bundel awal untuk benih D1 |
| `tools/` | CLI: `sign-bundle`, `lint-profile`, `budget`, `make-vectors`, `gen-keys` |

## Akun dan kunci

Empat hal yang berbeda, jangan dicampur:

1. **Akun** — username + kata sandi (hash PBKDF2-SHA256 di D1) + peran `admin`/`staff` + **public key**
   Ed25519 milik akun itu. Dibuat dan diubah administrator di `/admin`. Akun pertama dibuat lewat
   kartu "Buat administrator pertama" dengan **kode setup** dari secret Site `AITQR_SETUP_CODE`,
   sehingga URL publik tidak bisa diklaim orang lain.
2. **Kunci akun** — pasangan Ed25519 di luar AITQR. Administrator hanya menyimpan public key-nya
   (64 hex). Petugas menempel kunci privat (64 hex) sekali di aplikasi; aplikasi memeriksa apakah
   public key hasil impor cocok dengan yang terdaftar, lalu menyimpan CryptoKey non-extractable di
   IndexedDB. QR ditandatangani di perangkat, jadi tidak ada kunci privat di server.
3. **Kunci admin bundel** — Ed25519 yang menandatangani bundel konfigurasi. Public key tertanam di
   `src/config/trustedAdminKeys.ts`; seed disimpan sebagai secret `AITQR_ADMIN_KEY`. Rotasi = rilis
   aplikasi baru.
4. **Kunci decoder** — X25519. Public key ada di profil (untuk enkripsi) dan diatur dari konsol admin.
   Kunci rahasia disimpan di D1 lewat konsol admin dan hanya dipakai server untuk alat verifikasi token;
   nilainya tidak pernah dikirim balik ke browser.

Secret Site: `AITQR_ADMIN_KEY`, `AITQR_SESSION_KEY` (HMAC cookie sesi), `AITQR_SETUP_CODE` (kode
administrator pertama). `keys/` (git-ignored) menyimpan salinan lokal untuk pengembangan.

## Konsol admin (`/admin`)

| Kemampuan | Keterangan |
|---|---|
| Akun | Buat akun (username, kata sandi, public key, peran), ubah public key, reset kata sandi, aktif/nonaktif, hapus |
| Kolom metadata | Kunci field, tipe, label ID/EN, wajib, maks panjang, pola, grup, daftar opsi |
| Kunci | Public key penerima per profil, kunci rahasia decoder |
| Verifikasi | Tempel token MQ2 → server membuka dengan kunci rahasia decoder, mencari akun lewat `kid`, memeriksa tanda tangan |
| Publikasi | Simpan draf, naikkan `seq`, tanda tangan bundel di server |
| Allowlist | Unduh `allowlist.json` dari akun yang punya public key |

- Tanpa sesi, API admin menjawab 401; akun non-admin 403; mutasi lintas-origin 403.
- Login dibatasi 5 percobaan gagal per akun (kunci 60 detik).
- `seq` dan `issued` ditetapkan server. `GET /api/health` melaporkan status konfigurasi secret,
  jumlah admin/user, dan `publishedSeq`.

## Memperbarui konfigurasi

Ubah di konsol admin → **Simpan draf** → **Tandatangani & terbitkan**. Aplikasi mengambil
`/bundles/latest.bundle.json`, memverifikasi tanda tangan, dan menolak `seq` yang lebih lama.

Jalur CLI untuk pengembangan:

```bash
npm run bundle:lint && npm run bundle:budget && npm run bundle:sign
```

## Deployment

```bash
npm run build && npx wrangler dev --port 8787 --local   # uji Worker + D1 lokal (workerd)
```

Binding: `DB` (D1), `ASSETS`, `APP_ORIGIN`, dan tiga secret di atas (`npx wrangler secret put AITQR_ADMIN_KEY`
dan seterusnya). `deploy.manifest.json` adalah manifest untuk hosting Freebuff Sites; Worker-nya juga
jalan di Cloudflare Workers biasa. Skema D1 dibuat otomatis oleh Worker, jadi tidak ada migrasi manual.

## Siap untuk repo GitHub

Repo ini tidak membawa rahasia apa pun:

- `keys/` (kunci admin, kunci decoder uji, kode setup, secret sesi), `dist/`, `server/`, `.wrangler/`,
  `.env*`, dan `node_modules/` sudah di `.gitignore`.
- `npm test` dan `npm run build` berjalan tanpa file kunci: test membuat pasangan kunci decoder sendiri.
- `bundles/default.bundle.json` memakai kunci decoder **uji** (TEST-ONLY). Ganti dengan kunci publik
  decoder asli dari konsol admin sebelum dipakai produksi — tidak perlu menandatangani ulang dari repo.
- Sebelum push: `npm run typecheck && npm test`, lalu pastikan tiga secret hanya ada di dashboard
  hosting. Rotasi kunci admin bundel berarti merilis ulang aplikasi karena public key-nya tertanam di
  `src/config/trustedAdminKeys.ts`.

## Catatan perubahan model

| | Versi awal (perangkat) | Versi akun |
|---|---|---|
| Identitas | kunci di IndexedDB HP | akun (username + kata sandi) |
| Kunci tanda tangan | dibuat di HP | berasal dari luar; public key didaftarkan admin, privat diimpor petugas |
| Setup | daftarkan perangkat + allowlist | login, tempel kunci sekali |
| Offline | QR offline | QR tetap bisa dibuat offline setelah kunci aktif |
| Allowlist decoder | per perangkat | per akun aktif |

## Yang belum diverifikasi

- Login dan alur QR diuji lokal (workerd + Chrome) memakai akun uji; belum diuji di HP nyata, kamera
  DECXIN, atau PWA terpasang.
- Skema `zyb-recording/v1` final (dimiliki repo ZYB Tool) dan verifikasi lintas repo.
- Kunci rahasia decoder asli belum dimasukkan; selama kosong, alat verifikasi menolak dengan pesan
  "Atur kunci rahasia decoder terlebih dahulu".
- `frame-ancestors 'none'` di produksi; preview mengizinkan origin panel Freebuff agar bisa di-iframe.
