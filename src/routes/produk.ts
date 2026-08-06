import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { cekAksesGerai, daftarIdGeraiTerakses } from '../lib/akses-gerai.js';

const router = Router();

router.use(requireAuth);

/**
 * Bentuk respons produk mengikuti kontrak ProductNetworkResponse di Android
 * (nama field: stok_tersedia, kode_pindai, foto_uri, harga_modal, varian_json,
 * apakah_stok_diaktifkan). Field tanpa padanan di backend dikirim null; Android
 * memakai nilai default karena Json { coerceInputValues = true }.
 */
interface ResponsProduk {
  id: string;
  nama: string;
  harga: number;
  stok_tersedia: number;
  kode_pindai: null;
  deskripsi: string | null;
  aktif: boolean;
  foto_uri: string | null;
  favorit: boolean;
  harga_modal: null;
  kategori: string;
  varian_json: null;
  apakah_stok_diaktifkan: boolean;
}

function keResponsProduk(p: {
  id: string;
  nama: string;
  harga: number;
  stok: number;
  kategori: string | null;
  deskripsi: string | null;
  fotoUri: string | null;
  favorit: boolean;
  aktif: boolean;
}): ResponsProduk {
  return {
    id: p.id,
    nama: p.nama,
    harga: p.harga,
    stok_tersedia: p.stok,
    kode_pindai: null,
    deskripsi: p.deskripsi,
    aktif: p.aktif,
    foto_uri: p.fotoUri,
    favorit: p.favorit,
    harga_modal: null,
    kategori: p.kategori ?? '',
    varian_json: null,
    apakah_stok_diaktifkan: true,
  };
}

const daftarSchema = z.object({
  geraiId: z.string().optional(),
  kata_kunci: z.string().optional(),
});

router.get('/', async (req: Request, res) => {
  const parsed = daftarSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, kata_kunci } = parsed.data;

  let daftarGeraiId: string[];
  if (geraiId) {
    if (!(await cekAksesGerai(req, geraiId))) {
      return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
    }
    daftarGeraiId = [geraiId];
  } else {
    daftarGeraiId = await daftarIdGeraiTerakses(req);
    if (daftarGeraiId.length === 0) {
      return res.json([]);
    }
  }

  const produk = await prisma.product.findMany({
    where: {
      geraiId: { in: daftarGeraiId },
      dihapus: false,
      ...(kata_kunci ? { nama: { contains: kata_kunci, mode: 'insensitive' } } : {}),
    },
    orderBy: { nama: 'asc' },
    take: 1000,
  });

  return res.json(produk.map(keResponsProduk));
});

router.get('/:id', async (req: Request, res) => {
  const idProduk = String(req.params.id);

  const produk = await prisma.product.findFirst({
    where: { id: idProduk, tenantId: req.user.tenantId, dihapus: false },
  });
  if (!produk) {
    return res.status(404).json({ error: 'Produk tidak ditemukan' });
  }

  if (!(await cekAksesGerai(req, produk.geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  return res.json(keResponsProduk(produk));
});

export default router;
