# AGENTS.md — AITQR

Instruksi untuk agent coding. Singkat sengaja; detail ada di dokumen lain. **Baca dulu:** `PRD.md` (aturan bisnis, model konfigurasi), `ARCHITECTURE.md` (modul, bundel, kunci). Jangan menurunkan ulang keputusan yang sudah tertulis.

## 1. Status proyek
PRD dan ARCHITECTURE masih berstatus **DRAFT menunggu persetujuan pemilik**. Snapshot implementasi tersedia di src/, worker/, test/, dan tools/; perlakukan sebagai **WIP**, bukan baseline produksi yang telah disetujui. Jangan memperluas cakupan atau mengubah kontrak keamanan tanpa instruksi eksplisit pemilik. Sebelum tahap pengembangan berikutnya, minta persetujuan dokumen dan tahap M1-M5 (PRD section 11). Satu tahap per permintaan.

## 2. Konvensi
- TypeScript, mode `strict`; tanpa framework UI berat; build minimal dan deterministik (lockfile, versi pin).
`config` -> `profile` -> `payload` -> `mq1` -> `qr`. `form` hanya membaca profil. `tools/` (CLI admin) tidak diimpor aplikasi. Hanya `mq1` yang menyentuh encoder Metaqr.
- **AITQR tidak boleh mengetahui alat konsumen.** Tidak ada `if (consumer === "zyb-tool")` di kode; semua perilaku khusus alat hidup di profil (data).
- Identifier/komentar Inggris; teks UI lewat `i18n` (Indonesia, Inggris).
- Waktu dan RNG selalu disuntikkan agar uji deterministik.

## 3. Batas modul
`config` -> `profile` -> `payload` -> `mq1` -> `qr`. `form` hanya membaca profil. `tools/` (CLI admin) tidak diimpor aplikasi. Hanya `mq1` yang menyentuh encoder Metaqr.

## 4. Keamanan (fail-closed)
- Kriptografi hanya dari salinan Metaqr (**tanpa modifikasi**, hash commit tercatat). Jangan menulis kripto sendiri.
- Verifikasi tanda tangan bundel dan `seq` wajib; gagal → tidak ada penerbitan QR dari bundel itu. Jangan menambah fallback tanpa verifikasi.
- Kunci perangkat non-extractable. Dilarang: mengekspor kunci privat, menyimpan kunci di `localStorage`/`sessionStorage`/cookie, atau menurunkan ke kunci software/QR tanpa tanda tangan secara diam-diam.
- Kunci privat decoder dan kunci penandatangan bundel **tidak pernah** ada di repo, bundel, atau build. Kunci uji dipisah dan jelas berlabel.
- Tanpa CDN/skrip pihak ketiga saat runtime, tanpa inline script, tanpa permintaan keluar origin. CSP seperti ARCHITECTURE §8. Dependensi di-vendor dan di-pin dengan hash.
- Jangan menaruh data pribadi (daftar nama petugas) di bundel atau fixture.
- Tidak ada telemetri berisi data operasional.

## 5. Konfigurasi dan profil
- Perubahan skema payload = versi profil baru + vektor uji baru; jangan mengubah versi lama diam-diam.
- Skema payload milik konsumen; AITQR menyalin versi ber-pin + hash dan memvalidasinya di CI.
- Satu profil = satu penerima. Anggaran karakter token wajib dicek sebelum encode (target ≤ 400, batas 800).

## 6. Jangan berasumsi
Bukan fakta kecuali diuji: dukungan Ed25519/X25519/`deflate-raw` di HP target; perilaku penyimpanan kunci iOS; keterbacaan QR oleh kamera DECXIN; panjang token nyata; dukungan Wake Lock; bentuk final skema `zyb-recording/v1`. Tandai **[F]/[A]/[?]**.

## 7. Pengujian (wajib)
- Unit (Node): validator profil, pemetaan payload, anggaran, kanonisasi JCS, verifikasi bundel (kunci uji), anti-rollback.
- Vektor lintas bahasa dengan ZYB Tool (payload byte-identik; token terdekode di Python).
- `browser-check` (Chromium) dan matriks perangkat nyata (D2): kapabilitas, persistensi kunci, offline, pembaruan PWA. Perangkat yang gagal = tidak didukung.
- Uji baca QR dengan kamera nyata sebelum rilis.
- CI memeriksa lint, tipe, uji, ukuran bundel, dan tidak adanya permintaan ke luar origin.

## 8. Definition of done
1. Kriteria penerimaan PRD yang relevan lulus dan tertaut ke tes.
2. Lint, type-check, tes hijau; vektor kontrak lulus.
3. Tidak ada aturan §4 yang dilanggar; tidak ada secret/data pribadi di diff.
4. Penambahan alat/field baru dilakukan lewat profil, bukan kode.
5. Dokumen diperbarui bila perilaku berubah; diff minimal; dependensi baru dengan alasan tertulis.

## 9. Berhenti dan tanya
Hentikan dan tanyakan bila: butuh melonggarkan aturan keamanan; butuh kunci/kredensial; bukti kapabilitas HP bertentangan; skema konsumen ambigu; cakupan melebar dari tahap yang disetujui. Operasi destruktif (`git push --force`, `reset --hard`, hapus massal) dilarang kecuali diminta eksplisit. Laporan akhir: apa yang berubah, tes yang dijalankan, yang belum terverifikasi.
