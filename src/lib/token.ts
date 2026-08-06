import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';

export interface TokenPayload {
  sub: string;
  tenantId: string;
  nama: string;
  peran: string;
}

export interface RefreshTokenDiterbitkan {
  token: string;
  jti: string;
  expiresAt: Date;
}

const accessSecret = process.env.JWT_ACCESS_SECRET!;
const refreshSecret = process.env.JWT_REFRESH_SECRET!;
const accessExpires = (process.env.JWT_ACCESS_EXPIRES ?? '15m') as jwt.SignOptions['expiresIn'];
const refreshExpires = (process.env.JWT_REFRESH_EXPIRES ?? '30d') as jwt.SignOptions['expiresIn'];

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, accessSecret, { expiresIn: accessExpires });
}

/**
 * Terbitkan refresh token dengan `jti` (id unik) + tanggal kedaluwarsa, supaya
 * bisa dicabut: server menyimpan hash-nya di tabel `RefreshToken` dan
 * menandai revoked saat logout/reset-password.
 */
export function signRefreshToken(userId: string): RefreshTokenDiterbitkan {
  const jti = randomUUID();
  const token = jwt.sign({ sub: userId, jti }, refreshSecret, { expiresIn: refreshExpires });
  const decoded = jwt.decode(token) as { exp: number };
  return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, accessSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, refreshSecret) as { sub: string; jti: string };
}

/** Hash SHA-256 refresh token — yang disimpan DB, bukan token mentahnya. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
