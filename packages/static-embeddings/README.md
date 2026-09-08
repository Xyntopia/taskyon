# Static embeddings

Shared, runtime-independent loading and pooling for Taskyon's static embedding format.
This package does not own caches, tokenizers, network access, workers or application state.

- `loadStaticEmbeddingModelAssets(baseUrl, readAsset)` validates the versioned manifest,
  verifies SHA-256 asset checksums and returns `{ model, manifest }`.
- `poolStaticTokenEmbeddings(model, ids, mask?)` mean-pools int8 token vectors with
  per-token scales and normalizes the result. Token IDs may be numbers or BigInts.
- `DEFAULT_STATIC_EMBEDDING_MODEL` identifies the existing Taskyon model.

Callers inject asset reads and own their cache lifetime. Taskyon's existing adapter
preserves its configuration API; independent tooling can use this package without
importing Taskyon core. Pooling is insensitive to token order and is not a proof of
code equivalence. Existing Taskyon search diagnostics exercise the pooling API.
