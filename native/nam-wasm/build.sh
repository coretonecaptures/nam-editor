#!/usr/bin/env bash
# Build NAM Lab's offline NAM inference WASM module.
#
# Requires the Emscripten SDK. Install once:
#   git clone https://github.com/emscripten-core/emsdk.git
#   cd emsdk && ./emsdk install latest && ./emsdk activate latest
#   source ./emsdk_env.sh        # emsdk_env.bat on Windows cmd
#
# Output is written to src/renderer/public/ so the renderer can load it.
#
# NOTE: this calls emcc directly rather than going through CMake. It's a single target with a
# source glob, so CMake bought nothing but an extra required tool (on Windows, cmake often only
# exists bundled inside Visual Studio).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

DEPS_DIR="${SCRIPT_DIR}/deps"
EIGEN_DIR="${DEPS_DIR}/eigen"
# Pinned to the Eigen commit upstream neural-amp-modeler-wasm uses, so our numerical results
# match the shipping NAM plugin.
EIGEN_COMMIT="87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1"

# Windows/Git-Bash installs expose emcc.exe; POSIX installs expose emcc.
EMCC="emcc"
if ! command -v emcc >/dev/null 2>&1; then
  if command -v emcc.exe >/dev/null 2>&1; then
    EMCC="emcc.exe"
  else
    echo "ERROR: emcc not found on PATH. Install and activate the Emscripten SDK first:" >&2
    echo "  https://emscripten.org/docs/getting_started/downloads.html" >&2
    exit 1
  fi
fi

# Eigen is header-only but ~20MB, so it's fetched rather than vendored (deps/ is gitignored).
if [ ! -f "${EIGEN_DIR}/Eigen/Dense" ]; then
  echo "==> Fetching Eigen (${EIGEN_COMMIT})..."
  mkdir -p "${DEPS_DIR}"
  rm -rf "${EIGEN_DIR}"
  git clone https://gitlab.com/libeigen/eigen.git "${EIGEN_DIR}"
  git -C "${EIGEN_DIR}" checkout --quiet "${EIGEN_COMMIT}"
else
  echo "==> Eigen already present, skipping fetch."
fi

mkdir -p build

INCLUDES=(
  -I.                  # so <NAM/dsp.h> resolves
  -Ivendor             # so <nlohmann/json.hpp> resolves
  -Ivendor/nlohmann    # NAM's own headers include "json.hpp" unqualified
  -Ideps/eigen
)

COMPILE_FLAGS=(
  -std=c++17
  -O3
  -msimd128                        # WebAssembly SIMD — big win for the matrix math
  -DNAM_SAMPLE_FLOAT               # Web Audio is 32-bit float only
  -DEIGEN_STACK_ALLOCATION_LIMIT=0 # NAM's matrices are large
  -DNAM_USE_INLINE_GEMM
  -fexceptions                     # get_dsp throws on unsupported models; we catch at the boundary
)

# Deliberately ABSENT: -pthread, -sAUDIO_WORKLET, -sWASM_WORKERS. Those would make the module's
# memory a SharedArrayBuffer, which Chromium refuses to hand to an AudioWorklet unless the page
# is cross-origin isolated — unachievable in Electron (see docs/player-investigation.md).
# Without them nothing ever allocates shared memory, so isolation is never required.
LINK_FLAGS=(
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=64MB
  -sSTACK_SIZE=8MB
  -sDISABLE_EXCEPTION_CATCHING=0
  "-sEXPORTED_FUNCTIONS=_namLoadModel,_namProcessBuffer,_namFreeModel,_namResetModel,_namGetLoudness,_namHasLoudness,_namSetSlimmableSize,_namGetLastError,_malloc,_free"
  "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF32,stringToUTF8,lengthBytesUTF8,UTF8ToString"
)

SOURCES=(src/nam_offline.cpp NAM/*.cpp NAM/wavenet/*.cpp)

echo "==> Building browser/worker module..."
"${EMCC}" "${SOURCES[@]}" -o build/nam-offline.js \
  "${INCLUDES[@]}" "${COMPILE_FLAGS[@]}" "${LINK_FLAGS[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNamModule -sENVIRONMENT=web,worker

# A Node-targeted build of the same sources, used by test.cjs to verify inference actually runs.
if [ "${1:-}" = "--with-test-build" ]; then
  echo "==> Building Node test module..."
  "${EMCC}" "${SOURCES[@]}" -o build/nam-offline-node.cjs \
    "${INCLUDES[@]}" "${COMPILE_FLAGS[@]}" "${LINK_FLAGS[@]}" \
    -sMODULARIZE=1 -sENVIRONMENT=node
fi

echo "==> Copying output to renderer/public..."
OUT_DIR="${SCRIPT_DIR}/../../src/renderer/public"
mkdir -p "${OUT_DIR}"
cp build/nam-offline.js "${OUT_DIR}/nam-offline.js"
cp build/nam-offline.wasm "${OUT_DIR}/nam-offline.wasm"

echo ""
echo "Done. Wrote:"
echo "  ${OUT_DIR}/nam-offline.js   ($(du -h "${OUT_DIR}/nam-offline.js" | cut -f1))"
echo "  ${OUT_DIR}/nam-offline.wasm ($(du -h "${OUT_DIR}/nam-offline.wasm" | cut -f1))"
