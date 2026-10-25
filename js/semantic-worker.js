/* ===========================================================================
   semantic-worker.js — runs the language model off the main thread.

   A module worker, started by semantic.js. It loads Transformers.js and the
   all-MiniLM-L6-v2 model from this site's own vendor/ folder — nothing is
   fetched from anyone else — and turns text into fingerprints (sentence
   embeddings) on request, so the page stays responsive while it works.

   Messages in:   { id, type: 'load' }
                  { id, type: 'embed', texts: [...] }
   Messages out:  { type: 'progress', file, status, progress }
                  { id, ok: true, data, dims }   or   { id, ok: false, error }
   =========================================================================== */

import { pipeline, env } from '../vendor/transformers-3.0.2/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../vendor/models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers-3.0.2/', import.meta.url).href;

var MODEL = 'Xenova/all-MiniLM-L6-v2';
var extractor = null;

self.onmessage = async function (ev) {
  var msg = ev.data;
  try {
    if (msg.type === 'load') {
      extractor = await pipeline('feature-extraction', MODEL, {
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
