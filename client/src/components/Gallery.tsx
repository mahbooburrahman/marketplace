import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Expand, ImageOff } from 'lucide-react';

interface Img { id: string; url: string; thumb: string }

export function Gallery({ images, title }: { images: Img[]; title: string }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const touch = useRef<number | null>(null);
  const n = images.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', k);
      document.body.style.overflow = '';
    };
  });

  if (!n) return <div className="aspect-[4/3] rounded-2xl bg-stone-100 grid place-items-center text-stone-400"><ImageOff size={40} /></div>;

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => (touch.current = e.touches[0]!.clientX),
    onTouchEnd: (e: React.TouchEvent) => {
      if (touch.current === null) return;
      const dx = e.changedTouches[0]!.clientX - touch.current;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      touch.current = null;
    },
  };
  const arrows = n > 1 && (
    <>
      <button onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white/90 shadow grid place-items-center hover:bg-white"><ChevronLeft size={20} /></button>
      <button onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white/90 shadow grid place-items-center hover:bg-white"><ChevronRight size={20} /></button>
    </>
  );

  return (
    <div>
      <div className="relative aspect-[4/3] sm:rounded-2xl overflow-hidden bg-stone-900 select-none" {...swipe}>
        <img src={images[i]!.url} alt={`${title} — photo ${i + 1} of ${n}`} className="size-full object-contain" />
        {arrows}
        <button onClick={() => setFull(true)} aria-label="View full screen" className="absolute right-2 bottom-2 size-9 rounded-full bg-black/50 text-white grid place-items-center"><Expand size={16} /></button>
        {n > 1 && <span className="absolute left-3 bottom-3 rounded-full bg-black/55 text-white text-xs font-semibold px-2.5 py-1">{i + 1} / {n}</span>}
      </div>
      {n > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar px-4 sm:px-0">
          {images.map((im, k) => (
            <button key={im.id} onClick={() => setI(k)} aria-label={`Show photo ${k + 1}`}
              className={`size-16 shrink-0 rounded-lg overflow-hidden ring-2 transition ${k === i ? 'ring-brand' : 'ring-transparent opacity-70 hover:opacity-100'}`}>
              <img src={im.thumb} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {full && (
        <div className="fixed inset-0 z-[95] bg-black flex items-center justify-center" role="dialog" aria-label="Photo viewer" {...swipe}>
          <img src={images[i]!.url} alt={`${title} — photo ${i + 1}`} className="max-h-full max-w-full object-contain" />
          {arrows}
          <button onClick={() => setFull(false)} aria-label="Close" className="absolute top-4 right-4 size-11 rounded-full bg-white/15 text-white grid place-items-center"><X size={22} /></button>
        </div>
      )}
    </div>
  );
}
