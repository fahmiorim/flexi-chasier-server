import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  kirimKodeResetPassword,
  kirimKodeVerifikasi,
  kirimKonfirmasiResetPassword,
  kirimPemberitahuanResetPassword,
} from '../lib/pengirimEmail.js';
import {
  pembatasKirimUlang,
  pembatasLogin,
  pembatasLupaPassword,
  pembatasRegister,
  pembatasResetPassword,
  pembatasVerifikasi,
} from '../lib/pembatas.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/token.js';

const router = Router();

// ── Bantuan verifikasi email ──

const KADALUARSA_VERIFIKASI_MS = 15 * 60 * 1000; // 15 menit

function kodeVerifikasiBaru(): string {
  // 6 digit acak aman (0–999999, di-pad ke 6 digit).
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// Kode di-hash dengan bcrypt (cost sama dengan password): tahan brute-force
// offline andai database bocor. `cocokKode` memakai bcrypt.compare yang
// internalnya sudah constant-time.
async function hashKode(kode: string): Promise<string> {
  return bcrypt.hash(kode, 10);
}

async function cocokKode(kode: string, hashTersimpan: string): Promise<boolean> {
  return bcrypt.compare(kode, hashTersimpan);
}

async function buatDanKirimKode(userId: string, email: string): Promise<boolean> {
  const kode = kodeVerifikasiBaru();
  const kodeHash = await hashKode(kode);
  await prisma.user.update({
    where: { id: userId },
    data: {
      kodeVerifikasiHash: kodeHash,
      kodeVerifikasiKadaluarsa: new Date(Date.now() + KADALUARSA_VERIFIKASI_MS),
    },
  });
  return kirimKodeVerifikasi(email, kode);
}

async function buatDanKirimKodeReset(userId: string, email: string): Promise<boolean> {
  const kode = kodeVerifikasiBaru();
  const kodeHash = await hashKode(kode);
  await prisma.user.update({
    where: { id: userId },
    data: {
      kodeResetPasswordHash: kodeHash,
      kodeResetPasswordKadaluarsa: new Date(Date.now() + KADALUARSA_VERIFIKASI_MS),
    },
  });
  return kirimKodeResetPassword(email, kode);
}

// ── Register (akun dibuat, tapi WAJIB verifikasi email sebelum login) ──

const registerSchema = z.object({
  namaUsaha: z.string().min(1),
  namaUser: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/register', pembatasRegister, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { namaUsaha, namaUser, email, password } = parsed.data;

  const emailDipakai = await prisma.user.findUnique({ where: { email } });
  if (emailDipakai) {
    return res.status(409).json({ error: 'Email sudah terdaftar' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const tenant = await prisma.tenant.create({
    data: { nama: namaUsaha },
  });
  const gerai = await prisma.gerai.create({
    data: { tenantId: tenant.id, nama: namaUsaha },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nama: namaUser,
      email,
      passwordHash,
      peran: 'Pemilik',
      emailTerverifikasi: false,
      gerai: {
        create: [{ geraiId: gerai.id }],
      },
    },
  });

  // Kirim kode verifikasi; bila pengiriman gagal tetap balas 201 agar user
  // bisa minta kirim ulang lewat endpoint /kirim-ulang-verifikasi.
  await buatDanKirimKode(user.id, email);

  // Token TIDAK diberikan: verifikasi email wajib sebelum login pertama.
  return res.status(201).json({
    ok: true,
    perluVerifikasiEmail: true,
    email,
  });
});

// ── Login ──

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', pembatasLogin, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email dan password wajib diisi' });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.aktif) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }
  const cocok = await bcrypt.compare(password, user.passwordHash);
  if (!cocok) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }

  // Blokir login sampai email diverifikasi.
  if (!user.emailTerverifikasi) {
    return res.status(403).json({
      error: 'Email belum diverifikasi. Periksa kode di email Anda.',
      perluVerifikasiEmail: true,
    });
  }

  const gerai = await prisma.userGerai.findMany({
    where: { userId: user.id },
    select: {
      gerai: { select: { id: true, nama: true, alamat: true } },
    },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    nama: user.nama,
    peran: user.peran,
  });
  const refreshToken = signRefreshToken(user.id);

  return res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, nama: user.nama, email: user.email, peran: user.peran },
    gerai: gerai.map((g) => g.gerai),
  });
});

// ── Verifikasi email ──

const verifikasiSchema = z.object({
  email: z.string().email(),
  kode: z.string().length(6),
});

