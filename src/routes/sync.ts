import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

async function cekAksesGerai(req: Request, geraiId: string): Promise<boolean> {
  if (req.user.peran === 'Pemilik') {
    const gerai = await prisma.gerai.findFirst({
      where: { id: geraiId, tenantId: req.user.tenantId },
    });
    return gerai !== null;
  }
  const relasi = await prisma.userGerai.findUnique({
    where: { userId_geraiId: { userId: req.user.id, geraiId } },
  });
  return relasi !== null;
}

const productSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  nama: z.string().min(1),
  harga: z.number().int().nonnegative(),
  stok: z.number().int().nonnegative().default(0),
  kategori: z.string().nullable().optional(),
  deskripsi: z.string().nullable().optional(),
  favorit: z.boolean().default(false),
  aktif: z.boolean().default(true),
  dihapus: z.boolean().default(false),
});

const pushProdukSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(productSchema).max(500),
});

router.post('/produk', async (req: Request, res) => {
  const parsed = pushProdukSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const existing = await tx.product.findUnique({ where: { id: item.id } });
      if (existing && BigInt(item.versi) < existing.versi) continue;

      await tx.product.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          tenantId: req.user.tenantId,
          geraiId,
          versi: BigInt(item.versi),
          nama: item.nama,
          harga: item.harga,
          stok: item.stok,
          kategori: item.kategori,
          deskripsi: item.deskripsi,
          favorit: item.favorit,
          aktif: item.aktif,
          dihapus: item.dihapus,
        },
        update: {
          versi: BigInt(item.versi),
          nama: item.nama,
          harga: item.harga,
          stok: item.stok,
          kategori: item.kategori,
          deskripsi: item.deskripsi,
          favorit: item.favorit,
          aktif: item.aktif,
          dihapus: item.dihapus,
        },
      });
      diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

const pullSchema = z.object({
  geraiId: z.string().min(1),
  sejakEpochMili: z.coerce.number().int().nonnegative().default(0),
});

router.get('/perubahan', async (req: Request, res) => {
  const parsed = pullSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, sejakEpochMili } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const sejak = new Date(sejakEpochMili);

  const [products, transactions, tables] = await Promise.all([
    prisma.product.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: 1000,
    }),
    prisma.transaction.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: 1000,
    }),
    prisma.table.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: 1000,
    }),
  ]);

  return res.json({
    waktuServerEpochMili: Date.now(),
    products: products.map((p) => ({
      id: p.id,
      versi: Number(p.versi),
      nama: p.nama,
      harga: p.harga,
      stok: p.stok,
      kategori: p.kategori,
      deskripsi: p.deskripsi,
      favorit: p.favorit,
      aktif: p.aktif,
      dihapus: p.dihapus,
    })),
    transactions,
    tables,
  });
});

export default router;
