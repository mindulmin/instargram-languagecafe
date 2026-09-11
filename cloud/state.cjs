const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const STATE_PATHS = [
  'jobs', 'tmp/publish-locks', 'content-queue/threads/jobs',
  'content-queue/threads/.publish-locks', 'content-queue/threads/recovery-evidence',
  'operations/revenue-experiment', 'operations/cloud-controller', 'operations/growth', 'status-memory.json',
  'content-queue/korean-conversation-library.csv', 'content-queue/expression-library.csv',
  'content-queue/google-sheet-source.json', 'content-queue/comment-feedback-signals.json',
  'content-queue/status-memory.json', 'content-queue/threads/threads-exposure-experiment.json'
];
const GENERATED_PATHS = ['series', 'assets', 'exports'];
function safePath(name) {
  return typeof name === 'string' && !name.includes('\\') && !name.includes(':')
    && !name.startsWith('/') && !name.split('/').some(p => !p || p === '.' || p === '..')
    && [...STATE_PATHS, ...GENERATED_PATHS].some(p => name === p || name.startsWith(p + '/'));
}
function collect(root, includeGenerated = false) {
  const files = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('State symlinks are forbidden');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute)) visit(relative + '/' + entry);
    } else if (stat.isFile()) {
      if (!safePath(relative)) throw new Error('State path is outside the allowlist');
      files[relative] = fs.readFileSync(absolute).toString('base64');
    }
  }
  for (const relative of [...STATE_PATHS, ...(includeGenerated ? GENERATED_PATHS : [])]) visit(relative);
  return { version: 1, files };
}
function keyBytes(key) {
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('A 32-byte state encryption key is required');
  return Buffer.from(key, 'hex');
}
function encrypt(state, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from('language-cafe-state-v1'));
  const compressed = zlib.gzipSync(JSON.stringify(state));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const result = Buffer.concat([Buffer.from('LCS1'), iv, cipher.getAuthTag(), ciphertext]);
  if (result.length > 90 * 1024 * 1024) throw new Error('State exceeds the 90 MiB cloud checkpoint limit');
  return result;
}
function decrypt(bytes, key) {
  if (bytes.subarray(0, 4).toString() !== 'LCS1') throw new Error('Invalid state format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(key), bytes.subarray(4, 16));
  decipher.setAAD(Buffer.from('language-cafe-state-v1'));
  decipher.setAuthTag(bytes.subarray(16, 32));
  const plain = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
  const state = JSON.parse(zlib.gunzipSync(plain, { maxOutputLength: 512 * 1024 * 1024 }));
  if (state.version !== 1 || !state.files || typeof state.files !== 'object') throw new Error('Invalid state schema');
  for (const [name, value] of Object.entries(state.files)) {
    if (!safePath(name) || typeof value !== 'string') throw new Error('Unsafe state entry');
  }
  return state;
}
function restore(root, state) {
  for (const [name, value] of Object.entries(state.files)) {
    if (!safePath(name)) throw new Error('Unsafe state entry');
    const absolute = path.resolve(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Buffer.from(value, 'base64'));
  }
}
module.exports = { STATE_PATHS, safePath, collect, encrypt, decrypt, restore };
