const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const GLOBAL_ROOM = 'MAIN';

// Server-side persistent state so rules and player positions stay alive 24/7
// even if the /host tab is closed!
const serverState = {
  rules: {
    maxRange: 32,
    minRange: 5,
    rolloff: 'smooth',
    spectatorIsolation: true
  },
  worldPlayers: {},
  uuidToName: {},
  pendingCommandMap: new Map(),
  mcSocket: null,
  lastMcPacketAt: 0
};

function isUuidLike(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^-?\d{8,}$/.test(s);
}

function findCanonicalPlayerKey(nameOrId) {
  if (!nameOrId) return null;
  const clean = String(nameOrId).trim();
  if (serverState.uuidToName[clean]) return serverState.uuidToName[clean];
  if (serverState.worldPlayers[clean]) return clean;
  const lower = clean.toLowerCase();
  for (const k of Object.keys(serverState.worldPlayers)) {
    if (k.toLowerCase() === lower) return k;
  }
  return clean;
}

function mergeUuidIntoPlayerName(uuid, realName) {
  if (!uuid || !realName || uuid === realName) return;
  const canonical = findCanonicalPlayerKey(realName);
  serverState.uuidToName[uuid] = canonical;
  const uuidEntry = serverState.worldPlayers[uuid];
  if (uuidEntry) {
    const existingReal = serverState.worldPlayers[canonical] || {};
    serverState.worldPlayers[canonical] = Object.assign({}, uuidEntry, existingReal, {
      name: canonical,
      uniqueId: uuid,
      x: uuidEntry.x !== undefined ? uuidEntry.x : (existingReal.x || 0),
      y: uuidEntry.y !== undefined ? uuidEntry.y : (existingReal.y || 64),
      z: uuidEntry.z !== undefined ? uuidEntry.z : (existingReal.z || 0),
      yaw: uuidEntry.yaw !== undefined ? uuidEntry.yaw : (existingReal.yaw || 0),
      dimension: uuidEntry.dimension !== undefined ? uuidEntry.dimension : (existingReal.dimension || 0),
      linkedPeerId: existingReal.linkedPeerId || uuidEntry.linkedPeerId || null
    });
    delete serverState.worldPlayers[uuid];
  } else if (serverState.worldPlayers[canonical]) {
    serverState.worldPlayers[canonical].uniqueId = uuid;
  }
}

function upsertServerPlayer(name, patch) {
  if (!name) return;
  const canonical = findCanonicalPlayerKey(name);
  if (isUuidLike(canonical)) return;
  const existing = serverState.worldPlayers[canonical] || {
    name: canonical,
    x: 0,
    y: 64,
    z: 0,
    yaw: 0,
    dimension: 0,
    gamemode: 'survival',
    linkedPeerId: null,
    muted: false,
    deafened: false,
    speaking: false,
    lastSeenAt: Date.now()
  };
  serverState.worldPlayers[canonical] = Object.assign(existing, patch, {
    name: canonical,
    lastSeenAt: Date.now()
  });
}

function makeMcCommandRequest(commandLine, requestId) {
  const reqId = requestId || ('req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  return JSON.stringify({
    header: {
      version: 1,
      requestId: reqId,
      messagePurpose: 'commandRequest',
      messageType: 'commandRequest'
    },
    body: {
      version: 1,
      commandLine: commandLine,
      origin: { type: 'player' }
    }
  });
}

function subscribeMcEvents(ws) {
  ['PlayerTransform', 'PlayerMessage', 'PlayerTravelled'].forEach((evName) => {
    const subFrame = JSON.stringify({
      header: {
        version: 1,
        requestId: 'sub-' + evName + '-' + Date.now(),
        messagePurpose: 'subscribe',
        messageType: 'commandRequest'
      },
      body: { eventName: evName }
    });
    try { ws.send(subFrame); } catch (e) {}
  });
}

function sendTrackedMcCommandToSocket(ws, commandLine, meta) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const reqId = 'srv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  serverState.pendingCommandMap.set(reqId, Object.assign({ ts: Date.now() }, meta || {}));
  if (serverState.pendingCommandMap.size > 150) {
    const oldest = Array.from(serverState.pendingCommandMap.keys()).slice(0, 60);
    oldest.forEach((k) => serverState.pendingCommandMap.delete(k));
  }
  try {
    ws.send(makeMcCommandRequest(commandLine, reqId));
  } catch (e) {}
}

