/**
 * Local text embedding using @xenova/transformers.
 *
 * Runs the model fully locally in Node — no API keys, no network calls
 * after the first download. The default model (`all-MiniLM-L6-v2`)
 * produces 384-dim vectors and is small (~90MB) and fast.
 *
 * The transformers library is HEAVY (pulls in onnxruntime and friends),
 * so we dynamic-import it on first use. This keeps `autocode --help`
 * fast — no model loading until someone actually needs an embedding.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Embedder = any;

let _embedder: Embedder | null = null;
let _loading: Promise<Embedder> | null = null;

export async function getEmbedder(modelName: string): Promise<Embedder> {
  if (_embedder) return _embedder;
  if (_loading) return _loading;

  _loading = (async () => {
    // Dynamic import so the heavy bundle isn't pulled in on every CLI run.
    const { pipeline } = await import("@xenova/transformers");
    const e = await pipeline("feature-extraction", modelName);
    _embedder = e;
    _loading = null;
    return e;
  })();

  return _loading;
}

export async function embedText(
  text: string,
  modelName: string,
): Promise<number[]> {
  const embedder = await getEmbedder(modelName);
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedBatch(
  texts: string[],
  modelName: string,
): Promise<number[][]> {
  // The transformers pipeline supports batched input, but the types are
  // awkward to pin down. Sequential is simpler and fast enough for v1.
  // Optimize later if the sync processor becomes a bottleneck.
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedText(text, modelName));
  }
  return out;
}
