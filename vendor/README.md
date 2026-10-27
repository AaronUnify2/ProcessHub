# vendor/ — self-hosted copies for the Ask page

`ask.html` matches visitors' questions to the published FAQ with a small
language model that runs in their browser, and Process Hub's Probe section
(`js/semantic.js`, `js/semantic-worker.js`) uses the same model to find the
questions the FAQ doesn't answer. The experimental `map.html` uses it too,
with `ask.html`'s fingerprints. Everything they need is kept here,
in this repository, so the page fetches nothing from anyone else's servers and
keeps working whatever happens to the original sources. Nothing here changes
unless someone deliberately replaces it.

These are unmodified copies, kept exactly as published.

## What is here

| Folder | What | Version | Source | Licence |
|---|---|---|---|---|
| `transformers-3.0.2/` | Transformers.js — loads the model and runs it in the browser. `transformers.min.js` includes ONNX Runtime Web; `ort-wasm-simd-threaded.jsep.wasm` is its engine | 3.0.2 (ONNX Runtime Web 1.21.0-dev.20241024-d9ca84ef96) | npm package `@huggingface/transformers@3.0.2`, `dist/`, via cdn.jsdelivr.net | Apache 2.0 (`LICENSE`); ONNX Runtime: MIT (`LICENSE-onnxruntime`) |
| `models/Xenova/all-MiniLM-L6-v2/` | The model: all-MiniLM-L6-v2 sentence embeddings, 8-bit quantised ONNX weights, and its tokenizer | Hugging Face commit `751bff37182d3f1213fa05d7196b954e230abad9` | https://huggingface.co/Xenova/all-MiniLM-L6-v2 (converted from https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) | Apache 2.0 (see the model card, `README.md`; licence text as in `transformers-3.0.2/LICENSE`) |

Copied on 2026-10-25.

## Checksums (SHA-256)

```
495b03b846b315baab6ff2e2f048085e45684b910799e36c4d7f2b4be00cff72  transformers-3.0.2/transformers.min.js
0f6fe5c40378504d1a25a77f766133464bb15705af23e01c994f185719fb080e  transformers-3.0.2/ort-wasm-simd-threaded.jsep.wasm
7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7  models/Xenova/all-MiniLM-L6-v2/config.json
da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0  models/Xenova/all-MiniLM-L6-v2/tokenizer.json
9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3  models/Xenova/all-MiniLM-L6-v2/tokenizer_config.json
afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1  models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
```

Check them with `cd vendor && sha256sum -c` and the block above.

## The fingerprints depend on the model

`ask.html` holds a precomputed fingerprint for every FAQ question and answer
passage, made with exactly this model. They only mean anything to the model
that made them. **If the model files are ever replaced, regenerate the
fingerprints at the same time** (open Process Hub with the published
content, run `copy(await Probe.exportFingerprints())` in the console, paste
over the `fingerprints` block in `ask.html`), or the matches will quietly get
worse. Process Hub keeps its own in each browser; a new model name (below)
makes it work them out again.

## Upgrading

Only if there is a reason to — a browser stops running it, or a clearly
better model. Put the new version in its own folder (e.g.
`transformers-3.x.y/`), change the paths in `ask.html`'s and `map.html`'s
workers and in `js/semantic-worker.js`, regenerate the fingerprints, test with outside
network access blocked, and update this file. Remove the old folder
afterwards. A different model also needs a new model name in `ask.html`, `map.html` and
`js/semantic.js` (`MODEL`): fingerprints are kept under it in each browser,
and a new name is what tells them apart from the old model's.
