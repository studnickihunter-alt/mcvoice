const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const allSockets = new Set();
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

function sendWsText(socket, text) {
  if (!socket || socket.destroyed || !socket.writable) return;
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch (e) {}
}

function broadcastToBrowsers() {
  const msg = JSON.stringify({
    bcafe: true,
    type: 'ROSTER_SYNC',
    mcConnected: Boolean(state.mcSocket && !state.mcSocket.destroyed && (Date.now() - state.lastMcPacketAt < 8000)),
    worldPlayers: state.worldPlayers,
    rules: state.rules
  });
  for (const client of webClients) {
    sendWsText(client, msg);
  }
}

function sendMcCommand(socket, commandLine, meta) {
  if (!socket || socket.destroyed) return;
  const requestId = crypto.randomUUID();
  if (meta) {
    pendingQueries.set(requestId, { ...meta, ts: Date.now() });
  }
  sendWsText(socket, JSON.stringify({
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
  }));
}

function handleIncomingJson(socket, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.bcafe) {
    webClients.add(socket);

    if (msg.type === 'REQUEST_ROSTER') {
      broadcastToBrowsers();
    } else if (msg.type === 'CLAIM_PLAYER' && msg.playerName) {
      socket.playerName = msg.playerName;
      socket.peerId = msg.peerId;
      if (!state.worldPlayers[msg.playerName]) {
        state.worldPlayers[msg.playerName] = {
          name: msg.playerName,
          x: 0, y: 64, z: 0, yaw: 0,
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
    } else if (msg.type === 'PLAYER_MIC_STATE' && msg.playerName && state.worldPlayers[msg.playerName]) {
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
          x: 0, y: 64, z: 0, yaw: 0,
          gamemode: 'survival',
          inWorld: true,
          linkedPeerId: null,
          muted: false,
          deafened: false,
          speaking: false
        };
        broadcastToBrowsers();
      }
    } else if (msg.type === 'LEAVE_PLAYER' && msg.playerName && state.worldPlayers[msg.playerName]) {
      state.worldPlayers[msg.playerName].linkedPeerId = null;
      state.worldPlayers[msg.playerName].speaking = false;
      broadcastToBrowsers();
    }
    return;
  }

  if (msg.header || msg.body) {
    webClients.delete(socket);
    state.mcSocket = socket;
    state.lastMcPacketAt = Date.now();

    const reqId = msg.header && msg.header.requestId;
    const meta = reqId ? pendingQueries.get(reqId) : null;
    if (reqId) pendingQueries.delete(reqId);

    const body = msg.body || {};

    if ((meta && meta.kind === 'list') || typeof body.players === 'string' || typeof body.statusMessage === 'string') {
      let names = [];
      if (typeof body.players === 'string') {
        names = body.players.split(',').map(s => s.trim()).filter(Boolean);
      } else if (typeof body.statusMessage === 'string' && body.statusMessage.includes('players online:')) {
        const lines = body.statusMessage.split('\n');
        if (lines.length > 1) {
          names = lines.slice(1).join(',').split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      if (names.length > 0) {
        names.forEach(n => {
          if (!state.worldPlayers[n]) {
            state.worldPlayers[n] = {
              name: n,
              x: 0, y: 64, z: 0, yaw: 0,
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
    }

    if (typeof body.localplayername === 'string') {
      const n = body.localplayername.trim();
      if (n && !state.worldPlayers[n]) {
        state.worldPlayers[n] = {
          name: n,
          x: 0, y: 64, z: 0, yaw: 0,
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
        const parsed = typeof body.details === 'string' ? JSON.parse(body.details) : body.details;
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

    if (meta && meta.kind === 'spec' && meta.playerName && state.worldPlayers[meta.playerName]) {
      const isSpec = body.statusCode === 0 && Array.isArray(body.victim) && body.victim.length > 0;
      state.worldPlayers[meta.playerName].gamemode = isSpec ? 'spectator' : 'survival';
    }

    broadcastToBrowsers();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const proto = req.headers['sec-websocket-protocol'];
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`
  ];
  if (proto) {
    headers.push(`Sec-WebSocket-Protocol: ${proto.split(',')[0].trim()}`);
  }

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  socket.setNoDelay(true);
  allSockets.add(socket);

  setTimeout(() => {
    if (!webClients.has(socket) && !socket.destroyed) {
      sendMcCommand(socket, 'list', { kind: 'list' });
      sendMcCommand(socket, 'getlocalplayername', { kind: 'localname' });
    }
  }, 300);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (isMasked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x8) {
        socket.end();
        return;
      } else if (opcode === 0x9) {
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0;
        try { socket.write(pong); } catch (e) {}
      } else if (opcode === 0x1) {
        try {
          const parsed = JSON.parse(payload.toString('utf8'));
          handleIncomingJson(socket, parsed);
        } catch (e) {}
      }
    }
  });

  const cleanup = () => {
    allSockets.delete(socket);
    webClients.delete(socket);
    if (socket.playerName && state.worldPlayers[socket.playerName]) {
      state.worldPlayers[socket.playerName].linkedPeerId = null;
      state.worldPlayers[socket.playerName].speaking = false;
    }
    if (state.mcSocket === socket) {
      state.mcSocket = null;
    }
    broadcastToBrowsers();
  };

  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingQueries.entries()) {
    if (now - v.ts > 4000) pendingQueries.delete(k);
  }

  const targetSocket = state.mcSocket;
  if (targetSocket && !targetSocket.destroyed) {
    sendMcCommand(targetSocket, 'list', { kind: 'list' });
    sendMcCommand(targetSocket, 'getlocalplayername', { kind: 'localname' });
    Object.keys(state.worldPlayers).forEach(name => {
      sendMcCommand(targetSocket, `querytarget @a[name="${name}"]`, { kind: 'pos', playerName: name });
      sendMcCommand(targetSocket, `testfor @a[name="${name}",m=spectator]`, { kind: 'spec', playerName: name });
    });
  }
}, 400);

server.listen(PORT, () => {
  console.log(`Bedrock Cafe running on port ${PORT}`);
});
