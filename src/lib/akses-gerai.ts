import type { Request } from 'express';
import { prisma } from './prisma.js';

/**
 * Memastikan pengguna (dari token) berhak mengakses gerai tertentu.
 * Pemilik: semua gerai di tenant-nya. Kasir: hanya gerai yang di-assign.
 */
export async function cekAksesGerai(req: Request, geraiId: string): Promise<boolean> {
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

/**
 * Daftar id gerai yang boleh diakses pengguna saat ini.
 */
export async function daftarIdGeraiTerakses(req: Request): Promise<string[]> {
  if (req.user.peran === 'Pemilik') {
    const gerai = await prisma.gerai.findMany({
      where: { tenantId: req.user.tenantId },
      select: { id: true },
    });
    return gerai.map((g) => g.id);
  }
  const relasi = await prisma.userGerai.findMany({
    where: { userId: req.user.id },
    select: { geraiId: true },
  });
  return relasi.map((r) => r.geraiId);
}
