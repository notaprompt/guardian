/**
 * Guardian — Conversation Import Parser
 *
 * Parses ChatGPT and Claude conversation export formats into a normalized structure.
 * Supports ChatGPT conversations.json and Claude data export ZIP/JSON files.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// ── Format Detection ─────────────────────────────────────────────

/**
 * Detect the format of parsed JSON data.
 * @param {*} jsonData - Parsed JSON
 * @returns {'chatgpt' | 'claude' | 'unknown'}
 */
function detectFormat(jsonData) {
  // ChatGPT: top-level array with objects containing `mapping` property
  if (Array.isArray(jsonData) && jsonData.length > 0) {
    const first = jsonData[0];
    if (first && typeof first === 'object' && first.mapping && typeof first.mapping === 'object') {
      return 'chatgpt';
    }
    // Claude: array of objects with `chat_messages` property
    if (first && typeof first === 'object' && Array.isArray(first.chat_messages)) {
      return 'claude';
    }
  }
  // Claude single conversation: object with `chat_messages`
  if (jsonData && typeof jsonData === 'object' && !Array.isArray(jsonData) && Array.isArray(jsonData.chat_messages)) {
    return 'claude';
  }
  return 'unknown';
}

// ── ChatGPT Parser ───────────────────────────────────────────────

/**
 * Walk the ChatGPT mapping tree to extract messages in order.
 * @param {Object} mapping - The mapping object from a ChatGPT conversation
 * @returns {Array} Ordered messages
 */
function _walkChatGPTMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return [];

  // Find root node (no parent or parent not in mapping)
  let rootId = null;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (!node.parent || !mapping[node.parent]) {
      rootId = nodeId;
      break;
    }
  }
  if (!rootId) return [];

  // Walk from root following children chain
  const messages = [];
  const visited = new Set();
  const queue = [rootId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = mapping[nodeId];
    if (!node) continue;

    // Extract message if present and has content
    if (node.message && node.message.content) {
      const msg = node.message;
      const role = msg.author?.role;
      const parts = msg.content?.parts;

      if ((role === 'user' || role === 'assistant') && Array.isArray(parts)) {
        const content = parts
          .filter(p => typeof p === 'string')
          .join('\n')
          .trim();

        if (content) {
          messages.push({
            role: role,
            content: content,
            timestamp: msg.create_time
              ? new Date(msg.create_time * 1000).toISOString()
              : null,
          });
        }
      }
    }

    // Queue children
    if (node.children && Array.isArray(node.children)) {
      for (const childId of node.children) {
        queue.push(childId);
      }
    }
  }

  return messages;
}

/**
 * Parse a ChatGPT conversations.json export.
 * @param {Array} jsonData - Parsed conversations.json array
 * @returns {{ conversations: Array, errors: Array }}
 */
function parseChatGPTExport(jsonData) {
  const conversations = [];
  const errors = [];

  if (!Array.isArray(jsonData)) {
    errors.push({ error: 'Expected an array of conversations', index: -1 });
    return { conversations, errors };
  }

  for (let i = 0; i < jsonData.length; i++) {
    try {
      const conv = jsonData[i];
      if (!conv || typeof conv !== 'object') {
        errors.push({ error: 'Invalid conversation object', index: i });
        continue;
      }

      const messages = _walkChatGPTMapping(conv.mapping);
      if (messages.length === 0) continue; // Skip empty conversations

      // Extract model from first assistant message metadata
      let model = null;
      if (conv.mapping) {
        for (const node of Object.values(conv.mapping)) {
          if (node.message?.author?.role === 'assistant' && node.message?.metadata?.model_slug) {
            model = node.message.metadata.model_slug;
            break;
          }
        }
      }

      conversations.push({
        id: conv.id || `chatgpt_${i}_${Date.now()}`,
        source: 'chatgpt',
        title: conv.title || 'Untitled',
        createdAt: conv.create_time
          ? new Date(conv.create_time * 1000).toISOString()
          : new Date().toISOString(),
        updatedAt: conv.update_time
          ? new Date(conv.update_time * 1000).toISOString()
          : new Date().toISOString(),
        model: model,
        messageCount: messages.length,
        messages: messages,
      });
    } catch (e) {
      errors.push({ error: e.message, index: i });
    }
  }

  return { conversations, errors };
}

