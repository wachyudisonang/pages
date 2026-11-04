(function (global) {
  'use strict';

  var LS_PREFIX = 'begood_';
  var DEFAULT_LANG = 'id';
  var SUPPORTED = ['id', 'en'];
  var DICT = {
    en: {
      'app.name': 'BeGood',
      'app.subtitle': 'Finance & Zakat',
      'nav.summary': 'Summary',
      'nav.transactions': 'Transactions',
      'nav.zakat': 'Zakat',
      'nav.settings': 'Settings',
      'vault.title': 'Private vault',
      'vault.setup': 'Create vault',
      'vault.unlock': 'Unlock vault',
      'vault.setupHint': 'Create a passphrase of at least 12 characters. It cannot be recovered.',
      'vault.unlockHint': 'Your passphrase decrypts records only on this device.',
      'vault.passphrase': 'Vault passphrase',
      'vault.confirm': 'Confirm passphrase',
      'vault.create': 'Create encrypted vault',
      'vault.open': 'Unlock',
      'vault.restoreCloud': 'Restore encrypted cloud vault',
      'vault.togglePassphrase': 'Show or hide passphrase',
      'vault.idleLocked': 'The vault locked after a period without activity. Unlock it to continue.',
      'summary.title': 'This year',
      'summary.income': 'Income',
      'summary.expense': 'Expenses',
      'summary.cashflow': 'Net cash flow',
      'summary.eligible': 'Zakat-eligible income',
      'summary.estimate': 'Estimated zakat',
      'summary.paid': 'Zakat paid',
      'summary.remaining': 'Remaining estimate',
      'summary.empty': 'Add your first income or expense to begin.',
      'transactions.title': 'Transactions',
      'transactions.add': 'Add transaction',
      'transactions.empty': 'No transactions recorded yet.',
      'transactions.delete': 'Delete transaction',
      'transactions.confirmDelete': 'Tap again to confirm deletion',
      'transactions.income': 'Income',
      'transactions.expense': 'Expense',
      'transaction.modalTitle': 'Record transaction',
      'transaction.modalHint': 'The record is encrypted before it leaves memory.',
      'transaction.type': 'Type',
      'transaction.date': 'Date',
      'transaction.amount': 'Amount (IDR)',
      'transaction.account': 'Account',
      'transaction.category': 'Category',
      'transaction.treatment': 'Zakat treatment',
      'transaction.description': 'Description',
      'transaction.save': 'Save encrypted transaction',
      'transaction.cancel': 'Cancel',
      'treatment.eligibleIncome': 'Eligible income',
      'treatment.deductibleExpense': 'Allowed deduction',
      'treatment.zakatPayment': 'Zakat payment',
      'treatment.excluded': 'Excluded',
      'zakat.title': 'Income-zakat estimate',
      'zakat.method': 'Calculation method',
      'zakat.methodGross': 'Gross income',
      'zakat.methodNet': 'Net income',
      'zakat.nisab': 'Nisab amount (IDR)',
      'zakat.rate': 'Rate (%)',
      'zakat.saveSettings': 'Save calculation settings',
      'zakat.belowNisab': 'The calculated base is below the configured nisab.',
      'zakat.reachedNisab': 'The calculated base reaches the configured nisab.',
      'zakat.finalize': 'Finalize assessment snapshot',
      'zakat.assessments': 'Finalized assessments',
      'zakat.noAssessments': 'No finalized assessment yet.',
      'assessment.paid': 'Paid',
      'assessment.remaining': 'Remaining',
      'settings.status': 'Connection',
      'settings.online': 'Online',
      'settings.offline': 'Offline — local encrypted data remains available',
      'settings.cloud': 'Private cloud sync',
      'settings.cloudHint': 'Google login is used only to access your private RTDB path.',
      'settings.sync': 'Sign in and synchronize',
      'settings.signOut': 'Sign out from cloud',
      'settings.cloudNever': 'Not synchronized in this session.',
      'settings.backup': 'Encrypted backup',
      'settings.export': 'Export encrypted backup',
      'settings.import': 'Choose encrypted backup',
      'settings.importApply': 'Replace local vault with selected backup',
      'settings.backupHint': 'The exported file remains encrypted and still requires your vault passphrase.',
      'settings.language': 'Language',
      'settings.appearance': 'Appearance',
      'settings.theme': 'Theme',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'settings.themeSystem': 'System',
      'settings.lock': 'Lock vault',
      'settings.autoLock': 'Automatic lock',
      'settings.autoLockHint': 'The vault stays open across reloads until you lock it or it sits unused for this many minutes.',
      'settings.autoLockMinutes': 'Minutes without activity (1–1440)',
      'settings.autoLockSave': 'Save auto-lock time',
      'settings.about': 'About',
      'settings.aboutHint': 'Offline-first encrypted cash-flow and zakat tracker.',
      'footer.copy': 'BeGood',
      'footer.meta': 'Encrypted locally · private cloud sync',
      'common.close': 'Close',
      'common.loading': 'Working…',
      'a11y.menu': 'Open navigation',
      'a11y.home': 'Go to summary',
      'a11y.toTop': 'Scroll to top',
      'toast.saved': 'Saved securely.',
      'toast.deleted': 'Transaction deleted.',
      'toast.settingsSaved': 'Calculation settings saved.',
      'toast.assessmentSaved': 'Assessment snapshot finalized.',
      'toast.backupReady': 'Encrypted backup downloaded.',
      'toast.importReady': 'Backup selected. Confirm replacement to continue.',
      'toast.imported': 'Encrypted backup imported. Unlock it with its passphrase.',
      'toast.syncDone': 'Sync complete: {pushed} uploaded, {pulled} downloaded.',
      'toast.signedOut': 'Signed out from cloud.',
      'toast.autoLockSaved': 'Auto-lock time saved.',
      'error.passphraseMismatch': 'The passphrases do not match.',
      'error.passphraseTooShort': 'Use at least 12 characters.',
      'error.wrongPassphrase': 'The passphrase is incorrect.',
      'error.secureContext': 'This address is not a secure context. Open BeGood from HTTPS or a localhost address such as http://begood.localhost/.',
      'error.invalidTransaction': 'Check the date, amount, account, category, and zakat treatment.',
      'error.invalidSettings': 'Enter a valid nisab and rate.',
      'error.invalidAutoLock': 'Enter a whole number of minutes from 1 to 1440.',
      'error.popupBlocked': 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
      'error.popupClosed': 'The Google sign-in window was closed before it finished.',
      'error.unauthorizedDomain': 'This address is not an authorized Firebase domain. Add it under Authentication → Settings → Authorized domains.',
      'error.permissionDenied': 'The cloud rules rejected this Google account. Ask a shared administrator to add its UID to the BeGood members list.',
      'error.cloudMembership': 'This Google account is not allowed to use BeGood cloud storage.',
      'error.cloudVaultConflict': 'This account already has a different BeGood vault. Restore it instead of overwriting it.',
      'error.cloudVaultMissing': 'No BeGood vault exists for this Google account.',
      'error.verifiedGoogle': 'Use a verified Google account for private cloud access.',
      'error.networkTimeout': 'The cloud request timed out. Your local data remains safe.',
      'error.syncConflict': '{count} record conflict(s) need review; nothing was overwritten.',
      'error.invalidBackup': 'This is not a valid BeGood encrypted backup.',
      'error.generic': 'The operation failed. Your local encrypted data was not changed.',
    },
    id: {
      'app.name': 'BeGood',
      'app.subtitle': 'Keuangan & Zakat',
      'nav.summary': 'Ringkasan',
      'nav.transactions': 'Transaksi',
      'nav.zakat': 'Zakat',
      'nav.settings': 'Pengaturan',
      'vault.title': 'Brankas pribadi',
      'vault.setup': 'Buat brankas',
      'vault.unlock': 'Buka brankas',
      'vault.setupHint': 'Buat frasa sandi minimal 12 karakter. Frasa ini tidak dapat dipulihkan.',
      'vault.unlockHint': 'Frasa sandi membuka data hanya di perangkat ini.',
      'vault.passphrase': 'Frasa sandi brankas',
      'vault.confirm': 'Ulangi frasa sandi',
      'vault.create': 'Buat brankas terenkripsi',
      'vault.open': 'Buka',
      'vault.restoreCloud': 'Pulihkan brankas cloud terenkripsi',
      'vault.togglePassphrase': 'Tampilkan atau sembunyikan frasa sandi',
      'vault.idleLocked': 'Brankas terkunci karena tidak ada aktivitas. Buka brankas untuk melanjutkan.',
      'summary.title': 'Tahun ini',
      'summary.income': 'Pemasukan',
      'summary.expense': 'Pengeluaran',
      'summary.cashflow': 'Arus kas bersih',
      'summary.eligible': 'Pemasukan wajib zakat',
      'summary.estimate': 'Perkiraan zakat',
      'summary.paid': 'Zakat dibayar',
      'summary.remaining': 'Sisa perkiraan',
      'summary.empty': 'Tambahkan pemasukan atau pengeluaran pertama untuk memulai.',
      'transactions.title': 'Transaksi',
      'transactions.add': 'Tambah transaksi',
      'transactions.empty': 'Belum ada transaksi.',
      'transactions.delete': 'Hapus transaksi',
      'transactions.confirmDelete': 'Ketuk sekali lagi untuk memastikan penghapusan',
      'transactions.income': 'Pemasukan',
      'transactions.expense': 'Pengeluaran',
      'transaction.modalTitle': 'Catat transaksi',
      'transaction.modalHint': 'Data dienkripsi sebelum meninggalkan memori.',
      'transaction.type': 'Jenis',
      'transaction.date': 'Tanggal',
      'transaction.amount': 'Jumlah (IDR)',
      'transaction.account': 'Akun',
      'transaction.category': 'Kategori',
      'transaction.treatment': 'Perlakuan zakat',
      'transaction.description': 'Keterangan',
      'transaction.save': 'Simpan transaksi terenkripsi',
      'transaction.cancel': 'Batal',
      'treatment.eligibleIncome': 'Pemasukan wajib zakat',
      'treatment.deductibleExpense': 'Pengurang yang diizinkan',
      'treatment.zakatPayment': 'Pembayaran zakat',
      'treatment.excluded': 'Tidak dihitung',
      'zakat.title': 'Perkiraan zakat penghasilan',
      'zakat.method': 'Metode perhitungan',
      'zakat.methodGross': 'Penghasilan kotor',
      'zakat.methodNet': 'Penghasilan bersih',
      'zakat.nisab': 'Nilai nisab (IDR)',
      'zakat.rate': 'Tarif (%)',
      'zakat.saveSettings': 'Simpan pengaturan perhitungan',
      'zakat.belowNisab': 'Dasar perhitungan masih di bawah nisab yang ditentukan.',
      'zakat.reachedNisab': 'Dasar perhitungan telah mencapai nisab yang ditentukan.',
      'zakat.finalize': 'Tetapkan snapshot perhitungan',
      'zakat.assessments': 'Perhitungan yang ditetapkan',
      'zakat.noAssessments': 'Belum ada perhitungan yang ditetapkan.',
      'assessment.paid': 'Dibayar',
      'assessment.remaining': 'Sisa',
      'settings.status': 'Koneksi',
      'settings.online': 'Daring',
      'settings.offline': 'Luring — data lokal terenkripsi tetap tersedia',
      'settings.cloud': 'Sinkronisasi cloud pribadi',
      'settings.cloudHint': 'Login Google hanya digunakan untuk membuka jalur RTDB pribadimu.',
      'settings.sync': 'Login dan sinkronkan',
      'settings.signOut': 'Keluar dari cloud',
      'settings.cloudNever': 'Belum disinkronkan pada sesi ini.',
      'settings.backup': 'Cadangan terenkripsi',
      'settings.export': 'Ekspor cadangan terenkripsi',
      'settings.import': 'Pilih cadangan terenkripsi',
      'settings.importApply': 'Ganti brankas lokal dengan cadangan terpilih',
      'settings.backupHint': 'Berkas ekspor tetap terenkripsi dan tetap memerlukan frasa sandi brankas.',
      'settings.language': 'Bahasa',
      'settings.appearance': 'Tampilan',
      'settings.theme': 'Tema',
      'settings.themeLight': 'Terang',
      'settings.themeDark': 'Gelap',
      'settings.themeSystem': 'Sistem',
      'settings.lock': 'Kunci brankas',
      'settings.autoLock': 'Kunci otomatis',
      'settings.autoLockHint': 'Brankas tetap terbuka saat halaman dimuat ulang sampai kamu menguncinya atau tidak dipakai selama jumlah menit ini.',
      'settings.autoLockMinutes': 'Menit tanpa aktivitas (1–1440)',
      'settings.autoLockSave': 'Simpan waktu kunci otomatis',
      'settings.about': 'Tentang',
      'settings.aboutHint': 'Pencatat arus kas dan zakat terenkripsi yang mengutamakan luring.',
      'footer.copy': 'BeGood',
      'footer.meta': 'Terenkripsi lokal · sinkronisasi cloud pribadi',
      'common.close': 'Tutup',
      'common.loading': 'Memproses…',
      'a11y.menu': 'Buka navigasi',
      'a11y.home': 'Ke ringkasan',
      'a11y.toTop': 'Gulir ke atas',
      'toast.saved': 'Tersimpan dengan aman.',
      'toast.deleted': 'Transaksi dihapus.',
      'toast.settingsSaved': 'Pengaturan perhitungan disimpan.',
      'toast.assessmentSaved': 'Snapshot perhitungan ditetapkan.',
      'toast.backupReady': 'Cadangan terenkripsi telah diunduh.',
      'toast.importReady': 'Cadangan dipilih. Konfirmasi penggantian untuk melanjutkan.',
      'toast.imported': 'Cadangan terenkripsi diimpor. Buka dengan frasa sandinya.',
      'toast.syncDone': 'Sinkron selesai: {pushed} diunggah, {pulled} diunduh.',
      'toast.signedOut': 'Keluar dari cloud.',
      'toast.autoLockSaved': 'Waktu kunci otomatis disimpan.',
      'error.passphraseMismatch': 'Kedua frasa sandi tidak sama.',
      'error.passphraseTooShort': 'Gunakan minimal 12 karakter.',
      'error.wrongPassphrase': 'Frasa sandi salah.',
      'error.secureContext': 'Alamat ini bukan secure context. Buka BeGood dari HTTPS atau alamat localhost seperti http://begood.localhost/.',
      'error.invalidTransaction': 'Periksa tanggal, jumlah, akun, kategori, dan perlakuan zakat.',
      'error.invalidSettings': 'Masukkan nisab dan tarif yang valid.',
      'error.invalidAutoLock': 'Masukkan jumlah menit bulat dari 1 sampai 1440.',
      'error.popupBlocked': 'Browser memblokir jendela masuk Google. Izinkan pop-up untuk situs ini lalu coba lagi.',
      'error.popupClosed': 'Jendela masuk Google ditutup sebelum selesai.',
      'error.unauthorizedDomain': 'Alamat ini bukan domain Firebase yang diizinkan. Tambahkan di Authentication → Settings → Authorized domains.',
      'error.permissionDenied': 'Aturan cloud menolak akun Google ini. Minta administrator bersama menambahkan UID-nya ke daftar anggota BeGood.',
      'error.cloudMembership': 'Akun Google ini belum diizinkan memakai penyimpanan cloud BeGood.',
      'error.cloudVaultConflict': 'Akun ini sudah memiliki brankas BeGood yang berbeda. Pulihkan brankas tersebut, jangan menimpanya.',
      'error.cloudVaultMissing': 'Belum ada brankas BeGood untuk akun Google ini.',
      'error.verifiedGoogle': 'Gunakan akun Google terverifikasi untuk mengakses cloud pribadi.',
      'error.networkTimeout': 'Permintaan cloud melewati batas waktu. Data lokal tetap aman.',
      'error.syncConflict': '{count} konflik data perlu ditinjau; tidak ada data yang ditimpa.',
      'error.invalidBackup': 'Berkas ini bukan cadangan terenkripsi BeGood yang valid.',
      'error.generic': 'Proses gagal. Data lokal terenkripsi tidak berubah.',
    },
  };

  var language = DEFAULT_LANG;

  function getLang() {
    try {
      var saved = localStorage.getItem(LS_PREFIX + 'lang');
      return SUPPORTED.indexOf(saved) >= 0 ? saved : DEFAULT_LANG;
    } catch (_error) {
      return DEFAULT_LANG;
    }
  }

  function t(key, values) {
    var table = DICT[language] || DICT[DEFAULT_LANG];
    var text = table[key] == null ? (DICT.en[key] == null ? key : DICT.en[key]) : table[key];
    if (values) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return values[name] == null ? match : values[name];
      });
    }
    return text;
  }

  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (element) {
      element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria')));
    });
    document.documentElement.setAttribute('lang', language);
    var segment = document.getElementById('langSeg');
    if (segment) {
      segment.querySelectorAll('button').forEach(function (button) {
        button.classList.toggle('on', button.dataset.lang === language);
      });
    }
  }

  function setLang(nextLanguage) {
    if (SUPPORTED.indexOf(nextLanguage) < 0) return;
    language = nextLanguage;
    try {
      localStorage.setItem(LS_PREFIX + 'lang', nextLanguage);
    } catch (_error) {}
    applyI18n(document);
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { language: nextLanguage } }));
  }

  language = getLang();
  global.I18N = { t: t, getLang: getLang, setLang: setLang, applyI18n: applyI18n };
})(window);
