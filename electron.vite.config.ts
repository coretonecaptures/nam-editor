import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// NOTE: cross-origin isolation headers (COOP/COEP) were removed from the dev server and the
// preview server here.
//
// They were added to make `crossOriginIsolated` true so a threaded WASM build could transfer a
// SharedArrayBuffer into an AudioWorklet. That approach was abandoned — see
// docs/player-investigation.md — and the shipping worklet deliberately avoids SharedArrayBuffer
// entirely (public/nam-worklet.js reports `usedSharedArrayBuffer: false`). The main process
// dropped its copy of these headers in b9dfde2 with a comment warning they "risk blocking
// legitimately-loaded sub-resources (local-file:// images, Tone3000 assets)". This copy survived,
// and did exactly that: `Cross-Origin-Embedder-Policy: require-corp` makes every cross-origin
// subresource opt in via CORP, which Tone3000's image CDN does not send, so every tone thumbnail
// was fetched successfully and then discarded by Chromium with
// ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep.
//
// Because these only ever applied to the dev and preview servers, the packaged app was unaffected,
// which is why the artwork looked broken only when running from source.
//
// Do not reintroduce them without first confirming something actually needs SharedArrayBuffer.

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(version)
    },
    server: {
      hmr: false
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
