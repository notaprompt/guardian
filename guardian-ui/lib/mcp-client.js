"use strict";
/**
 * MCP Client — Raw JSON-RPC 2.0 over stdio
 *
 * Communicates with any MCP server via subprocess stdio.
 * No ESM dependencies. Pure CJS for Electron main process.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const log = require('./logger');

class McpClient extends EventEmitter {
  constructor(options) {
    super();
    this._command = options.command;
    this._args = options.args || [];
    this._env = options.env || {};
    this._process = null;
    this._buffer = '';
    this._requestId = 0;
    this._pending = new Map();
    this._ready = false;
  }

  /** Spawn the MCP server subprocess and initialize the protocol. */
  async start() {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...this._env };

      this._process = spawn(this._command, this._args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      });

      this._process.stdout.on('data', (chunk) => this._onData(chunk));
      this._process.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) log.debug('MCP stderr:', msg);
      });

      this._process.on('error', (err) => {
        log.error('MCP process error:', err.message);
        this.emit('error', err);
        if (!this._ready) reject(err);
      });

      this._process.on('exit', (code) => {
        log.info('MCP process exited with code', code);
        this._ready = false;
        this._rejectAll('MCP process exited');
        this.emit('exit', code);
      });

      // Initialize protocol
      this._initialize()
        .then(() => {
          this._ready = true;
          resolve();
        })
        .catch(reject);
    });
  }

  /** Send a JSON-RPC request and return the result. */
  async request(method, params = {}) {
    if (!this._process || !this._ready) {
      throw new Error('MCP client not connected');
    }
    const id = ++this._requestId;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10000);

      this._pending.set(id, { resolve, reject, timer });
      this._send(message);
    });
  }

  /** Call an MCP tool by name. */
  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    // MCP tool results have { content: [{ type, text }] }
    if (result && result.content && result.content.length > 0) {
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent) {
        try {
          return JSON.parse(textContent.text);
        } catch {
          return textContent.text;
        }
      }
    }
    return result;
  }

  /** List available tools. */
  async listTools() {
    const result = await this.request('tools/list');
    return result.tools || [];
  }

  /** Gracefully stop the subprocess. */
  stop() {
    this._ready = false;
    this._rejectAll('MCP client stopping');
    if (this._process) {
      try {
        this._process.stdin.end();
        // Give it 2s to exit gracefully before killing
        const timer = setTimeout(() => {
          if (this._process) {
            this._process.kill();
            this._process = null;
          }
        }, 2000);
        this._process.on('exit', () => {
          clearTimeout(timer);
          this._process = null;
        });
      } catch (_) {
        if (this._process) {
          this._process.kill();
          this._process = null;
        }
      }
    }
  }

  get connected() {
    return this._ready;
  }

  // ── Private ──

  async _initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'guardian-ui', version: '0.1.0' },
    });
    // Send initialized notification
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return result;
  }

  _send(message) {
    if (!this._process || !this._process.stdin.writable) return;
    const json = JSON.stringify(message);
    this._process.stdin.write(json + '\n');
  }

  _onData(chunk) {
    this._buffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIdx).trim();
      this._buffer = this._buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch (e) {
        log.debug('MCP: non-JSON line:', line.slice(0, 100));
      }
    }
  }

  _handleMessage(msg) {
    // Response to a request
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) {
        reject(new Error(msg.error.message || 'MCP error'));
      } else {
        resolve(msg.result);
      }
      return;
    }
    // Notification from server
    if (msg.method && !msg.id) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  _rejectAll(reason) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this._pending.clear();
  }
}

module.exports = { McpClient };