// HTTP Server serving index.html (both / and /host), /api/positions for Behavior Pack, and /healthz
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const cleanUrl = (req.url || '/').split('?')[0];

  if (cleanUrl === '/healthz' || cleanUrl === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      status: 'ok',
      mcConnected: Date.now() - serverState.lastMcPacketAt < 12000,
      players: Object.keys(serverState.worldPlayers).length,
      uptime: process.uptime(),
      ts: Date.now()
    }));
    return;
  }

  // Optional HTTP POST endpoint for Minecraft Bedrock Behavior Pack (@minecraft/server-net)
  if (cleanUrl === '/api/positions' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data.players)) {
          serverState.lastMcPacketAt = Date.now();
          data.players.forEach((p) => {
            if (p && p.name) {
              upsertServerPlayer(p.name, {
                x: Number(p.x) || 0,
                y: Number(p.y) || 64,
                z: Number(p.z) || 0,
                yaw: Number(p.yaw) || 0,
                dimension: Number(p.dimension) || 0,
                gamemode: p.gamemode || 'survival'
              });
            }
          });
          broadcastServerRoster();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // Route / and /host to index.html
  let filePath = (cleanUrl === '/' || cleanUrl === '/host' || cleanUrl === '/host/') ? '/index.html' : cleanUrl;
  filePath = path.join(__dirname, filePath);

  const extname = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'text/html; charset=utf-8';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (err2, fallback) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fallback, 'utf-8');
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Single Global WebSocket Server
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false,
  clientTracking: true
});

