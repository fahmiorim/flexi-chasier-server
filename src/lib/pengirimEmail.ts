/**
 * Pengirim email transaksional memakai Resend (REST API, tanpa SDK).
 *
 * Jika `RESEND_API_KEY` belum diisi (mis. mode pengembangan lokal), email
 * tidak benar-benar dikirim — kode verifikasi ditulis ke log server agar
 * alur tetap bisa diuji. Di produksi, isi `RESEND_API_KEY` dan `EMAIL_DARI`.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_DARI = process.env.EMAIL_DARI ?? 'Flexi Kasir <noreply@flexikasir.test>';

function kodeTersembunyi(kode: string): string {
  return kode.slice(0, 2) + '••••' + kode.slice(-2);
}

/**
 * Kirim kode verifikasi email. Mengembalikan false jika email tidak terkirim
 * (mode dev tanpa API key tetap dianggap sukses karena kode di-log).
 */
export async function kirimKodeVerifikasi(email: string, kode: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(
      `[EMAIL-DEV] Kode verifikasi untuk ${email}: ${kode}` +
        ` (isi RESEND_API_KEY di .env untuk kirim email sungguhan)`,
    );
    return true;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_DARI,
      to: [email],
      subject: 'Kode verifikasi email — Flexi Kasir',
      text: `Kode verifikasi Anda: ${kode}\n\nKode berlaku 15 menit. Jika bukan Anda yang mendaftar, abaikan email ini.`,
    }),
  });

  if (!res.ok) {
    console.error('[EMAIL] Gagal mengirim via Resend:', res.status, await res.text());
    return false;
  }
  console.log(`[EMAIL] Kode verifikasi ${kodeTersembunyi(kode)} terkirim ke ${email}`);
  return true;
}

/**
 * Kirim kode reset password (6 digit). Fallback log bila tanpa RESEND_API_KEY.
 */
export async function kirimKodeResetPassword(email: string, kode: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(
      `[EMAIL-DEV] Kode reset password untuk ${email}: ${kode}` +
        ` (isi RESEND_API_KEY di .env untuk kirim email sungguhan)`,
    );
    return true;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_DARI,
      to: [email],
      subject: 'Kode reset password — Flexi Kasir',
      text: `Kode reset password Anda: ${kode}\n\nKode berlaku 15 menit. Jika bukan Anda yang meminta, abaikan email ini dan segera hubungi admin.\n\nSetelah reset, gunakan password baru untuk masuk.`,
    }),
  });

  if (!res.ok) {
    console.error('[EMAIL] Gagal mengirim reset via Resend:', res.status, await res.text());
    return false;
  }
  console.log(`[EMAIL] Kode reset ${kodeTersembunyi(kode)} terkirim ke ${email}`);
  return true;
}

/**
 * Helper kirim email transaksional (Resend REST, fallback log dev).
 */
async function kirimEmail(ke: string, subjek: string, teks: string, label: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(
      `[EMAIL-DEV] ${label} untuk ${ke}` +
        ` (isi RESEND_API_KEY di .env untuk kirim email sungguhan)`,
    );
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_DARI,
        to: [ke],
        subject: subjek,
        text: teks,
      }),
    });
    if (!res.ok) {
      console.error('[EMAIL] Gagal kirim:', res.status, await res.text());
      return false;
    }
    console.log(`[EMAIL] ${label} terkirim ke ${ke}`);
    return true;
  } catch (kesalahan) {
    console.error('[EMAIL] Gagal kirim (jaringan):', kesalahan);
    return false;
  }
}

/**
 * Konfirmasi ke pemilik akun bahwa kata sandinya baru saja direset.
 */
export async function kirimKonfirmasiResetPassword(email: string, nama: string): Promise<boolean> {
  return kirimEmail(
    email,
    'Kata sandi Anda telah direset — Flexi Kasir',
    `Halo ${nama},\n\nKata sandi akun Anda (${email}) baru saja direset.\nJika ini dilakukan oleh Anda, abaikan email ini. Jika bukan, segera hubungi pemilik usaha Anda.\n\n— Flexi Kasir`,
    'Konfirmasi reset kata sandi',
  );
}

/**
 * Pengumuman ke pemilik tenant bahwa akun kasir telah mereset kata sandinya.
 */
export async function kirimPemberitahuanResetPassword(
  emailPemilik: string,
  namaKasir: string,
): Promise<boolean> {
  return kirimEmail(
    emailPemilik,
    'Reset kata sandi akun kasir — Flexi Kasir',
    `Halo,\n\nAkun kasir "${namaKasir}" di usaha Anda baru saja mereset kata sandinya.\nJika Anda tidak mengetahui perubahan ini, periksa akun tersebut melalui menu User di dashboard web.\n\n— Flexi Kasir`,
    'Pengumuman reset kata sandi kasir',
  );
}
