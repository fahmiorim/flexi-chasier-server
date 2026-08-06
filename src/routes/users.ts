import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// ── Daftar user per tenant ──

router.get('/', requireOwner, async (req: Request, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.user.tenantId },
    select: {
      id: true,
      nama: true,
      email: true,
      peran: true,
      aktif: true,
      gerai: {
        select: { gerai: { select: { id: true, nama: true } } },
      },
    },
    orderBy: { waktuDibuat: 'asc' },
  });

  return res.json({
    hasil: users.map((u) => ({
      id: u.id,
      nama: u.nama,
      email: u.email,
      peran: u.peran,
      aktif: u.aktif,
      gerai: u.gerai.map((g) => g.gerai),
    })),
  });
});

// ── Buat user baru (kasir atau pemilik tambahan) ──

const buatUserSchema = z.object({
  nama: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  peran: z.enum(['Pemilik', 'Kasir']),
  geraiIds: z.array(z.string().min(1)).min(1),
});

router.post('/', requireOwner, async (req: Request, res) => {
  const parsed = buatUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Data user tidak lengkap' });
  }
  const { nama, email, password, peran, geraiIds } = parsed.data;

  const emailDipakai = await prisma.user.findUnique({ where: { email } });
  if (emailDipakai) {
    return res.status(409).json({ error: 'Email sudah terdaftar' });
  }

  const geraiValid = await prisma.gerai.findMany({
    where: { id: { in: geraiIds }, tenantId: req.user.tenantId },
    select: { id: true, nama: true },
  });
  if (geraiValid.length !== geraiIds.length) {
    return res.status(400).json({ error: 'Salah satu gerai tidak valid' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      tenantId: req.user.tenantId,
      nama,
      email,
      passwordHash,
      peran,
      gerai: {
        create: geraiIds.map((geraiId) => ({ geraiId })),
      },
    },
  });

  return res.status(201).json({
    user: {
      id: user.id,
      nama: user.nama,
      email: user.email,
      peran: user.peran,
      aktif: user.aktif,
      gerai: geraiValid.map((g) => ({ id: g.id, nama: g.nama })),
    },
  });
});

// ── Perbarui user (nama, email, password, peran, aktif, gerai) ──

const perbaruiUserSchema = z.object({
  nama: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  peran: z.enum(['Pemilik', 'Kasir']).optional(),
  aktif: z.boolean().optional(),
  geraiIds: z.array(z.string().min(1)).min(1).optional(),
});

router.patch('/:id', requireOwner, async (req: Request, res) => {
  const userId = String(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Tidak dapat mengubah akun sendiri di sini' });
  }

  const parsed = perbaruiUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Data tidak valid' });
  }
  const { nama, email, password, peran, aktif, geraiIds } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.user.tenantId },
  });
  if (!target) {
    return res.status(404).json({ error: 'User tidak ditemukan' });
  }

  if (email && email !== target.email) {
    const emailDipakai = await prisma.user.findUnique({ where: { email } });
    if (emailDipakai) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }
  }

  let geraiValidIds: string[] | null = null;
  if (geraiIds) {
    const geraiValid = await prisma.gerai.findMany({
      where: { id: { in: geraiIds }, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (geraiValid.length !== geraiIds.length) {
      return res.status(400).json({ error: 'Salah satu gerai tidak valid' });
    }
    geraiValidIds = geraiValid.map((g) => g.id);
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        nama,
        email,
        passwordHash,
        peran,
        aktif,
      },
    });
    if (geraiValidIds) {
      await tx.userGerai.deleteMany({ where: { userId } });
      await tx.userGerai.createMany({
        data: geraiValidIds.map((geraiId) => ({ userId, geraiId })),
      });
    }
  });

  return res.json({ ok: true });
});

export default router;
