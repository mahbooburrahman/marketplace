import type { Server } from 'socket.io';

let io: Server | null = null;
const online = new Map<string, number>(); // userId -> open socket count

export function setIo(server: Server) {
  io = server;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown) {
  io?.to('admins').emit(event, payload);
}

export function markOnline(userId: string, delta: 1 | -1) {
  const n = (online.get(userId) ?? 0) + delta;
  if (n <= 0) online.delete(userId);
  else online.set(userId, n);
  return n > 0;
}

export const isOnline = (userId: string) => online.has(userId);
