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
const disconnectTimers = new Map();

let inFlightRequest = null;
let pollStep = 0;
let playerPollIndex = 0;
let nextPollTimer = null;

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

server.keepAliveTimeout = 0;
server.headersTimeout = 0;

server.on('connection', (socket) => {
  socket.setKeepAlive(true, 10000);
  socket.setNoDelay(true);
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 256 * 1024,
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
  const str = JSON.stringify(payload);
  for (const client of webClients) {
    if (client.readyState === 1) {
      try {
        client.send(str);
      } catch (e) {}
    }
  }
}

function sendMcSubscribe(ws, eventName) {
  if (!ws || ws.readyState !== 1) return;
  sendJson(ws, {
    header: {
      version: 1,
      requestId: crypto.randomUUID(),
      messagePurpose: 'subscribe',
      messageType: 'commandRequest'
    },
    body: {
      eventName
    }
  });
}

function sendRawMcCommand(ws, commandLine, meta) {
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

function scheduleNextMcPoll(delayMs = 280) {
  if (nextPollTimer) {
    clearTimeout(nextPollTimer);
    nextPollTimer = null;
  }
  nextPollTimer = setTimeout(runNextMcPoll, delayMs);
}

function runNextMcPoll() {
  nextPollTimer = null;
  const ws = state.mcSocket;
  if (!ws || ws.readyState !== 1) {
    inFlightRequest = null;
    return;
  }

  const now = Date.now();
  // Never queue multiple commands if Minecraft hasn't answered the current one yet
  if (inFlightRequest && now - inFlightRequest.ts < 2200) {
    scheduleNextMcPoll(300);
    return;
  }
  inFlightRequest = null;

  pollStep++;

  if (pollStep % 8 === 1) {
    sendRawMcCommand(ws, 'list', { kind: 'list' });
    scheduleNextMcPoll(2200);
    return;
  }

  if (pollStep % 8 === 4) {
    sendRawMcCommand(ws, 'testfor @a[m=spectator]', { kind: 'spec_all' });
    scheduleNextMcPoll(2200);
    return;
  }

  const names = Object.keys(state.worldPlayers);
  if (names.length === 0) {
    sendRawMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
    scheduleNextMcPoll(2200);
    return;
  }

  if (playerPollIndex >= names.length) {
    playerPollIndex = 0;
  }
  const targetName = names[playerPollIndex++];
  sendRawMcCommand(ws, `querytarget @a[name="${targetName}"]`, {
    kind: 'pos',
    playerName: targetName
  });
  scheduleNextMcPoll(2200);
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
    // Send a single lightweight probe; do NOT set state.mcSocket until it replies with a valid MC header
    sendRawMcCommand(ws, 'getlocalplayername', { kind: 'localname' });
  }

  ws.on('message', (raw) => {
    const rawStr = raw.toString();

    // Fast path for VOICE_CHUNK: only forward to active player sockets, never to host dashboard
    if (rawStr.includes('"VOICE_CHUNK"')) {
      ws.isBrowser = true;
      webClients.add(ws);
      for (const client of webClients) {
        if (
          client !== ws &&
          client.readyState === 1 &&
          client.playerName &&
          client._socket &&
          client._socket.bufferSize < 65536
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

    // Verified Minecraft Bedrock packet
    if (msg.header && (msg.header.messagePurpose || msg.header.eventName)) {
      ws.isBrowser = false;
      webClients.delete(ws);

      const isNewMcSocket = state.mcSocket !== ws;
      state.mcSocket = ws;
      state.lastMcPacketAt = Date.now();

      if (isNewMcSocket) {
        sendMcSubscribe(ws, 'PlayerTransform');
        sendMcSubscribe(ws, 'PlayerTravelled');
        sendRawMcCommand(ws, 'list', { kind: 'list' });
      }

      const body = msg.body || {};

      // Handle real-time movement events from PlayerTransform / PlayerTravelled
      if (msg.header.messagePurpose === 'event' && body.player && body.player.name) {
        const pName = body.player.name.trim();
        if (pName) {
          ensurePlayerEntry(pName);
          if (body.player.position) {
            const px = Number(body.player.position.x);
            const py = Number(body.player.position.y);
            const pz = Number(body.player.position.z);
            if (Number.isFinite(px)) state.worldPlayers[pName].x = px;
            if (Number.isFinite(py)) state.worldPlayers[pName].y = py;
            if (Number.isFinite(pz)) state.worldPlayers[pName].z = pz;
          }
          if (body.player.yRot !== undefined && Number.isFinite(Number(body.player.yRot))) {
            state.worldPlayers[pName].yaw = Number(body.player.yRot);
          }
          broadcastToBrowsers();
        }
        return;
      }

      const reqId = msg.header.requestId;
      const meta =
        inFlightRequest && inFlightRequest.requestId === reqId
          ? inFlightRequest
          : null;
      if (meta) {
        inFlightRequest = null;
      }

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
      // Schedule the next single command only after Minecraft finishes answering this one
      scheduleNextMcPoll(250);
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
      inFlightRequest = null;
      if (nextPollTimer) {
        clearTimeout(nextPollTimer);
        nextPollTimer = null;
      }
      broadcastToBrowsers();
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// Watchdog: if polling ever pauses while Minecraft is connected, kick it gently
setInterval(() => {
  if (isMcConnected() && !nextPollTimer) {
    scheduleNextMcPoll(200);
  }
}, 2000);

// Keep browser sockets alive without sending raw ws.ping() frames to Minecraft
setInterval(() => {
  for (const client of webClients) {
    sendJson(client, { bcafe: true, type: 'KEEPALIVE' });
  }
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
