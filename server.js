const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(htmlPath, 'utf8'));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bedrock Cafe Voice Server Running');
  }
});

const wss = new WebSocketServer({ server });
const webClients = new Set();
const mcSocketsByRoom = new Map();

function sendMcCommand(ws, commandLine) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    header: {
      version: 1,
      requestId: crypto.randomUUID(),
      messagePurpose: 'commandRequest',
      messageType: 'commandRequest'
    },
    body: {
      version: 1,
      commandLine,
      origin: { type: 'player' }
    }
  }));
}

function broadcastToWeb(payload) {
  const str = JSON.stringify(payload);
  for (const client of webClients) {
    if (client.readyState === 1) client.send(str);
  }
}

wss.on('connection', (ws, req) => {
  const urlPath = (req.url || '/').split('?')[0];
  const match = urlPath.match(/\/mc\/([A-Za-z0-9]+)/i);
  const urlRoom = match ? match[1].toUpperCase() : 'DEFAULT';
  let isBrowser = false;

  const probe = setTimeout(() => {
    if (!isBrowser) {
      mcSocketsByRoom.set(urlRoom, ws);
      broadcastToWeb({ type: 'bridge_status', roomCode: urlRoom, mcConnected: true });
    }
  }, 450);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.role === 'web_client') {
        isBrowser = true;
        clearTimeout(probe);
        ws.roomCode = (msg.roomCode || 'DEFAULT').toUpperCase();
        webClients.add(ws);
        const hasMc = mcSocketsByRoom.has(ws.roomCode) || mcSocketsByRoom.has('DEFAULT');
        ws.send(JSON.stringify({ type: 'bridge_status', roomCode: ws.roomCode, mcConnected: hasMc }));
        return;
      }
      if (msg.type === 'room_sync' || (msg.body && msg.body.statusMessage)) {
        broadcastToWeb({ type: 'mc_raw', roomCode: urlRoom, payload: msg });
        return;
      }
      if (msg.header && msg.header.messagePurpose === 'commandRequest') {
        const targetMc = mcSocketsByRoom.get(msg.roomCode) || mcSocketsByRoom.get('DEFAULT');
        if (targetMc && targetMc.readyState === 1) {
          targetMc.send(JSON.stringify(msg));
        }
        return;
      }
      broadcastToWeb({ type: 'mc_raw', roomCode: urlRoom, payload: msg });
    } catch (e) {}
  });

  ws.on('close', () => {
    clearTimeout(probe);
    webClients.delete(ws);
    for (const [r, sock] of mcSocketsByRoom.entries()) {
      if (sock === ws) {
        mcSocketsByRoom.delete(r);
        broadcastToWeb({ type: 'bridge_status', roomCode: r, mcConnected: false });
      }
    }
  });
});

setInterval(() => {
  for (const [, mcWs] of mcSocketsByRoom.entries()) {
    if (mcWs.readyState === 1) {
      sendMcCommand(mcWs, 'querytarget @a');
      sendMcCommand(mcWs, 'testfor @a[m=spectator]');
    }
  }
}, 200);

server.listen(PORT);
