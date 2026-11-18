/** SaudaGo brand mark (map pin with two "go" chevrons) and wordmark. */

const TEAL = '#0E5C4B';
const CREAM = '#FBF5E9';
const GOLD = '#F5A623';
const GOLD_ON_LIGHT = '#D9780A';

export function BrandMark({ size = 36, reversed = false, className = '' }: { size?: number; reversed?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 120 140" width={size} height={Math.round((size * 140) / 120)} className={className} aria-hidden="true" focusable="false">
      <path d="M60 4C32 4 10 26 10 54c0 36 50 84 50 84s50-48 50-84C110 26 88 4 60 4z" fill={reversed ? CREAM : TEAL} />
      <path d="M38 38l19 16-19 16" fill="none" stroke={reversed ? TEAL : CREAM} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 38l19 16-19 16" fill="none" stroke={reversed ? '#E8930C' : GOLD} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandWordmark({ reversed = false, className = '' }: { reversed?: boolean; className?: string }) {
  return (
    <span className={`font-extrabold leading-none tracking-[-0.035em] ${className}`} style={{ color: reversed ? CREAM : TEAL }}>
      Sauda<span style={{ color: reversed ? GOLD : GOLD_ON_LIGHT }}>Go</span>
    </span>
  );
}

export function BrandLogo({ reversed = false, markSize = 30, textClass = 'text-[26px]', className = '' }: { reversed?: boolean; markSize?: number; textClass?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={markSize} reversed={reversed} />
      <BrandWordmark reversed={reversed} className={textClass} />
    </span>
  );
}