router.post('/verifikasi-email', pembatasVerifikasi, async (req, res) => {
  const parsed = verifikasiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email dan kode 6 digit wajib diisi' });
  }
  const { email, kode } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: 'Email tidak terdaftar' });
  }
  if (user.emailTerverifikasi) {
    return res.json({ ok: true, emailTerverifikasi: true });
  }
  if (!user.kodeVerifikasiHash || !user.kodeVerifikasiKadaluarsa) {
    return res.status(400).json({ error: 'Belum ada kode verifikasi. Minta kode baru.' });
  }
  if (user.kodeVerifikasiKadaluarsa.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Kode sudah kedaluwarsa. Minta kode baru.' });
  }
  if (!(await cocokKode(kode, user.kodeVerifikasiHash))) {
    return res.status(400).json({ error: 'Kode verifikasi salah.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailTerverifikasi: true,
      kodeVerifikasiHash: null,
      kodeVerifikasiKadaluarsa: null,
    },
  });

  return res.json({ ok: true, emailTerverifikasi: true });
});

// ── Kirim ulang kode verifikasi ──

const kirimUlangSchema = z.object({
  email: z.string().email(),
});

router.post('/kirim-ulang-verifikasi', pembatasKirimUlang, async (req, res) => {
  const parsed = kirimUlangSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email wajib diisi' });
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: 'Email tidak terdaftar' });
  }
  if (user.emailTerverifikasi) {
    return res.json({ ok: true, emailTerverifikasi: true });
  }

  await buatDanKirimKode(user.id, email);
  return res.json({ ok: true });
});

// ── Lupa / reset password ──

const lupaPasswordSchema = z.object({
  email: z.string().email(),
});

router.post('/lupa-password', pembatasLupaPassword, async (req, res) => {
  const parsed = lupaPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email wajib diisi' });
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Tidak bocorkan apakah email terdaftar (anti-enumerasi akun).
  if (user) {
    await buatDanKirimKodeReset(user.id, email);
  }
  return res.json({ ok: true });
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  kode: z.string().length(6),
  passwordBaru: z.string().min(6),
});

router.post('/reset-password', pembatasResetPassword, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email, kode 6 digit, dan password (min. 6 karakter) wajib diisi' });
  }
  const { email, kode, passwordBaru } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Anti-enumerasi: respon sama dengan kondisi kode salah agar tidak
    // membocorkan apakah sebuah email terdaftar.
    return res.status(400).json({ error: 'Email dan kode tidak cocok' });
  }
  if (!user.kodeResetPasswordHash || !user.kodeResetPasswordKadaluarsa) {
    return res.status(400).json({ error: 'Belum ada permintaan reset. Minta kode baru.' });
  }
  if (user.kodeResetPasswordKadaluarsa.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Kode sudah kedaluwarsa. Minta kode baru.' });
  }
  if (!(await cocokKode(kode, user.kodeResetPasswordHash))) {
    return res.status(400).json({ error: 'Kode reset salah.' });
  }

  const passwordHash = await bcrypt.hash(passwordBaru, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      kodeResetPasswordHash: null,
      kodeResetPasswordKadaluarsa: null,
    },
  });

  // Notifikasi email: konfirmasi ke pemilik akun + pengumuman ke pemilik
  // tenant bila akun yang di-reset bukan pemilik itu sendiri. Kegagalan
  // pengiriman tidak menggagalkan reset.
  try {
    await kirimKonfirmasiResetPassword(user.email, user.nama);
    const pemilik = await prisma.user.findMany({
      where: { tenantId: user.tenantId, peran: 'Pemilik', aktif: true },
      select: { email: true },
    });
    for (const p of pemilik) {
      if (p.email !== user.email) {
        await kirimPemberitahuanResetPassword(p.email, user.nama);
      }
    }
  } catch (kesalahanKirim) {
    console.error('[EMAIL] Gagal mengirim notifikasi reset password:', kesalahanKirim);
  }

  return res.json({ ok: true });
});

// ── Refresh ──

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'refreshToken wajib diisi' });
  }
  try {
    const payload = verifyRefreshToken(parsed.data.refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.aktif) {
      return res.status(401).json({ error: 'Sesi tidak valid' });
    }
    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      nama: user.nama,
      peran: user.peran,
    });
    const refreshToken = signRefreshToken(user.id);
    return res.json({ accessToken, refreshToken });
  } catch {
    return res.status(401).json({ error: 'refreshToken tidak valid' });
  }
});

router.post('/logout', (_req, res) => {
  return res.json({ ok: true });
});

export default router;
