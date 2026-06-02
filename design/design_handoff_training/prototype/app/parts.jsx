// parts.jsx — shared helpers + small components for the Trainer UI.

function esrTone(esr) {
  if (esr == null) return 'none';
  if (esr < 0.01) return 'green';
  if (esr < 0.05) return 'amber';
  return 'red';
}
function esrFmt(esr) { return esr == null ? '—' : esr.toFixed(4); }
const ARCH_LABELS = { standard: 'Standard', complex: 'Complex', lite: 'Lite', feather: 'Feather', nano: 'Nano', revystd: 'REVySTD', revyhi: 'REVyHI', revxstd: 'REVxSTD', a2: 'A2 Packed' };

function EsrBadge({ esr }) {
  const tone = esrTone(esr);
  return <span className={`esr-badge ${tone}`}><span className="ed-dot" />{esr == null ? 'no ESR' : esr.toFixed(4)}</span>;
}
function StatusPill({ status }) {
  const label = { queued: 'Queued', running: 'Running', success: 'Done', error: 'Failed', canceled: 'Canceled', starting: 'Starting' }[status] || status;
  return <span className={`spill ${status}`}><span className="sp-dot" />{label}</span>;
}
function ArchChip({ arch }) { return <span className="archchip">{ARCH_LABELS[arch] || arch}</span>; }
function ProfChip({ name }) { return <span className="profchip">{name}</span>; }

function elapsed(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// Mini ESR plot — used as the history thumbnail. A tiny descending curve.
function MiniEsrPlot({ tone = 'green', seed = 3 }) {
  const color = tone === 'green' ? '#10b981' : tone === 'amber' ? '#f59e0b' : '#ef4444';
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const n = 18, w = 44, h = 34, pad = 3;
  const pts = Array.from({ length: n }, (_, i) => {
    const frac = i / (n - 1);
    const base = 0.1 + 0.85 * Math.exp(-3.2 * frac);
    const v = Math.max(base + base * 0.08 * (rnd() - 0.5), 0.04);
    return [pad + frac * (w - pad * 2), pad + v * (h - pad * 2)];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="esr-plot" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={`${line} L${w - pad} ${h - pad} L${pad} ${h - pad} Z`} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Full ESR plot (mimics the trainer's saved matplotlib PNG) for the plot modal.
function FullEsrPlot({ name, esr, tone }) {
  const color = tone === 'green' ? '#10b981' : tone === 'amber' ? '#f59e0b' : '#ef4444';
  const W = 720, H = 380, m = { t: 40, r: 30, b: 46, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  let s = 11; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const n = 60;
  // two traces: target (output) and prediction overlapping
  const pred = Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1);
    return Math.sin(x * 22) * 0.6 * Math.exp(-x * 0.4) + Math.sin(x * 7) * 0.3 + (rnd() - 0.5) * 0.05;
  });
  const tgt = pred.map((v, i) => v + (rnd() - 0.5) * (esr ? esr * 8 : 0.04));
  const X = i => m.l + (i / (n - 1)) * iw;
  const Y = v => m.t + ih / 2 - v * (ih / 2.6);
  const mk = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: 'var(--panel)' }}>
      <text x={W / 2} y={24} fill="var(--text)" fontSize="15" fontWeight="600" textAnchor="middle">{name}</text>
      {[0, 1, 2, 3, 4].map(i => { const y = m.t + (ih / 4) * i; return <line key={i} x1={m.l} y1={y} x2={m.l + iw} y2={y} stroke="var(--border-soft)" strokeWidth="1" />; })}
      <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke="var(--border)" strokeWidth="1" />
      <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke="var(--border)" strokeWidth="1" />
      <path d={mk(tgt)} fill="none" stroke="var(--text-3)" strokeWidth="2" opacity="0.6" />
      <path d={mk(pred)} fill="none" stroke={color} strokeWidth="1.6" />
      <text x={m.l} y={H - 14} fill="var(--text-3)" fontSize="11" fontFamily="var(--font-mono)">time (samples)</text>
      <text x={m.l + iw} y={H - 14} fill="var(--text-2)" fontSize="12" fontFamily="var(--font-mono)" textAnchor="end">ESR = {esr == null ? 'n/a' : esr.toFixed(5)}</text>
      <g transform={`translate(${m.l + 14},${m.t + 12})`}>
        <rect x="-8" y="-12" width="150" height="40" rx="6" fill="var(--field)" opacity="0.9" />
        <line x1="0" y1="-2" x2="18" y2="-2" stroke="var(--text-3)" strokeWidth="2" /><text x="24" y="2" fill="var(--text-2)" fontSize="10.5">target</text>
        <line x1="0" y1="14" x2="18" y2="14" stroke={color} strokeWidth="2" /><text x="24" y="18" fill="var(--text-2)" fontSize="10.5">prediction</text>
      </g>
    </svg>
  );
}

// generic icon button used in rows
function IconBtn({ name, title, onClick, danger, size = 15 }) {
  return (
    <span className="icon-btn" title={title} onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      style={danger ? { color: '#f87171' } : undefined}>
      <Icon name={name} size={size} />
    </span>
  );
}

// HelpPopover — the small "?" affordance used across the real TrainingPanel.
function HelpPopover({ title, children, side = 'right' }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span className="help-pop" ref={ref}>
      <button type="button" className="help-dot" tabIndex={-1} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>?</button>
      {open && (
        <div className={`help-bubble ${side}`}>
          {title && <div className="help-title">{title}</div>}
          <div className="help-body">{children}</div>
        </div>
      )}
    </span>
  );
}

Object.assign(window, { esrTone, esrFmt, ARCH_LABELS, EsrBadge, StatusPill, ArchChip, ProfChip, elapsed, MiniEsrPlot, FullEsrPlot, IconBtn, HelpPopover });
