// newrun.jsx — New Run setup (Run WAVs + Run Folder merged).
const { useState: useStateN } = React;

function NewRun({ t }) {
  const [mode, setMode] = useStateN('wavs'); // 'wavs' | 'folder'
  const [nam, setNam] = useStateN('a1');
  const [savePlot, setSavePlot] = useStateN(true);
  const [ignore, setIgnore] = useStateN(false);
  const wavs = window.TRAINER.PRINCE.slice(0, 9).map(n => `…/_Processed/_WAV/DI/${n}.wav`);
  const count = mode === 'wavs' ? 13 : 8;

  return (
    <div className="content-pad" style={{ maxWidth: 900 }}>
      <div className="section-head">
        <div><div className="section-title">New Training Run</div><div className="section-sub">Queue one input DI against many reamped captures — runs serially</div></div>
      </div>

      <div className="seg-pick" style={{ marginBottom: 18 }}>
        <button className={`sp-opt${mode === 'wavs' ? ' on' : ''}`} onClick={() => setMode('wavs')}><span><Icon name="fileAudio" size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Run WAVs</span><small>Pick individual reamped captures</small></button>
        <button className={`sp-opt${mode === 'folder' ? ' on' : ''}`} onClick={() => setMode('folder')}><span><Icon name="folderOpen" size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Run Folder</span><small>Train every WAV in a folder</small></button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><Icon name="fileAudio" size={15} className="ch-ic" /><span className="ch-title">Captures</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="field-label">Input DI <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· trainer reference</span></label>
            <div className="field-row">
              <input className="field mono" defaultValue="F:/NAM To Process/v3_0_0.wav" />
              <button className="btn"><Icon name="folder" size={14} />Browse</button>
            </div>
          </div>
          {mode === 'wavs' ? (
            <div>
              <label className="field-label">Output WAVs <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {wavs.length} selected</span></label>
              <div className="field-row" style={{ marginBottom: 8 }}>
                <button className="btn"><Icon name="plus" size={14} />Choose WAVs…</button>
                <button className="btn ghost"><Icon name="x" size={13} />Clear</button>
              </div>
              <div className="wavbox">
                {wavs.map((w, i) => <div className="wb-row" key={i}><Icon name="fileAudio" size={12} className="wb-ic" />{w}</div>)}
              </div>
            </div>
          ) : (
            <div>
              <label className="field-label">WAV folder</label>
              <div className="field-row">
                <input className="field mono" defaultValue="F:/NAM To Process/70s Silver Prince/_Processed/_WAV/DI" />
                <button className="btn"><Icon name="folder" size={14} />Folder…</button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>8 WAV files found · all will be trained against the input DI above.</div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><Icon name="sliders" size={15} className="ch-ic" /><span className="ch-title">Training settings</span><HelpPopover title="Training settings">These map straight to the official NAM trainer flags. Presets bundle architecture, epochs, latency and ESR target so you can reuse a recipe across Run WAVs, Run Folder and watch folders.</HelpPopover></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid-3">
            <div><label className="field-label">Preset</label><select className="field"><option>Custom</option><option>Standard 1000</option><option>REVxSTD 1000</option></select></div>
            <div><label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Architecture <HelpPopover title="Architecture">WaveNet variant. Standard is the highest-quality default; Lite/Feather/Nano trade fidelity for smaller, faster models. REV* presets force their author-recommended settings.</HelpPopover></label><select className="field" disabled={nam === 'a2'}><option>Standard</option><option>Complex</option><option>Lite</option><option>Feather</option><option>Nano</option></select></div>
            <div><label className="field-label">Epochs</label><input className="field mono" defaultValue="1000" /></div>
          </div>
          <div className="grid-3">
            <div>
              <label className="field-label">NAM version</label>
              <div className="seg-pick">
                <button className={`sp-opt${nam === 'a1' ? ' on' : ''}`} style={{ height: 38 }} onClick={() => setNam('a1')}>A1 WaveNet</button>
                <button className="sp-opt" style={{ height: 38 }} disabled>A2 — Soon</button>
              </div>
            </div>
            <div><label className="field-label">Latency</label><input className="field" placeholder="Auto" /></div>
            <div><label className="field-label">Target ESR <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· optional</span></label><input className="field mono" placeholder="e.g. 0.005" /></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <div className="checkrow" onClick={() => setSavePlot(v => !v)}><span className={`checkbox${savePlot ? ' on' : ''}`}>{savePlot && <Icon name="check" size={13} />}</span>Save ESR plot</div>
            <div className="checkrow" onClick={() => setIgnore(v => !v)}><span className={`checkbox${ignore ? ' on' : ''}`}>{ignore && <Icon name="check" size={13} />}</span>Ignore checks</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Normalize</span><HelpPopover title="Input normalization">Peak-normalizes the reamped WAV before training so levels are consistent batch-to-batch. Leave Off to train on the file as-is; On targets the dBFS set in Settings.</HelpPopover><select className="fsel"><option>Off</option><option>On</option></select></div>
            <span className="section-spacer" style={{ flex: 1 }} />
            <button className="btn"><Icon name="save" size={14} />Save as Preset</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><Icon name="external" size={15} className="ch-ic" /><span className="ch-title">Output routing</span><HelpPopover title="Output routing">Formulas decide where the finished .nam and ESR plot land relative to the source WAV. The tokens {'{architecture}'} and {'{folder}'} expand per run so every batch files itself automatically.</HelpPopover></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="routing-card nam">
            <div className="routing-top"><Icon name="checkCircle" size={15} style={{ color: '#10b981' }} />NAM output formula active <span className="routing-formula">../../NAM/{'{architecture}'}/{'{folder}'}</span></div>
            <div className="routing-path">→ F:/NAM To Process/70s Silver Prince/_Processed/NAM/standard/DI</div>
          </div>
          <div className="routing-card graph">
            <div className="routing-top"><Icon name="checkCircle" size={15} style={{ color: 'var(--accent)' }} />Graph output formula active <span className="routing-formula">../../Graphs/{'{architecture}'}/{'{folder}'}</span></div>
            <div className="routing-path">→ F:/NAM To Process/70s Silver Prince/_Processed/Graphs/standard/DI</div>
          </div>
        </div>
      </div>

      <button className="cta"><Icon name="play" size={16} fill />Queue {count} captures</button>
    </div>
  );
}

window.NewRun = NewRun;
