// Token counting for benchmark reports.
//
// Exact Claude tokenization is not available offline. When
// BENCH_TOKENIZER_DIR names a directory with `js-tiktoken` installed, counts
// use OpenAI's o200k_base encoding (the GPT-4o / Codex family tokenizer) as a
// close, reproducible proxy. Otherwise counts are ceil(chars / 4) estimates.
// Every report states which method produced its numbers.

import { createRequire } from "node:module";
import { join } from "node:path";

let encoderPromise;

function loadEncoder() {
  encoderPromise ??= (async () => {
    const dir = process.env.BENCH_TOKENIZER_DIR;
    if (!dir) return null;
    try {
      const require = createRequire(join(dir, "package.json"));
      const { getEncoding } = require("js-tiktoken");
      return getEncoding("o200k_base");
    } catch {
      return null;
    }
  })();
  return encoderPromise;
}

export async function countTokens(text) {
  const encoder = await loadEncoder();
  if (!encoder) return Math.ceil(text.length / 4);
  return encoder.encode(text).length;
}

export async function tokenizerLabel() {
  return (await loadEncoder())
    ? "o200k_base via js-tiktoken (measured; proxy for Claude tokens)"
    : "ceil(chars/4) (estimated)";
}