function broadcastServerRoster() {
  const payload = JSON.stringify({
    bcafe: true,
    room: GLOBAL_ROOM,
    type: 'ROSTER_SYNC',
    worldPlayers: serverState.worldPlayers,
    rules: serverState.rules,
    mcConnected: Date.now() - serverState.lastMcPacketAt < 12000,
    ts: Date.now()
  });

  wss.clients.forEach((client) => {
    // CRITICAL: Never send custom bcafe JSON to the Minecraft Bedrock client socket!
    // Sending non-Minecraft JSON frames to Minecraft causes it to close the connection.
    if (client.readyState === WebSocket.OPEN && !client.isMinecraftClient) {
      try { client.send(payload); } catch (e) {}
    }
  });
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.isBrowserClient = false;
  ws.isMinecraftClient = false;

  // Check if URL or User-Agent indicates a browser vs Minecraft Bedrock client
  const ua = String(req.headers['user-agent'] || '');
  if (ua.includes('Mozilla') || (req.url && req.url.includes('client=browser'))) {
    ws.isBrowserClient = true;
  } else {
    // Likely Minecraft Bedrock /connect client! Subscribe to events immediately
    subscribeMcEvents(ws);
  }

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    const rawText = isBinary ? data.toString() : String(data);

    try {
      const pkt = JSON.parse(rawText);

      // 1. Browser Client Signaling (bcafe: true)
      if (pkt && pkt.bcafe) {
        ws.isBrowserClient = true;
        ws.isMinecraftClient = false;

        if (pkt.type === 'PING' || pkt.type === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ bcafe: true, type: 'PONG', ts: Date.now() }));
          }
          return;
        }

        if (pkt.type === 'CLAIM_PLAYER' && pkt.playerName && pkt.peerId) {
          ws.claimedPlayerName = pkt.playerName.trim();
          upsertServerPlayer(ws.claimedPlayerName, { linkedPeerId: pkt.peerId });
          broadcastServerRoster();
        } else if (pkt.type === 'PLAYER_MIC_STATE' && pkt.playerName) {
          upsertServerPlayer(pkt.playerName, {
            muted: Boolean(pkt.muted),
            deafened: Boolean(pkt.deafened),
            speaking: Boolean(pkt.speaking)
          });
          broadcastServerRoster();
        } else if (pkt.type === 'UPDATE_RULES' && pkt.rules) {
          serverState.rules = Object.assign({}, serverState.rules, pkt.rules);
          broadcastServerRoster();
        } else if (pkt.type === 'LEAVE_PLAYER' && pkt.playerName) {
          const canonical = findCanonicalPlayerKey(pkt.playerName);
          if (canonical && serverState.worldPlayers[canonical]) {
            serverState.worldPlayers[canonical].linkedPeerId = null;
            serverState.worldPlayers[canonical].speaking = false;
            broadcastServerRoster();
          }
        } else if (pkt.type === 'REQUEST_ROSTER') {
          broadcastServerRoster();
        }

        // Relay browser signaling to other browser clients (NEVER to Minecraft!)
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN && !client.isMinecraftClient) {
            try { client.send(rawText); } catch (e) {}
          }
        });
        return;
      }

      // 2. Outgoing Minecraft commandRequest from a /host browser tab -> forward ONLY to Minecraft socket
      if (pkt && pkt.header && (pkt.header.messagePurpose === 'commandRequest' || pkt.header.messagePurpose === 'subscribe')) {
        ws.isBrowserClient = true;
        if (serverState.mcSocket && serverState.mcSocket.readyState === WebSocket.OPEN) {
          try { serverState.mcSocket.send(rawText); } catch (e) {}
        }
        return;
      }

      // 3. Incoming Minecraft Bedrock Event or CommandResponse!
      if (pkt && pkt.header && (pkt.header.eventName || pkt.header.messagePurpose === 'commandResponse' || pkt.header.messagePurpose === 'error')) {
        ws.isMinecraftClient = true;
        ws.isBrowserClient = false;
        serverState.mcSocket = ws;
        serverState.lastMcPacketAt = Date.now();

        let updated = false;

        if ((pkt.header.eventName === 'PlayerTransform' || pkt.header.eventName === 'PlayerTravelled') && pkt.body) {
          const b = pkt.body;
          const playerObj = b.player || b;
          const rawName = (playerObj.name && !isUuidLike(playerObj.name)) ? playerObj.name : ((b.name && !isUuidLike(b.name)) ? b.name : null);
          const rawUuid = String(playerObj.id || playerObj.uniqueId || b.id || '');
          const pos = playerObj.position || b.position || b;

          if (rawName && rawUuid) {
            mergeUuidIntoPlayerName(rawUuid, rawName);
          }

          let targetKey = rawName || (rawUuid && serverState.uuidToName[rawUuid]) || null;
          if (!targetKey) {
            const nonUuidNames = Object.keys(serverState.worldPlayers).filter((k) => !isUuidLike(k));
            if (nonUuidNames.length === 1) {
              targetKey = nonUuidNames[0];
              if (rawUuid) mergeUuidIntoPlayerName(rawUuid, targetKey);
            }
          }

          if (targetKey && !isUuidLike(targetKey)) {
            upsertServerPlayer(targetKey, {
              x: Number(pos.x) || 0,
              y: Number(pos.y) || 64,
              z: Number(pos.z) || 0,
              yaw: Number(playerObj.yRot || b.yRot || pos.yRot || 0),
              dimension: Number(playerObj.dimension || b.dimension || 0)
            });
            updated = true;
          }
        } else if (pkt.header.messagePurpose === 'commandResponse' && pkt.body) {
          const reqId = pkt.header.requestId || '';
          const cmdMeta = serverState.pendingCommandMap.get(reqId) || {};
          if (reqId) serverState.pendingCommandMap.delete(reqId);

          if (pkt.body.details) {
            try {
              const details = typeof pkt.body.details === 'string' ? JSON.parse(pkt.body.details) : pkt.body.details;
              const requestedPlayer = cmdMeta.playerName || null;
              if (Array.isArray(details)) {
                const knownGamertags = Object.keys(serverState.worldPlayers).filter((k) => !isUuidLike(k));
                details.forEach((ent, idx) => {
                  if (!ent || !ent.position) return;
                  const rawId = ent.uniqueId ? String(ent.uniqueId) : (ent.id ? String(ent.id) : null);
                  const entName = (ent.name && !isUuidLike(ent.name)) ? ent.name : null;

                  if (entName && rawId) mergeUuidIntoPlayerName(rawId, entName);
                  if (requestedPlayer && rawId) mergeUuidIntoPlayerName(rawId, requestedPlayer);

                  let resolvedName = requestedPlayer || entName || (rawId && serverState.uuidToName[rawId]) || null;
                  if (!resolvedName) {
                    if (details.length === 1 && knownGamertags.length === 1) {
                      resolvedName = knownGamertags[0];
                      if (rawId) mergeUuidIntoPlayerName(rawId, resolvedName);
                    } else if (details.length === knownGamertags.length && knownGamertags[idx]) {
                      resolvedName = knownGamertags[idx];
                      if (rawId) mergeUuidIntoPlayerName(rawId, resolvedName);
                    }
                  }

                  if (resolvedName && !isUuidLike(resolvedName)) {
                    upsertServerPlayer(resolvedName, {
                      uniqueId: rawId || undefined,
                      x: Number(ent.position.x) || 0,
                      y: Number(ent.position.y) || 64,
                      z: Number(ent.position.z) || 0,
                      yaw: Number(ent.yRot) || 0,
                      dimension: Number(ent.dimension) || 0
                    });
                    updated = true;
                  }
                });
              }
            } catch (e) {}
          }

          if (Array.isArray(pkt.body.victim)) {
            const victims = pkt.body.victim.filter((v) => v && !isUuidLike(v));
            if (cmdMeta.kind === 'spectators') {
              const specSet = new Set(victims.map((v) => findCanonicalPlayerKey(v)));
              Object.keys(serverState.worldPlayers).forEach((pName) => {
                serverState.worldPlayers[pName].gamemode = specSet.has(pName) ? 'spectator' : 'survival';
              });
              updated = true;
            } else {
              victims.forEach((vName) => {
                const canonical = findCanonicalPlayerKey(vName);
                if (!serverState.worldPlayers[canonical]) {
                  upsertServerPlayer(canonical, {});
                  updated = true;
                }
              });
            }
          } else if (cmdMeta.kind === 'spectators') {
            Object.keys(serverState.worldPlayers).forEach((pName) => {
              if (serverState.worldPlayers[pName].gamemode !== 'survival') {
                serverState.worldPlayers[pName].gamemode = 'survival';
                updated = true;
              }
            });
          }
        }

        if (updated) {
          broadcastServerRoster();
        }

        // Also forward raw Minecraft packet to any open /host browser tabs
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN && client.isBrowserClient) {
            try { client.send(rawText); } catch (e) {}
          }
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (ws === serverState.mcSocket) {
      serverState.mcSocket = null;
      broadcastServerRoster();
    }
    if (ws.claimedPlayerName) {
      const canonical = findCanonicalPlayerKey(ws.claimedPlayerName);
      if (canonical && serverState.worldPlayers[canonical]) {
        serverState.worldPlayers[canonical].linkedPeerId = null;
        serverState.worldPlayers[canonical].speaking = false;
        broadcastServerRoster();
      }
    }
  });

  ws.on('error', () => {});
});

