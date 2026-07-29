/**
 * NAM Lab — offline (non-real-time) NAM inference entry point for WebAssembly.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Upstream tone-3000/neural-amp-modeler-wasm builds `wasm/t3k-wasm-module.cpp`, which wires
 * NAM inference into Emscripten's real-time Web Audio worklet scheduler
 * (`emscripten/webaudio.h`, `emscripten_create_wasm_audio_worklet_node`, ...). That build
 * requires `-pthread -sAUDIO_WORKLET -sWASM_WORKERS`, which in turn requires the hosting page
 * to be cross-origin isolated (`self.crossOriginIsolated === true`) before Chromium will let a
 * SharedArrayBuffer be transferred into the AudioWorklet thread.
 *
 * We could never get `crossOriginIsolated` to be true inside Electron — see
 * `docs/player-investigation.md` for the full list of what was tried (COOP/COEP via
 * onHeadersReceived, a custom app:// protocol, Vite middleware, sandbox: true, ...).
 *
 * The key realization: the neural-net inference itself has NO threading requirement. It's an
 * ordinary synchronous call — `nam::DSP::process()`. The pthreads/AudioWorklet machinery exists
 * only to invoke that call every 128 samples from the browser's real-time audio thread.
 *
 * A library preview player does not need real-time bounded latency — it can render the whole
 * buffer once, then play the result back. So this entry point exposes the DSP directly and
 * skips the real-time scaffolding entirely. Built WITHOUT -pthread / -sAUDIO_WORKLET /
 * -sWASM_WORKERS, it never allocates a SharedArrayBuffer, so cross-origin isolation is never
 * required. That is not a security bypass: COOP/COEP exists to gate shared-memory
 * (Spectre-class) side channels, and this module simply does not use shared memory.
 *
 * Everything below is plain synchronous C — callable from an ordinary Web Worker or even the
 * main thread.
 */

#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>

#include <emscripten/emscripten.h>

#include <nlohmann/json.hpp>

#include <NAM/activations.h>
#include <NAM/dsp.h>
#include <NAM/get_dsp.h>
#include <NAM/slimmable.h>

namespace
{
/// Owns a loaded model. Handed back to JS as an opaque pointer.
struct OfflineModel
{
  std::unique_ptr<nam::DSP> dsp;
};

bool g_activationsInitialized = false;

// Set whenever a call below catches an exception, so JS can retrieve a real message via
// namGetLastError() instead of whatever Emscripten's default JS<->C++ exception bridging
// produces for an uncaught throw (frequently an object with no usable toString/.message,
// which is exactly what surfaced to the user as "[object Object]").
std::string g_lastError;

/// Run `fn`, catching anything it throws into g_lastError instead of letting it cross the
/// Emscripten export boundary as an opaque, hard-to-stringify JS value.
template <typename Fn>
bool guarded(Fn&& fn)
{
  try
  {
    fn();
    return true;
  }
  catch (const std::exception& e)
  {
    g_lastError = e.what();
    return false;
  }
  catch (...)
  {
    g_lastError = "Unknown error in NAM inference module";
    return false;
  }
}
} // namespace

