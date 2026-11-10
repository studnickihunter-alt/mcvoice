const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const rooms = new Map();

function getRoom(roomCode) {
  const code = (roomCode || 'DEFAULT').toUpperCase();
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      mcSocket: null,
      lastMcPacketAt: 0,
      rules: {
        maxRange: 32,
        minRange: 5,
        rolloff: 'smooth',
        spectatorIsolation: true
      },
      worldPlayers: {},
      webClients: new Set(),
      pendingQueries: new Map(),
      lastActiveAt: Date.now()
    });
  }
  const room = rooms.get(code);
  room.lastActiveAt = Date.now();
  return room;
}

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

function broadcastToRoom(room) {
  const payload = {
    bcafe: true,
    type: 'ROSTER_SYNC',
    roomCode: room.code,
    mcConnected: Boolean(
      room.mcSocket &&
      room.mcSocket.readyState === 1 &&
      Date.now() - room.lastMcPacketAt < 8000
    ),
    worldPlayers: room.worldPlayers,
    rules: room.rules
  };
  for (const client of room.webClients) {
    sendJson(client, payload);
  }
}

function sendMcCommand(room, ws, commandLine, meta) {
  if (!ws || ws.readyState !== 1) return;
  const requestId = crypto.randomUUID();
  if (meta) {
    room.pendingQueries.set(requestId, { ...meta, ts: Date.now() });
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

wss.on('connection', (ws, req) => {
  const rawPath = (req.url || '/')
    .split('?')[0]
    .replace(/^\/+|\/+$/g, '')
    .toUpperCase();
  const roomCode = rawPath || 'DEFAULT';
  const room = getRoom(roomCode);

  const probeTimer = setTimeout(() => {
    if (!room.webClients.has(ws) && ws.readyState === 1) {
      room.mcSocket = ws;
      room.lastMcPacketAt = Date.now();
      sendMcCommand(room, ws, 'list', { kind: 'list' });
      sendMcCommand(room, ws, 'getlocalplayername', { kind: 'localname' });
      broadcastToRoom(room);
    }
  }, 300);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    room.lastActiveAt = Date.now();

    if (msg.bcafe) {
      clearTimeout(probeTimer);
      room.webClients.add(ws);

      if (msg.type === 'REQUEST_ROSTER') {
        broadcastToRoom(room);
      } else if (msg.type === 'CLAIM_PLAYER' && msg.playerName) {
        ws.playerName = msg.playerName;
        ws.peerId = msg.peerId;
        if (!room.worldPlayers[msg.playerName]) {
          room.worldPlayers[msg.playerName] = {
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
          room.worldPlayers[msg.playerName].linkedPeerId = msg.peerId;
        }
        broadcastToRoom(room);
      } else if (
        msg.type === 'PLAYER_MIC_STATE' &&
        msg.playerName &&
        room.worldPlayers[msg.playerName]
      ) {
        room.worldPlayers[msg.playerName].muted = Boolean(msg.muted);
        room.worldPlayers[msg.playerName].deafened = Boolean(msg.deafened);
        room.worldPlayers[msg.playerName].speaking = Boolean(msg.speaking);
        broadcastToRoom(room);
      } else if (msg.type === 'UPDATE_RULES' && msg.rules) {
        room.rules = { ...room.rules, ...msg.rules };
        broadcastToRoom(room);
      } else if (msg.type === 'ADD_MANUAL_PLAYER' && msg.playerName) {
        const name = msg.playerName.trim();
        if (name && !room.worldPlayers[name]) {
          room.worldPlayers[name] = {
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
          broadcastToRoom(room);
        }
      } else if (
        msg.type === 'LEAVE_PLAYER' &&
        msg.playerName &&
        room.worldPlayers[msg.playerName]
      ) {
        room.worldPlayers[msg.playerName].linkedPeerId = null;
        room.worldPlayers[msg.playerName].speaking = false;
        broadcastToRoom(room);
      }
      return;
    }

    if (msg.header || msg.body) {
      clearTimeout(probeTimer);
      room.webClients.delete(ws);
      room.mcSocket = ws;
      room.lastMcPacketAt = Date.now();

      const reqId = msg.header && msg.header.requestId;
      const meta = reqId ? room.pendingQueries.get(reqId) : null;
      if (reqId) room.pendingQueries.delete(reqId);

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
          if (!room.worldPlayers[n]) {
            room.worldPlayers[n] = {
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
            room.worldPlayers[n].inWorld = true;
          }
        });
      }

      if (typeof body.localplayername === 'string') {
        const n = body.localplayername.trim();
        if (n && !room.worldPlayers[n]) {
          room.worldPlayers[n] = {
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
          if (target && target.position && room.worldPlayers[meta.playerName]) {
            room.worldPlayers[meta.playerName].x = Number(target.position.x) || 0;
            room.worldPlayers[meta.playerName].y = Number(target.position.y) || 64;
            room.worldPlayers[meta.playerName].z = Number(target.position.z) || 0;
            if (target.yRot !== undefined) {
              room.worldPlayers[meta.playerName].yaw = Number(target.yRot) || 0;
            }
          }
        } catch (e) {}
      }

      if (
        meta &&
        meta.kind === 'spec' &&
        meta.playerName &&
        room.worldPlayers[meta.playerName]
      ) {
        const isSpec =
          body.statusCode === 0 &&
          Array.isArray(body.victim) &&
          body.victim.length > 0;
        room.worldPlayers[meta.playerName].gamemode = isSpec
          ? 'spectator'
          : 'survival';
      }

      broadcastToRoom(room);
    }
  });

  const cleanup = () => {
    clearTimeout(probeTimer);
    room.webClients.delete(ws);
    if (ws.playerName && room.worldPlayers[ws.playerName]) {
      if (!ws.peerId || room.worldPlayers[ws.playerName].linkedPeerId === ws.peerId) {
        room.worldPlayers[ws.playerName].linkedPeerId = null;
        room.worldPlayers[ws.playerName].speaking = false;
      }
    }
    if (room.mcSocket === ws) {
      room.mcSocket = null;
    }
    broadcastToRoom(room);
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    for (const [k, v] of room.pendingQueries.entries()) {
      if (now - v.ts > 4000) room.pendingQueries.delete(k);
    }

    if (room.mcSocket && room.mcSocket.readyState === 1) {
      sendMcCommand(room, room.mcSocket, 'list', { kind: 'list' });
      sendMcCommand(room, room.mcSocket, 'getlocalplayername', { kind: 'localname' });
      Object.keys(room.worldPlayers).forEach((name) => {
        sendMcCommand(room, room.mcSocket, `querytarget @a[name="${name}"]`, {
          kind: 'pos',
          playerName: name
        });
        sendMcCommand(room, room.mcSocket, `testfor @a[name="${name}",m=spectator]`, {
          kind: 'spec',
          playerName: name
        });
      });
    } else if (room.webClients.size === 0 && now - room.lastActiveAt > 1800000) {
      rooms.delete(code);
    }
  }
}, 400);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe listening on port ${PORT}`);
});
