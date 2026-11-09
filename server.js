const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    const host = req.headers.host;
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/ws:\/\/127\.0\.0\.1:8080/g, `wss://${host}`);
    html = html.replace(/127\.0\.0\.1:8080/g, host);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Upload index.html to your GitHub repository.');
  }
});

const wss = new WebSocketServer({ server });
const webClients = new Set();
let mcSocket = null;

function sendMcCommand(ws, commandLine, reqId) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    header: {
      version: 1,
      requestId: reqId || crypto.randomUUID(),
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
  const data = JSON.stringify(payload);
  for (const client of webClients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', (ws) => {
  let isBrowser = false;

  const probeTimer = setTimeout(() => {
    if (!isBrowser) {
      mcSocket = ws;
      broadcastToWeb({ type: 'bridge_status', mcConnected: true });
    }
  }, 600);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.role === 'web_client') {
        isBrowser = true;
        clearTimeout(probeTimer);
        webClients.add(ws);
        ws.send(JSON.stringify({
          type: 'bridge_status',
          mcConnected: Boolean(mcSocket && mcSocket.readyState === 1)
        }));
        return;
      }
      if (msg.body && (msg.body.statusMessage || msg.body.position)) {
        broadcastToWeb({ type: 'mc_raw', payload: msg });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clearTimeout(probeTimer);
    if (webClients.has(ws)) webClients.delete(ws);
    if (mcSocket === ws) {
      mcSocket = null;
      broadcastToWeb({ type: 'bridge_status', mcConnected: false });
    }
  });
});

setInterval(() => {
  if (mcSocket && mcSocket.readyState === 1) {
    sendMcCommand(mcSocket, 'querytarget @a', 'poll-pos');
    sendMcCommand(mcSocket, 'testfor @a[m=spectator]', 'poll-spec');
  }
}, 150);

server.listen(PORT);
