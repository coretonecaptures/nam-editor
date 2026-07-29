cmake_minimum_required(VERSION 3.16)
project(nam-offline-wasm CXX)

# NAM Lab's offline (non-real-time) NAM inference module.
#
# Deliberately does NOT use -pthread / -sAUDIO_WORKLET / -sWASM_WORKERS, unlike upstream
# tone-3000/neural-amp-modeler-wasm. Those flags force a SharedArrayBuffer-backed threaded
# build, which requires the hosting page to be cross-origin isolated — unachievable in Electron
# (see docs/player-investigation.md). Rendering offline needs none of it.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Eigen is fetched by build.sh into deps/ (20MB — not vendored into the repo).
set(EIGEN_PATH "${CMAKE_CURRENT_SOURCE_DIR}/deps/eigen" CACHE PATH "Path to Eigen headers")
if(NOT EXISTS "${EIGEN_PATH}/Eigen/Dense")
  message(FATAL_ERROR
    "Eigen not found at ${EIGEN_PATH}. Run ./build.sh, which fetches it automatically.")
endif()

file(GLOB_RECURSE NAM_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/NAM/*.cpp")

add_executable(nam-offline
  "${CMAKE_CURRENT_SOURCE_DIR}/src/nam_offline.cpp"
  ${NAM_SOURCES}
)

target_include_directories(nam-offline PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"          # so <NAM/dsp.h> resolves
  "${CMAKE_CURRENT_SOURCE_DIR}/vendor"   # so <nlohmann/json.hpp> resolves
  "${EIGEN_PATH}"
)

# Web Audio is 32-bit float only, so build the DSP for float samples (sets NAM_SAMPLE=float).
target_compile_definitions(nam-offline PRIVATE NAM_SAMPLE_FLOAT)
# NAM's matrices can be large; don't let Eigen cap stack allocation.
target_compile_definitions(nam-offline PRIVATE EIGEN_STACK_ALLOCATION_LIMIT=0)

target_compile_options(nam-offline PRIVATE
  -O3
  -msimd128              # WebAssembly SIMD — big win for the matrix math
  -DNAM_USE_INLINE_GEMM  # inline GEMM path from NeuralAmpModelerCore
  -fexceptions           # get_dsp throws on unsupported models; we catch at the boundary
)

# Single-threaded, ES6-module output. Note what is ABSENT: -pthread, -sAUDIO_WORKLET,
# -sWASM_WORKERS. Without them nothing ever allocates a SharedArrayBuffer, so
# crossOriginIsolated is never consulted and the module loads in a plain Worker.
set_target_properties(nam-offline PROPERTIES
  LINK_FLAGS
  "-O3 \
-sMODULARIZE=1 \
-sEXPORT_ES6=1 \
-sEXPORT_NAME=createNamModule \
-sENVIRONMENT=web,worker \
-sALLOW_MEMORY_GROWTH=1 \
-sINITIAL_MEMORY=64MB \
-sEXPORTED_FUNCTIONS=_namLoadModel,_namProcessBuffer,_namFreeModel,_namResetModel,_namGetLoudness,_namHasLoudness,_namSetSlimmableSize,_malloc,_free \
-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF32,HEAPU8,stringToUTF8,lengthBytesUTF8 \
-sDISABLE_EXCEPTION_CATCHING=0 \
-sSTACK_SIZE=8MB"
)
