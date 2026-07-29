// batches.jsx — Staged Batches: saved batches waiting to be queued.
// "Stage (save, don't run)" in Create Batch lands them here; queue when ready.
const { useState: useStateB } = React;

const STAGE_TYPE_ICON = { wavs: 'fileAudio', folder: 'folderOpen', watcher: 'eye' };
const STAGE_TYPE_LABEL = { wavs: 'Run WAVs', folder: 'Run Folder', watcher: 'Watch folder' };

function BatchesView({ setSection }) {
  const D = window.TRAINER;
  const [staged, setStaged] = useStateB(() => D.stagedBatches.map(b => ({ ...b, collapsed: true })));
  const totalCaps = staged.reduce((a, b) => a + b.items.length, 0);

  const toggle = id => setStaged(prev => prev.map(b => b.id === id ? { ...b, collapsed: !b.collapsed } : b));
  const remove = id => setStaged(prev => prev.filter(b => b.id !== id));
  const duplicate = id => setStaged(prev => {
    const i = prev.findIndex(b => b.id === id); if (i < 0) return prev;
    const copy = { ...prev[i], id: prev[i].id + '-copy-' + Date.now(), label: prev[i].label + ' (copy)', collapsed: true };
    const next = prev.slice(); next.splice(i + 1, 0, copy); return next;
  });
  const queueNow = id => setStaged(prev => prev.filter(b => b.id !== id)); // moves to queue (prototype: just removes)

  return (
    <div className="content-pad">
      <div className="section-head">
        <div>
          <div className="section-title">Staged Batches</div>
          <div className="section-sub">{staged.length === 0 ? 'Nothing staged' : `${staged.length} batches · ${totalCaps} captures saved, ready to queue`}</div>
        </div>
        <div className="section-spacer" />
        {staged.length > 0 && <button className="btn" onClick={() => setSection('new')}><Icon name="plus" size={14} />New batch</button>}
        {staged.length > 1 && <button className="cta" style={{ width: 'auto', height: 38, padding: '0 16px', fontSize: 13 }} onClick={() => setStaged([])}><Icon name="play" size={14} fill />Queue all</button>}
      </div>

      {staged.length === 0 ? (
        <div className="empty-state">
          <div className="es-ic"><Icon name="inbox" size={26} /></div>
          <div className="es-title">No staged batches</div>
          <div className="es-sub">Build a batch in New Run and choose <b>Stage (save, don't run)</b> to park it here until you're ready to queue.</div>
          <button className="btn outline-accent" style={{ marginTop: 16, height: 38 }} onClick={() => setSection('new')}><Icon name="plus" size={14} />Create a batch</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {staged.map(b => (
            <div className={`stage-card${b.collapsed ? '' : ' open'}`} key={b.id}>
              <div className="stage-head">
                <span className="batch-caret" onClick={() => toggle(b.id)}><Icon name="chevronRight" size={15} /></span>
                <span className="stage-type-ic"><Icon name={STAGE_TYPE_ICON[b.type]} size={16} /></span>
                <div className="stage-id">
                  <div className="stage-label">{b.label}<span className="staged-pill"><Icon name="save" size={11} />Staged</span></div>
                  <div className="batch-sub">
                    <span>{b.items.length} captures</span><span className="sep">·</span>
                    <ProfChip name={b.profile} /><ArchChip arch={b.arch} />
                    <span className="sep">·</span><span>{b.epochs} epochs</span>
                    <span className="sep">·</span><span>norm {b.normalize}</span>
                    <span className="sep">·</span><span>{b.createdAt}</span>
                  </div>
                </div>
                <div className="stage-actions">
                  <button className="btn-mini" onClick={() => setSection('new')}><Icon name="edit" size={12} />Edit</button>
                  <button className="btn-mini" onClick={() => duplicate(b.id)}><Icon name="layers" size={12} />Duplicate</button>
                  <button className="btn-mini" onClick={() => remove(b.id)} style={{ color: '#f87171' }}><Icon name="trash" size={12} />Delete</button>
                  <button className="btn-mini queue-now" onClick={() => queueNow(b.id)}><Icon name="play" size={12} fill />Queue now</button>
                </div>
              </div>
              <div className="stage-routing"><Icon name="external" size={12} />{b.routing} <span style={{ opacity: .5 }}>·</span> DI <span className="mono">…/{b.inputDi.split('/').slice(-1)[0]}</span></div>
              {!b.collapsed && (
                <div className="stage-body">
                  {b.items.map((it, i) => (
                    <div className="stage-item" key={i}>
                      <Icon name="fileAudio" size={13} style={{ color: 'var(--accent)', flex: 'none' }} />
                      <span className="stage-item-name">{it.name}.wav</span>
                      <ArchChip arch={b.arch} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

window.BatchesView = BatchesView;
