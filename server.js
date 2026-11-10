const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const state = {
  mcSocket: null,
  lastMcPacketAt: 0,
  rules: {
    maxRange: 32,
    minRange: 5,
    rolloff: 'smooth',
    spectatorIsolation: true
  },
  worldPlayers: {}
};

const webClients = new Set();
const pendingQueries = new Map();

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

const wss = new WebSocketServer({
  server,
  handleProtocols: () => false
});

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function broadcastToBrowsers() {
  const payload = {
    bcafe: true,
    type: 'ROSTER_SYNC',
    mcConnected: Boolean(
      state.mcSocket &&
      state.mcSocket.readyState === 1 &&
      Date.now() - state.lastMcPacketAt < 12000
    ),
    worldPlayers: state.worldPlayers,
    rules: state.rules
  };
  for (const client of webClients) {
    sendJson(client, payload);
  }
}

function sendMcCommand(ws, commandLine, meta) {
  if (!ws || ws.readyState !== 1) return;
  const requestId = crypto.randomUUID();
  if (meta) {
    pendingQueries.set(requestId, { ...meta, ts: Date.now() });
  }
  sendJson(ws, {
    header: {
      version: 1,
      requestId,
      messagePurpose: 'commandRequest',
      messageType: 'commandRequest'
    },
    body: {
      version: 1,
      commandLine,
      origin: { type: 'player' }
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const probeTimer = setTimeout(() => {
    if (!webClients.has(ws) && ws.readyState === 1) {
      state.mcSocket = ws;
      state.lastMcPacketAt = Date.now();
      sendMcCommand(ws, 'list', { kind: 'list' });
      sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
      broadcastToBrowsers();
    }
  }, 300);

  ws.on('message', (raw) => {
    const rawStr = raw.toString();
    let msg;
    try {
      msg = JSON.parse(rawStr);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.bcafe) {
      clearTimeout(probeTimer);
      webClients.add(ws);

      if (msg.type === 'PING') {
        sendJson(ws, { bcafe: true, type: 'PONG' });
        return;
      }

      if (msg.type === 'VOICE_CHUNK') {
        for (const client of webClients) {
          if (client !== ws && client.readyState === 1) {
            try {
              client.send(rawStr);
            } catch (e) {}
          }
        }
        return;
      }

      if (msg.type === 'REQUEST_ROSTER') {
        broadcastToBrowsers();
      } else if (msg.type === 'CLAIM_PLAYER' && msg.playerName) {
        ws.playerName = msg.playerName;
        ws.peerId = msg.peerId;
        if (!state.worldPlayers[msg.playerName]) {
          state.worldPlayers[msg.playerName] = {
            name: msg.playerName,
            x: 0,
            y: 64,
            z: 0,
            yaw: 0,
            gamemode: 'survival',
            inWorld: true,
            linkedPeerId: msg.peerId,
            muted: false,
            deafened: false,
            speaking: false
          };
        } else {
          state.worldPlayers[msg.playerName].linkedPeerId = msg.peerId;
        }
        broadcastToBrowsers();
      } else if (
        msg.type === 'PLAYER_MIC_STATE' &&
        msg.playerName &&
        state.worldPlayers[msg.playerName]
      ) {
        state.worldPlayers[msg.playerName].muted = Boolean(msg.muted);
        state.worldPlayers[msg.playerName].deafened = Boolean(msg.deafened);
        state.worldPlayers[msg.playerName].speaking = Boolean(msg.speaking);
        broadcastToBrowsers();
      } else if (msg.type === 'UPDATE_RULES' && msg.rules) {
        state.rules = { ...state.rules, ...msg.rules };
        broadcastToBrowsers();
      } else if (msg.type === 'ADD_MANUAL_PLAYER' && msg.playerName) {
        const name = msg.playerName.trim();
        if (name && !state.worldPlayers[name]) {
          state.worldPlayers[name] = {
            name,
            x: 0,
            y: 64,
            z: 0,
            yaw: 0,
            gamemode: 'survival',
            inWorld: true,
            linkedPeerId: null,
            muted: false,
            deafened: false,
            speaking: false
          };
          broadcastToBrowsers();
        }
      } else if (
        msg.type === 'LEAVE_PLAYER' &&
        msg.playerName &&
        state.worldPlayers[msg.playerName]
      ) {
        state.worldPlayers[msg.playerName].linkedPeerId = null;
        state.worldPlayers[msg.playerName].speaking = false;
        broadcastToBrowsers();
      }
      return;
    }

    if (msg.header || msg.body) {
      clearTimeout(probeTimer);
      webClients.delete(ws);
      state.mcSocket = ws;
      state.lastMcPacketAt = Date.now();

      const reqId = msg.header && msg.header.requestId;
      const meta = reqId ? pendingQueries.get(reqId) : null;
      if (reqId) pendingQueries.delete(reqId);

      const body = msg.body || {};

      if (
        (meta && meta.kind === 'list') ||
        typeof body.players === 'string' ||
        typeof body.statusMessage === 'string'
      ) {
        let names = [];
        if (typeof body.players === 'string') {
          names = body.players.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (
          typeof body.statusMessage === 'string' &&
          body.statusMessage.includes('players online:')
        ) {
          const lines = body.statusMessage.split('\n');
          if (lines.length > 1) {
            names = lines
              .slice(1)
              .join(',')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
        names.forEach((n) => {
          if (!state.worldPlayers[n]) {
            state.worldPlayers[n] = {
              name: n,
              x: 0,
              y: 64,
              z: 0,
              yaw: 0,
              gamemode: 'survival',
              inWorld: true,
              linkedPeerId: null,
              muted: false,
              deafened: false,
              speaking: false
            };
          } else {
            state.worldPlayers[n].inWorld = true;
          }
        });
      }

      if (typeof body.localplayername === 'string') {
        const n = body.localplayername.trim();
        if (n && !state.worldPlayers[n]) {
          state.worldPlayers[n] = {
            name: n,
            x: 0,
            y: 64,
            z: 0,
            yaw: 0,
            gamemode: 'survival',
            inWorld: true,
            linkedPeerId: null,
            muted: false,
            deafened: false,
            speaking: false
          };
        }
      }

      if (meta && meta.kind === 'pos' && meta.playerName && body.details) {
        try {
          const parsed =
            typeof body.details === 'string'
              ? JSON.parse(body.details)
              : body.details;
          const target = Array.isArray(parsed) ? parsed[0] : parsed;
          if (target && target.position && state.worldPlayers[meta.playerName]) {
            state.worldPlayers[meta.playerName].x = Number(target.position.x) || 0;
            state.worldPlayers[meta.playerName].y = Number(target.position.y) || 64;
            state.worldPlayers[meta.playerName].z = Number(target.position.z) || 0;
            if (target.yRot !== undefined) {
              state.worldPlayers[meta.playerName].yaw = Number(target.yRot) || 0;
            }
          }
        } catch (e) {}
      }

      if (
        meta &&
        meta.kind === 'spec' &&
        meta.playerName &&
        state.worldPlayers[meta.playerName]
      ) {
        const isSpec =
          body.statusCode === 0 &&
          Array.isArray(body.victim) &&
          body.victim.length > 0;
        state.worldPlayers[meta.playerName].gamemode = isSpec
          ? 'spectator'
          : 'survival';
      }

      broadcastToBrowsers();
    }
  });

  const cleanup = () => {
    clearTimeout(probeTimer);
    webClients.delete(ws);
    if (ws.playerName && state.worldPlayers[ws.playerName]) {
      if (!ws.peerId || state.worldPlayers[ws.playerName].linkedPeerId === ws.peerId) {
        state.worldPlayers[ws.playerName].linkedPeerId = null;
        state.worldPlayers[ws.playerName].speaking = false;
      }
    }
    if (state.mcSocket === ws) {
      state.mcSocket = null;
    }
    broadcastToBrowsers();
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 25000);

wss.on('close', () => {
  clearInterval(interval);
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingQueries.entries()) {
    if (now - v.ts > 4000) pendingQueries.delete(k);
  }

  if (state.mcSocket && state.mcSocket.readyState === 1) {
    sendMcCommand(state.mcSocket, 'list', { kind: 'list' });
    sendMcCommand(state.mcSocket, 'getlocalplayername', { kind: 'localname' });
    Object.keys(state.worldPlayers).forEach((name) => {
      sendMcCommand(state.mcSocket, `querytarget @a[name="${name}"]`, {
        kind: 'pos',
        playerName: name
      });
      sendMcCommand(state.mcSocket, `testfor @a[name="${name}",m=spectator]`, {
        kind: 'spec',
        playerName: name
      });
    });
  }
}, 400);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
