import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp, logger } from './app.js';
import { authenticate } from './auth.js';
import { config, webOrigins } from './config.js';
import { socketOriginAllowed } from './origins.js';
import { db } from '../../../packages/database/src/index.js';
import { redisConnection, closeQueue } from '../../../packages/submission-engine/src/queue.js';
const server = createServer(createApp());
const io = new Server(server, {
  cors: { origin: [...webOrigins], credentials: true },
  allowRequest: (req, cb) =>
    cb(null, socketOriginAllowed(req.headers.origin, req.headers['sec-fetch-site'], webOrigins)),
});
io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('session='))
    ?.slice(8);
  void authenticate(cookie)
    .then((user) => {
      socket.data.userId = user.id;
      next();
    })
    .catch(() => next(new Error('Unauthorized')));
});
io.on('connection', (socket) => {
  void socket.join(socket.data.userId);
  const cookie = socket.handshake.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('session='))
    ?.slice(8);
  const expiry = setInterval(() => {
    void authenticate(cookie).catch(() => socket.disconnect(true));
  }, 60000);
  socket.on('disconnect', () => clearInterval(expiry));
});
const subscriber = redisConnection();
subscriber.on('error', () => logger.warn('Realtime connection unavailable'));
void subscriber.subscribe('formflow:progress').catch(() => {});
subscriber.on('message', (_channel, message) => {
  try {
    const { userId, jobId } = JSON.parse(message);
    io.to(userId).emit('job:updated', { jobId });
  } catch {
    /* Ignore malformed events. */
  }
});
server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'FormFlow API listening'));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await io.close();
  subscriber.disconnect();
  await closeQueue();
  await db.$disconnect();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
