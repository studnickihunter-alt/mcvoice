const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

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
const disconnectTimers = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(fs.readFileSync(htmlPath, 'utf8'));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('index.html not found');
  }
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

server.on('connection', (socket) => {
  socket.setKeepAlive(true, 5000);
  socket.setNoDelay(true);
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  handleProtocols: () => false
});

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function isMcConnected() {
  return Boolean(state.mcSocket && state.mcSocket.readyState === 1);
}

function broadcastToBrowsers() {
  const payload = {
    bcafe: true,
    type: 'ROSTER_SYNC',
    mcConnected: isMcConnected(),
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

function ensurePlayerEntry(name) {
  if (!state.worldPlayers[name]) {
    state.worldPlayers[name] = {
      name,
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      gamemode: 'survival',
      inWorld: true,
      linkedPeerId: null,
      wsConnected: false,
      muted: false,
      deafened: false,
      speaking: false
    };
  } else {
    state.worldPlayers[name].inWorld = true;
  }
}

wss.on('connection', (ws, req) => {
  const reqUrl = req.url || '';
  const isBrowserUrl = reqUrl.includes('role=browser');

  if (isBrowserUrl) {
    ws.isBrowser = true;
    webClients.add(ws);
    broadcastToBrowsers();
  } else {
    // Probe potential Minecraft client without overwriting active state.mcSocket yet
    sendMcCommand(ws, 'list', { kind: 'list' });
    sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
  }

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
      ws.isBrowser = true;
      webClients.add(ws);
      if (state.mcSocket === ws) {
        state.mcSocket = null;
      }

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
        const name = msg.playerName;
        ws.playerName = name;

        if (disconnectTimers.has(name)) {
          clearTimeout(disconnectTimers.get(name));
          disconnectTimers.delete(name);
        }

        ensurePlayerEntry(name);
        state.worldPlayers[name].wsConnected = true;

        if (msg.peerId && !msg.peerId.startsWith('ws-')) {
          state.worldPlayers[name].linkedPeerId = msg.peerId;
          ws.peerId = msg.peerId;
        } else if (!state.worldPlayers[name].linkedPeerId) {
          state.worldPlayers[name].linkedPeerId = `ws-${name}`;
          ws.peerId = `ws-${name}`;
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
        if (name) {
          ensurePlayerEntry(name);
          broadcastToBrowsers();
        }
      } else if (
        msg.type === 'LEAVE_PLAYER' &&
        msg.playerName &&
        state.worldPlayers[msg.playerName]
      ) {
        if (disconnectTimers.has(msg.playerName)) {
          clearTimeout(disconnectTimers.get(msg.playerName));
          disconnectTimers.delete(msg.playerName);
        }
        state.worldPlayers[msg.playerName].linkedPeerId = null;
        state.worldPlayers[msg.playerName].wsConnected = false;
        state.worldPlayers[msg.playerName].speaking = false;
        ws.playerName = null;
        broadcastToBrowsers();
      }
      return;
    }

    if (msg.header || msg.body) {
      ws.isBrowser = false;
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
        (typeof body.statusMessage === 'string' &&
          body.statusMessage.includes('players online:'))
      ) {
        let names = [];
        if (typeof body.players === 'string') {
          names = body.players
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (typeof body.statusMessage === 'string') {
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
        names.forEach((n) => ensurePlayerEntry(n));
      }

      if (typeof body.localplayername === 'string') {
        const n = body.localplayername.trim();
        if (n) ensurePlayerEntry(n);
      }

      if (meta && meta.kind === 'spec_all') {
        const specNames = new Set(
          body.statusCode === 0 && Array.isArray(body.victim)
            ? body.victim
            : []
        );
        Object.keys(state.worldPlayers).forEach((name) => {
          state.worldPlayers[name].gamemode = specNames.has(name)
            ? 'spectator'
            : 'survival';
        });
      }

      if (meta && meta.kind === 'pos' && meta.playerName && body.details) {
        try {
          const parsed =
            typeof body.details === 'string'
              ? JSON.parse(body.details)
              : body.details;
          const target = Array.isArray(parsed) ? parsed[0] : parsed;
          if (target && target.position && state.worldPlayers[meta.playerName]) {
            state.worldPlayers[meta.playerName].x =
              Number(target.position.x) || 0;
            state.worldPlayers[meta.playerName].y =
              Number(target.position.y) || 64;
            state.worldPlayers[meta.playerName].z =
              Number(target.position.z) || 0;
            if (target.yRot !== undefined) {
              state.worldPlayers[meta.playerName].yaw =
                Number(target.yRot) || 0;
            }
          }
        } catch (e) {}
      }

      broadcastToBrowsers();
    }
  });

  const cleanup = () => {
    webClients.delete(ws);

    if (ws.playerName && state.worldPlayers[ws.playerName]) {
      const name = ws.playerName;
      const timer = setTimeout(() => {
        disconnectTimers.delete(name);
        const stillConnected = Array.from(webClients).some(
          (c) => c.playerName === name && c.readyState === 1
        );
        if (!stillConnected && state.worldPlayers[name]) {
          state.worldPlayers[name].linkedPeerId = null;
          state.worldPlayers[name].wsConnected = false;
          state.worldPlayers[name].speaking = false;
          broadcastToBrowsers();
        }
      }, 25000);
      disconnectTimers.set(name, timer);
    }

    if (state.mcSocket === ws) {
      state.mcSocket = null;
      pendingQueries.clear();
      broadcastToBrowsers();
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

let pollTick = 0;
let playerPollIndex = 0;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingQueries.entries()) {
    if (now - v.ts > 3000) pendingQueries.delete(k);
  }

  const ws = state.mcSocket;
  if (!ws || ws.readyState !== 1) return;

  pollTick++;

  if (pollTick % 6 === 1) {
    sendMcCommand(ws, 'list', { kind: 'list' });
    return;
  }

  if (pollTick % 6 === 3) {
    sendMcCommand(ws, 'testfor @a[m=spectator]', { kind: 'spec_all' });
    return;
  }

  const names = Object.keys(state.worldPlayers);
  if (names.length === 0) {
    sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
    return;
  }

  if (playerPollIndex >= names.length) {
    playerPollIndex = 0;
  }
  const targetName = names[playerPollIndex++];
  sendMcCommand(ws, `querytarget @a[name="${targetName}"]`, {
    kind: 'pos',
    playerName: targetName
  });
}, 400);

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) {
      try {
        ws.ping();
      } catch (e) {}
    }
  });

  for (const client of webClients) {
    sendJson(client, { bcafe: true, type: 'KEEPALIVE' });
  }
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
