import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Send, MoreVertical, Ban, Flag, CheckCheck, Check, MessageCircle, X, Image as ImageIcon, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, usePageMeta } from '../lib/hooks';
import { clock, money, timeAgo } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useSocket, useSocketEvent } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { ReportDialog } from '../components/ReportDialog';
import { Avatar, ConfirmDialog, EmptyState, ErrorState, Notice, RowsSkeleton, Spinner, errMsg } from '../components/ui';

interface ConvItem {
  id: string;
  role: 'buyer' | 'seller';
  listing: { id: string; title: string; slug: string; price: number; currency: string; status: string; image: string | null };
  other: { id: string; name: string; avatar_url: string | null; online: boolean; last_seen_at: string | null };
  last_message: { body: string; from_me: boolean; created_at: string; has_attachment: boolean } | null;
  unread: number;
  i_blocked: boolean;
  blocked_me: boolean;
}
interface Msg { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; attachments: { id: string; url: string; width: number; height: number }[]; pending?: boolean }
interface ConvDetail {
  conversation: { id: string; role: string; listing: ConvItem['listing']; other: ConvItem['other']; other_last_read_at: string; i_blocked: boolean; blocked_me: boolean };
  messages: Msg[];
  has_more: boolean;
}

function ConversationList({ items, activeId, filter, setFilter }: { items: ConvItem[]; activeId?: string; filter: string; setFilter: (f: string) => void }) {
  const shown = items.filter((c) => (filter === 'buying' ? c.role === 'buyer' : filter === 'selling' ? c.role === 'seller' : filter === 'unread' ? c.unread > 0 : true));
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-line">
        <h1 className="text-xl font-extrabold">Messages</h1>
        <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
          {['all', 'unread', 'buying', 'selling'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`chip h-7 capitalize ${filter === f ? 'chip-active' : ''}`}>{f}</button>
          ))}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {shown.length === 0 && <li><EmptyState icon={MessageCircle} title="No conversations" body={filter === 'all' ? 'When you contact a seller, the chat appears here.' : 'Nothing here.'} /></li>}
        {shown.map((c) => (
          <li key={c.id}>
            <Link to={`/messages/${c.id}`} className={`flex gap-3 px-4 py-3 border-b border-line/70 transition ${c.id === activeId ? 'bg-brand-soft' : 'hover:bg-stone-50'}`}>
              <div className="relative shrink-0">
                {c.listing.image ? <img src={c.listing.image} alt="" className="size-14 rounded-xl object-cover" /> : <div className="size-14 rounded-xl bg-stone-200" />}
                <span className="absolute -bottom-1 -right-1 ring-2 ring-white rounded-full"><Avatar name={c.other.name} src={c.other.avatar_url} size={24} /></span>
                {c.other.online && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white" aria-label="Online" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`truncate ${c.unread ? 'font-bold' : 'font-semibold'}`}>{c.other.name}</p>
                  <span className="text-[11px] text-muted shrink-0">{c.last_message ? timeAgo(c.last_message.created_at) : ''}</span>
                </div>
                <p className="text-xs text-muted truncate">{c.listing.title} · {money(c.listing.price, c.listing.currency)}</p>
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate flex-1 ${c.unread ? 'text-ink font-semibold' : 'text-muted'}`}>
                    {c.last_message ? `${c.last_message.from_me ? 'You: ' : ''}${c.last_message.body || (c.last_message.has_attachment ? '📷 Photo' : '')}` : 'No messages yet'}
                  </p>
                  {c.unread > 0 && <span className="rounded-full bg-brand text-white text-[11px] font-bold min-w-5 h-5 px-1.5 grid place-items-center">{c.unread}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thread({ id, onActivity }: { id: string; onActivity: () => void }) {
  const { user, setCounts } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const nav = useNavigate();
  const { data, error, loading, reload, setData } = useFetch<ConvDetail>(`/api/chat/conversations/${id}`);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingSent = useRef(0);
  const conv = data?.conversation;
  usePageMeta(conv ? `Chat with ${conv.other.name}` : 'Messages');

  const markRead = useCallback(() => {
    api.post(`/api/chat/conversations/${id}/read`).then(onActivity).catch(() => {});
  }, [id, onActivity]);

  useEffect(() => { if (data) markRead(); }, [data?.conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [data?.messages.length, typing]);

  useSocketEvent<Msg>('message:new', (m) => {
    if (m.conversation_id !== id) return;
    setData((d) => (d && !d.messages.some((x) => x.id === m.id) ? { ...d, messages: [...d.messages.filter((x) => !(x.pending && x.body === m.body && m.sender_id === user?.id)), m] } : d));
    if (m.sender_id !== user?.id) {
      setTyping(false);
      if (document.visibilityState === 'visible') markRead();
    }
  });
  useSocketEvent<{ conversation_id: string; read_at: string }>('message:read', (e) => {
    if (e.conversation_id === id) setData((d) => (d ? { ...d, conversation: { ...d.conversation, other_last_read_at: e.read_at } } : d));
  });
  useSocketEvent<{ conversation_id: string; typing: boolean }>('typing', (e) => {
    if (e.conversation_id !== id) return;
    setTyping(e.typing);
    clearTimeout(typingTimer.current);
    if (e.typing) typingTimer.current = setTimeout(() => setTyping(false), 4000);
  });
  useSocketEvent<{ user_id: string; online: boolean }>('presence', (p) => {
    if (p.user_id === conv?.other.id) setData((d) => (d ? { ...d, conversation: { ...d.conversation, other: { ...d.conversation.other, online: p.online, last_seen_at: new Date().toISOString() } } } : d));
  });

  const onType = (v: string) => {
    setText(v);
    if (socket && Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      socket.emit('typing', { conversation_id: id, typing: true });
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    const fd = new FormData();
    fd.append('body', body);
    if (file) fd.append('image', file);
    const tempId = `tmp-${Date.now()}`;
    if (!file) {
      setData((d) => d && { ...d, messages: [...d.messages, { id: tempId, conversation_id: id, sender_id: user!.id, body, created_at: new Date().toISOString(), attachments: [], pending: true }] });
    }
    setText('');
    atBottom.current = true;
    try {
      const r = await api.post<{ message: Msg }>(`/api/chat/conversations/${id}/messages`, fd);
      setData((d) => d && { ...d, messages: d.messages.filter((m) => m.id !== tempId && m.id !== r.message.id).concat(r.message) });
      setFile(null);
      onActivity();
    } catch (err) {
      setData((d) => d && { ...d, messages: d.messages.filter((m) => m.id !== tempId) });
      setText(body);
      toast(errMsg(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    if (!data?.messages.length) return;
    setLoadingOlder(true);
    const el = scroller.current!;
    const prevHeight = el.scrollHeight;
    try {
      const r = await api.get<ConvDetail>(`/api/chat/conversations/${id}?before=${encodeURIComponent(data.messages[0]!.created_at)}`);
      atBottom.current = false;
      setData((d) => d && { ...d, messages: [...r.messages, ...d.messages], has_more: r.has_more });
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight));
    } finally {
      setLoadingOlder(false);
    }
  };

  const toggleBlock = async () => {
    if (!conv) return;
    if (conv.i_blocked) await api.del(`/api/chat/blocks/${conv.other.id}`);
    else await api.post('/api/chat/blocks', { user_id: conv.other.id });
    toast(conv.i_blocked ? 'User unblocked' : 'User blocked');
    reload();
  };

  const lastOwnSeen = useMemo(() => {
    if (!data) return null;
    const own = [...data.messages].reverse().find((m) => m.sender_id === user?.id && !m.pending);
    return own && new Date(data.conversation.other_last_read_at) >= new Date(own.created_at) ? own.id : null;
  }, [data, user?.id]);

  if (loading) return <div className="p-6"><RowsSkeleton n={6} /></div>;
  if (error || !data || !conv) return <ErrorState error={error} retry={reload} />;

  const blocked = conv.i_blocked || conv.blocked_me;
  const canSend = !blocked && user?.status === 'approved';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-4 h-16 border-b border-line bg-white shrink-0">
        <button onClick={() => nav('/messages')} className="md:hidden p-2 -ml-1" aria-label="Back to conversations"><ArrowLeft size={20} /></button>
        <div className="relative">
          <Avatar name={conv.other.name} src={conv.other.avatar_url} size={40} />
          {conv.other.online && <span className="absolute bottom-0 right-0 size-3 rounded-full bg-emerald-500 ring-2 ring-white" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate">{conv.other.name}</p>
          <p className="text-xs text-muted">{typing ? <span className="text-brand font-semibold">typing…</span> : conv.other.online ? 'Online' : conv.other.last_seen_at ? `Last seen ${timeAgo(conv.other.last_seen_at)}` : 'Offline'}</p>
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="p-2 rounded-full hover:bg-stone-100" aria-label="Conversation options" aria-expanded={menu}><MoreVertical size={20} /></button>
          {menu && (
            <div className="absolute right-0 mt-1 w-52 card shadow-xl p-1.5 z-20" onClick={() => setMenu(false)}>
              <button onClick={() => setBlockOpen(true)} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-stone-100 text-sm font-medium"><Ban size={16} /> {conv.i_blocked ? 'Unblock user' : 'Block user'}</button>
              <button onClick={() => setReport(true)} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-stone-100 text-sm font-medium text-red-600"><Flag size={16} /> Report conversation</button>
            </div>
          )}
        </div>
      </div>

      {/* Listing context */}
      <Link to={`/item/${conv.listing.slug}`} className="flex items-center gap-3 px-4 py-2.5 bg-stone-50 border-b border-line hover:bg-stone-100 shrink-0">
        {conv.listing.image ? <img src={conv.listing.image} alt="" className="size-10 rounded-lg object-cover" /> : <div className="size-10 rounded-lg bg-stone-200" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{conv.listing.title}</p>
          <p className="text-xs text-muted">{money(conv.listing.price, conv.listing.currency)}{conv.listing.status !== 'published' && <> · <span className="font-semibold">{conv.listing.status === 'sold' ? 'Sold' : 'No longer available'}</span></>}</p>
        </div>
        <span className="text-xs font-semibold text-brand">View</span>
      </Link>

      {/* Messages */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-1.5 bg-canvas"
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {data.has_more && (
          <div className="text-center mb-3"><button className="btn btn-outline btn-sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? <Spinner size={14} /> : 'Load earlier messages'}</button></div>
        )}
        {data.messages.length === 0 && <p className="text-center text-sm text-muted py-10">Say hello 👋 — messages are private between you and {conv.other.name}.</p>}
        {data.messages.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const prev = data.messages[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          return (
            <div key={m.id}>
              {newDay && <p className="text-center text-[11px] font-semibold text-muted my-3">{new Date(m.created_at).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] sm:max-w-[65%] rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'bg-brand text-white rounded-br-md' : 'bg-white border border-line rounded-bl-md'} ${m.pending ? 'opacity-70' : ''}`}>
                  {m.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block -mx-1.5 -mt-0.5 mb-1.5">
                      <img src={a.url} alt="Shared photo" loading="lazy" className="rounded-xl max-h-72 w-auto" />
                    </a>
                  ))}
                  {m.body && <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>}
                  <p className={`text-[10px] mt-0.5 flex items-center justify-end gap-1 ${mine ? 'text-white/75' : 'text-muted'}`}>
                    {clock(m.created_at)}
                    {mine && (m.pending ? <Spinner size={10} /> : m.id === lastOwnSeen ? <CheckCheck size={13} aria-label="Seen" /> : <Check size={13} aria-label="Sent" />)}
                  </p>
                </div>
              </div>
              {mine && m.id === lastOwnSeen && <p className="text-right text-[11px] text-muted mt-0.5 mr-1">Seen</p>}
            </div>
          );
        })}
        {typing && (
          <div className="flex"><div className="bg-white border border-line rounded-2xl px-4 py-3 flex gap-1" aria-label={`${conv.other.name} is typing`}>
            {[0, 1, 2].map((d) => <span key={d} className="size-1.5 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />)}
          </div></div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-white p-2.5 sm:p-3 shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {!canSend ? (
          <Notice tone="red" icon={Lock} title={conv.i_blocked ? 'You blocked this user' : conv.blocked_me ? 'You can no longer message this user' : 'Your account cannot send messages right now'} />
        ) : (
          <form onSubmit={send}>
            {file && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 py-1.5 text-sm">
                <ImageIcon size={16} /> <span className="truncate max-w-[200px]">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} aria-label="Remove image"><X size={14} /></button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="size-11 shrink-0 grid place-items-center rounded-xl hover:bg-stone-100 cursor-pointer text-ink-2" aria-label="Attach image">
                <ImagePlus size={22} />
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size > 8 * 1024 * 1024) toast('Images must be under 8 MB', 'error');
                  else setFile(f ?? null);
                  e.target.value = '';
                }} />
              </label>
              <textarea value={text} onChange={(e) => onType(e.target.value)} rows={1} maxLength={4000} placeholder="Write a message…" aria-label="Message"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) { e.preventDefault(); send(); } }}
                className="input min-h-11 max-h-36 resize-none py-2.5" />
              <button type="submit" disabled={sending || (!text.trim() && !file)} className="btn btn-primary size-11 p-0 shrink-0 rounded-xl" aria-label="Send">
                {sending ? <Spinner size={18} /> : <Send size={18} />}
              </button>
            </div>
          </form>
        )}
      </div>

      <ReportDialog open={report} onClose={() => setReport(false)} targetType="conversation" targetId={id} label="conversation" />
      <ConfirmDialog open={blockOpen} onClose={() => setBlockOpen(false)} onConfirm={toggleBlock}
        title={conv.i_blocked ? `Unblock ${conv.other.name}?` : `Block ${conv.other.name}?`} danger={!conv.i_blocked}
        body={conv.i_blocked ? 'You will be able to message each other again.' : "Neither of you will be able to send messages in any conversation. They won't be notified."}
        confirmLabel={conv.i_blocked ? 'Unblock' : 'Block'} />
    </div>
  );
}

