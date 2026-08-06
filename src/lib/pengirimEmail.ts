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
