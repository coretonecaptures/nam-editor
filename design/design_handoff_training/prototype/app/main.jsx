// main.jsx — app shell, footprints, live simulation, tweaks wiring.
const { useState, useEffect, useRef } = React;

const ACCENTS = [
  { id: 'indigo', hex: '#6366f1' }, { id: 'violet', hex: '#8b5cf6' },
  { id: 'sky', hex: '#3b82f6' }, { id: 'emerald', hex: '#10b981' }, { id: 'orange', hex: '#f97316' },
];
const accentHex = id => (ACCENTS.find(a => a.id === id) || ACCENTS[0]).hex;
const hexToAccent = hex => (ACCENTS.find(a => a.hex === hex) || ACCENTS[0]).id;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "charcoal",
  "accent": "indigo",
  "chip": "soft",
  "footprint": "workspace",
  "density": "regular",
  "queueStyle": "rows",
  "chartStyle": "area",
  "nowStrip": true
}/*EDITMODE-END*/;

/* ---------- toolbar / status chrome ---------- */
function Toolbar() {
  return (
    <div className="toolbar">
      <div className="brand"><span className="brand-logo"><Icon name="wave" size={16} stroke={2.2} /></span><span className="brand-name">NAM Lab</span></div>
      <button className="tb-btn">Actions <Icon name="chevronDown" size={13} className="cv" /></button>
      <div className="tb-sep" />
      <span className="icon-btn"><Icon name="grid" size={15} /></span>
      <span className="icon-btn"><Icon name="list" size={15} /></span>
      <div className="tb-right">
        <button className="tb-btn"><Icon name="chart" size={15} /> Overview</button>
        <button className="tb-btn on"><Icon name="flask" size={15} /> Training</button>
        <button className="tb-btn"><Icon name="search" size={15} /> Find Tones</button>
        <button className="tb-btn"><Icon name="help" size={15} /> Help</button>
        <button className="tb-btn"><Icon name="settings" size={15} /> Settings</button>
        <div className="win-ctrls">
          <span className="wc"><Icon name="win_min" size={14} /></span>
          <span className="wc"><Icon name="win_max" size={12} /></span>
          <span className="wc close"><Icon name="x" size={14} /></span>
        </div>
      </div>
    </div>
  );
}
function StatusBar({ sim }) {
  return (
    <div className="statusbar">
      <span className={`sb-dot${sim.running ? ' run' : ''}`} />
      <span>{sim.running ? `Training · ${window.TRAINER.session.queuedCount} queued` : 'Trainer idle'}</span>
      <div className="tb-sep" style={{ margin: '0 8px' }} />
      <span className="sb-tag">Python · nam-trainer 0.10.1</span>
      <span className="sb-tag">GPU · CUDA available</span>
      <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>0.6.1-beta4</span>
    </div>
  );
}

/* ---------- faux background panels (panel2 / modal footprints) ---------- */
function FauxTree() {
  const rows = ['AMALGAM Audio', '70s Silver Prince', 'Jose CAB REVxSTD', 'Marshall JCM Pack', 'Friedman BE', 'Vox AC30', 'Mesa Mark IV'];
  return (
    <div className="faux-tree">
      <div className="faux-row" style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 700, letterSpacing: '.5px' }}>LIBRARY</div>
      {rows.map((r, i) => <div className="faux-row" key={i}><Icon name="folder" size={14} className="fr-ic" />{r}</div>)}
    </div>
  );
}
function FauxList() {
  return <div className="faux-list">{Array.from({ length: 6 }).map((_, i) => <div className="faux-card" key={i} />)}</div>;
}