extern "C" {

/**
 * Parse a .nam file's JSON contents and build a DSP instance.
 *
 * @param jsonStr  Full text of the .nam file (it is JSON).
 * @return Opaque model handle, or nullptr if the model could not be loaded (unsupported
 *         version, malformed JSON, unknown architecture, ...). Caller must pass the result to
 *         namFreeModel() when finished.
 */
EMSCRIPTEN_KEEPALIVE
void* namLoadModel(const char* jsonStr)
{
  if (jsonStr == nullptr)
  {
    g_lastError = "namLoadModel called with a null pointer";
    return nullptr;
  }

  if (!g_activationsInitialized)
  {
    // Matches upstream's real-time module: the fast tanh approximation is what the shipping
    // NAM plugin uses, so enabling it keeps our rendered output consistent with what users
    // hear elsewhere.
    nam::activations::Activation::enable_fast_tanh();
    g_activationsInitialized = true;
  }

  try
  {
    // NOTE: parse explicitly and call the nlohmann::json overload. There is NO
    // get_dsp(std::string) overload — passing a char*/std::string would silently select
    // get_dsp(std::filesystem::path) and try to open a *file* whose name is the entire JSON
    // blob. We hold the .nam contents in memory, so the json overload is the correct one.
    const nlohmann::json config = nlohmann::json::parse(jsonStr);

    // Validate the keys get_dsp() reads with operator[] BEFORE calling it.
    //
    // This is not belt-and-braces: nlohmann's const operator[] uses assert(), not exceptions.
    // On a missing key that fires Emscripten's abort(), which tears down the whole module
    // instance -- unrecoverable, and not catchable by try/catch or the guarded() helper. A
    // truncated or hand-edited .nam would take the player down for the rest of the session
    // instead of showing an error. get_dsp reads "version", "architecture" and "config" this
    // way; "weights" is safe because GetWeights() uses find() and throws properly.
    for (const char* required : {"version", "architecture", "config"})
    {
      if (!config.contains(required))
      {
        g_lastError = std::string("This .nam file is missing its \"") + required
                      + "\" field, so it can't be loaded. The file may be corrupt or truncated.";
        return nullptr;
      }
    }
    if (!config["version"].is_string() || !config["architecture"].is_string())
    {
      g_lastError = "This .nam file's \"version\" or \"architecture\" field is not text, so it "
                    "can't be loaded. The file may be corrupt.";
      return nullptr;
    }

    std::unique_ptr<nam::DSP> dsp = nam::get_dsp(config);
    if (dsp == nullptr)
    {
      g_lastError = "This .nam file's architecture is not supported by the bundled NAM core";
      return nullptr;
    }

    auto* model = new OfflineModel{std::move(dsp)};
    return static_cast<void*>(model);
  }
  catch (const std::exception& e)
  {
    // get_dsp throws on unsupported/invalid models (and json::parse throws on malformed JSON).
    // Report failure as nullptr rather than letting the exception unwind into JS, where it
    // would surface as an opaque, hard-to-stringify value instead of e.what()'s real message.
    g_lastError = e.what();
    return nullptr;
  }
  catch (...)
  {
    g_lastError = "Unknown error while loading the model";
    return nullptr;
  }
}

/**
 * Reported model loudness in dB, used to normalize playback level across captures.
 * Returns 0 when the model carries no loudness metadata.
 */
EMSCRIPTEN_KEEPALIVE
float namGetLoudness(void* handle)
{
  auto* model = static_cast<OfflineModel*>(handle);
  if (model == nullptr || model->dsp == nullptr)
    return 0.0f;
  return model->dsp->HasLoudness() ? static_cast<float>(model->dsp->GetLoudness()) : 0.0f;
}

/**
 * True when the model carries loudness metadata (so callers can distinguish "0 dB" from
 * "unknown").
 */
EMSCRIPTEN_KEEPALIVE
int namHasLoudness(void* handle)
{
  auto* model = static_cast<OfflineModel*>(handle);
  if (model == nullptr || model->dsp == nullptr)
    return 0;
  return model->dsp->HasLoudness() ? 1 : 0;
}

/**
 * Select the sub-model of an A2/Slimmable container. No-op for non-slimmable models.
 *
 * Threshold semantics are half-open `[prev_max, this_max)`, so 0.0 selects the smallest
 * ("nano") sub-model and 1.0 selects the largest.
 */
EMSCRIPTEN_KEEPALIVE
void namSetSlimmableSize(void* handle, float size)
{
  auto* model = static_cast<OfflineModel*>(handle);
  if (model == nullptr || model->dsp == nullptr)
    return;
  if (auto* slimmable = dynamic_cast<nam::SlimmableModel*>(model->dsp.get()))
    slimmable->SetSlimmableSize(size);
}

/**
 * Reset the model's internal state (ring buffers, recurrent state) and prewarm it.
 *
 * Call before rendering a fresh buffer so a previous render can't bleed into the next one.
 *
 * Uses ResetAndPrewarm() rather than plain Reset(): NAM models carry internal history, so
 * without prewarming the first samples of a render come out wrong. A real-time player hides
 * that behind a few hundred throwaway frames, but an offline render's output IS the final
 * result, so it has to be correct from sample 0.
 *
 * @param sampleRate  Sample rate of the audio about to be rendered.
 * @param maxBlock    Largest block size that will be passed to namProcessBuffer().
 * @return 1 on success, 0 on invalid arguments or if the model threw. Check
 *         namGetLastError() on failure.
 */
EMSCRIPTEN_KEEPALIVE
int namResetModel(void* handle, float sampleRate, int maxBlock)
{
  auto* model = static_cast<OfflineModel*>(handle);
  if (model == nullptr || model->dsp == nullptr || maxBlock <= 0)
  {
    g_lastError = "namResetModel called with an invalid handle or maxBlock";
    return 0;
  }
  return guarded([&] { model->dsp->ResetAndPrewarm(static_cast<double>(sampleRate), maxBlock); }) ? 1 : 0;
}

/**
 * Run inference over a buffer of mono samples.
 *
 * `in` and `out` are pointers into the WASM heap (allocate with _malloc from JS and write the
 * input samples there via HEAPF32). They may be the same pointer for in-place processing.
 *
 * This is the single hot call — for a preview render, JS hands over the whole DI buffer at once
 * (or in large chunks) instead of 128 frames at a time, which is exactly what lets us avoid the
 * real-time audio thread and its SharedArrayBuffer requirement.
 *
 * @return 1 on success, 0 if the handle/arguments were invalid or the model threw. Check
 *         namGetLastError() on failure.
 */
EMSCRIPTEN_KEEPALIVE
int namProcessBuffer(void* handle, float* in, float* out, int numSamples)
{
  auto* model = static_cast<OfflineModel*>(handle);
  if (model == nullptr || model->dsp == nullptr || in == nullptr || out == nullptr || numSamples <= 0)
  {
    g_lastError = "namProcessBuffer called with an invalid handle or buffer";
    return 0;
  }

  // nam::DSP::process() takes NAM_SAMPLE** (an array of channel pointers). NAM models are mono,
  // so we pass single-element arrays.
  return guarded([&] {
    NAM_SAMPLE* inputPtr = in;
    NAM_SAMPLE* outputPtr = out;
    model->dsp->process(&inputPtr, &outputPtr, numSamples);
  }) ? 1 : 0;
}

/**
 * Retrieve the message from the most recent failure in this module (namLoadModel returning
 * nullptr, or namResetModel/namProcessBuffer returning 0). Valid until the next failing call.
 *
 * Returned pointer is owned by the module; JS should read it with UTF8ToString() immediately,
 * not hold onto it.
 */
EMSCRIPTEN_KEEPALIVE
const char* namGetLastError()
{
  return g_lastError.c_str();
}

/**
 * Destroy a model created by namLoadModel(). Safe to call with nullptr.
 */
EMSCRIPTEN_KEEPALIVE
void namFreeModel(void* handle)
{
  delete static_cast<OfflineModel*>(handle);
}

} // extern "C"
