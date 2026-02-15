/**
 * Guardian — Multi-Provider API Abstraction
 *
 * Unified interface for Claude CLI, Anthropic API, OpenAI API, and
 * Moonshot (Kimi K2) providers. Each provider normalizes its streaming
 * events to a standard format and emits them via EventEmitter.
 *
 * Standard event types:
 *   { type: 'message_start', message: { id, model } }
 *   { type: 'text_delta', text: string }
 *   { type: 'thinking_delta', thinking: string }
 *   { type: 'message_stop' }
 *   { type: 'result', usage: { input_tokens, output_tokens } }
 *   { type: 'error', error: string }
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('./logger');
const secureStore = require('./secure-store');

// ── Claude CLI Resolution (mirrors main.js / summarizer.js) ──────

function getClaudePath() {
  const localBin = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(localBin)) return localBin;
  return 'claude';
}

const claudeBinDir = path.join(os.homedir(), '.local', 'bin');
const sep = process.platform === 'win32' ? ';' : ':';
const currentPath = process.env.Path || process.env.PATH || '';
const newPath = claudeBinDir + sep + currentPath;
const cliEnv = {
  ...process.env,
  Path: newPath,
  PATH: newPath,
};

// ══════════════════════════════════════════════════════════════════
// SSE Stream Parser — shared async generator for all HTTP providers
// ══════════════════════════════════════════════════════════════════

/**
 * Parse an SSE stream from a fetch() Response body.
 * Yields { event, data } objects for each SSE message.
 *
 * @param {Response} response - fetch() Response with readable body
 * @yields {{ event: string|null, data: string }}
 */
async function* parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      let currentEvent = null;
      let currentData = [];

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData.push(line.slice(6));
        } else if (line === '' && currentData.length > 0) {
          // Empty line = end of SSE message
          const dataStr = currentData.join('\n');
          if (dataStr !== '[DONE]') {
            yield { event: currentEvent, data: dataStr };
          }
          currentEvent = null;
          currentData = [];
        }
      }
    }

    // Flush any remaining data
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let currentEvent = null;
      let currentData = [];
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData.push(line.slice(6));
        }
      }
      if (currentData.length > 0) {
        const dataStr = currentData.join('\n');
        if (dataStr !== '[DONE]') {
          yield { event: currentEvent, data: dataStr };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ══════════════════════════════════════════════════════════════════
// ClaudeCLIProvider — wraps spawn('claude') with stream-json output
// ══════════════════════════════════════════════════════════════════

class ClaudeCLIProvider {
  constructor(config = {}) {
    this._claudePath = config.claudePath || null;
  }

  get name() { return 'Claude CLI'; }
  get type() { return 'claude-cli'; }

  isAvailable() {
    const p = this._claudePath || getClaudePath();
    if (p === 'claude') {
      try {
        require('child_process').execSync('claude --version', {
          stdio: 'pipe',
          timeout: 5000,
          env: cliEnv,
        });
        return true;
      } catch (_) {
        return false;
      }
    }
    return fs.existsSync(p);
  }

  /**
   * Send a message via Claude CLI.
   *
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} options
   * @param {string} [options.model] - Model ID (passed to --model)
   * @param {boolean} [options.stream=true] - Always true for CLI
   * @param {number} [options.maxTokens] - Max output tokens (--max-tokens)
   * @param {string} [options.resumeSessionId] - Claude CLI session to resume
   * @returns {EventEmitter} Emits standard events
   */
  sendMessage(messages, options = {}) {
    const emitter = new EventEmitter();
    const claudePath = this._claudePath || getClaudePath();

    // Extract the last user message as the prompt
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: 'No user message provided' });
      });
      return emitter;
    }

    const args = ['-p', lastUser.content, '--output-format', 'stream-json'];

    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.maxTokens) {
      args.push('--max-tokens', String(options.maxTokens));
    }
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    log.info('providers: spawning Claude CLI:', claudePath, args.slice(0, 4).join(' '));

    let proc;
    try {
      proc = spawn(claudePath, args, {
        cwd: os.homedir(),
        env: cliEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      log.error('providers: Claude CLI spawn failed:', e.message);
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: `Failed to spawn Claude CLI: ${e.message}` });
      });
      return emitter;
    }

    let stdoutBuf = '';

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          this._normalizeCliEvent(parsed, emitter);
        } catch (_) { /* non-JSON line */ }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const err = chunk.toString().trim();
      if (err) {
        emitter.emit('error', { type: 'error', error: err });
      }
    });

    proc.on('close', (code) => {
      // Flush remaining buffer
      if (stdoutBuf.trim()) {
        try {
          const parsed = JSON.parse(stdoutBuf.trim());
          this._normalizeCliEvent(parsed, emitter);
        } catch (_) {}
      }

      if (code !== 0) {
        emitter.emit('error', { type: 'error', error: `Claude CLI exited with code ${code}` });
      }
      emitter.emit('done', { exitCode: code });
    });

    proc.on('error', (e) => {
      emitter.emit('error', { type: 'error', error: `Process error: ${e.message}` });
    });

    // Attach kill method for cancellation
    emitter.abort = () => {
      try { proc.kill(); } catch (_) {}
    };

    return emitter;
  }

  /**
   * Normalize Claude CLI stream-json events to standard format.
   */
  _normalizeCliEvent(parsed, emitter) {
    // Session start with ID
    if (parsed.type === 'system' && parsed.session_id) {
      emitter.emit('message_start', {
        type: 'message_start',
        message: { id: parsed.session_id, model: parsed.model || null },
      });
    }

    // Content block deltas
    if (parsed.type === 'content_block_delta') {
      if (parsed.delta?.type === 'text_delta') {
        emitter.emit('text_delta', { type: 'text_delta', text: parsed.delta.text });
      }
      if (parsed.delta?.type === 'thinking_delta') {
        emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: parsed.delta.thinking });
      }
    }

    // Full assistant message (non-streaming result)
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'text') {
          emitter.emit('text_delta', { type: 'text_delta', text: block.text });
        }
        if (block.type === 'thinking') {
          emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: block.thinking || '' });
        }
      }
    }

    // Result with usage
    if (parsed.type === 'result') {
      const u = parsed.usage || parsed.message?.usage || {};
      emitter.emit('result', {
        type: 'result',
        usage: {
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0,
        },
      });
      emitter.emit('message_stop', { type: 'message_stop' });
    }

    // Forward raw event for consumers that want it
    emitter.emit('raw', parsed);
  }
}

