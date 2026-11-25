# AITQR

Web/PWA penghasil QR terenkripsi **MQ1** (Metaqr) untuk petugas lapangan. Petugas masuk dengan username/kata sandi, memilih profil, mengisi metadata sesi, lalu menampilkan QR yang dienkripsi langsung ke public key X25519 milik decoder ZYBTool. Tidak ada kunci tanda tangan per petugas.

AITQR berjalan mandiri di **VPS menggunakan Node.js + SQLite**. Caddy menangani HTTPS dan meneruskan request ke aplikasi Node.js di localhost. Tidak ada layanan serverless atau database terkelola eksternal, dan tidak ada integrasi login pihak ketiga.

## Fitur inti

- Login username + kata sandi, sesi cookie HttpOnly, perlindungan CSRF, dan pembatasan percobaan login.
- Bootstrap administrator pertama menggunakan kode sekali pakai.
- Konsol admin berbasis tab: konfigurasi QR/profil, akun petugas, QR Inspector dengan kamera langsung, dan aktivitas.
- Konfigurasi field, preset profil, daftar pilihan, serta public key decoder **terisolasi per akun**; preset bisa ditambah, dihapus, diimpor, dan diekspor sebagai JSON.
- Draft dan publikasi konfigurasi ditandatangani Ed25519; klien memverifikasi signature dan sequence.
- Penerbitan QR MQ1 terenkripsi X25519. Private key decoder dapat didaftarkan satu kali per akun ke Vault AES-256-GCM untuk decrypt QR dari browser admin; key tidak pernah dikirim kembali ke browser.
- PWA offline; cache konfigurasi diberi namespace per akun.
- SQLite lokal dengan WAL; data disimpan persisten di direktori data VPS.

## Menjalankan secara lokal

Persyaratan: Node.js **22.6 atau lebih baru** dan npm.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Buat file environment lokal yang tidak di-commit, misalnya `.env.local`, lalu ekspor variabelnya ke terminal. Contoh secret dapat dibuat dengan:

```bash
openssl rand -hex 32   # AITQR_SESSION_KEY
openssl rand -hex 24   # AITQR_SETUP_CODE
openssl rand -hex 32   # AITQR_VAULT_MASTER_KEY (backup terpisah dari database)
npm run keys:init      # membuat pasangan kunci admin di keys/admin/
```

Salin seed private admin dari `keys/admin/private.hex` ke variabel `AITQR_ADMIN_KEY` di environment lokal. Pasangan `adminKid` dan `adminPublic` dari generator harus dipasang ke `src/config/trustedAdminKeys.ts`, kemudian build ulang. **Jangan commit atau membagikan private key.** Generator juga membuat decoder key TEST-ONLY; jangan gunakan private key tersebut untuk produksi.

Jalankan aplikasi:

```bash
APP_ORIGIN=http://localhost:3000 HOST=127.0.0.1 PORT=3000 AITQR_DATA_DIR=./data npm start
```

Windows PowerShell dapat mengatur environment untuk sesi saat ini:

```powershell
$env:APP_ORIGIN = "http://localhost:3000"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:AITQR_DATA_DIR = ".\data"
$env:AITQR_SESSION_KEY = "<64 hex>"
$env:AITQR_ADMIN_KEY = "<64 hex>"
$env:AITQR_SETUP_CODE = "<48 hex>"
$env:AITQR_VAULT_MASTER_KEY = "<64 hex>"
npm start
```

Database otomatis dibuat pada `data/aitqr.sqlite`. Skema dan migrasi tabel dijalankan otomatis saat API pertama kali digunakan. Untuk uji end-to-end, buka `http://localhost:3000/admin` dan periksa `/api/health`.

## Deployment VPS (Ubuntu/Debian + Caddy)

File siap pakai tersedia di `deploy/`:

- `deploy/aitqr.service`: systemd unit untuk Node.js, SQLite, dan restart otomatis.
- `deploy/Caddyfile`: reverse proxy Caddy ke `127.0.0.1:3000`, memakai domain AITQR saat ini.
- `.env.example`: template environment tanpa nilai rahasia.

### 1. Persiapan aplikasi

Pasang Node.js 22.6+ dan Caddy pada VPS. Buat user layanan dan direktori:

```bash
sudo useradd --system --home /opt/aitqr --shell /usr/sbin/nologin aitqr
sudo mkdir -p /opt/aitqr /var/lib/aitqr /etc/aitqr
sudo chown -R aitqr:aitqr /opt/aitqr /var/lib/aitqr
```

Clone repository ke `/opt/aitqr` lalu build:

