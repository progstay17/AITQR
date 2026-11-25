import type { Locale } from "./types.js";

type Entry = readonly [id: string, en: string];

const DICT: Record<string, Entry> = {
  "app.name": ["AITQR", "AITQR"],
  "app.tagline": ["Penerbit QR sesi aman", "Secure session QR issuer"],

  "status.ready": ["Siap", "Ready"],
  "status.offline": ["Offline — memakai konfigurasi tersimpan", "Offline — using saved configuration"],
  "status.checking": ["Memeriksa akun dan konfigurasi…", "Checking account and configuration…"],

  "session.unavailable.title": ["Tidak dapat memeriksa sesi", "Unable to verify your session"],
  "session.unavailable.body": [
    "AITQR perlu terhubung ke server untuk memeriksa sesi login. Sambungkan perangkat lalu coba lagi. Untuk penggunaan offline, muat aplikasi dan masuk saat online terlebih dahulu; jangan tutup atau muat ulang tab selama sesi offline.",
    "AITQR must reach the server to verify your login session. Reconnect and try again. For offline use, load the app and sign in while online first; do not close or reload this tab during the offline session.",
  ],
  "login.title": ["Masuk untuk menerbitkan QR", "Sign in to issue QR"],
  "login.body": [
    "Masuk dengan username dan kata sandi yang dibuat administrator. Setelah sesi dan konfigurasi dimuat, AITQR dapat melanjutkan penerbitan selama tab tetap terbuka meskipun koneksi terputus.",
    "Sign in with the username and password created by your administrator. Once the session and configuration are loaded, AITQR can continue issuing while this tab remains open even if the connection drops.",
  ],
  "login.cta": ["Masuk", "Sign in"],
  "login.hint": ["Akun dibuat oleh administrator. Lupa kata sandi? Minta admin mengatur ulang.", "Accounts are created by an administrator. Forgot your password? Ask an admin to reset it."],
  "login.user": ["Username", "Username"],
  "login.pass": ["Kata sandi", "Password"],
  "login.submit": ["Masuk", "Sign in"],

  "key.missing.title": ["Akun belum punya public key", "This account has no public key"],
  "key.missing.body": [
    "Administrator harus mengisi public key decoder pada profil yang akan digunakan.",
    "An administrator must add the decoder public key to the selected profile before QR codes can be issued.",
  ],
  "key.setup.title": ["Aktifkan kunci akun", "Activate the account key"],
  "key.setup.body": [
    "AITQR tidak meminta atau menyimpan private key petugas. Masuk menggunakan username dan kata sandi.",
    "AITQR does not request or store staff private keys. Sign in with your username and password.",
  ],
  "key.setup.label": ["Tidak diperlukan", "Not required"],
  "key.setup.cta": ["Tidak diperlukan", "Not required"],
  "key.setup.note": [
    "AITQR hanya menggunakan public key decoder yang dikonfigurasi administrator. Private key decoder tetap berada pada aplikasi penerima.",
    "AITQR only uses the decoder public key configured by an administrator. The decoder private key remains in the receiving application.",
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
  "home.hero.eyebrow": ["ALUR PENERBITAN QR", "SECURE QR WORKFLOW"],
  "home.hero.title.lead": ["Siapkan sesi.", "Prepare the session."],
  "home.hero.title.accent": ["QR siap dipindai.", "QR ready to scan."],
  "home.hero.body": [
    "Pilih profil, lengkapi metadata, lalu tampilkan QR terenkripsi ke kamera.",
    "Choose a profile, complete the metadata, then present the encrypted QR to the camera.",
  ],

  "readiness.account": ["Akun", "Account"],
  "readiness.signing": ["Signature konfigurasi admin", "Admin configuration signature"],
  "readiness.signing.ok": ["diverifikasi sebelum konfigurasi dipakai", "verified before the configuration is used"],

  "form.check": ["Periksa kembali data yang ditandai.", "Check the highlighted fields."],
  "form.session.hint": ["ID sesi dibuat otomatis di perangkat saat QR dibuat.", "The session ID is generated automatically on this device when the QR is created."],
  "form.session.auto": ["Otomatis", "Automatic"],

  "review.sid.pending": ["ID sesi", "Session ID"],
  "review.recipient": ["QR akan dienkripsi untuk decoder {name}. QR tidak membuktikan identitas pembuatnya.", "The QR will be encrypted for decoder {name}. It does not authenticate who created it."],
  "error.budget": [
    "Token melebihi {limit} karakter. Persingkat {field} lalu coba lagi.",
    "The token exceeds {limit} characters. Shorten {field} and try again.",
  ],

  "qr.account": ["Dienkripsi untuk decoder · format {kid}", "Encrypted for decoder · format {kid}"],
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
  "form.search": ["Ketik untuk mencari opsi…", "Type to search options…"],
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
  "qr.wake": ["Layar dijaga tetap menyala selama QR ditampilkan.", "The screen is kept awake while the QR is displayed."],
  "qr.wake.unsupported": ["Browser tidak dapat menjaga layar tetap menyala. Tingkatkan kecerahan dan hindari layar terkunci.", "The browser cannot keep the screen awake. Increase brightness and prevent the screen from locking."],
  "qr.wake.pending": ["Menyiapkan layar QR agar tetap menyala…", "Keeping the QR screen awake…"],
  "qr.back": ["Kembali ke detail", "Back to details"],
  "qr.finish": ["Selesai", "Finish"],
  "qr.copy": ["Salin token", "Copy token"],
  "qr.copy.failed": ["Token tidak dapat disalin. Periksa izin clipboard browser.", "The token could not be copied. Check the browser clipboard permission."],
  "qr.copied": ["Token disalin.", "Token copied."],
  "qr.chars": ["{chars} karakter", "{chars} characters"],

  "history.title": ["Riwayat sesi", "Session history"],
  "history.empty": ["Belum ada sesi di perangkat ini.", "No sessions on this device yet."],
  "history.local": ["Riwayat hanya tersimpan di perangkat ini.", "History is stored on this device only."],
  "history.redisplay": ["Tampilkan ulang", "Show again"],
  "history.clear": ["Hapus riwayat", "Clear history"],
  "history.clear.failed": ["Riwayat gagal dihapus dari perangkat ini.", "The history could not be cleared on this device."],
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