// ── Claude Parser ────────────────────────────────────────────────

/**
 * Parse a single Claude conversation JSON object.
 * @param {Object} conv - Claude conversation object
 * @param {number} index - Index for error reporting
 * @returns {{ conversation: Object|null, error: string|null }}
 */
function _parseClaudeConversation(conv, index) {
  try {
    if (!conv || typeof conv !== 'object' || !Array.isArray(conv.chat_messages)) {
      return { conversation: null, error: `Invalid Claude conversation at index ${index}` };
    }

    const messages = [];
    for (const msg of conv.chat_messages) {
      if (!msg.text || typeof msg.text !== 'string') continue;
      const content = msg.text.trim();
      if (!content) continue;

      let role;
      if (msg.sender === 'human') role = 'user';
      else if (msg.sender === 'assistant') role = 'assistant';
      else continue; // Skip unknown sender types

      messages.push({
        role,
        content,
        timestamp: msg.created_at || msg.updated_at || null,
      });
    }

    if (messages.length === 0) return { conversation: null, error: null };

    return {
      conversation: {
        id: conv.uuid || `claude_${index}_${Date.now()}`,
        source: 'claude_export',
        title: conv.name || 'Untitled',
        createdAt: conv.created_at || new Date().toISOString(),
        updatedAt: conv.updated_at || conv.created_at || new Date().toISOString(),
        model: null,
        messageCount: messages.length,
        messages,
      },
      error: null,
    };
  } catch (e) {
    return { conversation: null, error: e.message };
  }
}

/**
 * Parse a Claude data export. Accepts a file path to a ZIP or JSON file.
 * ZIP files are expected to contain individual conversation JSON files.
 * @param {string} filePath - Path to ZIP or JSON file
 * @returns {{ conversations: Array, errors: Array }}
 */
