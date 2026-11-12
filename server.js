const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const STATE_FILE = '/tmp/bcafe-state.json';
const HTML_PATH = path.join(__dirname, 'index.html');
const CACHED_HTML = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH) : Buffer.from('index.html not found');

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

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved && saved.rules) {
      state.rules = { ...state.rules, ...saved.rules };
    }
    if (saved && saved.worldPlayers) {
      for (const [name, p] of Object.entries(saved.worldPlayers)) {
        state.worldPlayers[name] = {
          name,
          x: Number(p.x) || 0,
          y: Number(p.y) || 64,
          z: Number(p.z) || 0,
          yaw: Number(p.yaw) || 0,
          gamemode: p.gamemode || 'survival',
          inWorld: true,
          linkedPeerId: null,
          wsConnected: false,
          muted: false,
          deafened: false,
          speaking: false
        };
      }
    }
  }
} catch (e) {}

function saveStateSnapshot() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        rules: state.rules,
        worldPlayers: state.worldPlayers
      })
    );
  } catch (e) {}
}

const webClients = new Set();
const pendingQueries = new Map();
const disconnectTimers = new Map();

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/healthz')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('ok');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(CACHED_HTML);
});

server.keepAliveTimeout = 0;
server.headersTimeout = 0;

server.on('connection', (socket) => {
  socket.setKeepAlive(true, 5000);
  socket.setNoDelay(true);
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 64 * 1024,
  handleProtocols: () => false
});

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1 && ws.bufferedAmount < 32768) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function isMcConnected() {
  return Boolean(state.mcSocket && state.mcSocket.readyState === 1);
}

function broadcastToBrowsers() {
  const str = JSON.stringify({
    bcafe: true,
    type: 'ROSTER_SYNC',
    mcConnected: isMcConnected(),
    worldPlayers: state.worldPlayers,
    rules: state.rules
  });
  for (const client of webClients) {
    if (client.readyState === 1 && client.bufferedAmount < 32768) {
      try {
        client.send(str);
      } catch (e) {}
    }
  }
}

function sendMcCommand(ws, commandLine, meta) {
  if (!ws || ws.readyState !== 1 || ws.bufferedAmount > 8192) return;
  if (pendingQueries.size >= 4) {
    pendingQueries.clear();
  }
  const requestId = crypto.randomUUID();
  if (meta) {
    pendingQueries.set(requestId, {
      kind: meta.kind,
      playerName: meta.playerName || null,
      ts: Date.now()
    });
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
    ws.isBrowser = false;
    sendMcCommand(ws, 'list', { kind: 'list' });
    sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
  }

  ws.on('message', (raw, isBinary) => {
    const rawStr = isBinary ? raw.toString() : String(raw);

    if (rawStr.includes('"VOICE_CHUNK"')) {
      ws.isBrowser = true;
      webClients.add(ws);
      for (const client of webClients) {
        if (
          client !== ws &&
          client.readyState === 1 &&
          client.playerName &&
          client.bufferedAmount < 16384
        ) {
          try {
            client.send(rawStr);
          } catch (e) {}
        }
      }
      return;
    }

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
        saveStateSnapshot();
        broadcastToBrowsers();
      } else if (msg.type === 'ADD_MANUAL_PLAYER' && msg.playerName) {
        const name = msg.playerName.trim();
        if (name) {
          ensurePlayerEntry(name);
          saveStateSnapshot();
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
            const px = Number(target.position.x);
            const py = Number(target.position.y);
            const pz = Number(target.position.z);
            if (Number.isFinite(px)) state.worldPlayers[meta.playerName].x = px;
            if (Number.isFinite(py)) state.worldPlayers[meta.playerName].y = py;
            if (Number.isFinite(pz)) state.worldPlayers[meta.playerName].z = pz;
            if (target.yRot !== undefined && Number.isFinite(Number(target.yRot))) {
              state.worldPlayers[meta.playerName].yaw = Number(target.yRot);
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
  const ws = state.mcSocket;
  if (!ws || ws.readyState !== 1) return;

  const now = Date.now();
  for (const [k, v] of pendingQueries.entries()) {
    if (now - v.ts > 1500) pendingQueries.delete(k);
  }

  if (pendingQueries.size > 0) return;

  pollTick++;

  if (pollTick % 8 === 1) {
    sendMcCommand(ws, 'list', { kind: 'list' });
    return;
  }

  if (pollTick % 8 === 4) {
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
}, 500);

// Delete old cached objects, prune dead clients, save state, and force garbage collection every 15s
setInterval(() => {
  pendingQueries.clear();

  for (const client of webClients) {
    if (client.readyState !== 1) {
      webClients.delete(client);
    } else {
      sendJson(client, { bcafe: true, type: 'KEEPALIVE' });
    }
  }

  const playerKeys = Object.keys(state.worldPlayers);
  if (playerKeys.length > 40) {
    for (const k of playerKeys) {
      if (!state.worldPlayers[k].wsConnected && !state.worldPlayers[k].linkedPeerId) {
        delete state.worldPlayers[k];
      }
    }
  }

  saveStateSnapshot();

  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch (e) {}
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
