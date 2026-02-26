/**
 * Guardian -- Ollama client utility
 *
 * Minimal fetch wrapper for local Ollama instance.
 * Uses Node 20 native fetch (no dependencies).
 */

const BASE = 'http://localhost:11434';

async function isAvailable() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BASE}/api/tags`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function embed(text, opts = {}) {
  const model = opts.model || 'nomic-embed-text';
  const res = await fetch(`${BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.embedding;
}

async function generate(prompt, opts = {}) {
  const model = opts.model || 'qwen2.5:3b';
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) {
    throw new Error(`Ollama generate failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.response;
}

module.exports = { isAvailable, embed, generate };
