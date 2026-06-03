// dashboard.jsx — Simple mode: one spacious dashboard for your favorite defaults.
const { useState: useStateD, useRef: useRefD } = React;

/* Slim control bar for simple mode — just live status + the big run controls. */
function SimpleControlBar({ sim, ctrl }) {
  const j = window.TRAINER.liveJob;
  const running = sim.running;
  return (
    <div className="simplebar">
      <div className="simplebar-id">
        <span className={`live-badge big${running ? '' : ' idle'}`}>
          <span className={`live-dot${running ? ' pulse' : ''}`} />{running ? 'Training' : sim.paused ? 'Paused' : 'Idle'}
        </span>
        <span className="simplebar-name">{running ? j.modelName : 'Queue idle'}</span>
      </div>
      <div className="ctrl-bar big">
        <button className="ctrl-btn danger" onClick={ctrl.stop} disabled={!running && !sim.paused}><Icon name="zap" size={16} />Emergency stop</button>
        {running
          ? <button className="ctrl-btn" onClick={ctrl.pause}><Icon name="pause" size={15} />Pause</button>
          : <button className="ctrl-btn go" onClick={ctrl.resume}><Icon name="play" size={14} fill />Resume</button>}
      </div>
    </div>
  );
}

function Dashboard({ sim, ctrl, openSettings, addedBatches, onQuickAdd }) {
  const D = window.TRAINER;
  const j = D.liveJob;
  const fav = D.favorites;
  const favPreset = D.presets.find(p => p.id === fav.presetId) || D.presets[0];

  // live elapsed since the active batch started (subtle, ticks each second)
  const startRef = useRefD(Date.now() - 47 * 60 * 1000 - 12 * 1000); // ~47m ago
  const [, tick] = useStateD(0);
  React.useEffect(() => { const id = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  const elapsedMs = Date.now() - startRef.current;
  const eh = Math.floor(elapsedMs / 3600000), em = Math.floor((elapsedMs % 3600000) / 60000), es = Math.floor((elapsedMs % 60000) / 1000);
  const elapsedStr = (eh > 0 ? eh + 'h ' : '') + em + 'm ' + String(es).padStart(2, '0') + 's';

  // derive "last finished" item across batches
  const finished = D.batches.flatMap(b => b.items.filter(i => i.status === 'success' || i.status === 'error').map(i => ({ ...i, batch: b.label })));
  const lastDone = finished.filter(i => i.status === 'success').slice(-1)[0] || finished.slice(-1)[0];
  const queuedItems = D.batches.flatMap(b => b.items.filter(i => i.status === 'queued').map(i => ({ ...i, batch: b.label, arch: b.arch })));
  const totalQueued = queuedItems.length + addedBatches.reduce((a, b) => a + b.count, 0);

  const running = sim.running;
  const pct = (sim.epoch / j.progressEpochTotal) * 100;
  const tone = esrTone(sim.esr);
  // batch position: which item of the active batch
  const activeBatch = D.batches.find(b => b.items.some(i => i.status === 'running')) || D.batches[0];
  const batchTotal = activeBatch.items.length;
  const batchIdx = activeBatch.items.findIndex(i => i.status === 'running') + 1;
  const etaMin = Math.max(1, Math.round(((j.progressEpochTotal - sim.epoch) / Math.max(sim.rate, 1)) * j.progressBatchTotal / 60));
  // queue-wide tallies (across every batch)
  const allBatchItems = D.batches.flatMap(b => b.items);
  const addedCount = addedBatches.reduce((a, b) => a + b.count, 0);
  const queueDone = allBatchItems.filter(i => i.status === 'success').length;
  const queueFailed = allBatchItems.filter(i => i.status === 'error' || i.status === 'canceled').length;
  const queueFinished = queueDone + queueFailed;
  const queueTotal = allBatchItems.length + addedCount;

  return (
    <div className="dash">
      {/* HERO — now training, big */}
      <div className="dash-hero">
        {running ? (
          <>
            <div className="dash-hero-left">
              <div className="dash-eyebrow">Now training · {activeBatch.label}</div>
              <div className="dash-hero-name">{j.modelName}</div>
              <div className="dash-hero-meta">
                <span><Icon name="clock" size={15} />batch started {activeBatch.createdAt}</span>
                <span className="dash-elapsed"><Icon name="hourglass" size={14} />running {elapsedStr}</span>
                <span><ArchChip arch={j.architecture} /></span>
              </div>
              <div className="dash-progress">
                <div className="dash-progress-top"><span className="phase">Epoch {sim.epoch} / {j.progressEpochTotal}</span><span className="mono">{pct.toFixed(0)}%</span></div>
                <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            </div>
            <div className="dash-hero-ring">
              <ProgressRing value={pct} size={168} thickness={13} color="var(--accent)">
                <div style={{ textAlign: 'center' }}>
                  <div className="ring-pct">{pct.toFixed(0)}<span>%</span></div>
                  <div className="ring-sub">epoch {sim.epoch}</div>
                </div>
              </ProgressRing>
              <div className="dash-eta">~{etaMin} min remaining</div>
            </div>
          </>
        ) : (
          <div className="dash-idle">
            <div className="es-ic" style={{ width: 64, height: 64 }}><Icon name="flask" size={30} /></div>
            <div className="dash-idle-title">{sim.paused ? 'Paused' : 'Nothing training right now'}</div>
            <div className="dash-idle-sub">Add captures below to start a quick batch, or resume up top.</div>
          </div>
        )}
      </div>

      {/* BIG STATS */}
      <div className="dash-stats">
        <BigStat label="Current epoch" value={running ? sim.epoch : '—'} sub={running ? `of ${j.progressEpochTotal}` : 'idle'} ic="activity" color="var(--accent)" />
        <BigStat label="Queue progress" value={`${queueFinished} / ${queueTotal}`} sub={`${D.batches.length} batches · ${Math.max(queueTotal - queueFinished, 0)} to go`} ic="trend" color="var(--accent)" big />
        <BigStat label="Active batch" value={`${batchIdx} / ${batchTotal}`} sub={activeBatch.label} ic="layers" color="var(--accent)" />
        <BigStat label="Current ETA" value={running ? `${etaMin}m` : '—'} sub={running ? `at ${sim.rate.toFixed(0)} it/s` : 'idle'} ic="hourglass" color="var(--text-3)" />
        <BigStat label="Completed" value={queueDone} sub="across queue" ic="checkCircle" color="#10b981" tone="green" />
        <BigStat label="Failed" value={queueFailed} sub="across queue" ic="alertCircle" color={queueFailed ? '#ef4444' : 'var(--text-3)'} tone={queueFailed ? 'red' : null} />
        <BigStat label="Last ESR" value={lastDone && lastDone.esr != null ? lastDone.esr.toFixed(4) : '—'} sub={lastDone ? lastDone.name.split(' ').slice(-2).join(' ') : 'no runs yet'} ic="target" color={lastDone && lastDone.esr != null ? (esrTone(lastDone.esr) === 'green' ? '#10b981' : esrTone(lastDone.esr) === 'amber' ? '#f59e0b' : '#ef4444') : 'var(--text-3)'} tone={lastDone && lastDone.esr != null ? esrTone(lastDone.esr) : null} />
        <BigStat label="Last item took" value={lastDone && lastDone.dur ? lastDone.dur.replace('m ', ':').replace('s', '') : '—'} sub="mm:ss" ic="clock" color="var(--text-3)" />
      </div>

      {/* QUICK ADD + UP NEXT */}
      <div className="dash-grid">
        <div className="dash-add">
          <div className="dash-add-head">
            <div><div className="dash-card-title">Quick add</div><div className="dash-card-sub">Picks your favorite defaults — no setup</div></div>
            <button className="icon-btn" onClick={openSettings} title="Edit favorites in Settings"><Icon name="settings" size={17} /></button>
          </div>
          <div className="fav-rows">
            <div className="fav-row"><span className="fav-k"><Icon name="star" size={13} fill style={{ color: '#fbbf24' }} />Preset</span><span className="fav-v">{favPreset.name} <span className="archchip" style={{ marginLeft: 4 }}>{ARCH_LABELS[favPreset.arch]}</span></span></div>
            <div className="fav-row"><span className="fav-k"><Icon name="external" size={13} />Routing</span><span className="fav-v mono">{fav.routing}</span></div>
            <div className="fav-row"><span className="fav-k"><Icon name="fileAudio" size={13} />Input DI</span><span className="fav-v mono">…/{fav.inputDi.split('/').slice(-1)[0]}</span></div>
          </div>
          <button className="cta big" onClick={onQuickAdd}><Icon name="plus" size={18} />Pick WAVs & queue batch</button>
          {addedBatches.length > 0 && (
            <div className="dash-added">
              {addedBatches.slice(-2).map((b, i) => (
                <div className="dash-added-row" key={i}><Icon name="checkCircle" size={15} style={{ color: '#10b981' }} />Queued <b>{b.count}</b> captures · {b.name} <span style={{ color: 'var(--text-3)' }}>· auto-queued at end</span></div>
              ))}
            </div>
          )}
        </div>

        <div className="dash-next">
          <div className="dash-add-head"><div><div className="dash-card-title">Up next</div><div className="dash-card-sub">{totalQueued} waiting · runs in order</div></div></div>
          <div className="dash-next-list">
            {queuedItems.slice(0, 5).map((q, i) => (
              <div className="dash-next-row" key={q.id}>
                <span className="dash-next-idx">{i + 1}</span>
                <span className="dash-next-name">{q.name}</span>
                <ArchChip arch={q.arch} />
              </div>
            ))}
            {queuedItems.length > 5 && <div className="dash-next-more">+{queuedItems.length - 5} more queued</div>}
            {queuedItems.length === 0 && <div className="dash-next-more">Queue is empty</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BigStat({ label, value, sub, ic, color, tone, big }) {
  return (
    <div className={`bigstat${big ? ' featured' : ''}`} style={{ '--sc': color }}>
      <div className="bigstat-top"><span className="bigstat-ic"><Icon name={ic} size={17} /></span><span className="bigstat-label">{label}</span></div>
      <div className={`bigstat-value${tone ? ' ' + tone : ''}`}>{value}</div>
      <div className="bigstat-sub">{sub}</div>
    </div>
  );
}

/* Quick-add modal — pick real WAV files from your computer → new batch, auto-queues at end. */
function QuickAddModal({ onClose, onConfirm }) {
  const D = window.TRAINER;
  const fav = D.favorites;
  const favPreset = D.presets.find(p => p.id === fav.presetId) || D.presets[0];
  const inputRef = useRefD(null);
  const [files, setFiles] = useStateD([]);
  const [drag, setDrag] = useStateD(false);

  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function addFiles(list) {
    const wavs = Array.from(list).filter(f => /\.wav$/i.test(f.name));
    setFiles(prev => {
      const map = new Map(prev.map(f => [f.name + f.size, f]));
      wavs.forEach(f => map.set(f.name + f.size, f));
      return Array.from(map.values());
    });
  }
  function onPick(e) { addFiles(e.target.files); e.target.value = ''; }
  function onDrop(e) { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }
  function removeAt(i) { setFiles(prev => prev.filter((_, k) => k !== i)); }

  return (
    <div className="plot-modal-bg" onClick={onClose}>
      <div className="plot-modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="card-head"><Icon name="plus" size={16} className="ch-ic" /><span className="ch-title">Quick add — pick WAVs from your computer</span><span className="ch-spacer" /><span className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></span></div>
        <div style={{ padding: 18 }}>
          <div className="qa-note"><Icon name="star" size={13} fill className="qa-star" style={{ color: '#fbbf24' }} />New batch trains each with <b>{favPreset.name}</b> · routing <span className="mono">{fav.routing}</span> · DI <span className="mono">…/{fav.inputDi.split('/').slice(-1)[0]}</span> — <b>auto-queues at the end</b>.</div>

          <input ref={inputRef} type="file" multiple accept=".wav,audio/wav,audio/x-wav" style={{ display: 'none' }} onChange={onPick} />

          {files.length === 0 ? (
            <div className={`qa-drop${drag ? ' over' : ''}`}
              onClick={() => inputRef.current && inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)} onDrop={onDrop}>
              <Icon name="fileAudio" size={26} />
              <div className="qa-drop-title">Choose WAV files</div>
              <div className="qa-drop-sub">Click to browse your computer, or drop .wav files here</div>
            </div>
          ) : (
            <>
              <div className="qa-files-head"><span>{files.length} file{files.length > 1 ? 's' : ''} selected</span><button className="btn-mini" onClick={() => inputRef.current && inputRef.current.click()}><Icon name="plus" size={12} />Add more</button></div>
              <div className="qa-files"
                onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
                {files.map((f, i) => (
                  <div className="qa-file" key={f.name + f.size + i}>
                    <Icon name="fileAudio" size={15} style={{ color: 'var(--accent)', flex: 'none' }} />
                    <span className="qa-file-name">{f.name}</span>
                    <span className="qa-file-size mono">{fmtSize(f.size)}</span>
                    <span className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => removeAt(i)}><Icon name="x" size={13} /></span>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="cta" style={{ marginTop: 16 }} disabled={files.length === 0} onClick={() => onConfirm(files.length)}>
            <Icon name="play" size={15} fill />Queue {files.length || ''} as new batch
          </button>
        </div>
      </div>
    </div>
  );
}

/* Settings modal — Simple-mode favorites live here. */
function SettingsModal({ onClose }) {
  const D = window.TRAINER;
  const [presets, setPresets] = useStateD(() => D.presets.map(p => ({ ...p })));
  const [routing, setRouting] = useStateD(D.favorites.routing);
  const [di, setDi] = useStateD(D.favorites.inputDi);
  const star = id => setPresets(ps => ps.map(p => ({ ...p, favorite: p.id === id })));
  return (
    <div className="plot-modal-bg" onClick={onClose}>
      <div className="plot-modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="card-head"><Icon name="settings" size={16} className="ch-ic" /><span className="ch-title">Settings · Simple-mode favorites</span><span className="ch-spacer" /><span className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></span></div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Favorite preset <HelpPopover title="Favorite preset">Simple mode trains every quick-added capture with this preset — no per-run setup. Star one to make it the default.</HelpPopover></label>
            <div className="preset-list">
              {presets.map(p => (
                <div className={`preset-row${p.favorite ? ' fav' : ''}`} key={p.id} onClick={() => star(p.id)}>
                  <button className={`star-btn${p.favorite ? ' on' : ''}`} title="Make favorite"><Icon name="star" size={16} fill={p.favorite} /></button>
                  <span className="preset-name">{p.name}</span>
                  <span className="archchip">{ARCH_LABELS[p.arch]}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{p.epochs} epochs</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">Favorite output routing</label>
            <input className="field mono" value={routing} onChange={e => setRouting(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Default Input DI <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· simple mode won't ask</span></label>
            <div className="field-row"><input className="field mono" value={di} onChange={e => setDi(e.target.value)} /><button className="btn"><Icon name="folder" size={14} />Browse</button></div>
          </div>
          <button className="btn" style={{ alignSelf: 'flex-end', background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }} onClick={onClose}><Icon name="check" size={15} />Save favorites</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, SimpleControlBar, QuickAddModal, SettingsModal });
