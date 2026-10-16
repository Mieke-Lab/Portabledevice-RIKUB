import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wheat } from 'lucide-react';

function Sprout({ className, style }) {
  // Small sprout standing on the track (base at bottom of the viewBox).
  return (
    <svg className={className} style={style} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 31 V16" stroke="#15803d" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 20 C9 20 6 15 6 11 C12 11 16 14 16 20 Z" fill="#22c55e" />
      <path d="M16 17 C23 17 26 11 26 7 C19 7 16 11 16 17 Z" fill="#15803d" />
    </svg>
  );
}

function Snail({ className }) {
  return (
    <svg className={className} viewBox="0 0 96 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* foot / body */}
      <path d="M10 52 Q8 44 18 44 H74 Q90 44 86 55 Q85 59 79 59 H16 Q10 59 10 52 Z" fill="#6f9080" />
      {/* neck + head */}
      <path d="M70 46 Q80 46 82 34 Q83 26 76 24 Q70 23 69 30 L70 46 Z" fill="#7ba089" />
      <circle cx="78" cy="26" r="7" fill="#7ba089" />
      {/* eye stalks (wiggle) */}
      <g className="snail-antennae">
        <line x1="76" y1="21" x2="73" y2="9" stroke="#6f9080" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="81" y1="21" x2="85" y2="9" stroke="#6f9080" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="72" cy="8" r="3.2" fill="#fff" /><circle cx="72" cy="8" r="1.4" fill="#2f3e37" />
        <circle cx="86" cy="8" r="3.2" fill="#fff" /><circle cx="86" cy="8" r="1.4" fill="#2f3e37" />
      </g>
      {/* smile */}
      <path d="M74 30 Q78 33 82 30" stroke="#2f3e37" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      {/* shell */}
      <circle cx="34" cy="32" r="21" fill="#2f3e37" />
      <path d="M34 32 m-13 0 a13 13 0 1 1 26 0 a13 13 0 1 1 -26 0" stroke="#4b6357" strokeWidth="2.6" fill="none" />
      <path d="M34 32 m-7 0 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0" stroke="#4b6357" strokeWidth="2.4" fill="none" />
      <path d="M24 22 q6 -5 12 -2" stroke="#ca8a04" strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const STEPS = [
  { at: 0, text: 'Menyiapkan sistem…' },
  { at: 30, text: 'Memuat peta sawah…' },
  { at: 60, text: 'Menghubungkan sensor…' },
  { at: 85, text: 'Hampir siap…' },
  { at: 100, text: 'Siap!' },
];

export function Splash() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(id);
          setTimeout(() => navigate('/menu'), 600);
          return 100;
        }
        return p + 1;
      });
    }, 32);
    return () => clearInterval(id);
  }, [navigate]);

  const msg = [...STEPS].reverse().find((s) => progress >= s.at)?.text ?? '';
  const done = progress >= 100;

  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="w-[min(640px,84vw)] px-6">
        {/* wordmark */}
        <div className="mb-9 flex flex-col items-center gap-1.5">
          <Wheat className="h-11 w-11 text-forest" strokeWidth={2} />
          <h1 className="text-3xl font-bold tracking-tight text-forest">Jaga Padi</h1>
          <p className="text-[11px] font-semibold uppercase tracking-[2px] text-muted-foreground">Smart Rice Field Monitoring</p>
        </div>

        {/* scene: tall enough so the snail rides ON the track */}
        <div className="relative h-16">
          {/* track pinned to the bottom */}
          <div className="absolute inset-x-0 bottom-0 h-4 rounded-full bg-primary/10 shadow-inner">
            <div className="h-full rounded-full bg-gradient-to-r from-forest/80 to-leaf transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }} />
          </div>
          {/* ground shadow under the track */}
          <div className="absolute inset-x-0 -bottom-1.5 mx-auto h-2 rounded-[100%] bg-forest/10 blur-md" />

          {/* goal sprout standing on the track at the finish line */}
          <Sprout className="absolute right-0 bottom-2.5 h-8 w-8" style={{ transformOrigin: 'bottom center', ...(done ? { animation: 'goal-pop 0.6s ease-in-out infinite' } : {}) }} />

          {/* snail sitting on the fill edge */}
          <div className="absolute bottom-2.5 -translate-x-1/2 transition-[left] duration-100 ease-linear"
            style={{ left: `${progress}%` }}>
            <Snail className={`h-12 w-12 drop-shadow ${done ? '' : 'snail-bob'}`} />
          </div>
        </div>

        {/* status */}
        <div className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-forest">
          <span>{msg}</span>
          <span className="tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
