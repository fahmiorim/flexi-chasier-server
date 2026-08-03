import jwt from 'jsonwebtoken';

export interface TokenPayload {
  sub: string;
  tenantId: string;
  nama: string;
  peran: string;
}

const accessSecret = process.env.JWT_ACCESS_SECRET!;
const refreshSecret = process.env.JWT_REFRESH_SECRET!;
const accessExpires = (process.env.JWT_ACCESS_EXPIRES ?? '15m') as jwt.SignOptions['expiresIn'];
const refreshExpires = (process.env.JWT_REFRESH_EXPIRES ?? '30d') as jwt.SignOptions['expiresIn'];

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, accessSecret, { expiresIn: accessExpires });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, refreshSecret, { expiresIn: refreshExpires });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, accessSecret) as TokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, refreshSecret) as { sub: string };
}