```bash
sudo -u aitqr git clone https://github.com/progstay17/AITQR.git /opt/aitqr
cd /opt/aitqr
sudo -u aitqr npm ci
sudo -u aitqr npm run typecheck
sudo -u aitqr npm test
sudo -u aitqr npm run build
sudo -u aitqr npm prune --omit=dev
```

Jangan menjalankan `npm prune --omit=dev` sebelum `npm run build`; TypeScript dan esbuild hanya diperlukan saat build. Runtime tidak memerlukan dependency npm eksternal.

### 2. Konfigurasi secret dan origin

Buat `/etc/aitqr/aitqr.env` dengan permission ketat:

```bash
sudo install -o root -g root -m 600 /dev/null /etc/aitqr/aitqr.env
sudo nano /etc/aitqr/aitqr.env
```

Isi:

```dotenv
APP_ORIGIN=https://aitqr.40.83.95.72.sslip.io
HOST=127.0.0.1
PORT=3000
AITQR_DATA_DIR=/var/lib/aitqr
AITQR_SESSION_KEY=<hasil openssl rand -hex 32>
AITQR_ADMIN_KEY=<seed Ed25519 32-byte hex>
AITQR_SETUP_CODE=<hasil openssl rand -hex 24>
AITQR_VAULT_MASTER_KEY=<hasil openssl rand -hex 32>
AITQR_PBKDF2_ITERATIONS=120000
```

`AITQR_ADMIN_KEY` harus cocok dengan public key yang tertanam di `src/config/trustedAdminKeys.ts`. Jangan memakai placeholder nol. Jangan memasukkan private key decoder atau master key Vault ke source code, Git, atau chat. Gunakan environment file yang hanya dapat dibaca root/systemd. Master key Vault wajib dicadangkan secara terpisah dari backup SQLite; jika hilang, key decoder tidak dapat dipulihkan.

### 3. Aktifkan systemd dan Caddy

Periksa `deploy/aitqr.service` agar direktori sesuai instalasi. Lalu:

```bash
sudo cp deploy/aitqr.service /etc/systemd/system/aitqr.service
sudo systemctl daemon-reload
sudo systemctl enable --now aitqr
sudo systemctl status aitqr --no-pager
```

Atur Caddy:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Pastikan DNS/domain mengarah ke VPS dan port 80/443 dapat dijangkau. Aplikasi Node hanya bind ke `127.0.0.1`; akses publik harus melalui Caddy/HTTPS.

### 4. Buat administrator pertama

Buka:

`https://aitqr.40.83.95.72.sslip.io/admin`

Kartu **Buat administrator pertama** tampil jika database belum memiliki akun admin. Masukkan `AITQR_SETUP_CODE`, lalu tentukan username (3-?2 karakter: huruf kecil, angka, titik, garis bawah, strip) dan password (minimal 8 karakter). Setelah berhasil, hapus baris `AITQR_SETUP_CODE` dari `/etc/aitqr/aitqr.env`, kemudian restart:

```bash
sudo systemctl restart aitqr
```

### 5. Cek layanan dan backup

- Health: `https://aitqr.40.83.95.72.sslip.io/api/health`
- Sesi: `https://aitqr.40.83.95.72.sslip.io/api/session`
- Log: `sudo journalctl -u aitqr -n 100 --no-pager`
- Database aktif: `/var/lib/aitqr/aitqr.sqlite`

Backup SQLite dengan utilitas SQLite yang mendukung online backup:

```bash
sqlite3 /var/lib/aitqr/aitqr.sqlite ".backup '/var/backups/aitqr-$(date +%F-%H%M%S).sqlite'"
```

Jangan menyalin hanya file database saat WAL sedang aktif tanpa prosedur backup yang benar. Simpan backup terenkripsi dan di luar direktori aplikasi.

## Konfigurasi dan secret

| Nama | Wajib | Isi |
|---|---|---|
| `AITQR_SESSION_KEY` | Ya | HMAC cookie sesi, 32 byte acak dalam 64 digit hex |
| `AITQR_ADMIN_KEY` | Ya untuk publikasi | Seed private Ed25519 32 byte dalam hex; public key-nya tertanam pada build |
| `AITQR_SETUP_CODE` | Saat bootstrap | Kode hex acak 16-?28 digit; hapus setelah admin pertama dibuat |
| `APP_ORIGIN` | Ya | Origin publik HTTPS untuk validasi same-origin |
| `AITQR_DATA_DIR` | Ya di produksi | Direktori file SQLite persisten |
| `AITQR_PBKDF2_ITERATIONS` | Tidak | PBKDF2-SHA256; default VPS 120000 |
| `AITQR_VAULT_MASTER_KEY` | Ya untuk QR Inspector | Kunci AES-256-GCM 32 byte (64 digit hex); simpan di environment, backup terpisah dari SQLite |
| `HOST`, `PORT` | Tidak | Default `127.0.0.1:3000` |

