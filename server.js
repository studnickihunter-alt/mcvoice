const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// HTTP Server serving index.html and /healthz endpoint
const server = http.createServer((req, res) => {
  const cleanUrl = (req.url || '/').split('?')[0];

  if (cleanUrl === '/healthz' || cleanUrl === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), ts: Date.now() }));
    return;
  }

  let filePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  filePath = path.join(__dirname, filePath);

  const extname = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'text/html; charset=utf-8';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback to index.html for SPA / room routes
      fs.readFile(path.join(__dirname, 'index.html'), (err2, fallback) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fallback, 'utf-8');
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// WebSocket Relay Server with Room Routing & Protocol-Level Keep-Alive
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false,
  clientTracking: true
});

// Map<roomCode, Set<WebSocket>>
const rooms = new Map();

function getRoomCodeFromReq(req) {
  const rawUrl = req.url || '/';
  // Match /room/CODE or /v3/bedrockcafe_CODE or ?room=CODE
  const roomMatch = rawUrl.match(/\/room\/([A-Za-z0-9_-]+)/i) ||
                    rawUrl.match(/bedrockcafe_([A-Za-z0-9_-]+)/i) ||
                    rawUrl.match(/[?&]room=([A-Za-z0-9_-]+)/i);
  return roomMatch ? roomMatch[1].toUpperCase() : 'DEFAULT';
}

function joinRoom(ws, roomCode) {
  const normalized = (roomCode || 'DEFAULT').toUpperCase();
  if (ws.roomCode && rooms.has(ws.roomCode)) {
    rooms.get(ws.roomCode).delete(ws);
  }
  ws.roomCode = normalized;
  if (!rooms.has(normalized)) {
    rooms.set(normalized, new Set());
  }
  rooms.get(normalized).add(ws);
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  const initialRoom = getRoomCodeFromReq(req);
  joinRoom(ws, initialRoom);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    const rawText = isBinary ? data.toString() : String(data);

    try {
      const parsed = JSON.parse(rawText);

      // Allow client to dynamically switch/announce room
      if (parsed && parsed.room) {
        joinRoom(ws, parsed.room);
      }

      // Respond directly to application-level PINGs so client knows socket is healthy
      if (parsed && (parsed.type === 'PING' || parsed.type === 'ping')) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ bcafe: true, type: 'PONG', ts: Date.now() }));
        }
        return;
      }
    } catch (e) {
      // Non-JSON or raw Minecraft frames still get relayed to the room
    }

    // Broadcast message to all other sockets in the same room
    const roomSet = rooms.get(ws.roomCode);
    if (roomSet) {
      for (const client of roomSet) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(rawText);
          } catch (err) {}
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && rooms.has(ws.roomCode)) {
      const roomSet = rooms.get(ws.roomCode);
      roomSet.delete(ws);
      if (roomSet.size === 0) {
        rooms.delete(ws.roomCode);
      }
    }
  });

  ws.on('error', () => {});
});

// 15-second WebSocket protocol-level Ping + Application-level Keep-Alive
// Prevents Fly.io edge proxy (60s idle limit) and mobile NATs from ever closing idle sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ bcafe: true, type: 'SERVER_HEARTBEAT', ts: Date.now() }));
      }
    } catch (e) {}
  });
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe Proximity Voice Server running on 0.0.0.0:${PORT}`);
});
