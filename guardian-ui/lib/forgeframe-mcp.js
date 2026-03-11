"use strict";
/**
 * ForgeFrame MCP Manager
 *
 * Spawns the @forgeframe/server as a subprocess and communicates via
 * JSON-RPC 2.0 (MCP protocol). Provides high-level methods matching
 * the 12 ForgeFrame tools.
 *
 * Lifecycle: init() at app startup, close() at app quit.
 */

const path = require('path');
const os = require('os');
const { McpClient } = require('./mcp-client');
const log = require('./logger');

const FORGEFRAME_DIR = path.join(os.homedir(), '.forgeframe');
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'forgeframe', 'packages', 'server', 'dist', 'bin.js');

let _client = null;
let _tools = [];

/**
 * Initialize the ForgeFrame MCP connection.
 * Spawns the server subprocess and establishes the protocol.
 */
async function init(options = {}) {
  if (_client && _client.connected) {
    log.info('ForgeFrame MCP: already connected');
    return;
  }

  const serverPath = options.serverPath || SERVER_ENTRY;
  const dbPath = options.dbPath || path.join(FORGEFRAME_DIR, 'memory.db');

  log.info('ForgeFrame MCP: starting server at', serverPath);

  _client = new McpClient({
    command: process.execPath.includes('electron')
      ? 'node'
      : process.execPath,
    args: [serverPath],
    env: {
      FORGEFRAME_DB_PATH: dbPath,
      FORGEFRAME_INGEST_DIR: options.ingestDir || '',
      FORGEFRAME_OLLAMA_URL: options.ollamaUrl || 'http://localhost:11434',
      FORGEFRAME_EMBEDDING_MODEL: options.embeddingModel || 'nomic-embed-text',
    },
  });

  _client.on('error', (err) => {
    log.error('ForgeFrame MCP error:', err.message);
  });

  _client.on('exit', (code) => {
    log.warn('ForgeFrame MCP server exited with code', code);
    _client = null;
    _tools = [];
  });

  try {
    await _client.start();
    _tools = await _client.listTools();
    log.info('ForgeFrame MCP: connected,', _tools.length, 'tools available');
  } catch (err) {
    log.error('ForgeFrame MCP: failed to start:', err.message);
    _client = null;
    throw err;
  }
}

/** Check if connected. */
function isConnected() {
  return _client && _client.connected;
}

/** Get available tool names. */
function getTools() {
  return _tools.map((t) => t.name);
}

// ── Memory Tools ──

async function memorySave(content, metadata = {}) {
  return _call('memory_save', { content, metadata });
}

async function memoryQuery(query, options = {}) {
  return _call('memory_query', { query, ...options });
}

async function memoryUpdate(id, updates) {
  return _call('memory_update', { id, ...updates });
}

async function memoryDelete(id) {
  return _call('memory_delete', { id });
}

async function memoryListRecent(limit = 20) {
  return _call('memory_list_recent', { limit });
}

async function memoryListByTag(tag, limit = 20) {
  return _call('memory_list_by_tag', { tag, limit });
}

async function memorySearch(query) {
  return _call('memory_search', { query });
}

async function memoryStatus() {
  return _call('memory_status', {});
}

async function memoryReindex() {
  return _call('memory_reindex', {});
}

// ── Session Tools ──

async function sessionStart(name = null) {
  return _call('session_start', name ? { name } : {});
}

async function sessionEnd() {
  return _call('session_end', {});
}

async function sessionCurrent() {
  return _call('session_current', {});
}

async function sessionList(limit = 10) {
  return _call('session_list', { limit });
}

// ── Internal ──

async function _call(tool, args) {
  if (!_client || !_client.connected) {
    log.warn('ForgeFrame MCP: not connected, skipping', tool);
    return null;
  }
  try {
    return await _client.callTool(tool, args);
  } catch (err) {
    log.error('ForgeFrame MCP:', tool, 'failed:', err.message);
    return null;
  }
}

/** Gracefully shut down the server subprocess. */
function close() {
  if (_client) {
    log.info('ForgeFrame MCP: shutting down');
    _client.stop();
    _client = null;
    _tools = [];
  }
}

module.exports = {
  init,
  close,
  isConnected,
  getTools,
  memorySave,
  memoryQuery,
  memoryUpdate,
  memoryDelete,
  memoryListRecent,
  memoryListByTag,
  memorySearch,
  memoryStatus,
  memoryReindex,
  sessionStart,
  sessionEnd,
  sessionCurrent,
  sessionList,
};