## Rute API

| Rute | Akses | Fungsi |
|---|---|---|
| `GET /`, `GET /admin` | Publik | Shell PWA/konsol |
| `GET /api/health` | Publik | Status service, jumlah admin/user, sequence |
| `GET /api/session` | Publik | Status sesi saat ini |
| `POST /api/bootstrap` | Setup code | Membuat administrator pertama |
| `POST /api/login` | Publik | Login dan membuat cookie sesi |
| `POST /api/logout` | Sesi | Menghapus cookie |
| `POST /api/password` | Sesi | Mengganti kata sandi sendiri |
| `GET /api/account/config` | Akun aktif | Bundle terbit khusus akun |
| `GET /api/admin/state` | Admin | Akun, konfigurasi per akun, audit, status key |
| `* /api/admin/users` | Admin | CRUD akun, reset password, status |
| `PUT /api/admin/account-config` | Admin | Simpan draft akun terpilih |
| `POST /api/admin/account-config/publish` | Admin | Terbitkan konfigurasi akun terpilih |

Tanpa sesi, API admin mengembalikan 401; akun non-admin 403; mutasi lintas-origin 403.

## Konfigurasi field per akun

Konsol admin memiliki pemilih akun. Profil, field, label ID/EN, tipe, validasi, grup, opsi, public key decoder, draft, serta publikasi disimpan per akun dalam tabel `account_configs`. Mengubah akun A tidak mengubah akun B. API mengambil ID akun dari sesi yang diverifikasi server, bukan dari ID yang dipercayai dari browser.

Akun lama saat migrasi menerima salinan satu kali dari template lama agar konfigurasi sebelumnya tidak hilang. Akun baru memulai dengan daftar profil dan opsi yang kosong; administrator membuat preset atau mengimpor JSON untuk mendefinisikan skema payload akun tersebut. Setelah itu setiap salinan berdiri sendiri.

Cache offline menggunakan namespace per akun. Service worker tidak menyimpan respons `/api/*` ke Cache API bersama, sehingga respons sesi akun lain tidak dapat dipakai lintas akun.

## Keamanan akun dan kunci

- Password disimpan sebagai PBKDF2-SHA256 dengan salt unik. Hash dengan cost lama dinaikkan saat login berhasil.
- Cookie sesi HttpOnly, SameSite=Lax, Secure pada HTTPS, masa berlaku 12 jam.
- Mutasi admin dilindungi autentikasi, pemeriksaan role, dan same-origin.
- Login dibatasi setelah lima percobaan gagal.
- AITQR tidak membuat private key per petugas; akun hanya menggunakan username/kata sandi.
- Private seed `AITQR_ADMIN_KEY` hanya berada di environment server; public key pasangannya tertanam di source/build.
- QR menggunakan MQ1 encrypted-only ke public key decoder; private key decoder tidak pernah berada di server AITQR.
- SQLite menggunakan WAL dan file datanya berada di luar direktori source/build.

## Pemeriksaan kualitas

Jalankan dari root repository:

```bash
npm run typecheck
npm test
npm run bundle:lint
npm run bundle:budget
npm run build
```

Tes integrasi mencakup bootstrap admin, migrasi konfigurasi lama, isolasi field antar akun, autentikasi, CRUD, enkripsi/dekripsi MQ1, dan cache offline.

## Struktur penting

| Path | Isi |
|---|---|
| `backend/index.ts` | HTTP API: sesi, akun, konfigurasi, publikasi |
| `scripts/serve.mjs` | Server Node.js, static assets, binding SQLite dan environment |
| `scripts/sqlite-adapter.mjs` | Adapter SQL untuk API backend |
| `src/admin.ts`, `admin.html` | Konsol admin |
| `src/app.ts` | PWA petugas |
| `src/config/` | Signing/verifikasi bundle, JCS, anti-rollback, cache |
| `src/auth.ts` | Password hashing dan session cookie |
| `bundles/` | Bundle template |
| `deploy/` | systemd unit dan Caddyfile |
| `vendor/metaqr/` | Encoder Metaqr 0.4.0 tanpa modifikasi |

Generated files, private keys, secrets, database SQLite, and logs are excluded by `.gitignore`. Do not commit runtime data or secret material.
