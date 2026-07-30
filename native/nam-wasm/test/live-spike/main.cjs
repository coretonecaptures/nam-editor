/**
 * Standalone Electron harness for the Phase 1 live-player spike.
 *
 * Isolated on purpose: it uses its own userData dir so it doesn't trip NAM Lab's
 * single-instance lock (the real app may be running), and serves assets over
 * http://127.0.0.1 because AudioWorklet.addModule() and fetch() of a .wasm are both blocked
 * from file:// origins.
 *
 * Everything the renderer logs is relayed to stdout so the result is observable from a terminal.
 */
const { app, BrowserWindow } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const PUBLIC_DIR = process.env.SPIKE_PUBLIC_DIR
const NAM_PATH = process.env.SPIKE_NAM_PATH

if (!PUBLIC_DIR || !NAM_PATH) {
  console.error('SPIKE_PUBLIC_DIR and SPIKE_NAM_PATH must be set')
  process.exit(1)
}

// Deliberately NOT cross-origin isolated: no COOP/COEP headers are sent. If the spike passes
// under these headers, it proves the approach doesn't depend on the isolation we can't get.
const MIME = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html',
  '.nam': 'application/json'
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/' || url === '/index.html') {
    // SPIKE_PAGE=chain.html runs the full-chain test (worklet + cabinet IR) instead.
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(fs.readFileSync(path.join(__dirname, process.env.SPIKE_PAGE || 'index.html')))
    return
  }
  if (url === '/model.nam') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(fs.readFileSync(NAM_PATH))
    return
  }
  if (url === '/ir.wav') {
    if (!process.env.SPIKE_IR_PATH) {
      res.writeHead(404)
      res.end('SPIKE_IR_PATH not set')
      return
    }
    res.writeHead(200, { 'Content-Type': 'audio/wav' })
    res.end(fs.readFileSync(process.env.SPIKE_IR_PATH))
    return
  }

  const filePath = path.join(PUBLIC_DIR, decodeURIComponent(url))
  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
  res.end(fs.readFileSync(filePath))
})

app.setPath('userData', path.join(app.getPath('temp'), 'nam-live-spike-userdata'))

let exitCode = 1

app.whenReady().then(() => {
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
    })

    win.webContents.on('console-message', (_e, _level, message) => {
      console.log(message)
      if (message.startsWith('SPIKE_DONE ')) {
        try {
          exitCode = JSON.parse(message.slice('SPIKE_DONE '.length)).ok ? 0 : 1
        } catch {
          exitCode = 1
        }
        setTimeout(() => app.exit(exitCode), 150)
      }
    })

    void win.loadURL(`http://127.0.0.1:${port}/`)

    // Hard stop so a hung worklet can't leave this running forever.
    setTimeout(() => {
      console.log('SPIKE_TIMEOUT — no result after 60s')
      app.exit(1)
    }, 60000)
  })
})
