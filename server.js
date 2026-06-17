// Guess the Admit Rate — leaderboard server
// Zero dependencies: Node's built-in http + node:sqlite (Node >= 22.5, tested on 24).
// Run:  node server.js     (optionally PORT=3000 DB_PATH=/data/lb.db node server.js)

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT    = process.env.PORT || 8765;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'leaderboard.db');
const ROOT    = __dirname;
// boards: "easy|medium|hard" (guess-the-rate) and "vs-easy|vs-medium|vs-hard" (head-to-head)
const validDiff = d => /^(vs-)?(easy|medium|hard)$/.test(d);

// ---------- database ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS scores(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    initials   TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    difficulty TEXT    NOT NULL,
    round      INTEGER NOT NULL DEFAULT 0,
    mean_error REAL    NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_diff_score ON scores(difficulty, score DESC);
`);

const qInsert = db.prepare(
  'INSERT INTO scores (initials,score,difficulty,round,mean_error,created_at) VALUES (?,?,?,?,?,?)');
const qTop = db.prepare(
  'SELECT id,initials,score,round,mean_error,created_at FROM scores WHERE difficulty=? ORDER BY score DESC, created_at ASC LIMIT ?');
const qRank = db.prepare(
  'SELECT COUNT(*)+1 AS rank FROM scores WHERE difficulty=? AND (score > ? OR (score = ? AND created_at < ?))');
const qTotal = db.prepare('SELECT COUNT(*) AS n FROM scores WHERE difficulty=?');

// ---------- tiny in-memory rate limit (per IP) ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), windowMs = 60000, max = 20;
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}

// ---------- helpers ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.csv': 'text/csv', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/game.html';
  // prevent path traversal
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- routes ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // GET /api/leaderboard?difficulty=easy&limit=10
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const difficulty = String(url.searchParams.get('difficulty') || '').toLowerCase();
    if (!validDiff(difficulty)) return json(res, 400, { error: 'bad difficulty' });
    let limit = parseInt(url.searchParams.get('limit'), 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    limit = Math.min(limit, 100);
    return json(res, 200, { difficulty, top: qTop.all(difficulty, limit), total: qTotal.get(difficulty).n });
  }

  // POST /api/score   { initials, score, difficulty, round, meanError }
  if (req.method === 'POST' && url.pathname === '/api/score') {
    if (rateLimited(clientIp(req))) return json(res, 429, { error: 'slow down' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }

      let initials = String(b.initials || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (initials.length === 0) initials = 'AAA';
      const difficulty = String(b.difficulty || '').toLowerCase();
      if (!validDiff(difficulty)) return json(res, 400, { error: 'bad difficulty' });
      const score = Number(b.score);
      if (!Number.isInteger(score) || score < 0 || score > 50_000_000) return json(res, 400, { error: 'bad score' });
      const round = Number.isInteger(Number(b.round)) ? Number(b.round) : 0;
      const meanError = Number.isFinite(Number(b.meanError)) ? Number(b.meanError) : 0;
      const created_at = new Date().toISOString();

      const info = qInsert.run(initials, score, difficulty, round, meanError, created_at);
      const rank = qRank.get(difficulty, score, score, created_at).rank;
      return json(res, 200, {
        ok: true,
        id: Number(info.lastInsertRowid),
        rank,
        total: qTotal.get(difficulty).n,
        top: qTop.all(difficulty, 10),
      });
    });
    return;
  }

  // static files (game.html, csv, etc.)
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`🎮 Guess the Admit Rate  →  http://localhost:${PORT}`);
  console.log(`   database: ${DB_PATH}`);
});
