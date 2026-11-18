import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const Ctx = createContext<{ socket: Socket | null; connected: boolean }>({ socket: null, connected: false });
export const useSocket = () => useContext(Ctx);

/** Subscribe to a socket event for the lifetime of a component. */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, setCounts, refresh } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return;
    const s = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('notification', (n: { type: string; title: string }) => {
      setCounts((c) => ({ ...c, unread_notifications: c.unread_notifications + 1 }));
      if (n.type === 'message.new') {
        setCounts((c) => ({ ...c, unread_messages: c.unread_messages + 1 }));
        // The chat screen shows its own messages; only toast elsewhere.
        if (!location.pathname.startsWith('/messages')) toast(n.title, 'info');
      } else {
        toast(n.title, 'info');
        // Status changes (approval, seller activation) affect permissions — refresh the session view.
        if (/^(account|seller|payment)\./.test(n.type)) refresh();
      }
    });
    s.on('unread:changed', () => refresh());
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return <Ctx.Provider value={{ socket, connected }}>{children}</Ctx.Provider>;
}
