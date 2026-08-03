import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/token.js';

const router = Router();

const registerSchema = z.object({
  namaUsaha: z.string().min(1),
  namaUser: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/register', async (req, res) => {
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
      gerai: {
        create: [{ geraiId: gerai.id }],
      },
    },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: tenant.id,
    nama: user.nama,
    peran: user.peran,
  });
  const refreshToken = signRefreshToken(user.id);

  return res.status(201).json({
    accessToken,
    refreshToken,
    user: { id: user.id, nama: user.nama, email: user.email, peran: user.peran },
    gerai: [{ id: gerai.id, nama: gerai.nama, alamat: gerai.alamat }],
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
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