/* ---------- the workspace ---------- */
function Workspace({ section, setSection, sim, ctrl, t, setTweak, onPlot }) {
  return (
    <div className="ws">
      <Rail section={section} setSection={setSection} t={t} sim={sim} />
      <div className="ws-main">
        {t.nowStrip && <NowStrip sim={sim} ctrl={ctrl} />}
        <div className="ws-content">
          {section === 'live' && <LiveRun sim={sim} t={t} />}
          {section === 'queue' && <QueueView t={t} setTweak={setTweak} />}
          {section === 'history' && <HistoryView t={t} onPlot={onPlot} />}
          {section === 'new' && <NewRun t={t} />}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [section, setSection] = useState('live');
  const [plot, setPlot] = useState(null);

  // live simulation state
  const [sim, setSim] = useState(() => ({
    running: true, paused: false,
    epoch: 100, rate: 34.69, esr: 0.0091,
    curve: window.TRAINER.liveCurve.slice(),
  }));

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', t.theme);
    r.setAttribute('data-accent', t.accent);
    r.setAttribute('data-chip', t.chip);
    // reflow fix for theme-driven var() transitions
    const root = document.getElementById('root');
    if (root) { root.style.display = 'none'; void root.offsetHeight; root.style.display = ''; }
  }, [t.theme, t.accent, t.chip]);

  // tick the live run
  useEffect(() => {
    if (!sim.running) return;
    const id = setInterval(() => {
      setSim(prev => {
        if (!prev.running) return prev;
        let epoch = prev.epoch + 7;
        if (epoch >= 1000) epoch = 1000;
        const rate = 33 + Math.random() * 3.5;
        const floor = 0.0072;
        const nextEsr = Math.max(floor, prev.esr * (0.985 + Math.random() * 0.02) - 0.00004);
        const curve = prev.curve.slice();
        if (epoch - (curve[curve.length - 1]?.epoch || 0) >= 30) curve.push({ epoch, esr: nextEsr });
        return { ...prev, epoch, rate, esr: nextEsr, curve, running: epoch < 1000 };
      });
    }, 1100);
    return () => clearInterval(id);
  }, [sim.running]);

  // expose for queue rows
  window.SIM_EPOCH = sim.epoch; window.SIM_RATE = sim.rate;

  const ctrl = {
    stop: () => setSim(s => ({ ...s, running: false, paused: false })),
    pause: () => setSim(s => ({ ...s, running: false, paused: true })),
    resume: () => setSim(s => ({ ...s, running: true, paused: false, epoch: s.epoch >= 1000 ? 100 : s.epoch })),
    retry: () => {},
  };

  const wsProps = { section, setSection, sim, ctrl, t, setTweak, onPlot: setPlot };

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body" data-density={t.density}>
        {t.footprint === 'workspace' && <Workspace {...wsProps} />}
        {t.footprint === 'panel2' && <><FauxTree /><Workspace {...wsProps} /></>}
        {t.footprint === 'modal' && (
          <>
            <FauxTree /><FauxList />
            <div className="modal-bg">
              <div className="modal-shell"><Workspace {...wsProps} /></div>
            </div>
          </>
        )}
      </div>
      <StatusBar sim={sim} />

      {plot && (
        <div className="plot-modal-bg" onClick={() => setPlot(null)}>
          <div className="plot-modal" onClick={e => e.stopPropagation()}>
            <div className="card-head"><Icon name="image" size={15} className="ch-ic" /><span className="ch-title">{plot.name}</span><span className="ch-spacer" /><EsrBadge esr={plot.esr} /><span className="icon-btn" onClick={() => setPlot(null)}><Icon name="x" size={16} /></span></div>
            <FullEsrPlot name={plot.name} esr={plot.esr} tone={esrTone(plot.esr)} />
          </div>
        </div>
      )}

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakRadio label="Footprint" value={t.footprint} options={['workspace', 'panel2', 'modal']} onChange={v => setTweak('footprint', v)} />
        <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'spacious']} onChange={v => setTweak('density', v)} />
        <TweakToggle label="Now-Training strip" value={t.nowStrip} onChange={v => setTweak('nowStrip', v)} />
        <TweakSection label="Queue & charts" />
        <TweakRadio label="Queue style" value={t.queueStyle} options={['rows', 'cards', 'kanban']} onChange={v => setTweak('queueStyle', v)} />
        <TweakRadio label="Chart style" value={t.chartStyle} options={['area', 'line', 'minimal']} onChange={v => setTweak('chartStyle', v)} />
        <TweakSection label="Appearance (app settings)" />
        <TweakRadio label="Theme" value={t.theme} options={['charcoal', 'dark', 'midnight', 'blue', 'light']} onChange={v => setTweak('theme', v)} />
        <TweakColor label="Accent" value={accentHex(t.accent)} options={ACCENTS.map(a => a.hex)} onChange={hex => setTweak('accent', hexToAccent(hex))} />
        <TweakRadio label="Chip style" value={t.chip} options={['soft', 'solid', 'minimal']} onChange={v => setTweak('chip', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
