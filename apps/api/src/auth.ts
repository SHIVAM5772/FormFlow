import type { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '../../../packages/database/src/index.js';
import { config, webOrigins } from './config.js';
export const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
const secret = new TextEncoder().encode(config.SESSION_SECRET);
export async function signSession(id: string, version: number) {
  return new SignJWT({ version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);
}
export async function authenticate(token?: string) {
  if (!token) throw new Error('Authentication required');
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.sessionVersion !== payload.version) throw new Error('Session expired');
  return user;
}
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void authenticate(req.cookies?.session)
    .then((user) => {
      res.locals.user = user;
      next();
    })
    .catch(() =>
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' } }),
    );
}
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) &&
    !webOrigins.has(req.get('origin') ?? '')
  ) {
    res
      .status(403)
      .json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed' } });
    return;
  }
  next();
}
