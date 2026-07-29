// views.jsx — History (Queue lives in queue.jsx).
const { useState: useStateV } = React;

/* ============================ HISTORY ============================ */
function HistoryView({ t, onPlot }) {
  const D = window.TRAINER;
  const [status, setStatus] = useStateV('all');
  const [search, setSearch] = useStateV('');
  const groups = D.hist.map(g => ({
    ...g,
    entries: g.entries.filter(e =>
      (status === 'all' || e.status === status) &&
      (!search || e.name.toLowerCase().includes(search.toLowerCase()))),
  })).filter(g => g.entries.length);
  const total = D.hist.reduce((a, g) => a + g.entries.length, 0);

  return (
    <div className="content-pad">
      <div className="section-head">
        <div><div className="section-title">History</div><div className="section-sub">{total} completed, failed & canceled runs</div></div>
        <div className="section-spacer" />
        <button className="btn ghost"><Icon name="download" size={14} />Export</button>
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="card-head"><Icon name="chart" size={15} className="ch-ic" /><span className="ch-title">ESR quality · last 7 days</span><span className="ch-spacer" /><span className="legend"><span><i style={{ background: '#10b981' }} />&lt;.01</span><span><i style={{ background: '#f59e0b' }} />&lt;.05</span><span><i style={{ background: '#ef4444' }} />≥.05</span></span></div>
          <div className="card-body" style={{ paddingTop: 10 }}><ChartFit minH={150}>{(w) => <QualityBars groups={D.quality} width={w} height={155} />}</ChartFit></div>
        </div>
        <div className="card">
          <div className="card-head"><Icon name="trend" size={15} className="ch-ic" /><span className="ch-title">Throughput · models / hour</span></div>
          <div className="card-body" style={{ paddingTop: 10 }}><ChartFit minH={150}>{(w) => <ThroughputArea data={D.throughput} width={w} height={155} labels={['', '', 'Wed', '', '', 'Fri', '', '', '', '', 'now']} />}</ChartFit></div>
        </div>
      </div>

      <div className="filterbar">
        <div className="fsearch"><Icon name="search" size={14} style={{ color: 'var(--text-3)' }} /><input placeholder="Search name or path…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="fseg">
          {[['all', 'All'], ['success', 'Done'], ['error', 'Failed'], ['canceled', 'Canceled']].map(([id, lb]) => (
            <button key={id} className={`fseg-btn${status === id ? ' on' : ''}`} onClick={() => setStatus(id)}>{lb}</button>
          ))}
        </div>
        <select className="fsel"><option>All profiles</option><option>STANDARD</option><option>Jose CAB REVxSTD</option></select>
        <select className="fsel"><option>All time</option><option>Today</option><option>This week</option></select>
      </div>

      {groups.length === 0 && <div className="empty-state"><div className="es-ic"><Icon name="clock" size={26} /></div><div className="es-title">Nothing matches</div><div className="es-sub">Try a different filter or search term.</div></div>}

      {groups.map(g => {
        const ok = g.entries.filter(e => e.status === 'success').length;
        const fail = g.entries.filter(e => e.status === 'error').length;
        return (
          <div className="h-group" key={g.submissionId}>
            <div className="h-group-head">
              <span className="h-group-title">{g.label}</span>
              <span className="h-group-badge">{g.mode}</span>
              {ok > 0 && <span className="h-group-badge" style={{ color: '#34d399' }}>{ok} done</span>}
              {fail > 0 && <span className="h-group-badge" style={{ color: '#f87171' }}>{fail} failed</span>}
              <span className="h-group-meta">{g.createdAt}</span>
            </div>
            <div className="h-list">
              {g.entries.map(e => {
                const tone = esrTone(e.esr);
                const clickable = e.status === 'success' && e.graph;
                return (
                  <div className="h-row" key={e.id} onClick={() => clickable && onPlot(e)}>
                    <div className="h-thumb">
                      {e.status === 'success' && e.graph ? <MiniEsrPlot tone={tone} seed={e.id.length * 7 + 3} />
                        : e.status === 'error' ? <Icon name="alertTri" size={16} style={{ color: '#f87171' }} />
                          : <Icon name="stop" size={14} />}
                    </div>
                    <div className="h-main">
                      <div className="h-name">{e.name}</div>
                      {e.status === 'error'
                        ? <div className="h-err">{e.error}</div>
                        : <div className="h-meta"><ArchChip arch={e.arch} /><ProfChip name={e.profile} /><span className="sep">·</span><span>{e.epochs} epochs</span><span className="sep">·</span><span className="mono">{e.dur}</span></div>}
                    </div>
                    <div className="h-right">
                      {e.status === 'success' ? <EsrBadge esr={e.esr} /> : <StatusPill status={e.status} />}
                      <span className="h-time">{e.time}</span>
                      <div className="q-actions" style={{ opacity: 1 }}>
                        {clickable && <IconBtn name="image" title="View ESR plot" onClick={() => onPlot(e)} />}
                        {e.status === 'error' && <IconBtn name="rotate" title="Retry" />}
                        <IconBtn name="folderOpen" title="Reveal in folder" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { HistoryView });
