// Battle Bound: serves the game page and a Scratch/TurboWarp-compatible cloud variable server.
// Players only share cloud variables with others in the same room (project_id).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = Number(process.env.MAX_PLAYERS) || 50;
const MAX_MSGS_PER_SEC = 200;
// Values every fresh room starts with (the game reads "☁ Online" as its version number).
const SEED = JSON.parse(process.env.SEED_VARS || '{"☁ Online":"16"}');

const indexPath = path.join(__dirname, 'public', 'index.html');
const indexRaw = fs.readFileSync(indexPath);
const indexGzip = zlib.gzipSync(indexRaw, { level: 9 });

const rooms = new Map(); // roomId -> { vars: Map, clients: Set }
function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { vars: new Map(Object.entries(SEED)), clients: new Set() };
    rooms.set(id, r);
  }
  return r;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/check') {
    const room = rooms.get(url.searchParams.get('room') || '');
    const user = (url.searchParams.get('user') || '').toLowerCase();
    const taken = !!room && [...room.clients].some(c => c.user && c.user.toLowerCase() === user);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ taken }));
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
    if (gz) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    return res.end(gz ? indexGzip : indexRaw);
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const c = { ws, room: null, roomId: null, user: null, tokens: MAX_MSGS_PER_SEC, last: Date.now(), alive: true };
  ws.on('pong', () => { c.alive = true; });

  ws.on('message', (data) => {
    const now = Date.now();
    c.tokens = Math.min(MAX_MSGS_PER_SEC, c.tokens + ((now - c.last) / 1000) * MAX_MSGS_PER_SEC);
    c.last = now;
    for (const line of String(data).split('\n')) {
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (!msg || typeof msg !== 'object') continue;

      if (msg.method === 'handshake') {
        if (c.room) continue;
        const roomId = String(msg.project_id || 'default');
        const user = String(msg.user || '');
        if (!/^[\w-]{1,64}$/.test(roomId)) return ws.close(4004, 'Bad project');
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(user)) return ws.close(4002, 'Username is invalid');
        const room = getRoom(roomId);
        if ([...room.clients].some(o => o.user.toLowerCase() === user.toLowerCase())) return ws.close(4002, 'Username already in use');
        if (room.clients.size >= MAX_PLAYERS_PER_ROOM) return ws.close(4003, 'Server full');
        c.room = room; c.roomId = roomId; c.user = user;
        room.clients.add(c);
        let out = '';
        for (const [name, value] of room.vars) out += JSON.stringify({ method: 'set', name, value }) + '\n';
        if (out) ws.send(out);
      } else if (msg.method === 'set' && c.room) {
        if (c.tokens < 1) continue; // drop floods
        c.tokens -= 1;
        const { name, value } = msg;
        if (typeof name !== 'string' || !name.startsWith('☁ ') || name.length > 100) continue;
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const v = String(value);
        if (v.length > 5000) continue;
        c.room.vars.set(name, v);
        const out = JSON.stringify({ method: 'set', name, value: v }) + '\n';
        for (const o of c.room.clients) {
          if (o !== c && o.ws.readyState === 1) o.ws.send(out);
        }
      }
    }
  });

  ws.on('close', () => {
    if (!c.room) return;
    c.room.clients.delete(c);
    if (c.room.clients.size === 0) rooms.delete(c.roomId); // empty room resets to a fresh start
  });
  ws.on('error', () => {});
});

// Drop dead connections (also keeps hosts' idle proxies from closing live ones).
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._dead) return ws.terminate();
    ws._dead = true; ws.ping();
    ws.once('pong', () => { ws._dead = false; });
  });
}, 30000);

server.listen(PORT, () => console.log('Battle Bound listening on port ' + PORT));
