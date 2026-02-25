// Shared Claude CLI path resolution and environment setup.

const path = require('path');
const os = require('os');
const fs = require('fs');

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

module.exports = { getClaudePath, cliEnv, newPath };