function parseClaudeExport(filePath) {
  const conversations = [];
  const errors = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    // Extract ZIP and parse each JSON file inside
    try {
      const tmpDir = path.join(require('os').tmpdir(), `guardian-claude-import-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        // Use PowerShell Expand-Archive on Windows, unzip elsewhere
        const isWin = process.platform === 'win32';
        if (isWin) {
          require('child_process').execSync(
            `powershell -Command "Expand-Archive -Path '${filePath}' -DestinationPath '${tmpDir}' -Force"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } else {
          require('child_process').execSync(
            `unzip -o "${filePath}" -d "${tmpDir}"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        }

        // Find all JSON files recursively
        const jsonFiles = _findJsonFiles(tmpDir);
        let index = 0;

        for (const jsonFile of jsonFiles) {
          try {
            const raw = fs.readFileSync(jsonFile, 'utf-8');
            const data = JSON.parse(raw);

            // Could be a single conversation or an array
            if (Array.isArray(data)) {
              for (const conv of data) {
                const result = _parseClaudeConversation(conv, index);
                if (result.conversation) conversations.push(result.conversation);
                if (result.error) errors.push({ error: result.error, index });
                index++;
              }
            } else if (data && typeof data === 'object') {
              // Check if this is a conversation object (has chat_messages)
              if (Array.isArray(data.chat_messages)) {
                const result = _parseClaudeConversation(data, index);
                if (result.conversation) conversations.push(result.conversation);
                if (result.error) errors.push({ error: result.error, index });
                index++;
              }
            }
          } catch (e) {
            errors.push({ error: `Failed to parse ${path.basename(jsonFile)}: ${e.message}`, index });
            index++;
          }
        }
      } finally {
        // Cleanup temp dir
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (e) {
      errors.push({ error: `ZIP extraction failed: ${e.message}`, index: -1 });
    }
  } else {
    // Single JSON file
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const result = _parseClaudeConversation(data[i], i);
          if (result.conversation) conversations.push(result.conversation);
          if (result.error) errors.push({ error: result.error, index: i });
        }
      } else if (data && typeof data === 'object' && Array.isArray(data.chat_messages)) {
        const result = _parseClaudeConversation(data, 0);
        if (result.conversation) conversations.push(result.conversation);
        if (result.error) errors.push({ error: result.error, index: 0 });
      } else {
        errors.push({ error: 'Unrecognized Claude export format', index: -1 });
      }
    } catch (e) {
      errors.push({ error: `Failed to read file: ${e.message}`, index: -1 });
    }
  }

  return { conversations, errors };
}

/**
 * Recursively find all .json files in a directory.
 */
function _findJsonFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(..._findJsonFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
  } catch (_) {}
  return results;
}

// ── Auto-Detect & Parse ──────────────────────────────────────────

/**
 * Validate a file for import. Returns format info and basic stats.
 * @param {string} filePath - Path to the file
 * @returns {{ ok: boolean, format: string, size: number, conversations: number, dateRange: Object|null, error: string|null }}
 */
function validateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, format: 'unknown', size: 0, conversations: 0, dateRange: null, error: 'File not found' };
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Size check: 500MB max
    if (stat.size > 500 * 1024 * 1024) {
      return { ok: false, format: 'unknown', size: stat.size, conversations: 0, dateRange: null, error: 'File too large (max 500MB)' };
    }

    // ZIP files — assume Claude export
    if (ext === '.zip') {
      return { ok: true, format: 'claude_export', size: stat.size, conversations: -1, dateRange: null, error: null };
    }

    // JSON files — read and detect
    if (ext === '.json') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const format = detectFormat(data);

      if (format === 'unknown') {
        return { ok: false, format: 'unknown', size: stat.size, conversations: 0, dateRange: null, error: 'Unrecognized format. Expected ChatGPT or Claude export.' };
      }

      let convCount = 0;
      let dateRange = null;

      if (format === 'chatgpt' && Array.isArray(data)) {
        convCount = data.length;
        // Compute date range
        const timestamps = data
          .map(c => c.create_time)
          .filter(t => t && typeof t === 'number')
          .sort();
        if (timestamps.length > 0) {
          dateRange = {
            earliest: new Date(timestamps[0] * 1000).toISOString(),
            latest: new Date(timestamps[timestamps.length - 1] * 1000).toISOString(),
          };
        }
      } else if (format === 'claude') {
        if (Array.isArray(data)) {
          convCount = data.length;
          const dates = data
            .map(c => c.created_at)
            .filter(d => d)
            .sort();
          if (dates.length > 0) {
            dateRange = { earliest: dates[0], latest: dates[dates.length - 1] };
          }
        } else {
          convCount = 1;
        }
      }

      return { ok: true, format, size: stat.size, conversations: convCount, dateRange, error: null };
    }

    return { ok: false, format: 'unknown', size: stat.size, conversations: 0, dateRange: null, error: `Unsupported file type: ${ext}. Expected .json or .zip` };
  } catch (e) {
    return { ok: false, format: 'unknown', size: 0, conversations: 0, dateRange: null, error: e.message };
  }
}

/**
 * Auto-detect format and parse a file.
 * @param {string} filePath - Path to the export file
 * @returns {{ conversations: Array, errors: Array }}
 */
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // ZIP → Claude export
  if (ext === '.zip') {
    log.info('Import parser: detected ZIP file, parsing as Claude export');
    return parseClaudeExport(filePath);
  }

  // JSON → detect format
  if (ext === '.json') {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const format = detectFormat(data);

      if (format === 'chatgpt') {
        log.info('Import parser: detected ChatGPT format');
        return parseChatGPTExport(data);
      }

      if (format === 'claude') {
        log.info('Import parser: detected Claude format');
        return parseClaudeExport(filePath);
      }

      return { conversations: [], errors: [{ error: 'Unrecognized JSON format', index: -1 }] };
    } catch (e) {
      return { conversations: [], errors: [{ error: `Failed to parse JSON: ${e.message}`, index: -1 }] };
    }
  }

  return { conversations: [], errors: [{ error: `Unsupported file type: ${ext}`, index: -1 }] };
}

module.exports = {
  parseFile,
  parseChatGPTExport,
  parseClaudeExport,
  detectFormat,
  validateFile,
};
