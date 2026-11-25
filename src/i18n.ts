import type { Locale } from "./types.js";

type Entry = readonly [id: string, en: string];

const DICT: Record<string, Entry> = {
  "app.name": ["AITQR", "AITQR"],
  "app.tagline": ["Penerbit QR sesi aman", "Secure session QR issuer"],

  "status.ready": ["Siap", "Ready"],
  "status.offline": ["Offline — memakai konfigurasi tersimpan", "Offline — using saved configuration"],
  "status.checking": ["Memeriksa akun dan konfigurasi…", "Checking account and configuration…"],

  "login.title": ["Masuk untuk menerbitkan QR", "Sign in to issue QR"],
  "login.body": [
    "Masuk dengan akun yang dibuat administrator. Kunci privat akun cukup ditempel sekali di browser ini; kunci itu tidak dikirim ke server.",
    "Sign in with the account your administrator created. Paste the account's private key once in this browser; it is never sent to the server.",
  ],
  "login.cta": ["Masuk", "Sign in"],
  "login.hint": ["Akun dibuat oleh administrator. Lupa kata sandi? Minta admin mengatur ulang.", "Accounts are created by an administrator. Forgot your password? Ask an admin to reset it."],
  "login.user": ["Username", "Username"],
  "login.pass": ["Kata sandi", "Password"],
  "login.submit": ["Masuk", "Sign in"],

  "key.missing.title": ["Akun belum punya public key", "This account has no public key"],
  "key.missing.body": [
    "Administrator harus mengisi public key akun ini sebelum QR bisa diterbitkan.",
    "An administrator must add this account's public key before QR codes can be issued.",
  ],
  "key.setup.title": ["Aktifkan kunci akun", "Activate the account key"],
  "key.setup.body": [
    "Tempel kunci privat Ed25519 akun Anda (64 karakter hex). Kunci diimpor sebagai non-extractable dan disimpan hanya di browser ini.",
    "Paste your account's Ed25519 private key (64 hex characters). It is imported as non-extractable and stored only in this browser.",
  ],
  "key.setup.label": ["Kunci privat", "Private key"],
  "key.setup.cta": ["Simpan kunci", "Save key"],
  "key.setup.note": [
    "AITQR tidak pernah membuat kunci. Public key akun ini sudah didaftarkan administrator; kunci privat tidak dikirim ke server.",
    "AITQR never generates keys. This account's public key is already registered by the administrator; the private key is not sent to the server.",
  ],
  "key.account": ["Akun", "Account"],
  "key.registered": ["Public key terdaftar", "Registered public key"],
  "key.mismatch": [
    "Kunci ini bukan milik akun Anda (public key tidak cocok). Periksa kembali atau hubungi administrator.",
    "This key does not belong to your account (public key mismatch). Check it or contact the administrator.",
  ],
  "key.change": ["Ganti kunci", "Change key"],

  "home.signout": ["Keluar", "Sign out"],
  "home.admin": ["Konsol admin", "Admin console"],
  "home.update": ["Versi aplikasi baru tersedia.", "A new app version is available."],
  "home.reload": ["Muat ulang", "Reload"],

  "readiness.account": ["Akun", "Account"],
  "readiness.signing": ["Kunci tanda tangan akun", "Account signing key"],
  "readiness.signing.ok": ["dipakai untuk semua QR", "used for every QR"],

  "form.check": ["Periksa kembali data yang ditandai.", "Check the highlighted fields."],
  "form.session.hint": ["ID sesi dibuat otomatis di server saat QR diterbitkan.", "The session ID is created on the server when the QR is issued."],
  "form.session.auto": ["Otomatis", "Automatic"],

  "review.sid.pending": ["ID sesi", "Session ID"],
  "review.account.signed": ["QR akan ditandatangani akun {name} di server.", "The QR is signed by the account {name} on the server."],
  "error.budget": [
    "Token melebihi {limit} karakter. Persingkat {field} lalu coba lagi.",
    "The token exceeds {limit} characters. Shorten {field} and try again.",
  ],

  "qr.account": ["Ditandatangani akun · kid {kid}", "Signed by account · kid {kid}"],
  "history.save.failed": ["QR dibuat, tetapi riwayat tidak dapat disimpan di perangkat ini.", "The QR was created, but history could not be saved on this device."],

  "readiness.title": ["Status kesiapan", "Readiness"],
  "readiness.device": ["Identitas perangkat", "Device identity"],
  "readiness.device.ready": ["Identitas perangkat siap", "Device identity ready"],
  "readiness.device.unregistered": ["Perangkat perlu didaftarkan", "Device needs registration"],
  "readiness.device.reset": ["Identitas perangkat direset", "Device identity was reset"],
  "readiness.device.volatile": ["Penyimpanan tidak tersedia: kunci hilang saat tab ditutup", "Storage unavailable: the key is lost when the tab closes"],
  "readiness.config": ["Konfigurasi", "Configuration"],
  "readiness.config.ok": ["Bundel sah, urutan {seq}", "Bundle valid, sequence {seq}"],
  "readiness.config.age": ["Diterbitkan {date}", "Issued {date}"],
  "readiness.profile": ["Profil aktif", "Active profile"],
  "readiness.start": ["Mulai sesi", "Start session"],
  "readiness.history": ["Riwayat sesi", "Session history"],
  "readiness.key": ["Identitas perangkat", "Device identity"],

  "profile.pick": ["Pilih profil", "Choose a profile"],
  "profile.empty": ["Belum ada preset untuk akun ini. Hubungi administrator untuk menambahkan profil.", "No presets are configured for this account. Ask your administrator to add a profile."],
  "profile.consumer": ["Untuk {consumer}", "For {consumer}"],
  "profile.schema": ["Skema payload: {schema}", "Payload schema: {schema}"],

  "form.title": ["Data sesi", "Session details"],
  "form.group.details": ["Detail rekaman", "Recording details"],
  "form.group.place": ["Lokasi & aktivitas", "Location & activity"],
  "form.group.camera": ["Kamera", "Camera"],
  "form.required": ["wajib", "required"],
  "form.optional": ["opsional", "optional"],
  "form.select": ["Pilih…", "Select…"],
  "form.review": ["Periksa data sesi", "Review session details"],
  "form.back": ["Kembali", "Back"],
  "form.session": ["ID sesi (otomatis)", "Session ID (automatic)"],

  "error.required": ["Wajib diisi.", "This field is required."],
  "error.max": ["Maksimal {detail} karakter.", "At most {detail} characters."],
  "error.pattern": ["Format tidak sesuai.", "Format does not match."],
  "error.option": ["Pilih salah satu opsi yang tersedia.", "Choose one of the listed options."],
  "error.number": ["Masukkan angka.", "Enter a number."],
  "error.range": ["Nilai di luar rentang yang diizinkan.", "Value is outside the allowed range."],

  "review.title": ["Periksa data sesi", "Check session details"],
  "review.recorder": ["Petugas", "Operator"],
  "review.location": ["Lokasi", "Location"],
  "review.activity": ["Aktivitas", "Activity"],
  "review.camera": ["Kamera / device", "Camera / device"],
  "review.time": ["Waktu", "Time"],
  "review.shift": ["Shift", "Shift"],
  "review.profile": ["Profil", "Profile"],
  "review.session": ["ID sesi", "Session ID"],
  "review.budget": ["Ukuran token", "Token size"],
  "review.budget.value": ["{chars} / {limit} karakter", "{chars} / {limit} characters"],
  "review.budget.warn": ["Mendekati batas; QR akan lebih padat.", "Close to the limit; the QR will be denser."],
  "review.generate": ["Buat QR aman", "Generate secure QR"],
  "review.edit": ["Ubah data", "Edit details"],
  "review.derived": ["Nilai otomatis tidak dapat diubah.", "Automatic values cannot be edited."],

  "qr.title": ["QR siap dipindai kamera", "QR ready to scan"],
  "qr.hint": ["Tunjukkan layar ini ke kamera perekam.", "Show this screen to the recording camera."],
  "qr.session": ["ID sesi", "Session ID"],
  "qr.profile": ["Profil", "Profile"],
  "qr.recorder": ["Petugas", "Operator"],
  "qr.brightness": ["Tingkatkan kecerahan layar. Jangan tutupi kode.", "Raise screen brightness. Do not cover the code."],
  "qr.wake": ["Layar dijaga tetap menyala.", "Screen will stay awake."],
  "qr.wake.unsupported": ["Browser ini tidak mendukung Wake Lock; layar dapat meredup.", "This browser has no Wake Lock support; the screen may dim."],
  "qr.back": ["Kembali ke detail", "Back to details"],
  "qr.finish": ["Selesai", "Finish"],
  "qr.copy": ["Salin token", "Copy token"],
  "qr.copied": ["Token disalin.", "Token copied."],
  "qr.chars": ["{chars} karakter", "{chars} characters"],

  "history.title": ["Riwayat sesi", "Session history"],
  "history.empty": ["Belum ada sesi di perangkat ini.", "No sessions on this device yet."],
  "history.local": ["Riwayat hanya tersimpan di perangkat ini.", "History is stored on this device only."],
  "history.redisplay": ["Tampilkan ulang", "Show again"],
  "history.clear": ["Hapus riwayat", "Clear history"],
  "history.clear.confirm": ["Hapus seluruh riwayat di perangkat ini?", "Delete all history on this device?"],
  "history.issued": ["Diterbitkan", "Issued"],

  "key.title": ["Identitas perangkat", "Device identity"],
  "key.explain": [
    "QR dienkripsi untuk public key decoder. Tidak perlu kunci tanda tangan petugas atau allow-list.",
    "The QR is encrypted to the decoder public key. Staff signing keys and allow-lists are not required.",
  ],
  "key.kid": ["ID kunci", "Key ID"],
  "key.public": ["Kunci publik", "Public key"],
  "key.registration": ["Kode pendaftaran", "Registration code"],
  "key.copy": ["Salin", "Copy"],
  "key.copied": ["Disalin.", "Copied."],
  "key.forget": ["Lupakan kunci perangkat", "Forget device key"],
  "key.forget.confirm": [
    "Kunci ini akan dihapus dan perangkat harus didaftarkan ulang. Lanjutkan?",
    "This key will be deleted and the device must be registered again. Continue?",
  ],
  "key.reset.warning": [
    "Kunci perangkat berbeda dari yang terakhir dipakai. Kemungkinan data situs dihapus atau kunci dihapus browser. Minta administrator mendaftarkan kunci baru sebelum menerbitkan QR.",
    "The device key differs from the last one used. Site data may have been cleared or the browser removed the key. Ask an administrator to register the new key before issuing QR codes.",
  ],

  "blocked.title": ["Fitur keamanan browser tidak tersedia", "Browser security features unavailable"],
  "blocked.body": [
    "AITQR tidak menerbitkan QR tanpa tanda tangan perangkat. Buka dengan HTTPS pada browser terbaru.",
    "AITQR does not issue unsigned QR codes. Open it over HTTPS in a current browser.",
  ],
  "blocked.missing": ["Kapabilitas yang kurang:", "Missing capabilities:"],
  "blocked.retry": ["Periksa ulang", "Check again"],

  "config.title": ["Konfigurasi tidak dapat dipercaya", "Configuration cannot be trusted"],
  "config.body": [
    "Bundel konfigurasi tidak lolos verifikasi tanda tangan, jadi tidak ada QR yang diterbitkan.",
    "The configuration bundle failed signature verification, so no QR code is issued.",
  ],
  "config.reason": ["Alasan", "Reason"],
  "config.retry": ["Muat ulang konfigurasi", "Reload configuration"],

  "common.busy": ["Memproses…", "Working…"],
  "common.menu": ["Menu", "Menu"],
  "common.home": ["Beranda", "Home"],
  "common.language": ["Bahasa", "Language"],
  "common.error": ["Terjadi kesalahan.", "Something went wrong."],
  "common.retry": ["Coba lagi", "Try again"],
  "common.yes": ["Ya", "Yes"],
  "common.no": ["Tidak", "No"],
};

export function t(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  const template = entry ? (locale === "en" ? entry[1] : entry[0]) : key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