// ══════════════════════════════════════════════════════════════════
// AnthropicAPIProvider — direct HTTPS to api.anthropic.com
// ══════════════════════════════════════════════════════════════════

class AnthropicAPIProvider {
  constructor({ apiKey, baseUrl } = {}) {
    this._apiKey = apiKey || null;
    this._baseUrl = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  }

  get name() { return 'Anthropic API'; }
  get type() { return 'anthropic'; }

  isAvailable() {
    const key = this._apiKey || secureStore.getKey('anthropic');
    return !!key;
  }

  /**
   * Send a message via Anthropic Messages API.
   *
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} options
   * @param {string} [options.model='claude-sonnet-4-5-20250929'] - Model ID
   * @param {boolean} [options.stream=true] - Enable streaming
   * @param {number} [options.maxTokens=4096] - Max output tokens
   * @param {string} [options.system] - System prompt
   * @returns {EventEmitter} Emits standard events
   */
  sendMessage(messages, options = {}) {
    const emitter = new EventEmitter();
    const apiKey = this._apiKey || secureStore.getKey('anthropic');

    if (!apiKey) {
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: 'Anthropic API key not configured' });
      });
      return emitter;
    }

    const model = options.model || 'claude-sonnet-4-5-20250929';
    const maxTokens = options.maxTokens || 4096;
    const stream = options.stream !== false;

    // Separate system message from conversation messages
    let systemPrompt = options.system || undefined;
    const conversationMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const body = {
      model,
      max_tokens: maxTokens,
      messages: conversationMessages,
      stream,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const url = `${this._baseUrl}/v1/messages`;

    this._doFetch(url, apiKey, body, stream, emitter);

    return emitter;
  }

  async _doFetch(url, apiKey, body, stream, emitter) {
    let aborted = false;
    const controller = new AbortController();
    emitter.abort = () => {
      aborted = true;
      controller.abort();
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        emitter.emit('error', {
          type: 'error',
          error: `Anthropic API ${response.status}: ${errBody}`,
        });
        return;
      }

      if (!stream) {
        // Non-streaming: parse full JSON response
        const result = await response.json();
        emitter.emit('message_start', {
          type: 'message_start',
          message: { id: result.id, model: result.model },
        });
        for (const block of (result.content || [])) {
          if (block.type === 'text') {
            emitter.emit('text_delta', { type: 'text_delta', text: block.text });
          }
          if (block.type === 'thinking') {
            emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: block.thinking || '' });
          }
        }
        if (result.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: result.usage.input_tokens || 0,
              output_tokens: result.usage.output_tokens || 0,
            },
          });
        }
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
        return;
      }

      // Streaming: parse SSE events
      for await (const { event, data } of parseSSEStream(response)) {
        if (aborted) break;
        try {
          const parsed = JSON.parse(data);
          this._normalizeEvent(event, parsed, emitter);
        } catch (_) {
          // Non-JSON SSE data, skip
        }
      }

      if (!aborted) {
        emitter.emit('done', { exitCode: 0 });
      }
    } catch (e) {
      if (!aborted) {
        log.error('providers: Anthropic API error:', e.message);
        emitter.emit('error', { type: 'error', error: e.message });
      }
    }
  }

  _normalizeEvent(event, parsed, emitter) {
    switch (event || parsed.type) {
      case 'message_start':
        emitter.emit('message_start', {
          type: 'message_start',
          message: {
            id: parsed.message?.id || null,
            model: parsed.message?.model || null,
          },
        });
        break;

      case 'content_block_delta':
        if (parsed.delta?.type === 'text_delta') {
          emitter.emit('text_delta', { type: 'text_delta', text: parsed.delta.text });
        }
        if (parsed.delta?.type === 'thinking_delta') {
          emitter.emit('thinking_delta', { type: 'thinking_delta', thinking: parsed.delta.thinking });
        }
        break;

      case 'message_delta':
        if (parsed.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: parsed.usage.input_tokens || 0,
              output_tokens: parsed.usage.output_tokens || 0,
            },
          });
        }
        break;

      case 'message_stop':
        emitter.emit('message_stop', { type: 'message_stop' });
        break;

      case 'error':
        emitter.emit('error', {
          type: 'error',
          error: parsed.error?.message || JSON.stringify(parsed),
        });
        break;

      default:
        // ping, content_block_start, content_block_stop — ignore
        break;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// OpenAIProvider — direct HTTPS to api.openai.com
