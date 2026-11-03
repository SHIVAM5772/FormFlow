import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, encrypt, decrypt } from '../../../packages/database/src/index.js';
import { cookieOptions } from './auth.js';
import { config } from './config.js';
export const google = Router();
google.get('/status', (_req, res) => {
  res.json({
    data: { enabled: !!process.env.GOOGLE_CLIENT_ID, connected: !!res.locals.user.googleRefresh },
  });
});
google.get('/connect', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res
      .status(409)
      .json({ error: { message: 'Configure Google OAuth environment variables first' } });
    return;
  }
  const state = randomBytes(32).toString('hex');
  res.cookie('oauth_state', state, { ...cookieOptions, sameSite: 'lax', maxAge: 600000 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/forms.body.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  res.json({ data: { url: url.href } });
});
google.get('/callback', async (req, res, next) => {
  try {
    const state = String(req.query.state ?? '');
    const expected = String(req.cookies.oauth_state ?? '');
    res.clearCookie('oauth_state', cookieOptions);
    if (
      !state ||
      state.length !== expected.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
    )
      throw new Error('Invalid OAuth state');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code: String(req.query.code ?? ''),
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data: any = await response.json();
    if (!response.ok || !data.refresh_token)
      throw new Error('Google did not grant offline access. Try connecting again.');
    await db.user.update({
      where: { id: res.locals.user.id },
      data: { googleRefresh: encrypt(data.refresh_token) },
    });
    res.redirect(`${config.WEB_ORIGIN}/settings?google=connected`);
  } catch (error) {
    next(error);
  }
});
google.delete('/connection', async (_req, res, next) => {
  try {
    await db.user.update({ where: { id: res.locals.user.id }, data: { googleRefresh: null } });
    res.json({ data: { disconnected: true } });
  } catch (error) {
    next(error);
  }
});
export async function googleAccess(encrypted: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt<string>(encrypted),
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data: any = await response.json();
  if (!response.ok || !data.access_token)
    throw new Error('Google connection expired. Reconnect in Settings.');
  return data.access_token as string;
}
