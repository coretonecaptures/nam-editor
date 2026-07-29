// queue.jsx — batch-centric queue: collapsible batches, drag to reorder
// items within a batch and drag batches past each other. Finished items
// stay in their batch with their final status.
const { useState: useStateQ, useRef: useRefQ } = React;

const TYPE_ICON = { wavs: 'fileAudio', folder: 'folderOpen', watcher: 'eye' };
const TYPE_LABEL = { wavs: 'Run WAVs', folder: 'Run Folder', watcher: 'Watch folder' };
const STATUS_RANK = { success: 0, error: 0, canceled: 0, running: 1, queued: 2 };

function tally(items) {
  const c = { success: 0, error: 0, canceled: 0, running: 0, queued: 0 };
  items.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; });
  return c;
}

function QueueView({ t, setTweak }) {
  const D = window.TRAINER;
  const [batches, setBatches] = useStateQ(() => D.batches.map(b => ({ ...b, items: b.items.map(it => ({ ...it })) })));
  const [profileF, setProfileF] = useStateQ('all');
  const [statusF, setStatusF] = useStateQ('all');
  const [archF, setArchF] = useStateQ('all');

  // drag state
  const drag = useRefQ(null); // { kind:'item', batchId, itemId } | { kind:'batch', batchId }
  const [overItem, setOverItem] = useStateQ(null); // { id, pos:'before'|'after' }
  const [overBatch, setOverBatch] = useStateQ(null); // { id, pos }
  const [draggingId, setDraggingId] = useStateQ(null);

  const profiles = Array.from(new Set(D.batches.map(b => b.profile)));

  // counts across everything (retained finished items included)
  const allItems = batches.flatMap(b => b.items);
  const counts = tally(allItems);

  function matchItem(it, b) {
    if (profileF !== 'all' && b.profile !== profileF) return false;
    if (archF !== 'all' && b.arch !== archF) return false;
    if (statusF !== 'all' && it.status !== statusF) return false;
    return true;
  }

  /* ---- item drag (within a batch) ---- */
  function onItemDragStart(e, batchId, itemId) {
    drag.current = { kind: 'item', batchId, itemId };
    setDraggingId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', itemId); } catch (_) {}
  }
  function onItemDragOver(e, batchId, item) {
    const d = drag.current;
    if (!d || d.kind !== 'item' || d.batchId !== batchId || item.status !== 'queued') return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    setOverItem({ id: item.id, pos });
  }
  function onItemDrop(e, batchId, targetId) {
    const d = drag.current;
    if (!d || d.kind !== 'item' || d.batchId !== batchId) { resetDrag(); return; }
    e.preventDefault(); e.stopPropagation();
    setBatches(prev => prev.map(b => {
      if (b.id !== batchId) return b;
      const items = b.items.slice();
      const from = items.findIndex(i => i.id === d.itemId);
      let to = items.findIndex(i => i.id === targetId);
      if (from < 0 || to < 0) return b;
      const [moved] = items.splice(from, 1);
      to = items.findIndex(i => i.id === targetId);
      const insert = overItem && overItem.pos === 'after' ? to + 1 : to;
      items.splice(insert, 0, moved);
      return { ...b, items };
    }));
    resetDrag();
  }

  /* ---- batch drag (reorder batches) ---- */
  function onBatchDragStart(e, batchId) {
    drag.current = { kind: 'batch', batchId };
    setDraggingId(batchId);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', batchId); } catch (_) {}
  }
  function onBatchDragOver(e, batchId) {
    const d = drag.current;
    if (!d || d.kind !== 'batch' || d.batchId === batchId) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    setOverBatch({ id: batchId, pos });
  }
  function onBatchDrop(e, batchId) {
    const d = drag.current;
    if (!d || d.kind !== 'batch') { resetDrag(); return; }
    e.preventDefault();
    setBatches(prev => {
      const arr = prev.slice();
      const from = arr.findIndex(b => b.id === d.batchId);
      let to = arr.findIndex(b => b.id === batchId);
      if (from < 0 || to < 0) return prev;
      const [moved] = arr.splice(from, 1);
      to = arr.findIndex(b => b.id === batchId);
      const insert = overBatch && overBatch.pos === 'after' ? to + 1 : to;
      arr.splice(insert, 0, moved);
      return arr;
    });
    resetDrag();
  }
  function resetDrag() { drag.current = null; setOverItem(null); setOverBatch(null); setDraggingId(null); }

  function toggleCollapse(id) { setBatches(prev => prev.map(b => b.id === id ? { ...b, collapsed: !b.collapsed } : b)); }
  function removeItem(batchId, itemId) { setBatches(prev => prev.map(b => b.id === batchId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b)); }
  function makeNext(batchId, itemId) {
    setBatches(prev => prev.map(b => {
      if (b.id !== batchId) return b;
      const items = b.items.slice();
      const from = items.findIndex(i => i.id === itemId);
      if (from < 0) return b;
      const firstQueued = items.findIndex(i => i.status === 'queued');
      const [moved] = items.splice(from, 1);
      items.splice(Math.max(firstQueued, 0), 0, moved);
      return { ...b, items };
    }));
  }

  return (
    <div className="content-pad">
      <div className="section-head">
        <div><div className="section-title">Queue</div><div className="section-sub">{batches.length} batches · {counts.queued} queued · {counts.running} running · runs serially</div></div>
        <div className="section-spacer" />
        <div className="fseg">
          {[['rows', 'list', 'Batches'], ['cards', 'grid', 'Compact'], ['kanban', 'kanban', 'Board']].map(([id, ic, lb]) => (
            <button key={id} className={`fseg-btn${t.queueStyle === id ? ' on' : ''}`} onClick={() => setTweak('queueStyle', id)}><Icon name={ic} size={13} />{lb}</button>
          ))}
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        {[['Queued', counts.queued, 'list', 'var(--text-3)'], ['Running', counts.running, 'activity', 'var(--accent)'], ['Done', counts.success, 'checkCircle', '#10b981'], ['Failed', counts.error, 'alertCircle', '#ef4444']].map(([lb, v, ic, c]) => (
          <div className="metric accent-l" style={{ '--mc': c }} key={lb}>
            <div className="metric-top"><span className="metric-ic"><Icon name={ic} size={16} /></span><span className="metric-label">{lb}</span></div>
            <div className="metric-value" style={{ color: v > 0 && lb === 'Failed' ? '#f87171' : undefined }}>{v}</div>
          </div>
        ))}
      </div>

      {/* quick filters (restored) */}
      <div className="batch-toolbar">
        <div className="fsearch" style={{ maxWidth: 220 }}><Icon name="search" size={14} style={{ color: 'var(--text-3)' }} /><input placeholder="Filter queue…" /></div>
        <select className="fsel" value={profileF} onChange={e => setProfileF(e.target.value)}>
          <option value="all">All profiles</option>
          {profiles.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="fsel" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="success">Success</option><option value="error">Failed</option><option value="canceled">Canceled</option>
        </select>
        <select className="fsel" value={archF} onChange={e => setArchF(e.target.value)}>
          <option value="all">All architectures</option>
          {Object.keys(ARCH_LABELS).map(a => <option key={a} value={a}>{ARCH_LABELS[a]}</option>)}
        </select>
        <span className="section-spacer" style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="dotsV" size={13} />drag to reorder · click ▸ to collapse</span>
      </div>

      {t.queueStyle === 'rows' && batches.map(b => {
        const visible = b.items.filter(it => matchItem(it, b));
        if (visible.length === 0 && (profileF !== 'all' || statusF !== 'all' || archF !== 'all')) return null;
        const c = tally(b.items);
        const total = b.items.length;
        const finished = c.success + c.error + c.canceled;
        const hasActive = c.running > 0;
        const ob = overBatch && overBatch.id === b.id ? `drop-${overBatch.pos}` : '';
        return (
          <div key={b.id} className={`batch ${b.collapsed ? '' : 'open'} ${hasActive ? 'has-active' : ''} ${draggingId === b.id ? 'dragging' : ''} ${ob}`}
            onDragOver={e => onBatchDragOver(e, b.id)} onDrop={e => onBatchDrop(e, b.id)}>
            <div className="batch-head">
              <span className="batch-grip" draggable onDragStart={e => onBatchDragStart(e, b.id)} onDragEnd={resetDrag} title="Drag batch"><Icon name="dotsV" size={15} /></span>
              <span className="batch-caret" onClick={() => toggleCollapse(b.id)}><Icon name="chevronRight" size={15} /></span>
              <span className={`batch-type-ic${b.type === 'watcher' ? ' watcher' : ''}`}><Icon name={TYPE_ICON[b.type]} size={15} /></span>
              <div className="batch-id">
                <div className="batch-label">{b.label}{hasActive && <span className="live-badge" style={{ height: 19, fontSize: 10 }}><span className="live-dot pulse" />active</span>}</div>
                <div className="batch-sub"><span>{TYPE_LABEL[b.type]}</span><span className="sep">·</span><ProfChip name={b.profile} /><ArchChip arch={b.arch} /><span className="sep">·</span><span>{total} items</span><span className="sep">·</span><span>{b.createdAt}</span></div>
              </div>
              <div className="batch-meter">
                <div className="batch-meter-top"><span>{finished}/{total} finished</span><span>{Math.round((finished / total) * 100)}%</span></div>
                <StackedMeter segments={[{ value: c.success, color: '#10b981', label: 'done' }, { value: c.error + c.canceled, color: '#ef4444', label: 'failed' }, { value: c.running, color: 'var(--accent)', label: 'running' }, { value: c.queued, color: 'var(--chart-track)', label: 'queued' }]} height={8} />
              </div>
              <div className="batch-counts">
                {c.queued > 0 && <span className="batch-mini"><span className="bm-dot" style={{ background: 'var(--text-3)' }} />{c.queued}</span>}
                {c.success > 0 && <span className="batch-mini" style={{ color: '#34d399' }}><span className="bm-dot" style={{ background: '#10b981' }} />{c.success}</span>}
                {(c.error + c.canceled) > 0 && <span className="batch-mini" style={{ color: '#f87171' }}><span className="bm-dot" style={{ background: '#ef4444' }} />{c.error + c.canceled}</span>}
              </div>
              <div className="batch-actions">
                {b.type === 'watcher' && <IconBtn name="pause" title="Pause watcher" />}
                <IconBtn name="rotate" title="Retry failed in batch" />
                <IconBtn name="trash" title="Remove batch" danger />
              </div>
            </div>
            {!b.collapsed && (
              <div className="batch-body">
                {b.type === 'watcher' && <div className="batch-source"><Icon name="folderOpen" size={12} />{b.watchFolder} · auto-queues new files as they appear</div>}
                {visible.map((it, idx) => {
                  const queued = it.status === 'queued';
                  const oi = overItem && overItem.id === it.id ? `drop-${overItem.pos}` : '';
                  return (
                    <div key={it.id}
                      className={`bi ${it.status} ${queued ? 'draggable-item' : ''} ${draggingId === it.id ? 'dragging' : ''} ${oi}`}
                      draggable={queued}
                      onDragStart={queued ? (e => { e.stopPropagation(); onItemDragStart(e, b.id, it.id); }) : undefined}
                      onDragEnd={resetDrag}
                      onDragOver={e => onItemDragOver(e, b.id, it)}
                      onDrop={e => onItemDrop(e, b.id, it.id)}>
                      <span className={`bi-grip${queued ? '' : ' locked'}`}><Icon name="dotsV" size={13} /></span>
                      <span className="bi-idx">{b.items.indexOf(it) + 1}</span>
                      <span className="bi-statusic"><ItemStatusIcon status={it.status} /></span>
                      <div className="bi-name">
                        <div className="bi-title">{it.name}</div>
                        {it.status === 'error' ? <div className="bi-err">{it.error}{it.attempts > 1 ? ` · attempt ${it.attempts}` : ''}</div>
                          : it.status === 'running' ? <div className="bi-sub mono">Epoch {window.SIM_EPOCH}/1000 · {window.SIM_RATE.toFixed(1)} it/s</div>
                            : it.status === 'success' ? <div className="bi-sub mono">{it.dur} · {ARCH_LABELS[b.arch]}</div>
                              : <div className="bi-sub">Waiting in queue</div>}
                      </div>
                      {it.status === 'running' && <div className="bi-bar"><div className="now-bar" style={{ height: 6 }}><div className="now-bar-fill" style={{ width: `${(window.SIM_EPOCH / 1000) * 100}%` }} /></div></div>}
                      <div className="bi-right">
                        {it.status === 'success' && <EsrBadge esr={it.esr} />}
                        {it.status !== 'running' && it.status !== 'success' && <StatusPill status={it.status} />}
                        {it.status === 'running' && <StatusPill status="running" />}
                        <div className="bi-actions">
                          {queued && b.items.indexOf(it) > (b.items.findIndex(x => x.status === 'queued')) && <button className="btn-mini accent" onClick={() => makeNext(b.id, it.id)}>Next</button>}
                          {it.status === 'error' && <button className="btn-mini"><Icon name="rotate" size={12} />Retry</button>}
                          {it.status === 'success' && <button className="btn-mini"><Icon name="folderOpen" size={12} />Show</button>}
                          {it.status !== 'running' && <IconBtn name="x" title="Remove" size={14} onClick={() => removeItem(b.id, it.id)} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {t.queueStyle === 'cards' && <QueueCompact batches={batches} matchItem={matchItem} />}
      {t.queueStyle === 'kanban' && <QueueBoard batches={batches} matchItem={matchItem} />}
    </div>
  );
}

function ItemStatusIcon({ status }) {
  if (status === 'success') return <Icon name="checkCircle" size={16} style={{ color: '#10b981' }} />;
  if (status === 'error') return <Icon name="alertCircle" size={16} style={{ color: '#ef4444' }} />;
  if (status === 'canceled') return <Icon name="stop" size={13} style={{ color: 'var(--text-3)' }} />;
  if (status === 'running') return <span className="live-dot pulse" style={{ width: 9, height: 9, background: 'var(--accent)' }} />;
  return <Icon name="hourglass" size={14} style={{ color: 'var(--text-3)' }} />;
}

/* Compact — dense flat rows, still grouped by batch label, finished retained */
function QueueCompact({ batches, matchItem }) {
  return (
    <div>
      {batches.map(b => {
        const visible = b.items.filter(it => matchItem(it, b));
        if (!visible.length) return null;
        return (
          <div className="h-group" key={b.id}>
            <div className="h-group-head"><span className="h-group-title">{b.label}</span><span className="h-group-badge">{TYPE_LABEL[b.type]}</span><span className="h-group-meta">{b.createdAt}</span></div>
            <div className="h-list">
              {visible.map(it => (
                <div className="h-row" key={it.id} style={{ cursor: 'default' }}>
                  <span className="bi-statusic"><ItemStatusIcon status={it.status} /></span>
                  <div className="h-main"><div className="h-name">{it.name}</div>{it.status === 'error' && <div className="h-err">{it.error}</div>}</div>
                  <div className="h-right">
                    {it.status === 'success' ? <EsrBadge esr={it.esr} /> : <StatusPill status={it.status} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Board — status pivot across ALL batches (cross-batch view) */
function QueueBoard({ batches, matchItem }) {
  const items = batches.flatMap(b => b.items.filter(it => matchItem(it, b)).map(it => ({ ...it, batch: b.label, arch: b.arch })));
  const cols = [
    { id: 'queued', label: 'Queued', icon: 'list', c: 'var(--text-3)' },
    { id: 'running', label: 'Running', icon: 'activity', c: 'var(--accent)' },
    { id: 'success', label: 'Done', icon: 'checkCircle', c: '#10b981' },
    { id: 'failed', label: 'Failed', icon: 'alertCircle', c: '#ef4444' },
  ];
  const pick = id => id === 'failed' ? items.filter(i => i.status === 'error' || i.status === 'canceled') : items.filter(i => i.status === id);
  return (
    <div className="kanban">
      {cols.map(col => {
        const list = pick(col.id);
        return (
          <div className="kan-col" key={col.id}>
            <div className="kan-head"><Icon name={col.icon} size={14} style={{ color: col.c }} />{col.label}<span className="kh-count">{list.length}</span></div>
            <div className="kan-body">
              {list.length === 0 && <div className="kan-empty">Nothing here</div>}
              {list.map(it => (
                <div className={`kan-card${it.status === 'running' ? ' running' : ''}`} key={it.id}>
                  <div className="kan-card-title">{it.name}</div>
                  {it.status === 'running' && <div className="now-bar" style={{ marginTop: 8 }}><div className="now-bar-fill" style={{ width: `${(window.SIM_EPOCH / 1000) * 100}%` }} /></div>}
                  <div className="kan-card-foot">
                    <ArchChip arch={it.arch} />
                    {it.esr != null && <EsrBadge esr={it.esr} />}
                    <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 'auto' }}>{it.batch}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { QueueView });
