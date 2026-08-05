import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { cekAksesGerai } from '../lib/akses-gerai.js';

const router = Router();

router.use(requireAuth);

const daftarSchema = z.object({
  geraiId: z.string().min(1),
  q: z.string().optional(),
});

/** GET /api/bahan — daftar bahan baku gerai (opsional filter nama). */
router.get('/', async (req: Request, res) => {
  const parsed = daftarSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, q } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const bahan = await prisma.bahan.findMany({
    where: {
      geraiId,
      dihapus: false,
      ...(q ? { nama: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { nama: 'asc' },
    take: 1000,
  });

  return res.json({
    hasil: bahan.map((b) => ({
      id: b.id,
      nama: b.nama,
      satuan: b.satuan,
      stok: b.stok,
      hargaBeli: b.hargaBeli,
      stokMinimum: b.stokMinimum,
      aktif: b.aktif,
    })),
  });
});

/** GET /api/bahan/resep — daftar resep gerai lengkap dengan bahan-bahannya. */
router.get('/resep', async (req: Request, res) => {
  const parsed = daftarSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, q } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const resep = await prisma.resep.findMany({
    where: {
      geraiId,
      dihapus: false,
      ...(q ? { namaProduk: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: { bahan: { orderBy: { namaBahan: 'asc' } } },
    orderBy: { namaProduk: 'asc' },
    take: 1000,
  });

  return res.json({
    hasil: resep.map((r) => ({
      id: r.id,
      productId: r.productId,
      namaProduk: r.namaProduk,
      bahan: r.bahan.map((b) => ({
        id: b.id,
        bahanId: b.bahanId,
        namaBahan: b.namaBahan,
        jumlah: b.jumlah,
      })),
    })),
  });
});

export default router;
