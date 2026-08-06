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

/**
 * Pembatas permintaan lupa password: 5 kali per jam per IP.
 */
export const pembatasLupaPassword = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});

/**
 * Pembatas percobaan reset password (kode + password baru): 10 per 15 menit per IP.
 */
export const pembatasResetPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});

/**
 * Pembatas rotasi refresh token: 60 permintaan per 15 menit per IP.
 * Token refresh sendiri ber-entropi tinggi, pembatas ini hanya mencegah
 * pemukulan API yang tidak wajar (mis. skrip coba-coba).
 */
export const pembatasRefresh = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: PESAN,
});
