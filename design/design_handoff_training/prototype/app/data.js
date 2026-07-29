// data.js — mock trainer state for the NAM Lab Trainer prototype.
(function () {
  // --- ESR-vs-epoch curve generator: noisy exponential decay toward a floor ---
  function genCurve(points, startEsr, floorEsr, totalEpochs, seed) {
    let s = seed || 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const out = [];
    for (let i = 0; i < points; i++) {
      const frac = i / (points - 1);
      const base = floorEsr + (startEsr - floorEsr) * Math.exp(-3.4 * frac);
      const noise = base * (0.06 * (rnd() - 0.5)) * (1 - frac * 0.6);
      out.push({ epoch: Math.round(frac * totalEpochs), esr: Math.max(base + noise, floorEsr * 0.7) });
    }
    return out;
  }

  // current live run is ~10% through (epoch 100/1000)
  const liveCurve = genCurve(26, 0.34, 0.0072, 1000, 13).map((p, i, a) =>
    ({ ...p, epoch: Math.round((i / (a.length - 1)) * 100) }));

  const PRINCE = [
    'Prince Clean Bright DIR', 'Prince Clean Comp DIR', 'Prince Clean Deep DIR',
    'Prince Clean Lift DIR', 'Prince Clean Lightspeed DIR', 'Prince Clean Pushed Bright DIR',
    'Prince Clean Pushed DIR', 'Prince Crunch Bright DIR', 'Prince Crunch Comp DIR',
    'Prince Crunch Deep DIR', 'Prince Lead Bright DIR', 'Prince Lead Comp DIR', 'Prince Lead Deep DIR',
  ];

  const liveJob = {
    jobId: 'job-live', status: 'running', modelName: PRINCE[3], architecture: 'standard',
    profileName: 'STANDARD', epochs: 1000, progressEpochCurrent: 100, progressEpochTotal: 1000,
    progressBatchCurrent: 62, progressBatchTotal: 62, progressRate: 34.69, validationEsr: 0.0091,
    progressPhase: 'Training', progressPercent: 10.0, tone: 'clean',
    outputPath: 'F:/NAM To Process/70s Silver Prince/_Processed/_WAV/DI/Prince Clean Bright DIR.wav',
    finalModelRoot: 'F:/NAM To Process/70s Silver Prince/_Processed/NAM/standard/DI',
    startedAt: '3:24:02 PM', etaSeconds: 1580,
  };

  const queued = PRINCE.slice(4).map((name, i) => ({
    jobId: 'q' + i, status: 'queued', modelName: name, architecture: 'standard', profileName: 'STANDARD',
    epochs: 1000, tone: name.includes('Crunch') ? 'crunch' : name.includes('Lead') ? 'hi_gain' : 'clean',
  }));

  // ---- BATCHES (submissions) — finished items stay in their batch ----
  const tn = name => name.includes('Crunch') ? 'crunch' : name.includes('Lead') ? 'hi_gain' : 'clean';
  const batches = [
    {
      id: 'b-prince', label: '70s Silver Prince', type: 'wavs', profile: 'STANDARD', arch: 'standard',
      epochs: 1000, createdAt: 'Today · 3:24 PM', collapsed: false,
      items: PRINCE.map((name, i) => {
        if (i < 3) return { id: 'p' + i, name, status: 'success', esr: [0.0064, 0.0081, 0.0093][i], dur: '13m 5' + i + 's', attempts: 1, tone: tn(name) };
        if (i === 3) return { id: 'p' + i, name, status: 'running', esr: 0.0086, epoch: 100, attempts: 1, tone: tn(name) };
        return { id: 'p' + i, name, status: 'queued', attempts: 0, tone: tn(name) };
      }),
    },
    {
      id: 'b-jose', label: 'Jose CAB REVxSTD', type: 'watcher', profile: 'Jose CAB REVxSTD', arch: 'revxstd',
      epochs: 1000, createdAt: 'Today · 11:52 PM', collapsed: false, watchFolder: 'F:/NAM To Process/Jose/V2/WAV/CAB',
      items: [
        { id: 'j0', name: 'FMAN JA Vint Jose HG Mars', status: 'error', attempts: 2, tone: 'hi_gain', error: 'input_norm.wav cannot be recognized as any known version' },
        { id: 'j1', name: 'FMAN JA Vint Jose HG Mars2', status: 'error', attempts: 1, tone: 'hi_gain', error: 'input_norm.wav cannot be recognized as any known version' },
        { id: 'j2', name: 'FMAN JA Vint Jose HG Mesa', status: 'queued', attempts: 0, tone: 'hi_gain' },
        { id: 'j3', name: 'FMAN JA Vint Jose HG Recto', status: 'queued', attempts: 0, tone: 'hi_gain' },
      ],
    },
    {
      id: 'b-marsh', label: 'Marshall JCM Pack', type: 'folder', profile: 'STANDARD', arch: 'standard',
      epochs: 1000, createdAt: 'Today · 4:01 PM', collapsed: true,
      items: [
        { id: 'm0', name: 'JCM800 Lead Hot', status: 'success', esr: 0.0073, dur: '13m 58s', attempts: 1, tone: 'hi_gain' },
        { id: 'm1', name: 'JCM800 Crunch Mid', status: 'success', esr: 0.0091, dur: '14m 06s', attempts: 1, tone: 'crunch' },
        { id: 'm2', name: 'JCM800 Clean Edge', status: 'canceled', dur: '3m 20s', attempts: 1, tone: 'clean' },
        { id: 'm3', name: 'JCM800 Lead Bright', status: 'success', esr: 0.0119, dur: '14m 22s', attempts: 1, tone: 'hi_gain' },
      ],
    },
  ];

  // history grouped by submission
  const hist = [
    {
      submissionId: 's-prince-cab', label: 'Prince CAB · 70s Silver', createdAt: '5/29/2026, 9:14 PM', mode: 'Run WAVs',
      entries: [
        { id: 'h1', name: 'Prince Clean Bright CAB', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0064, epochs: 1000, time: '5/29/2026, 9:42 PM', dur: '14m 02s', graph: true, tone: 'clean' },
        { id: 'h2', name: 'Prince Clean Comp CAB', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0081, epochs: 1000, time: '5/29/2026, 9:28 PM', dur: '13m 47s', graph: true, tone: 'clean' },
        { id: 'h3', name: 'Prince Crunch Bright CAB', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0142, epochs: 1000, time: '5/29/2026, 9:14 PM', dur: '14m 11s', graph: true, tone: 'crunch' },
      ],
    },
    {
      submissionId: 's-jose', label: 'Jose CAB REVxSTD', createdAt: '5/19/2026, 11:52 PM', mode: 'Watch folder',
      entries: [
        { id: 'h4', name: 'FMAN JA Vint Jose HG Mars', arch: 'revxstd', profile: 'Jose CAB REVxSTD', status: 'error', esr: null, epochs: 1000, time: '5/19/2026, 11:52 PM', dur: '0m 12s', graph: false, tone: 'hi_gain', error: 'input_norm.wav cannot be recognized as any known version' },
        { id: 'h5', name: 'FMAN JA Vint Jose HG Mars2', arch: 'revxstd', profile: 'Jose CAB REVxSTD', status: 'error', esr: null, epochs: 1000, time: '5/19/2026, 11:52 PM', dur: '0m 11s', graph: false, tone: 'hi_gain', error: 'input_norm.wav cannot be recognized as any known version' },
        { id: 'h6', name: 'FMAN JA Vint Jose HG Mesa', arch: 'revxstd', profile: 'Jose CAB REVxSTD', status: 'success', esr: 0.0331, epochs: 1000, time: '5/19/2026, 11:48 PM', dur: '16m 30s', graph: true, tone: 'hi_gain' },
      ],
    },
    {
      submissionId: 's-marsh', label: 'Marshall JCM Pack', createdAt: '5/23/2026, 4:01 PM', mode: 'Run Folder',
      entries: [
        { id: 'h7', name: 'JCM800 Lead Hot', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0073, epochs: 1000, time: '5/23/2026, 4:42 PM', dur: '13m 58s', graph: true, tone: 'hi_gain' },
        { id: 'h8', name: 'JCM800 Crunch Mid', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0091, epochs: 1000, time: '5/23/2026, 4:28 PM', dur: '14m 06s', graph: true, tone: 'crunch' },
        { id: 'h9', name: 'JCM800 Clean Edge', arch: 'lite', profile: 'LITE', status: 'canceled', esr: null, epochs: 1000, time: '5/23/2026, 4:13 PM', dur: '3m 20s', graph: false, tone: 'clean' },
        { id: 'h10', name: 'JCM800 Lead Bright', arch: 'standard', profile: 'STANDARD', status: 'success', esr: 0.0119, epochs: 1000, time: '5/23/2026, 4:01 PM', dur: '14m 22s', graph: true, tone: 'hi_gain' },
      ],
    },
  ];

  // per-day ESR quality distribution (last 7 sessions)
  const quality = [
    { label: 'Mon', green: 6, amber: 2, red: 0 },
    { label: 'Tue', green: 4, amber: 1, red: 1 },
    { label: 'Wed', green: 9, amber: 2, red: 0 },
    { label: 'Thu', green: 3, amber: 0, red: 2 },
    { label: 'Fri', green: 7, amber: 3, red: 1 },
    { label: 'Sat', green: 11, amber: 1, red: 0 },
    { label: 'Sun', green: 5, amber: 2, red: 0 },
  ];

  const burndown = {
    remaining: [13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8],
    done: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5],
  };
  const throughput = [3.2, 3.8, 3.6, 4.1, 3.9, 4.4, 4.2, 4.6, 4.3, 4.8, 4.69];
  const rateHistory = liveCurve.map((_, i) => 33 + Math.sin(i * 0.7) * 2.5 + (i % 3));

  // ---- STAGED batches (saved via "Stage", waiting to be queued) ----
  const stagedBatches = [
    {
      id: 'sb-friedman', label: 'Friedman BE 100', type: 'wavs', profile: 'STANDARD', arch: 'standard',
      epochs: 1000, normalize: 'Off', createdAt: 'Today · 2:58 PM', savePlot: true,
      inputDi: 'F:/NAM To Process/v3_0_0.wav',
      routing: '../../NAM/{architecture}/{folder}',
      items: [
        { name: 'Friedman BE Clean DIR', tone: 'clean' },
        { name: 'Friedman BE Crunch DIR', tone: 'crunch' },
        { name: 'Friedman BE Lead Bright DIR', tone: 'hi_gain' },
        { name: 'Friedman BE Lead Deep DIR', tone: 'hi_gain' },
        { name: 'Friedman BE Sat DIR', tone: 'hi_gain' },
      ],
    },
    {
      id: 'sb-vox', label: 'Vox AC30 Pack', type: 'folder', profile: 'LITE', arch: 'lite',
      epochs: 500, normalize: 'On', createdAt: 'Today · 1:12 PM', savePlot: true,
      inputDi: 'F:/NAM To Process/v3_0_0.wav',
      routing: '../../NAM/{architecture}/{folder}',
      items: [
        { name: 'Vox AC30 Chime DIR', tone: 'clean' },
        { name: 'Vox AC30 Top Boost DIR', tone: 'crunch' },
        { name: 'Vox AC30 Cranked DIR', tone: 'crunch' },
      ],
    },
  ];

  window.TRAINER = {
    liveJob, queued, batches, stagedBatches, liveCurve, hist, quality, burndown, throughput, rateHistory, PRINCE,
    session: {
      doneToday: 5, failedToday: 2, avgEsr: 0.0094, bestEsr: 0.0064,
      modelsPerHour: 4.69, activeSince: '3:24:02 PM', queuedCount: 9, totalInSubmission: 13,
    },
    watchFolders: [
      { name: 'Jose CAB REVxSTD', path: 'F:/NAM To Process/Jose/V2/WAV/CAB', pending: 0, skipped: 2, running: false },
      { name: 'Prince DI Standard', path: 'F:/NAM To Process/70s Silver Prince/_WAV/DI', pending: 12, skipped: 0, running: true },
    ],
    presets: [
      { id: 'std1000', name: 'Standard 1000', arch: 'standard', epochs: 1000, favorite: true },
      { id: 'rev1000', name: 'REVxSTD 1000', arch: 'revxstd', epochs: 1000, favorite: false },
      { id: 'lite500', name: 'Lite 500 (fast)', arch: 'lite', epochs: 500, favorite: false },
      { id: 'feather', name: 'Feather Live', arch: 'feather', epochs: 800, favorite: false },
    ],
    favorites: {
      presetId: 'std1000',
      routing: '../../NAM/{architecture}/{folder}',
      graphRouting: '../../Graphs/{architecture}/{folder}',
      inputDi: 'F:/NAM To Process/v3_0_0.wav',
    },
  };
})();
