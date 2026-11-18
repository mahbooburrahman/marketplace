import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { q } from './db.js';
import { config } from './config.js';
import { loadUserBySessionHash, SESSION_COOKIE } from './middleware/auth.js';
import { sha256 } from './lib/security.js';
import { markOnline, setIo } from './lib/realtime.js';

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

async function partnersOf(userId: string): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `SELECT DISTINCT CASE WHEN buyer_id=$1 THEN seller_id ELSE buyer_id END AS id FROM conversations WHERE buyer_id=$1 OR seller_id=$1`,
    [userId],
  );
  return rows.map((r) => r.id);
}

export function attachSocket(server: HttpServer) {
  const io = new Server(server, {
    path: '/socket.io',
    cors: config.isProd ? undefined : { origin: config.appUrl, credentials: true },
    maxHttpBufferSize: 16 * 1024,
  });
  setIo(io);

  // Authenticate the socket with the same httpOnly session cookie as the REST API.
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const user = token ? await loadUserBySessionHash(sha256(token)) : null;
      if (!user) return next(new Error('unauthenticated'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });

  // Cache of conversations each socket may emit typing events to.
  io.on('connection', async (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admins');
    const cameOnline = markOnline(user.id, 1);
    let typingCount = 0;
    const typingReset = setInterval(() => (typingCount = 0), 10_000);

    if (cameOnline) {
      for (const p of await partnersOf(user.id)) io.to(`user:${p}`).emit('presence', { user_id: user.id, online: true });
    }

    socket.on('typing', async (payload: { conversation_id?: string; typing?: boolean }) => {
      if (typeof payload?.conversation_id !== 'string' || ++typingCount > 30) return;
      const rows = await q<{ buyer_id: string; seller_id: string }>(
        `SELECT c.buyer_id, c.seller_id FROM conversations c
           JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=$2
          WHERE c.id=$1`,
        [payload.conversation_id, user.id],
      ).catch(() => []);
      const conv = rows[0];
      if (!conv) return;
      const other = conv.buyer_id === user.id ? conv.seller_id : conv.buyer_id;
      io.to(`user:${other}`).emit('typing', { conversation_id: payload.conversation_id, user_id: user.id, typing: payload.typing !== false });
    });

    socket.on('disconnect', async () => {
      clearInterval(typingReset);
      const stillOnline = markOnline(user.id, -1);
      if (!stillOnline) {
        await q('UPDATE users SET last_seen_at=now() WHERE id=$1', [user.id]).catch(() => {});
        for (const p of await partnersOf(user.id).catch(() => [])) io.to(`user:${p}`).emit('presence', { user_id: user.id, online: false });
      }
    });
  });

  return io;
}