// ══════════════════════════════════════════════════════════════════

class OpenAIProvider {
  constructor({ apiKey, baseUrl, name, keyName, noAuth } = {}) {
    this._apiKey = apiKey || null;
    this._baseUrl = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
    this._keyName = keyName || 'openai';
    this._name = name || 'OpenAI';
    this._noAuth = noAuth || false;
  }

  get name() { return this._name; }
  get type() { return 'openai'; }

  isAvailable() {
    if (this._noAuth) return true;
    const key = this._apiKey || secureStore.getKey(this._keyName);
    return !!key;
  }

  /**
   * Send a message via OpenAI Chat Completions API.
   *
   * Transforms Anthropic-style messages (system separate) to OpenAI format.
   *
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} options
   * @param {string} [options.model='gpt-4o'] - Model ID
   * @param {boolean} [options.stream=true] - Enable streaming
   * @param {number} [options.maxTokens=4096] - Max output tokens
   * @param {string} [options.system] - System prompt
   * @returns {EventEmitter} Emits standard events
   */
  sendMessage(messages, options = {}) {
    const emitter = new EventEmitter();
    const apiKey = this._apiKey || secureStore.getKey(this._keyName);

    if (!apiKey && !this._noAuth) {
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: `${this.name} API key not configured` });
      });
      return emitter;
    }

    const model = options.model || 'gpt-4o';
    const maxTokens = options.maxTokens || 4096;
    const stream = options.stream !== false;

    // Transform to OpenAI message format
    const openaiMessages = this._transformMessages(messages, options.system);

    const body = {
      model,
      max_tokens: maxTokens,
      messages: openaiMessages,
      stream,
    };

    if (stream && !this._noAuth) {
      body.stream_options = { include_usage: true };
    }

    const url = `${this._baseUrl}/v1/chat/completions`;

    this._doFetch(url, apiKey || '', body, stream, emitter);

    return emitter;
  }

  /**
   * Transform Anthropic-style messages to OpenAI format.
   * OpenAI expects system/user/assistant roles in the messages array.
   */
  _transformMessages(messages, systemPrompt) {
    const result = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Merge system messages at the top
        result.unshift({ role: 'system', content: msg.content });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  async _doFetch(url, apiKey, body, stream, emitter) {
    let aborted = false;
    const controller = new AbortController();
    emitter.abort = () => {
      aborted = true;
      controller.abort();
    };

    try {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) {
        headers['authorization'] = `Bearer ${apiKey}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        emitter.emit('error', {
          type: 'error',
          error: `${this.name} API ${response.status}: ${errBody}`,
        });
        return;
      }

      if (!stream) {
        const result = await response.json();
        const choice = result.choices?.[0];
        emitter.emit('message_start', {
          type: 'message_start',
          message: { id: result.id, model: result.model },
        });
        if (choice?.message?.content) {
          emitter.emit('text_delta', { type: 'text_delta', text: choice.message.content });
        }
        if (result.usage) {
          emitter.emit('result', {
            type: 'result',
            usage: {
              input_tokens: result.usage.prompt_tokens || 0,
              output_tokens: result.usage.completion_tokens || 0,
            },
          });
        }
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
        return;
      }

      // Streaming: parse SSE events
      let messageId = null;
      let messageModel = null;

      for await (const { event, data } of parseSSEStream(response)) {
        if (aborted) break;
        try {
          const parsed = JSON.parse(data);
          this._normalizeStreamEvent(parsed, emitter, { messageId, messageModel });
          if (parsed.id) messageId = parsed.id;
          if (parsed.model) messageModel = parsed.model;
        } catch (_) {
          // Non-JSON SSE data, skip
        }
      }

      if (!aborted) {
        emitter.emit('message_stop', { type: 'message_stop' });
        emitter.emit('done', { exitCode: 0 });
      }
    } catch (e) {
      if (!aborted) {
        log.error(`providers: ${this.name} API error:`, e.message);
        emitter.emit('error', { type: 'error', error: e.message });
      }
    }
  }

  _normalizeStreamEvent(parsed, emitter, ctx) {
    // First chunk typically has id and model
    if (parsed.id && !ctx.messageId) {
      emitter.emit('message_start', {
        type: 'message_start',
        message: { id: parsed.id, model: parsed.model },
      });
    }

    // Delta content
    const delta = parsed.choices?.[0]?.delta;
    if (delta?.content) {
      emitter.emit('text_delta', { type: 'text_delta', text: delta.content });
    }

    // Usage info (sent with stream_options.include_usage)
    if (parsed.usage) {
      emitter.emit('result', {
        type: 'result',
        usage: {
          input_tokens: parsed.usage.prompt_tokens || 0,
          output_tokens: parsed.usage.completion_tokens || 0,
        },
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// MoonshotProvider — Kimi K2 (OpenAI-compatible)
// ══════════════════════════════════════════════════════════════════

class MoonshotProvider extends OpenAIProvider {
  constructor({ apiKey, baseUrl } = {}) {
    super({
      apiKey,
      baseUrl: baseUrl || 'https://api.moonshot.cn',
    });
    this._keyName = 'moonshot';
  }

  get name() { return 'Moonshot (Kimi K2)'; }
  get type() { return 'moonshot'; }

  sendMessage(messages, options = {}) {
    // Default to Kimi K2 model if none specified
    const opts = { model: 'kimi-k2', ...options };
    return super.sendMessage(messages, opts);
  }
}

// ══════════════════════════════════════════════════════════════════
// ProviderRegistry — singleton that manages provider instances
// ══════════════════════════════════════════════════════════════════

class ProviderRegistry {
  constructor() {
    /** @type {Map<string, ClaudeCLIProvider|AnthropicAPIProvider|OpenAIProvider|MoonshotProvider>} */
    this._providers = new Map();
  }

  /**
   * Register a provider instance.
   * @param {string} type - Provider type key (e.g. 'claude-cli', 'anthropic')
   * @param {object} provider - Provider instance
   */
  register(type, provider) {
    this._providers.set(type, provider);
    log.info('providers: registered', type, '-', provider.name);
  }

  /**
   * Get a registered provider by type.
   * @param {string} type
   * @returns {object|undefined}
   */
  getProvider(type) {
    return this._providers.get(type);
  }

  /**
   * List all registered provider types.
   * @returns {string[]}
   */
  listProviders() {
    return Array.from(this._providers.keys());
  }

  /**
   * List available providers (those with valid credentials or CLI).
   * @returns {Array<{ type: string, name: string, available: boolean }>}
   */
  listAvailable() {
    const result = [];
    for (const [type, provider] of this._providers) {
      result.push({
        type,
        name: provider.name,
        available: provider.isAvailable(),
      });
    }
    return result;
  }

  /**
   * Dispatch a message to a specific provider.
   * @param {string} type - Provider type
   * @param {Array} messages - Array of { role, content }
   * @param {Object} options - Provider-specific options
   * @returns {EventEmitter}
   */
  sendMessage(type, messages, options = {}) {
    const provider = this._providers.get(type);
    if (!provider) {
      const emitter = new EventEmitter();
      process.nextTick(() => {
        emitter.emit('error', { type: 'error', error: `Unknown provider: ${type}` });
      });
      return emitter;
    }
    return provider.sendMessage(messages, options);
  }
}

// ── Singleton instance with default providers ───────────────────

const registry = new ProviderRegistry();

// Register built-in providers
registry.register('claude-cli', new ClaudeCLIProvider());
registry.register('anthropic', new AnthropicAPIProvider());
registry.register('openai', new OpenAIProvider());
registry.register('moonshot', new MoonshotProvider());

// ── Module exports ──────────────────────────────────────────────

module.exports = {
  registry,
  ProviderRegistry,
  ClaudeCLIProvider,
  AnthropicAPIProvider,
  OpenAIProvider,
  MoonshotProvider,
  parseSSEStream,
};
