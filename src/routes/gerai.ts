import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req: Request, res) => {
  const isOwner = req.user.peran === 'Pemilik';
  const gerai = await prisma.gerai.findMany({
    where: isOwner
      ? { tenantId: req.user.tenantId }
      : { users: { some: { userId: req.user.id } } },
    select: { id: true, nama: true, alamat: true },
    orderBy: { waktuDibuat: 'asc' },
  });
  return res.json({ gerai });
});

const createGeraiSchema = z.object({
  nama: z.string().min(1),
  alamat: z.string().optional(),
});

router.post('/', requireOwner, async (req: Request, res) => {
  const parsed = createGeraiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Nama gerai wajib diisi' });
  }
  const gerai = await prisma.gerai.create({
    data: {
      tenantId: req.user.tenantId,
      nama: parsed.data.nama,
      alamat: parsed.data.alamat,
      users: { create: [{ userId: req.user.id }] },
    },
  });
  return res.status(201).json({ gerai: { id: gerai.id, nama: gerai.nama, alamat: gerai.alamat } });
});

const createUserSchema = z.object({
  nama: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  peran: z.enum(['Pemilik', 'Kasir']),
  geraiIds: z.array(z.string().min(1)).min(1),
});

router.post('/:id/users', requireOwner, async (req: Request, res) => {
  const geraiId = String(req.params.id);
  const gerai = await prisma.gerai.findFirst({
    where: { id: geraiId, tenantId: req.user.tenantId },
  });
  if (!gerai) {
    return res.status(404).json({ error: 'Gerai tidak ditemukan' });
  }

  const parsed = createUserSchema.safeParse(req.body);
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
    select: { id: true },
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
        create: geraiIds.map((gid) => ({ geraiId: gid })),
      },
    },
  });
  return res.status(201).json({
    user: { id: user.id, nama: user.nama, email: user.email, peran: user.peran },
  });
});

export default router;
