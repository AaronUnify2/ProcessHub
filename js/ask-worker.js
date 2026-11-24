/* ===========================================================================
   ask-worker.js — the language model, in a background worker.

   Used by js/ask-engine.js (faq-ask.html). The same code as the worker inside
   ask.html. The library and the model are the copies kept under vendor/ (see
   vendor/README.md), so nothing is fetched from anyone else's servers. The
   browser keeps the model after the first visit.

   Messages in:  { id, type: 'load', base, model }
                 { id, type: 'embed', texts: [...] }
   Messages out: { id, ok, data, dims } or { id, ok: false, error }
                 { type: 'progress', file, status, progress } while loading
   =========================================================================== */

var extractor = null;

self.onmessage = async function (ev) {
  var msg = ev.data;
  try {
    if (msg.type === 'load') {
      var lib = await import(msg.base + 'vendor/transformers-3.0.2/transformers.min.js');
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = true;
      lib.env.localModelPath = msg.base + 'vendor/models/';
      lib.env.backends.onnx.wasm.wasmPaths = msg.base + 'vendor/transformers-3.0.2/';
      extractor = await lib.pipeline('feature-extraction', msg.model, {
        dtype: 'q8',
        progress_callback: function (p) {
          self.postMessage({ type: 'progress', file: p.file || '', status: p.status, progress: p.progress || 0 });
        }
      });
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'embed') {
      var out = await extractor(msg.texts, { pooling: 'mean', normalize: true });
      self.postMessage({ id: msg.id, ok: true, data: out.data, dims: out.dims });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
