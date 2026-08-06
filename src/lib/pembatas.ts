import rateLimit from 'express-rate-limit';

const PESAN = { error: 'Terlalu banyak percobaan. Coba lagi beberapa saat.' };

/**
 * Pembatas percobaan login: 10 percobaan per 15 menit per IP.
 */
export const pembatasLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});

/**
 * Pembatas pendaftaran akun: 5 pendaftaran per jam per IP.
 */
export const pembatasRegister = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});

/**
 * Pembatas verifikasi kode: 10 percobaan kode per 15 menit per IP.
 */
export const pembatasVerifikasi = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});

/**
 * Pembatas kirim-ulang kode verifikasi: 5 kali per jam per IP.
 */
export const pembatasKirimUlang = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});
