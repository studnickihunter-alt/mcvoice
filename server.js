const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const STATE_FILE = '/tmp/bcafe-state.json';

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

// Restore last known player positions & rules if process ever restarts
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
          inWorld: Boolean(p.inWorld),
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
      }),
      'utf8'
    );
  } catch (e) {}
}

const webClients = new Set();
const disconnectTimers = new Map();

let inFlightRequest = null;
let pollTick = 0;
let playerPollIndex = 0;

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/healthz')) {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store'
    });
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
  const str = JSON.stringify({
    bcafe: true,
    type: 'ROSTER_SYNC',
    mcConnected: isMcConnected(),
    worldPlayers: state.worldPlayers,
    rules: state.rules
  });
  for (const client of webClients) {
    if (client.readyState === 1) {
      try {
        client.send(str);
      } catch (e) {}
    }
  }
}

function sendMcCommand(ws, commandLine, meta) {
  if (!ws || ws.readyState !== 1) return;
  const requestId = crypto.randomUUID();
  if (meta) {
    inFlightRequest = {
      requestId,
      kind: meta.kind,
      playerName: meta.playerName || null,
      ts: Date.now()
    };
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

  ws.clientId = crypto.randomUUID();
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  if (isBrowserUrl) {
    ws.isBrowser = true;
    webClients.add(ws);
    broadcastToBrowsers();
  } else {
    ws.isBrowser = false;
    sendMcCommand(ws, 'list', { kind: 'list' });
    sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.bcafe) {
      ws.isBrowser = true;
      webClients.add(ws);

      if (msg.type === 'PING') {
        sendJson(ws, { bcafe: true, type: 'PONG' });
        return;
      }

      // Direct WebRTC signaling relay between players
      if (msg.type === 'RTC_SIGNAL' && msg.to && msg.from) {
        for (const client of webClients) {
          if (client !== ws && client.readyState === 1 && client.playerName === msg.to) {
            sendJson(client, msg);
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
        state.worldPlayers[name].linkedPeerId = msg.peerId || ws.clientId;
        ws.peerId = state.worldPlayers[name].linkedPeerId;

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

    // Verified Minecraft packet
    if (msg.header || msg.body) {
      ws.isBrowser = false;
      webClients.delete(ws);
      state.mcSocket = ws;
      state.lastMcPacketAt = Date.now();

      const reqId = msg.header && msg.header.requestId;
      const meta =
        inFlightRequest && inFlightRequest.requestId === reqId
          ? inFlightRequest
          : null;
      if (meta) {
        inFlightRequest = null;
      }

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
        if (names.length > 0) {
          const onlineSet = new Set(names);
          names.forEach((n) => ensurePlayerEntry(n));
          Object.keys(state.worldPlayers).forEach((existing) => {
            if (!state.worldPlayers[existing].wsConnected && !onlineSet.has(existing)) {
              state.worldPlayers[existing].inWorld = false;
            }
          });
        }
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
      }, 20000);
      disconnectTimers.set(name, timer);
    }

    if (state.mcSocket === ws) {
      state.mcSocket = null;
      inFlightRequest = null;
      broadcastToBrowsers();
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// Single-command-at-a-time paced polling for Minecraft (never overflows MC queue, keeps proxy open)
setInterval(() => {
  const ws = state.mcSocket;
  if (!ws || ws.readyState !== 1) return;

  const now = Date.now();
  if (inFlightRequest && now - inFlightRequest.ts < 1800) {
    return;
  }
  inFlightRequest = null;

  pollTick++;

  if (pollTick % 8 === 1) {
    sendMcCommand(ws, 'list', { kind: 'list' });
    return;
  }

  if (pollTick % 8 === 4) {
    sendMcCommand(ws, 'testfor @a[m=spectator]', { kind: 'spec_all' });
    return;
  }

  const activeNames = Object.keys(state.worldPlayers).filter(
    (n) => state.worldPlayers[n].inWorld !== false
  );

  if (activeNames.length === 0) {
    sendMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
    return;
  }

  if (playerPollIndex >= activeNames.length) {
    playerPollIndex = 0;
  }
  const targetName = activeNames[playerPollIndex++];
  sendMcCommand(ws, `querytarget @a[name="${targetName}"]`, {
    kind: 'pos',
    playerName: targetName
  });
}, 450);

// Keep browser sockets alive and persist state to /tmp every 8 seconds
setInterval(() => {
  saveStateSnapshot();
  for (const client of webClients) {
    sendJson(client, { bcafe: true, type: 'KEEPALIVE' });
  }
}, 8000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
