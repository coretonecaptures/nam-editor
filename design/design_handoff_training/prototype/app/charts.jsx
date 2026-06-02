// charts.jsx — SVG chart primitives for the Trainer. Theme-agnostic, no deps.
// Tracks read --chart-track; lines take explicit colors.
const { useId } = React;

function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, endDeg), e = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

// Donut — proportional ring with a center label slot.
function Donut({ segments, size = 116, thickness = 14, gap = 2.5, track = 'var(--chart-track)', children }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = Math.max(frac * c - gap, 0);
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color}
              strokeWidth={thickness} strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset * c} />
          );
          offset += frac;
          return el;
        })}
      </svg>
      {children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1 }}>{children}</div>
      )}
    </div>
  );
}

// ProgressRing — full-circle progress 0..100.
function ProgressRing({ value, size = 58, thickness = 6, color = 'var(--accent)', track = 'var(--chart-track)', children }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const len = (Math.min(Math.max(value, 0), 100) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeLinecap="round" strokeDasharray={`${len} ${c - len}`}
          style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      {children && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>}
    </div>
  );
}

// Sparkline — tiny line + soft fill.
function Sparkline({ data, color = 'var(--accent)', width = 120, height = 30, strokeWidth = 1.75, fill = true }) {
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - strokeWidth * 2) - strokeWidth;
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const id = useId();
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (<><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.26" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs><path d={area} fill={`url(#${id})`} /></>)}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// EsrCurve — ESR (or loss) vs epoch. Descending curve, optional target line.
// variant: 'area' | 'line' | 'minimal'
function EsrCurve({ data, color = 'var(--accent)', width = 640, height = 240, target = null,
  labels = true, variant = 'area', logScale = true }) {
  const id = useId();
  const pad = { t: 16, r: 16, b: 26, l: 44 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const vals = data.map(d => logScale ? Math.log10(Math.max(d.esr, 1e-5)) : d.esr);
  const allRef = target != null && logScale ? [...vals, Math.log10(target)] : [...vals, ...(target != null ? [target] : [])];
  const vmax = Math.max(...allRef), vmin = Math.min(...allRef);
  const range = (vmax - vmin) || 1;
  const padFrac = 0.12;
  const lo = vmin - range * padFrac, hi = vmax + range * padFrac;
  const span = hi - lo || 1;
  const n = data.length;
  const X = i => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const Y = v => pad.t + h - ((v - lo) / span) * h;
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${X(n - 1)} ${pad.t + h} L${pad.l} ${pad.t + h} Z`;
  // y gridlines: pick 4 esr ticks
  const ticks = logScale
    ? [0.001, 0.005, 0.01, 0.05, 0.1].filter(t => Math.log10(t) >= lo && Math.log10(t) <= hi)
    : Array.from({ length: 4 }, (_, i) => vmin + (range * (i + 1)) / 4);
  const tgtY = target != null ? Y(logScale ? Math.log10(target) : target) : null;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      {/* y ticks */}
      {ticks.map((t, i) => {
        const yy = Y(logScale ? Math.log10(t) : t);
        return (
          <g key={i}>
            <line x1={pad.l} y1={yy} x2={pad.l + w} y2={yy} stroke="currentColor" opacity={0.1} strokeWidth="1" strokeDasharray="2 4" />
            {labels && <text x={pad.l - 8} y={yy + 3} fill="currentColor" opacity={0.42} fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">{t < 0.01 ? t.toFixed(3) : t.toFixed(2)}</text>}
          </g>
        );
      })}
      {/* target line */}
      {tgtY != null && (<g>
        <line x1={pad.l} y1={tgtY} x2={pad.l + w} y2={tgtY} stroke="#10b981" opacity={0.7} strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={pad.l + w} y={tgtY - 6} fill="#10b981" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">target {target}</text>
      </g>)}
      {variant === 'area' && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={variant === 'minimal' ? 1.75 : 2.25} strokeLinejoin="round" strokeLinecap="round" />
      {variant !== 'minimal' && last && (<>
        <circle cx={last[0]} cy={last[1]} r={4.5} fill={color} />
        <circle cx={last[0]} cy={last[1]} r={9} fill={color} opacity={0.18}><animate attributeName="r" values="6;11;6" dur="1.8s" repeatCount="indefinite" /></circle>
      </>)}
      {labels && <text x={pad.l} y={height - 4} fill="currentColor" opacity={0.4} fontSize="10">epoch 0</text>}
      {labels && <text x={pad.l + w} y={height - 4} fill="currentColor" opacity={0.4} fontSize="10" textAnchor="end">{data[n - 1] ? `epoch ${data[n - 1].epoch}` : ''}</text>}
    </svg>
  );
}

// Burndown — remaining queue vs done, two stacked-ish lines over time.
function Burndown({ remaining, done, color = 'var(--accent)', width = 360, height = 130 }) {
  const id = useId();
  const pad = { t: 12, b: 18, l: 8, r: 8 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const n = remaining.length;
  const max = Math.max(...remaining, ...done, 1);
  const X = i => pad.l + (i / (n - 1)) * w;
  const Y = v => pad.t + h - (v / max) * h;
  const mk = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const remLine = mk(remaining);
  const remArea = `${remLine} L${X(n - 1)} ${pad.t + h} L${pad.l} ${pad.t + h} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.24" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={remArea} fill={`url(#${id})`} />
      <path d={mk(done)} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <path d={remLine} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ThroughputArea — generic area chart (models/hour, it/s history).
function ThroughputArea({ data, color = 'var(--accent)', width = 360, height = 130, labels }) {
  const id = useId();
  const pad = { t: 12, b: 18 };
  const max = Math.max(...data) * 1.12 || 1, n = data.length;
  const w = width, h = height - pad.t - pad.b;
  const pts = data.map((v, i) => [(i / (n - 1)) * w, pad.t + h - (v / max) * h]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w} ${pad.t + h} L0 ${pad.t + h} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      {[1, 2, 3].map(i => { const y = pad.t + (h / 3) * i; return <line key={i} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" opacity={0.1} strokeWidth="1" strokeDasharray="2 4" />; })}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} />}
      {labels && labels.map((lb, i) => (i % 2 === 0 || i === n - 1) ?
        <text key={i} x={(i / (n - 1)) * w} y={height - 2} fill="currentColor" opacity={0.45} fontSize="9" textAnchor="middle">{lb}</text> : null)}
    </svg>
  );
}

// QualityBars — ESR quality distribution: vertical green/amber/red bars per session/day.
function QualityBars({ groups, width = 360, height = 150, max }) {
  const pad = { t: 10, b: 22 };
  const h = height - pad.t - pad.b;
  const m = max || Math.max(...groups.map(g => g.green + g.amber + g.red), 1);
  const bw = width / groups.length;
  const colW = Math.min(bw * 0.5, 26);
  const seg = [['green', '#10b981'], ['amber', '#f59e0b'], ['red', '#ef4444']];
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {groups.map((g, i) => {
        const cx = i * bw + bw / 2;
        let yTop = pad.t + h;
        return (
          <g key={i}>
            {seg.map(([k, c]) => {
              const v = g[k]; if (!v) return null;
              const segH = (v / m) * h;
              yTop -= segH;
              return <rect key={k} x={cx - colW / 2} y={yTop} width={colW} height={Math.max(segH - 1.5, 0)} rx="2" fill={c} />;
            })}
            <text x={cx} y={height - 7} fill="currentColor" opacity={0.5} fontSize="9.5" textAnchor="middle">{g.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// StackedMeter — horizontal stacked proportion bar.
function StackedMeter({ segments, height = 12, radius = 6, gap = 1.5 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{ display: 'flex', height, borderRadius: radius, overflow: 'hidden', gap, background: 'var(--field)' }}>
      {segments.map((seg, i) => seg.value > 0 ? (
        <div key={i} title={seg.label} style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }} />
      ) : null)}
    </div>
  );
}

Object.assign(window, { Donut, ProgressRing, Sparkline, EsrCurve, Burndown, ThroughputArea, QualityBars, StackedMeter });
