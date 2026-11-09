const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(htmlPath, 'utf8'));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('index.html not found');
  }
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function getRoomSet(roomKey) {
  if (!rooms.has(roomKey)) {
    rooms.set(roomKey, new Set());
  }
  return rooms.get(roomKey);
}

wss.on('connection', (ws, req) => {
  const cleanUrl = (req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '').toUpperCase();
  const roomKey = cleanUrl || 'DEFAULT';
  const roomClients = getRoomSet(roomKey);
  roomClients.add(ws);

  ws.send(JSON.stringify({
    header: {
      version: 1,
      requestId: crypto.randomUUID(),
      messagePurpose: 'commandRequest',
      messageType: 'commandRequest'
    },
    body: {
      version: 1,
      commandLine: 'list',
      origin: { type: 'player' }
    }
  }));

  ws.on('message', (raw) => {
    const text = raw.toString();
    for (const client of roomClients) {
      if (client !== ws && client.readyState === 1) {
        client.send(text);
      }
    }
  });

  ws.on('close', () => {
    roomClients.delete(ws);
    if (roomClients.size === 0) {
      rooms.delete(roomKey);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bedrock Cafe running on port ${PORT}`);
});
