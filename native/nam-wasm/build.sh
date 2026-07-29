#!/usr/bin/env bash
# Build NAM Lab's offline NAM inference WASM module.
#
# Requires the Emscripten SDK on PATH (emcmake / emcc). Install:
#   git clone https://github.com/emscripten-core/emsdk.git
#   cd emsdk && ./emsdk install latest && ./emsdk activate latest
#   source ./emsdk_env.sh          # (emsdk_env.bat on Windows cmd)
#
# Output is copied to src/renderer/public/ so the renderer can load it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

DEPS_DIR="${SCRIPT_DIR}/deps"
EIGEN_DIR="${DEPS_DIR}/eigen"
# Pinned to the same Eigen commit upstream neural-amp-modeler-wasm uses, so our numerical
# results match the shipping NAM plugin.
EIGEN_COMMIT="87300c93cae6a8afd9a4f8aa8d9d5c5324cf02e1"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "ERROR: emcmake not found on PATH. Install and activate the Emscripten SDK first." >&2
  echo "  https://emscripten.org/docs/getting_started/downloads.html" >&2
  exit 1
fi

# Eigen is header-only but 20MB, so it is fetched rather than vendored (deps/ is gitignored).
if [ ! -f "${EIGEN_DIR}/Eigen/Dense" ]; then
  echo "==> Fetching Eigen (${EIGEN_COMMIT})..."
  mkdir -p "${DEPS_DIR}"
  rm -rf "${EIGEN_DIR}"
  git clone https://gitlab.com/libeigen/eigen.git "${EIGEN_DIR}"
  git -C "${EIGEN_DIR}" checkout --quiet "${EIGEN_COMMIT}"
else
  echo "==> Eigen already present, skipping fetch."
fi

echo "==> Configuring..."
rm -rf build
mkdir -p build
cd build
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

echo "==> Building..."
cmake --build . --config Release -j4

echo "==> Copying output to renderer/public..."
OUT_DIR="${SCRIPT_DIR}/../../src/renderer/public"
mkdir -p "${OUT_DIR}"
cp nam-offline.js "${OUT_DIR}/nam-offline.js"
cp nam-offline.wasm "${OUT_DIR}/nam-offline.wasm"

echo ""
echo "Done. Wrote:"
echo "  ${OUT_DIR}/nam-offline.js"
echo "  ${OUT_DIR}/nam-offline.wasm"