// Server-side Minecraft Polling Loop (Every 1500ms)
// Polls Minecraft directly from Node.js so positions update even if /host is closed!
setInterval(() => {
  const mcWs = serverState.mcSocket;
  if (mcWs && mcWs.readyState === WebSocket.OPEN) {
    sendTrackedMcCommandToSocket(mcWs, 'testfor @a', { kind: 'all_players' });
    sendTrackedMcCommandToSocket(mcWs, 'testfor @a[m=spectator]', { kind: 'spectators' });
    sendTrackedMcCommandToSocket(mcWs, 'querytarget @a', { kind: 'query_all' });

    Object.keys(serverState.worldPlayers).forEach((pName) => {
      if (!isUuidLike(pName)) {
        const safeName = pName.replace(/"/g, '');
        sendTrackedMcCommandToSocket(mcWs, `querytarget @a[name="${safeName}"]`, {
          kind: 'query_player',
          playerName: pName
        });
      }
    });
  }
}, 1500);

// 15-second WebSocket Keep-Alive Loop
// Sends valid JSON heartbeat ONLY to browsers, and valid RFC 6455 Ping + Minecraft command to Minecraft!
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.isMinecraftClient) {
          // Send a valid Minecraft Bedrock commandRequest keep-alive (NEVER send non-Minecraft JSON to Minecraft!)
          ws.send(makeMcCommandRequest('testfor @a', 'keepalive-' + Date.now()));
        } else {
          ws.send(JSON.stringify({ bcafe: true, type: 'SERVER_HEARTBEAT', ts: Date.now() }));
        }
      }
    } catch (e) {}
  });
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bedrock Cafe Single-Server Proximity Voice running on 0.0.0.0:${PORT}`);
});
