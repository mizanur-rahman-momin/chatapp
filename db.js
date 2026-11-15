require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Secret key for AES-256-GCM encryption at rest
const rawSecret = process.env.SESSION_SECRET || 'chatapp-private-secret-change-me';
const encKey = crypto.createHash('sha256').update(rawSecret).digest();

function encryptContent(plainText) {
  if (!plainText || typeof plainText !== 'string') return plainText;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    let enc = cipher.update(plainText, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `enc:v1:${iv.toString('hex')}:${tag}:${enc}`;
  } catch (err) {
    console.error('Encryption error:', err);
    return plainText;
  }
}

function decryptContent(cipherText) {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.startsWith('enc:v1:')) {
    return cipherText;
  }
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 5) return cipherText;
    const [, , ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(dataHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (err) {
    console.error('Decryption error:', err);
    return '[Encrypted message cannot be decrypted]';
  }
}

// Database initialization
const dbPath = process.env.DB_PATH || path.join(dataDir, 'chat.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for durability, high concurrency, and crash resilience
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
`);

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (sender_id, type, content, created_at, is_read)
  VALUES (?, ?, ?, ?, ?)
`);

const getMessageByIdStmt = db.prepare(`
  SELECT id, sender_id, type, content, created_at, is_read
  FROM messages
  WHERE id = ?
`);

const getRecentMessagesStmt = db.prepare(`
  SELECT id, sender_id, type, content, created_at, is_read
  FROM messages
  ORDER BY id DESC
  LIMIT ? OFFSET ?
`);

const markMessagesReadStmt = db.prepare(`
  UPDATE messages
  SET is_read = 1
  WHERE sender_id != ? AND is_read = 0
`);

function addMessage({ sender_id, type = 'text', content }) {
  const createdAt = new Date().toISOString();
  // Encrypt at rest before saving to disk
  const encrypted = encryptContent(content);
  const info = insertMessageStmt.run(sender_id, type, encrypted, createdAt, 0);
  const row = getMessageByIdStmt.get(info.lastInsertRowid);
  return {
    id: Number(row.id),
    sender_id: Number(row.sender_id),
    type: row.type,
    content: decryptContent(row.content), // Decrypted for client
    created_at: row.created_at,
    is_read: Number(row.is_read)
  };
}

function getMessages(limit = 100, offset = 0) {
  const rows = getRecentMessagesStmt.all(limit, offset);
  // Reverse so they are in chronological order (oldest -> newest)
  return rows.reverse().map(row => ({
    id: Number(row.id),
    sender_id: Number(row.sender_id),
    type: row.type,
    content: decryptContent(row.content), // Decrypted for client
    created_at: row.created_at,
    is_read: Number(row.is_read)
  }));
}

function markAsRead(reader_id) {
  markMessagesReadStmt.run(reader_id);
}

module.exports = {
  db,
  addMessage,
  getMessages,
  markAsRead,
  encryptContent,
  decryptContent
};
