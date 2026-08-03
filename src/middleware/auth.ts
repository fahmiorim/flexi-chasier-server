import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/token.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Tidak ada token' });
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      nama: payload.nama,
      peran: payload.peran,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.user.peran !== 'Pemilik') {
    return res.status(403).json({ error: 'Hanya pemilik yang dapat melakukan ini' });
  }
  return next();
}