export default function Messages() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const { data, error, loading, reload, setData } = useFetch<{ items: ConvItem[] }>('/api/chat/conversations');
  const [filter, setFilter] = useState('all');
  usePageMeta('Messages');

  const onActivity = useCallback(() => {
    reload();
    refresh();
  }, [reload, refresh]);

  useSocketEvent<Msg>('message:new', (m) => {
    setData((d) => {
      if (!d) return d;
      const c = d.items.find((x) => x.id === m.conversation_id);
      if (!c) {
        reload();
        return d;
      }
      const updated: ConvItem = {
        ...c,
        last_message: { body: m.body, from_me: m.sender_id === user?.id, created_at: m.created_at, has_attachment: m.attachments.length > 0 },
        unread: m.sender_id !== user?.id && m.conversation_id !== id ? c.unread + 1 : c.unread,
      };
      return { items: [updated, ...d.items.filter((x) => x.id !== c.id)] };
    });
  });
  useSocketEvent<{ user_id: string; online: boolean }>('presence', (p) =>
    setData((d) => d && { items: d.items.map((c) => (c.other.id === p.user_id ? { ...c, other: { ...c.other, online: p.online } } : c)) }),
  );

  return (
    <div className="md:container-page md:py-6">
      <div className={`md:card md:overflow-hidden grid grid-rows-[minmax(0,1fr)] md:grid-cols-[340px_1fr] ${id ? 'h-[100dvh]' : 'h-[calc(100dvh-4.25rem)]'} md:h-[calc(100dvh-10rem)] bg-white`}>
        <aside className={`${id ? 'hidden md:flex' : 'flex'} flex-col border-r border-line min-h-0 min-w-0 pb-16 md:pb-0`}>
          {loading ? <div className="p-4"><RowsSkeleton /></div> : error ? <ErrorState error={error} retry={reload} /> : (
            <ConversationList items={data!.items} activeId={id} filter={filter} setFilter={setFilter} />
          )}
        </aside>
        <section className={`${id ? 'flex' : 'hidden md:flex'} flex-col min-h-0 min-w-0`}>
          {id ? <Thread key={id} id={id} onActivity={onActivity} /> : (
            <div className="m-auto"><EmptyState icon={MessageCircle} title="Select a conversation" body="Choose a chat on the left to start messaging." /></div>
          )}
        </section>
      </div>
    </div>
  );
}
