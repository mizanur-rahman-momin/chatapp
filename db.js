const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'chat.db');
const db = new DatabaseSync(dbPath);

// Initialize tables and pragmas
db.exec('PRAGMA journal_mode = WAL;');
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
  const info = insertMessageStmt.run(sender_id, type, content, createdAt, 0);
  const row = getMessageByIdStmt.get(info.lastInsertRowid);
  return {
    id: Number(row.id),
    sender_id: Number(row.sender_id),
    type: row.type,
    content: row.content,
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
    content: row.content,
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
  markAsRead
};

