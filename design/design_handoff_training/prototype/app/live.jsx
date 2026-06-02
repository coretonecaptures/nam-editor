// live.jsx — Rail, persistent Now-Training strip, and Live Run view.
const { useState: useStateL } = React;

function Rail({ section, setSection, t, sim }) {
  const [wfOpen, setWfOpen] = useStateL(false);
  const D = window.TRAINER;
  const s = D.session;
  const nav = [
    { id: 'live', label: 'Live Run', icon: 'activity', count: sim.running ? 1 : 0, run: sim.running },
    { id: 'queue', label: 'Queue', icon: 'list', count: s.queuedCount },
    { id: 'history', label: 'History', icon: 'clock', count: D.hist.reduce((a, g) => a + g.entries.length, 0) },
    { id: 'new', label: 'New Run', icon: 'plus', count: null },
  ];
  return (
    <div className="ws-rail">
      <div className="rail-head">
        <div className="rail-eyebrow">NAM Lab</div>
        <div className="rail-title"><Icon name="flask" size={18} className="flask" />Local Training</div>
      </div>
      <div className="rail-nav">
        {nav.map(n => (
          <button key={n.id} className={`rail-item${section === n.id ? ' on' : ''}`} onClick={() => setSection(n.id)}>
            <Icon name={n.icon} size={16} className="ri-ic" />
            <span className="ri-label">{n.label}</span>
            {n.count != null && n.count > 0 && <span className={`rail-count${n.run ? ' run' : ''}`}>{n.count}</span>}
          </button>
        ))}
      </div>
      <div className="rail-sep" />
      <div className="rail-scroll">
        <div className="rail-section-label">This Session</div>
        <div className="rail-stats">
          <div className="rail-stat">
            <div className="rail-stat-row"><span className="rail-stat-label">Completed today</span><span className="rail-stat-value green">{s.doneToday}</span></div>
          </div>
          <div className="rail-stat">
            <div className="rail-stat-row"><span className="rail-stat-label">Avg ESR</span><span className="rail-stat-value mono">{s.avgEsr.toFixed(4)}</span></div>
          </div>
          <div className="rail-stat">
            <div className="rail-stat-row"><span className="rail-stat-label">Throughput</span><span className="rail-stat-value mono">{s.modelsPerHour}<small>/hr</small></span></div>
          </div>
          <div className="rail-stat">
            <div className="rail-stat-row"><span className="rail-stat-label">Failed today</span><span className="rail-stat-value mono" style={{ color: s.failedToday ? '#f87171' : undefined }}>{s.failedToday}</span></div>
          </div>
        </div>

        <div className="wf-wrap">
          <div className={`wf-head${wfOpen ? ' open' : ''}`} onClick={() => setWfOpen(o => !o)}>
            <Icon name="folderOpen" size={14} />
            Watch Folders
            <span className="wf-badge skip" style={{ marginLeft: 4 }}>{D.watchFolders.reduce((a, w) => a + w.pending, 0)} pending</span>
            <Icon name="chevronDown" size={14} className="wf-chev" />
          </div>
          {wfOpen && (
            <div className="wf-body">
              {D.watchFolders.map((w, i) => (
                <div className="wf-item" key={i}>
                  <span className={`wf-led${w.running ? ' run' : ''}`} />
                  <span className="wf-name" title={w.path}>{w.name}</span>
                  {w.pending > 0 && <span className="wf-badge run">{w.pending}</span>}
                  {w.skipped > 0 && <span className="wf-badge skip">{w.skipped} skip</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NowStrip({ sim, ctrl }) {
  const j = window.TRAINER.liveJob;
  const running = sim.running;
  const pct = (sim.epoch / j.progressEpochTotal) * 100;
  const tone = esrTone(sim.esr);
  const etaMin = Math.max(0, Math.round(((j.progressEpochTotal - sim.epoch) / Math.max(sim.rate, 1)) * j.progressBatchTotal / 60));
  return (
    <div className="now-strip">
      <div className="now-top">
        <div className="now-id">
          <div className="now-thumb"><Icon name="cpu" size={20} /></div>
          <div className="now-meta">
            <div className="now-name">{running ? j.modelName : 'No active run'}</div>
            <div className="now-sub">
              {running ? <>
                <ArchChip arch={j.architecture} />
                <ProfChip name={j.profileName} />
                <span>model {window.TRAINER.session.totalInSubmission - window.TRAINER.session.queuedCount} of {window.TRAINER.session.totalInSubmission}</span>
                <span className="sep">·</span>
                <span className="mono" title={j.outputPath}>…/{j.outputPath.split('/').slice(-1)[0]}</span>
              </> : <span>Queue is idle — start a run from New Run or the queue.</span>}
            </div>
          </div>
        </div>
        <span className={`live-badge${running ? '' : ' idle'}`}>
          <span className={`live-dot${running ? ' pulse' : ''}`} />{running ? 'Running' : sim.paused ? 'Paused' : 'Idle'}
        </span>
        <div className="ctrl-bar">
          <button className="ctrl-btn danger" onClick={ctrl.stop} disabled={!running && !sim.paused}><Icon name="zap" size={14} />Emergency stop</button>
          {running
            ? <button className="ctrl-btn" onClick={ctrl.pause}><Icon name="pause" size={14} />Pause after current</button>
            : <button className="ctrl-btn go" onClick={ctrl.resume}><Icon name="play" size={13} fill />Resume</button>}
          <div className="tb-sep" />
          <button className="ctrl-btn" onClick={ctrl.retry}><Icon name="rotate" size={14} />Retry failed</button>
        </div>
      </div>

      <div className="now-prog">
        <div className="now-bar-wrap">
          <div className="now-bar-top">
            <span className="phase">{running ? j.progressPhase : 'Waiting to start'} · Epoch {sim.epoch} / {j.progressEpochTotal}</span>
            <span className="pct">{pct.toFixed(1)}%</span>
          </div>
          <div className="now-bar"><div className="now-bar-fill" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="now-mini-stats">
          <div className="now-mini"><div className="now-mini-label">Rate</div><div className="now-mini-value">{running ? sim.rate.toFixed(1) : '—'}<span style={{ fontSize: 10, color: 'var(--text-3)' }}> it/s</span></div></div>
          <div className="now-mini"><div className="now-mini-label">Batch</div><div className="now-mini-value">{j.progressBatchCurrent}/{j.progressBatchTotal}</div></div>
          <div className="now-mini"><div className="now-mini-label">Val ESR</div><div className="now-mini-value" style={{ color: tone === 'green' ? '#34d399' : tone === 'amber' ? '#fbbf24' : tone === 'red' ? '#f87171' : undefined }}>{running ? sim.esr.toFixed(4) : '—'}</div></div>
          <div className="now-mini"><div className="now-mini-label">ETA</div><div className="now-mini-value">{running ? `${etaMin}m` : '—'}</div></div>
        </div>
        <div className="now-spark">
          <Sparkline data={sim.curve.map(c => -Math.log10(c.esr))} color="var(--accent)" width={130} height={40} />
        </div>
      </div>
    </div>
  );
}

function LiveRun({ sim, t }) {
  const [logOpen, setLogOpen] = useStateL(true);
  const j = window.TRAINER.liveJob;
  const D = window.TRAINER;
  const upNext = D.queued.slice(0, 3);
  if (!sim.running && !sim.paused) {
    return (
      <div className="content-pad">
        <div className="empty-state">
          <div className="es-ic"><Icon name="activity" size={26} /></div>
          <div className="es-title">No run in progress</div>
          <div className="es-sub">Start a queue or launch a new run to watch training live here.</div>
        </div>
      </div>
    );
  }
  const tone = esrTone(sim.esr);
  return (
    <div className="content-pad">
      <div className="section-head">
        <div>
          <div className="section-title">Live Run</div>
          <div className="section-sub">Real-time training telemetry for the active model</div>
        </div>
        <div className="section-spacer" />
        <span className="legend"><span><i style={{ background: 'var(--accent)' }} />validation ESR</span><span><i style={{ background: '#10b981' }} />target</span></span>
      </div>

      <div className="card raised" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <Icon name="trend" size={15} className="ch-ic" />
          <span className="ch-title">ESR over epochs</span>
          <span className="ch-spacer" />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>log scale · lower is better</span>
        </div>
        <div className="card-body" style={{ paddingTop: 8 }}>
          <ChartFit minH={250}>
            {(w) => <EsrCurve data={sim.curve} width={w} height={260} target={0.01} variant={t.chartStyle} />}
          </ChartFit>
        </div>
      </div>

      <div className="statline" style={{ marginBottom: 14 }}>
        <div className="sl-cell"><div className="sl-label">Epoch</div><div className="sl-value">{sim.epoch}<span style={{ fontSize: 12, color: 'var(--text-3)' }}> / {j.progressEpochTotal}</span></div></div>
        <div className="sl-cell"><div className="sl-label">Rate</div><div className="sl-value">{sim.rate.toFixed(2)}<span style={{ fontSize: 11, color: 'var(--text-3)' }}> it/s</span></div></div>
        <div className="sl-cell"><div className="sl-label">Validation ESR</div><div className={`sl-value ${tone}`}>{sim.esr.toFixed(5)}</div></div>
        <div className="sl-cell"><div className="sl-label">Started</div><div className="sl-value" style={{ fontSize: 15 }}>{j.startedAt}</div></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><Icon name="folderOpen" size={15} className="ch-ic" /><span className="ch-title">Final output</span></div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.7, wordBreak: 'break-all' }}>{j.finalModelRoot}/<span style={{ color: 'var(--text)' }}>{j.modelName}.nam</span></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Icon name="save" size={15} className="ch-ic" /><span className="ch-title">Checkpoint export</span></div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.7 }}>Lightning checkpoint copy will appear here after training starts.</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><Icon name="inbox" size={15} className="ch-ic" /><span className="ch-title">Up next</span><span className="ch-spacer" /><span style={{ fontSize: 11, color: 'var(--text-3)' }}>{window.TRAINER.session.queuedCount} queued</span></div>
        <div className="card-body" style={{ padding: 10 }}>
          {upNext.map((q, i) => (
            <div className="q-row" key={q.jobId} style={{ marginBottom: i < upNext.length - 1 ? 6 : 0 }}>
              <span className="q-idx">{i + 1}</span>
              <div className="q-name"><div className="qn-title">{q.modelName}</div></div>
              <div className="q-chips"><ArchChip arch={q.architecture} /><span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{q.epochs} ep</span></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className={`card-head collapse-head${logOpen ? ' open' : ''}`} onClick={() => setLogOpen(o => !o)} style={{ cursor: 'pointer' }}>
          <Icon name="chevronRight" size={14} className="ch-chev" />
          <Icon name="terminal" size={15} className="ch-ic" /><span className="ch-title">Raw trainer log</span>
        </div>
        {logOpen && (
          <div className="card-body" style={{ paddingTop: 12 }}>
            <div className="log-console">
              {buildLog(sim).map((l, i) => <div className="log-line" key={i} dangerouslySetInnerHTML={{ __html: l }} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildLog(sim) {
  const lines = [
    `<span class="ll-time">[15:24:02]</span> Sanity check passed. Starting training.`,
    `<span class="ll-time">[15:24:04]</span> GPU available: True (cuda), used: True`,
    `<span class="ll-ok">[15:24:05]</span> LR scheduler: ExponentialLR · lr=0.004 decay=0.002`,
  ];
  const e = sim.epoch;
  for (let k = Math.max(0, e - 4); k <= e; k++) {
    lines.push(`<span class="ll-epoch">Epoch ${k}/1000</span>: 100%|████████| 62/62 [00:01&lt;00:00, ${sim.rate.toFixed(2)}it/s, ESR=${(sim.esr * (1 + (e - k) * 0.04)).toFixed(5)}]`);
  }
  return lines;
}

// ChartFit — measures width so charts fill their card responsively.
function ChartFit({ children, minH = 120 }) {
  const ref = React.useRef(null);
  const [w, setW] = useStateL(640);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(Math.max(e.contentRect.width, 120)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} style={{ width: '100%', minHeight: minH }}>{children(w)}</div>;
}

Object.assign(window, { Rail, NowStrip, LiveRun, ChartFit });
