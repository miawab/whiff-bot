// SQLite storage (built into Node 22+, no install needed).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'bot.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    last_xp INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    elo INTEGER NOT NULL DEFAULT 1000,
    trivia INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL, mod_id TEXT NOT NULL, reason TEXT NOT NULL, ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner TEXT NOT NULL, loser TEXT NOT NULL, ft INTEGER NOT NULL, ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, starts TEXT, details TEXT, max INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    channel_id TEXT, message_id TEXT, created_by TEXT NOT NULL, ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entries (
    tid INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (tid, user_id)
  );
  CREATE TABLE IF NOT EXISTS starboard (msg_id TEXT PRIMARY KEY, board_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`);

const q = {
  user: db.prepare('SELECT * FROM users WHERE id = ?'),
  ensureUser: db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)'),
};

function getUser(id) {
  q.ensureUser.run(id);
  return q.user.get(id);
}

const kvGet = (key) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

module.exports = { db, getUser, kvGet, kvSet };
