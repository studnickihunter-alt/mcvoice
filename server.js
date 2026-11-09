<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Bedrock Cafe — Proximity Voice Chat</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            serif: ['Fraunces', 'Georgia', 'serif'],
            sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            navy: {
              950: '#100D1E',
              900: '#161326',
              800: '#211C38',
              700: '#2C254A',
              600: '#3D3463'
            },
            cream: {
              100: '#F6F2EA',
              200: '#E8DFD1',
              300: '#C4B7CB'
            },
            berry: {
              400: '#B69DF8',
              500: '#9B7EDE',
              600: '#7E5EC4'
            },
            sage: {
              400: '#84B59F',
              500: '#689F87',
              600: '#4F826C'
            },
            espresso: {
              400: '#E2A86F',
              500: '#C88D55'
            },
            rosewood: {
              400: '#E07A7A',
              500: '#C95B5B'
            }
          }
        }
      }
    }
  </script>
  <style>
    body {
      background-color: #161326;
      color: #F6F2EA;
      font-family: 'Plus Jakarta Sans', sans-serif;
      overflow-x: hidden;
      background-image:
        radial-gradient(circle at 15% 15%, rgba(155, 126, 222, 0.13) 0%, transparent 45%),
        radial-gradient(circle at 85% 80%, rgba(132, 181, 159, 0.11) 0%, transparent 45%),
        radial-gradient(circle at 50% 50%, rgba(226, 168, 111, 0.05) 0%, transparent 60%);
    }
    .cafe-card {
      background: rgba(33, 28, 56, 0.84);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(196, 183, 203, 0.15);
      box-shadow: 0 20px 50px rgba(10, 8, 20, 0.55);
    }
    .cafe-card-subtle {
      background: rgba(22, 19, 38, 0.65);
      border: 1px solid rgba(196, 183, 203, 0.12);
    }
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      background: #161326;
      height: 8px;
      border-radius: 999px;
      border: 1px solid rgba(196, 183, 203, 0.2);
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #84B59F;
      cursor: pointer;
      border: 3px solid #F6F2EA;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    }
  </style>
</head>
<body class="min-h-screen flex flex-col selection:bg-berry-500 selection:text-navy-950">

  <div class="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-25">
    <svg class="absolute -top-12 -left-12 w-80 h-80 text-sage-500/20" viewBox="0 0 200 200" fill="currentColor">
      <path d="M40,120 C20,80 50,20 110,20 C110,80 80,120 40,120 Z" />
      <path d="M90,160 C70,120 100,60 160,60 C160,120 130,160 90,160 Z" opacity="0.6" />
    </svg>
    <svg class="absolute -bottom-16 -right-12 w-96 h-96 text-berry-500/20" viewBox="0 0 200 200" fill="currentColor">
      <path d="M160,80 C180,120 150,180 90,180 C90,120 120,80 160,80 Z" />
      <path d="M110,40 C130,80 100,140 40,140 C40,80 70,40 110,40 Z" opacity="0.5" />
    </svg>
  </div>

  <header class="relative z-10 border-b border-cream-300/10 bg-navy-900/75 backdrop-blur-md">
    <div class="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-berry-500/25 to-sage-400/25 border border-cream-300/20 flex items-center justify-center shadow-inner">
          <svg class="w-5 h-5 text-espresso-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 1v3M10 1v3M14 1v3"/>
          </svg>
        </div>
        <div>
          <span class="font-serif text-lg font-bold tracking-tight text-cream-100 block leading-none">Bedrock Cafe</span>
          <span class="text-xs text-cream-300">Minecraft Bedrock Proximity Voice Lounge</span>
        </div>
      </div>

      <div id="topStatusArea" class="hidden items-center gap-3">
        <span id="roleBadge" class="px-3 py-1 rounded-full text-xs font-semibold bg-berry-500/20 text-berry-400 border border-berry-400/30">
          Table Host
        </span>
        <button id="leaveBtn" class="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rosewood-500/15 hover:bg-rosewood-500/25 text-rosewood-400 border border-rosewood-400/30 transition">
          Leave Table
        </button>
      </div>
    </div>
  </header>

  <main id="lobbyScreen" class="relative z-10 flex-1 flex items-center justify-center p-5">
    <div class="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">

      <div class="cafe-card rounded-3xl p-7 flex flex-col justify-between relative overflow-hidden">
        <div class="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-sage-400/10 blur-xl pointer-events-none"></div>
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sage-400/15 border border-sage-400/30 text-sage-400 text-xs font-semibold mb-4">
            <span>🌿</span> Join Voice Call
          </div>
          <h2 class="font-serif text-2xl font-bold text-cream-100 mb-2">Sit at a Table</h2>
          <p class="text-xs text-cream-300 leading-relaxed mb-6">
            Enter your Table Code and pick your Minecraft character from the live list of players currently in the world.
          </p>

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-cream-200 mb-1.5">Table Code</label>
              <input id="joinCodeInput" type="text" placeholder="e.g. MOSS24" maxlength="10"
                class="w-full px-4 py-3 rounded-2xl bg-navy-900/90 border border-cream-300/20 text-cream-100 placeholder-cream-300/40 font-mono text-sm uppercase tracking-widest focus:outline-none focus:border-sage-400 transition" />
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="block text-xs font-semibold text-cream-200">Select Your Minecraft Character</label>
                <span id="rosterFetchStatus" class="text-[11px] text-cream-300/70 italic">Enter table code...</span>
              </div>
              <div class="relative">
                <select id="joinPlayerSelect" disabled
                  class="w-full px-4 py-3 rounded-2xl bg-navy-900/90 border border-cream-300/20 text-cream-100 text-sm focus:outline-none focus:border-sage-400 transition appearance-none disabled:opacity-50 cursor-pointer">
                  <option value="">Waiting for Table Code...</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-cream-300">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 pt-4 border-t border-cream-300/10">
          <button id="joinTableBtn" disabled
            class="w-full py-3.5 px-5 rounded-2xl bg-sage-500 hover:bg-sage-400 disabled:bg-navy-700 disabled:text-cream-300/40 disabled:cursor-not-allowed text-navy-950 font-bold text-sm shadow-lg shadow-sage-500/20 transition flex items-center justify-center gap-2">
            <span>Join Voice Table</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
            </svg>
          </button>
          <p id="joinErrorMsg" class="text-xs text-rosewood-400 mt-2.5 text-center hidden"></p>
        </div>
      </div>

      <div class="cafe-card rounded-3xl p-7 flex flex-col justify-between relative overflow-hidden">
        <div class="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-berry-500/10 blur-xl pointer-events-none"></div>
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-berry-500/15 border border-berry-400/30 text-berry-400 text-xs font-semibold mb-4">
            <span>☕</span> Host Controller
          </div>
          <h2 class="font-serif text-2xl font-bold text-cream-100 mb-2">Brew a New Room</h2>
          <p class="text-xs text-cream-300 leading-relaxed mb-5">
            Hosting does <strong class="text-cream-100">not</strong> link you to a player account. It opens a control dashboard where you get your Minecraft <code class="font-mono text-espresso-400">/connect</code> command and adjust voice proximity rules.
          </p>

          <div class="cafe-card-subtle rounded-2xl p-4 space-y-2.5 text-xs text-cream-200 mb-6">
            <div class="flex items-start gap-2.5">
              <span class="text-espresso-400 font-bold">1.</span>
              <span>Open a table to get your instant Minecraft <code class="font-mono text-espresso-400">/connect</code> command.</span>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="text-espresso-400 font-bold">2.</span>
              <span>Paste the command in your Minecraft Bedrock world chat to link the world.</span>
            </div>
            <div class="flex items-start gap-2.5">
              <span class="text-espresso-400 font-bold">3.</span>
              <span>Share the invite link so you and your friends can pick your characters and talk.</span>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-cream-300/10">
          <button id="hostTableBtn"
            class="w-full py-3.5 px-5 rounded-2xl bg-berry-500 hover:bg-berry-400 text-navy-950 font-bold text-sm shadow-lg shadow-berry-500/20 transition flex items-center justify-center gap-2">
            <span>Open a New Table (Host Only)</span>
          </button>
        </div>
      </div>

    </div>
  </main>

  <main id="hostScreen" class="relative z-10 flex-1 hidden max-w-5xl w-full mx-auto p-5 space-y-6">

    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div class="cafe-card rounded-3xl p-5 flex flex-col justify-between">
        <div>
          <span class="text-xs text-cream-300 uppercase tracking-wider font-semibold">Table Number</span>
          <div class="flex items-baseline gap-3 mt-1">
            <h2 id="hostRoomCodeDisplay" class="font-serif text-3xl font-bold text-espresso-400 tracking-wide">------</h2>
          </div>
          <p class="text-xs text-cream-300 mt-1">Share this link so players (including yourself) can join the voice chat.</p>
        </div>
        <button id="copyInviteLinkBtn"
          class="mt-4 w-full py-2.5 px-4 rounded-xl bg-berry-500/20 hover:bg-berry-500/30 border border-berry-400/40 text-cream-100 text-xs font-semibold transition flex items-center justify-center gap-2">
          <svg class="w-4 h-4 text-berry-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
          <span id="copyInviteText">Copy Player Invite Link</span>
        </button>
      </div>

      <div class="cafe-card rounded-3xl p-5 md:col-span-2 flex flex-col justify-between">
        <div>
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span class="text-xs text-cream-300 uppercase tracking-wider font-semibold">Link Minecraft World</span>
            <span id="mcWorldBadge" class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-espresso-400/15 text-espresso-400 border border-espresso-400/30">
              <span id="mcWorldDot" class="w-2 h-2 rounded-full bg-espresso-400 animate-pulse"></span>
              <span id="mcWorldStatusText">Waiting for /connect in Minecraft</span>
            </span>
          </div>

          <p class="text-xs text-cream-300 mb-3">
            In Minecraft Bedrock, ensure <strong class="text-cream-100">Settings → Creator → Enable WebSockets</strong> is ON and <strong class="text-cream-100">Require Encrypted WebSockets</strong> is OFF, then run this command in chat:
          </p>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div class="flex-1 px-4 py-2.5 rounded-xl bg-navy-950/90 border border-cream-300/15 font-mono text-xs text-sage-400 select-all overflow-x-auto whitespace-nowrap" id="mcConnectCommand">
              /connect ...
            </div>
            <button id="copyMcCmdBtn"
              class="px-4 py-2.5 rounded-xl bg-sage-500 hover:bg-sage-400 text-navy-950 font-bold text-xs transition shrink-0">
              Copy Command
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <div class="lg:col-span-5 cafe-card rounded-3xl p-6 space-y-5">
        <div class="border-b border-cream-300/10 pb-3">
          <h3 class="font-serif text-xl font-bold text-cream-100">House Acoustics</h3>
          <p class="text-xs text-cream-300">Changes sync immediately to all connected players.</p>
        </div>

        <div class="space-y-4">
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="font-semibold text-cream-200">Maximum Hearing Distance</span>
              <span id="maxRangeLabel" class="font-mono text-sage-400 font-semibold">32 blocks</span>
            </div>
            <input id="maxRangeSlider" type="range" min="8" max="120" value="32" class="w-full" />
            <div class="flex justify-between text-[11px] text-cream-300/60 mt-1">
              <span>Whisper (8m)</span>
              <span>Normal (32m)</span>
              <span>Canyon (120m)</span>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="font-semibold text-cream-200">Full Volume Radius</span>
              <span id="minRangeLabel" class="font-mono text-berry-400 font-semibold">5 blocks</span>
            </div>
            <input id="minRangeSlider" type="range" min="1" max="30" value="5" class="w-full" />
            <p class="text-[11px] text-cream-300/70 mt-1">Players closer than this hear each other at 100% volume.</p>
          </div>

          <div>
            <label class="block text-xs font-semibold text-cream-200 mb-1.5">Voice Fade Curve</label>
            <select id="rolloffSelect"
              class="w-full px-3.5 py-2.5 rounded-xl bg-navy-900 border border-cream-300/20 text-xs text-cream-100 focus:outline-none focus:border-berry-400">
              <option value="smooth">Smooth Cafe Fade (Natural S-Curve)</option>
              <option value="linear">Linear Distance Dropoff</option>
              <option value="inverse">Realistic Acoustic Inverse</option>
            </select>
          </div>

          <div class="pt-2 border-t border-cream-300/10 flex items-center justify-between gap-4">
            <div>
              <span class="block text-xs font-semibold text-cream-200">Separate Spectator Lounge</span>
              <span class="text-[11px] text-cream-300/80">Spectators in Minecraft can talk together globally while Alive players cannot hear them.</span>
            </div>
            <label class="relative inline-flex items-center cursor-pointer shrink-0">
              <input id="spectatorIsolationToggle" type="checkbox" checked class="sr-only peer">
              <div class="w-11 h-6 bg-navy-950 rounded-full peer peer-checked:bg-sage-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-cream-100 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
        </div>
      </div>

      <div class="lg:col-span-7 cafe-card rounded-3xl p-6 flex flex-col justify-between">
        <div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-cream-300/10 pb-3 mb-4">
            <div>
              <h3 class="font-serif text-xl font-bold text-cream-100">Players in World</h3>
              <p class="text-xs text-cream-300">Live roster from your linked Minecraft world.</p>
            </div>
            <span id="hostPlayerCountBadge" class="px-3 py-1 rounded-full text-xs font-mono bg-navy-900 text-cream-200 border border-cream-300/15">
              0 In World · 0 Linked
            </span>
          </div>

          <div id="hostRosterList" class="space-y-2.5 max-h-80 overflow-y-auto pr-1"></div>
        </div>

        <div class="mt-6 pt-4 border-t border-cream-300/10">
          <label class="block text-xs font-semibold text-cream-200 mb-1.5">Add World Player Name Manually (Optional)</label>
          <div class="flex gap-2">
            <input id="manualPlayerInput" type="text" placeholder="Exact Gamertag (e.g. Hudenrilie Game)"
              class="flex-1 px-3.5 py-2 rounded-xl bg-navy-900 border border-cream-300/20 text-xs text-cream-100 placeholder-cream-300/40 focus:outline-none focus:border-berry-400" />
            <button id="addManualPlayerBtn"
              class="px-4 py-2 rounded-xl bg-berry-500/25 hover:bg-berry-500/35 border border-berry-400/30 text-cream-100 text-xs font-semibold transition">
              + Add to World List
            </button>
          </div>
        </div>
      </div>

    </div>
  </main>

  <main id="playerScreen" class="relative z-10 flex-1 hidden items-center justify-center p-5">
    <div class="cafe-card rounded-3xl p-8 max-w-sm w-full text-center space-y-6">

      <div class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-berry-500/15 border border-berry-400/30 text-berry-400 text-xs font-mono font-semibold">
        <span>Table #</span>
        <span id="playerTableCode">------</span>
      </div>

      <div>
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-sage-400/25 to-berry-500/25 border border-cream-300/20 mx-auto flex items-center justify-center mb-3 shadow-inner">
          <span id="playerAvatarInitial" class="font-serif text-2xl font-bold text-cream-100">?</span>
        </div>
        <h2 id="playerDisplayName" class="font-serif text-2xl font-bold text-cream-100">Player Name</h2>
      </div>

      <div class="cafe-card-subtle rounded-2xl p-4 text-left space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-cream-300 font-medium">Mic Level</span>
          <span id="playerMicStatusText" class="font-mono text-[11px] text-sage-400">Active</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-navy-950 overflow-hidden border border-cream-300/10">
          <div id="playerMicBar" class="h-full bg-gradient-to-r from-sage-500 to-berry-400 transition-all duration-75" style="width: 0%"></div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 pt-1">
        <button id="playerMuteBtn"
          class="py-3.5 px-4 rounded-2xl bg-navy-900 hover:bg-navy-700 border border-cream-300/20 text-cream-100 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5">
          <svg id="muteIconOn" class="w-5 h-5 text-sage-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
          </svg>
          <span id="muteBtnLabel">Mute</span>
        </button>

        <button id="playerDeafenBtn"
          class="py-3.5 px-4 rounded-2xl bg-navy-900 hover:bg-navy-700 border border-cream-300/20 text-cream-100 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5">
          <svg id="deafenIconOn" class="w-5 h-5 text-berry-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
          </svg>
          <span id="deafenBtnLabel">Deafen</span>
        </button>
      </div>

    </div>
  </main>

  <div id="remoteAudioContainer" class="hidden"></div>

  <script>
    const CLOUD_WS_CLUSTER = 'free.blr2.piesocket.com';
    const CLOUD_WS_API_KEY = 'B9UKgvptNTWrZxfCUTquFp7nKVsYqu2LtmBao5Jg';

    const state = {
      role: null,
      roomCode: '',
      myPlayerName: '',
      muted: false,
      deafened: false,
      micLevel: 0,
      mcConnected: false,
      lastMcPacketAt: 0,
      rules: {
        maxRange: 32,
        minRange: 5,
        rolloff: 'smooth',
        spectatorIsolation: true
      },
      worldPlayers: {},
      peer: null,
      hostConn: null,
      guestConns: new Map(),
      mediaCalls: new Map(),
      remoteAudioNodes: new Map(),
      localStream: null,
      audioCtx: null,
      wsRelays: [],
      bc: null
    };

    const pendingMcQueries = new Map();

    const lobbyScreen = document.getElementById('lobbyScreen');
    const hostScreen = document.getElementById('hostScreen');
    const playerScreen = document.getElementById('playerScreen');
    const topStatusArea = document.getElementById('topStatusArea');
    const roleBadge = document.getElementById('roleBadge');
    const leaveBtn = document.getElementById('leaveBtn');

    const joinCodeInput = document.getElementById('joinCodeInput');
    const joinPlayerSelect = document.getElementById('joinPlayerSelect');
    const rosterFetchStatus = document.getElementById('rosterFetchStatus');
    const joinTableBtn = document.getElementById('joinTableBtn');
    const joinErrorMsg = document.getElementById('joinErrorMsg');
    const hostTableBtn = document.getElementById('hostTableBtn');

    const hostRoomCodeDisplay = document.getElementById('hostRoomCodeDisplay');
    const copyInviteLinkBtn = document.getElementById('copyInviteLinkBtn');
    const copyInviteText = document.getElementById('copyInviteText');
    const mcWorldBadge = document.getElementById('mcWorldBadge');
    const mcWorldDot = document.getElementById('mcWorldDot');
    const mcWorldStatusText = document.getElementById('mcWorldStatusText');
    const mcConnectCommand = document.getElementById('mcConnectCommand');
    const copyMcCmdBtn = document.getElementById('copyMcCmdBtn');

    const maxRangeSlider = document.getElementById('maxRangeSlider');
    const maxRangeLabel = document.getElementById('maxRangeLabel');
    const minRangeSlider = document.getElementById('minRangeSlider');
    const minRangeLabel = document.getElementById('minRangeLabel');
    const rolloffSelect = document.getElementById('rolloffSelect');
    const spectatorIsolationToggle = document.getElementById('spectatorIsolationToggle');
    const hostRosterList = document.getElementById('hostRosterList');
    const hostPlayerCountBadge = document.getElementById('hostPlayerCountBadge');
    const manualPlayerInput = document.getElementById('manualPlayerInput');
    const addManualPlayerBtn = document.getElementById('addManualPlayerBtn');

    const playerTableCode = document.getElementById('playerTableCode');
    const playerAvatarInitial = document.getElementById('playerAvatarInitial');
    const playerDisplayName = document.getElementById('playerDisplayName');
    const playerMicStatusText = document.getElementById('playerMicStatusText');
    const playerMicBar = document.getElementById('playerMicBar');
    const playerMuteBtn = document.getElementById('playerMuteBtn');
    const playerDeafenBtn = document.getElementById('playerDeafenBtn');
    const muteBtnLabel = document.getElementById('muteBtnLabel');
    const deafenBtnLabel = document.getElementById('deafenBtnLabel');

    function generateCafeCode() {
      const words = ['MOSS', 'FERN', 'SAGE', 'BREW', 'PINE', 'LEAF', 'BEAN', 'MIST', 'PLUM', 'IRIS'];
      const word = words[Math.floor(Math.random() * words.length)];
      const num = Math.floor(10 + Math.random() * 89);
      return `${word}${num}`;
    }

    function hostPeerId(code) {
      return `bedrockcafe-v6-${code.toLowerCase()}-host`;
    }

    function getMcConnectAddress(code) {
      const clean = code.toUpperCase();
      return `${CLOUD_WS_CLUSTER}/v3/bedrockcafe_${clean}?api_key=${CLOUD_WS_API_KEY}`;
    }

    function getCloudWssUrl(code) {
      return `wss://${getMcConnectAddress(code)}`;
    }

    let lobbyProbePeer = null;
    let lobbyProbeConn = null;
    let lobbyProbeWs = null;
    let probedRoomCode = '';

    function probeTableRoster(rawCode) {
      const code = (rawCode || '').trim().toUpperCase();
      if (code.length < 3) {
        probedRoomCode = '';
        rosterFetchStatus.textContent = 'Enter table code...';
        joinPlayerSelect.innerHTML = '<option value="">Waiting for Table Code...</option>';
        joinPlayerSelect.disabled = true;
        joinTableBtn.disabled = true;
        return;
      }
      if (code === probedRoomCode) return;
      probedRoomCode = code;

      rosterFetchStatus.textContent = 'Checking world players...';
      joinPlayerSelect.innerHTML = '<option value="">Looking up Table #' + code + '...</option>';
      joinPlayerSelect.disabled = true;
      joinTableBtn.disabled = true;

      if (state.bc) state.bc.close();
      state.bc = new BroadcastChannel(`bedrockcafe_bc_${code}`);
      state.bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'ROSTER_SYNC') {
          applyProbedRoster(ev.data.worldPlayers, ev.data.rules);
        }
      };
      state.bc.postMessage({ type: 'REQUEST_ROSTER' });

      if (lobbyProbeWs) {
        try { lobbyProbeWs.close(); } catch (e) {}
      }
      try {
        lobbyProbeWs = new WebSocket(getCloudWssUrl(code));
        lobbyProbeWs.onopen = () => {
          lobbyProbeWs.send(JSON.stringify({ bcafe: true, type: 'REQUEST_ROSTER' }));
        };
        lobbyProbeWs.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.bcafe && msg.type === 'ROSTER_SYNC') {
              applyProbedRoster(msg.worldPlayers, msg.rules);
            }
          } catch (e) {}
        };
      } catch (e) {}

      if (lobbyProbePeer) {
        try { lobbyProbePeer.destroy(); } catch (e) {}
      }
      lobbyProbePeer = new Peer();
      lobbyProbePeer.on('open', () => {
        lobbyProbeConn = lobbyProbePeer.connect(hostPeerId(code), { reliable: true });
        lobbyProbeConn.on('open', () => {
          lobbyProbeConn.send({ type: 'REQUEST_ROSTER' });
        });
        lobbyProbeConn.on('data', (data) => {
          if (data && data.type === 'ROSTER_SYNC') {
            applyProbedRoster(data.worldPlayers, data.rules);
          }
        });
      });
    }

    function applyProbedRoster(worldPlayers, rules) {
      if (state.role !== null) return;
      state.worldPlayers = worldPlayers || {};
      if (rules) state.rules = rules;

      const currentSelection = joinPlayerSelect.value;
      const unlinkedNames = Object.keys(state.worldPlayers).filter(name => {
        const p = state.worldPlayers[name];
        return p && p.inWorld !== false && !p.linkedPeerId;
      });

      joinPlayerSelect.innerHTML = '';

      if (unlinkedNames.length === 0) {
        const totalInWorld = Object.keys(state.worldPlayers).length;
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = totalInWorld === 0
          ? 'Waiting for players in Minecraft world...'
          : 'All players in world are already linked';
        joinPlayerSelect.appendChild(opt);
        joinPlayerSelect.disabled = true;
        joinTableBtn.disabled = true;
        rosterFetchStatus.textContent = totalInWorld === 0 ? 'Waiting for world' : 'All linked';
      } else {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose your Minecraft character...';
        joinPlayerSelect.appendChild(placeholder);

        unlinkedNames.sort().forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          joinPlayerSelect.appendChild(opt);
        });

        if (currentSelection && unlinkedNames.includes(currentSelection)) {
          joinPlayerSelect.value = currentSelection;
        } else if (unlinkedNames.length === 1) {
          joinPlayerSelect.value = unlinkedNames[0];
        }

        joinPlayerSelect.disabled = false;
        joinTableBtn.disabled = !joinPlayerSelect.value;
        rosterFetchStatus.textContent = `${unlinkedNames.length} available in world`;
      }
    }

    joinCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      probeTableRoster(e.target.value);
    });

    joinPlayerSelect.addEventListener('change', () => {
      joinTableBtn.disabled = !joinPlayerSelect.value;
    });

    hostTableBtn.addEventListener('click', () => {
      const code = generateCafeCode();
      startHostSession(code);
    });

    function startHostSession(roomCode) {
      if (lobbyProbePeer) {
        try { lobbyProbePeer.destroy(); } catch (e) {}
        lobbyProbePeer = null;
      }
      if (lobbyProbeWs) {
        try { lobbyProbeWs.close(); } catch (e) {}
        lobbyProbeWs = null;
      }

      state.role = 'host';
      state.roomCode = roomCode;
      state.worldPlayers = {};

      lobbyScreen.classList.add('hidden');
      playerScreen.classList.add('hidden');
      hostScreen.classList.remove('hidden');
      topStatusArea.classList.remove('hidden');
      topStatusArea.classList.add('flex');
      roleBadge.textContent = 'Table Host (Controller)';

      hostRoomCodeDisplay.textContent = roomCode;
      mcConnectCommand.textContent = `/connect ${getMcConnectAddress(roomCode)}`;

      setupBroadcastChannel(roomCode);
      setupHostPeer(roomCode);
      connectHostWebSockets(roomCode);
      renderHostRoster();
    }

    function setupBroadcastChannel(roomCode) {
      if (state.bc) state.bc.close();
      state.bc = new BroadcastChannel(`bedrockcafe_bc_${roomCode}`);
      state.bc.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg) return;
        if (state.role === 'host') {
          if (msg.type === 'REQUEST_ROSTER') {
            broadcastRosterFromHost();
          } else if (msg.type === 'CLAIM_PLAYER') {
            handlePlayerClaim(msg.playerName, msg.peerId);
          } else if (msg.type === 'PLAYER_MIC_STATE') {
            if (state.worldPlayers[msg.playerName]) {
              state.worldPlayers[msg.playerName].muted = msg.muted;
              state.worldPlayers[msg.playerName].deafened = msg.deafened;
              state.worldPlayers[msg.playerName].speaking = msg.speaking;
              renderHostRoster();
            }
          } else if (msg.type === 'LEAVE_PLAYER') {
            if (state.worldPlayers[msg.playerName]) {
              state.worldPlayers[msg.playerName].linkedPeerId = null;
              state.worldPlayers[msg.playerName].speaking = false;
              broadcastRosterFromHost();
              renderHostRoster();
            }
          }
        } else if (state.role === 'player') {
          if (msg.type === 'ROSTER_SYNC') {
            state.worldPlayers = msg.worldPlayers || {};
            if (msg.rules) state.rules = msg.rules;
            updateSpatialAudioForAllPeers();
          }
        }
      };
    }

    function setupHostPeer(roomCode) {
      if (state.peer) state.peer.destroy();
      state.peer = new Peer(hostPeerId(roomCode));

      state.peer.on('connection', (conn) => {
        conn.on('open', () => {
          state.guestConns.set(conn.peer, conn);
          conn.send({
            type: 'ROSTER_SYNC',
            worldPlayers: state.worldPlayers,
            rules: state.rules
          });
        });

        conn.on('data', (msg) => {
          if (!msg) return;
          if (msg.type === 'REQUEST_ROSTER') {
            conn.send({
              type: 'ROSTER_SYNC',
              worldPlayers: state.worldPlayers,
              rules: state.rules
            });
          } else if (msg.type === 'CLAIM_PLAYER') {
            conn.playerName = msg.playerName;
            handlePlayerClaim(msg.playerName, msg.peerId);
          } else if (msg.type === 'PLAYER_MIC_STATE') {
            if (state.worldPlayers[msg.playerName]) {
              state.worldPlayers[msg.playerName].muted = msg.muted;
              state.worldPlayers[msg.playerName].deafened = msg.deafened;
              state.worldPlayers[msg.playerName].speaking = msg.speaking;
              renderHostRoster();
            }
          }
        });

        conn.on('close', () => {
          state.guestConns.delete(conn.peer);
          if (conn.playerName && state.worldPlayers[conn.playerName]) {
            state.worldPlayers[conn.playerName].linkedPeerId = null;
            state.worldPlayers[conn.playerName].speaking = false;
            broadcastRosterFromHost();
            renderHostRoster();
          }
        });
      });
    }

    function handlePlayerClaim(playerName, peerId) {
      if (!state.worldPlayers[playerName]) {
        state.worldPlayers[playerName] = {
          name: playerName,
          x: 0, y: 64, z: 0, yaw: 0,
          gamemode: 'survival',
          inWorld: true,
          linkedPeerId: peerId,
          muted: false,
          deafened: false,
          speaking: false
        };
      } else {
        state.worldPlayers[playerName].linkedPeerId = peerId;
      }
      broadcastRosterFromHost();
      renderHostRoster();
    }

    function sendOverRelays(payloadObj) {
      const raw = JSON.stringify(payloadObj);
      for (const ws of state.wsRelays) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(raw); } catch (e) {}
        }
      }
    }

    function broadcastRosterFromHost() {
      if (state.role !== 'host') return;
      const payload = {
        bcafe: true,
        type: 'ROSTER_SYNC',
        worldPlayers: state.worldPlayers,
        rules: state.rules
      };
      if (state.bc) state.bc.postMessage(payload);
      for (const conn of state.guestConns.values()) {
        if (conn.open) conn.send(payload);
      }
      sendOverRelays(payload);
    }

    function connectHostWebSockets(roomCode) {
      for (const ws of state.wsRelays) {
        try { ws.close(); } catch (e) {}
      }
      state.wsRelays = [];

      const urls = [getCloudWssUrl(roomCode)];
      const isPreview = location.hostname.includes('googleusercontent.com') || location.hostname === 'localhost' || location.hostname === '';
      if (!isPreview) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        urls.push(`${proto}//${location.host}/room/${roomCode}`);
      }

      urls.forEach((wsUrl) => {
        const openSocket = () => {
          if (state.role !== 'host' || state.roomCode !== roomCode) return;
          try {
            const ws = new WebSocket(wsUrl);
            state.wsRelays.push(ws);

            ws.onopen = () => {
              subscribeMcEvents(ws);
              pollMinecraftWorld();
            };

            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(ev.data);
                if (msg && msg.bcafe) {
                  if (msg.type === 'REQUEST_ROSTER') {
                    broadcastRosterFromHost();
                  } else if (msg.type === 'CLAIM_PLAYER') {
                    handlePlayerClaim(msg.playerName, msg.peerId);
                  } else if (msg.type === 'PLAYER_MIC_STATE' && state.worldPlayers[msg.playerName]) {
                    state.worldPlayers[msg.playerName].muted = msg.muted;
                    state.worldPlayers[msg.playerName].deafened = msg.deafened;
                    state.worldPlayers[msg.playerName].speaking = msg.speaking;
                    renderHostRoster();
                  } else if (msg.type === 'LEAVE_PLAYER' && state.worldPlayers[msg.playerName]) {
                    state.worldPlayers[msg.playerName].linkedPeerId = null;
                    state.worldPlayers[msg.playerName].speaking = false;
                    broadcastRosterFromHost();
                    renderHostRoster();
                  }
                  return;
                }
                if (msg && msg.type === 'mc_raw' && msg.payload) {
                  handleMcPacket(msg.payload);
                } else if (msg && (msg.header || msg.body)) {
                  handleMcPacket(msg);
                }
              } catch (e) {}
            };

            ws.onclose = () => {
              const idx = state.wsRelays.indexOf(ws);
              if (idx !== -1) state.wsRelays.splice(idx, 1);
              if (state.role === 'host' && state.roomCode === roomCode) {
                setTimeout(openSocket, 2500);
              }
            };
          } catch (e) {}
        };
        openSocket();
      });
    }

    function updateMcStatusUI(connected) {
      state.mcConnected = connected;
      if (connected) {
        mcWorldBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sage-500/20 text-sage-400 border border-sage-400/30';
        mcWorldDot.className = 'w-2 h-2 rounded-full bg-sage-400';
        mcWorldStatusText.textContent = 'Minecraft World Linked';
      } else {
        mcWorldBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-espresso-400/15 text-espresso-400 border border-espresso-400/30';
        mcWorldDot.className = 'w-2 h-2 rounded-full bg-espresso-400 animate-pulse';
        mcWorldStatusText.textContent = 'Waiting for /connect in Minecraft';
      }
    }

    function sendMcCommand(commandLine, meta) {
      const requestId = crypto.randomUUID();
      pendingMcQueries.set(requestId, { ...meta, ts: Date.now() });
      const packet = {
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
      };
      sendOverRelays(packet);
    }

    function subscribeMcEvents(targetWs) {
      ['PlayerMessage', 'PlayerTransform'].forEach((eventName) => {
        const packet = {
          header: {
            version: 1,
            requestId: crypto.randomUUID(),
            messagePurpose: 'subscribe',
            messageType: 'commandRequest'
          },
          body: { eventName }
        };
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify(packet));
        } else {
          sendOverRelays(packet);
        }
      });
    }

    function handleMcPacket(pkt) {
      if (!pkt || !pkt.header) return;
      if (pkt.header.messagePurpose === 'commandRequest' || pkt.header.messagePurpose === 'subscribe') {
        return;
      }

      state.lastMcPacketAt = Date.now();
      if (!state.mcConnected) updateMcStatusUI(true);

      const reqId = pkt.header.requestId;
      const meta = pendingMcQueries.get(reqId);
      if (reqId) pendingMcQueries.delete(reqId);

      const body = pkt.body || {};

      if (meta && meta.kind === 'list') {
        let names = [];
        if (typeof body.players === 'string') {
          names = body.players.split(',').map(s => s.trim()).filter(Boolean);
        } else if (typeof body.statusMessage === 'string') {
          const lines = body.statusMessage.split('\n');
          if (lines.length > 1) {
            names = lines.slice(1).join(',').split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        if (names.length > 0) {
          let changed = false;
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
              changed = true;
            } else {
              state.worldPlayers[n].inWorld = true;
            }
          });
          if (changed) {
            broadcastRosterFromHost();
            renderHostRoster();
          }
        }
      }

      if (meta && meta.kind === 'localname' && typeof body.localplayername === 'string') {
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
          broadcastRosterFromHost();
          renderHostRoster();
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
    }

    function pollMinecraftWorld() {
      if (state.role !== 'host') return;
      const now = Date.now();
      for (const [k, v] of pendingMcQueries.entries()) {
        if (now - v.ts > 4000) pendingMcQueries.delete(k);
      }

      if (state.mcConnected && now - state.lastMcPacketAt > 6000) {
        updateMcStatusUI(false);
      }

      sendMcCommand('list', { kind: 'list' });
      sendMcCommand('getlocalplayername', { kind: 'localname' });

      const names = Object.keys(state.worldPlayers);
      names.forEach(name => {
        sendMcCommand(`querytarget @a[name="${name}"]`, { kind: 'pos', playerName: name });
        sendMcCommand(`testfor @a[name="${name}",m=spectator]`, { kind: 'spec', playerName: name });
      });

      if (names.length > 0) {
        broadcastRosterFromHost();
      }
    }

    setInterval(() => {
      if (state.role === 'host') {
        pollMinecraftWorld();
      }
    }, 350);

    function renderHostRoster() {
      if (state.role !== 'host') return;
      const names = Object.keys(state.worldPlayers).sort();
      const linkedCount = names.filter(n => Boolean(state.worldPlayers[n].linkedPeerId)).length;
      hostPlayerCountBadge.textContent = `${names.length} In World · ${linkedCount} Linked`;

      if (names.length === 0) {
        hostRosterList.innerHTML = `
          <div class="cafe-card-subtle rounded-2xl p-6 text-center text-xs text-cream-300">
            Waiting for players in the linked Minecraft world...
          </div>
        `;
        return;
      }

      hostRosterList.innerHTML = '';
      names.forEach(name => {
        const p = state.worldPlayers[name];
        const isLinked = Boolean(p.linkedPeerId);
        const isSpec = p.gamemode === 'spectator';

        const row = document.createElement('div');
        row.className = 'cafe-card-subtle rounded-2xl px-4 py-3 flex items-center justify-between gap-3';
        row.innerHTML = `
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl ${isLinked ? 'bg-sage-500/25 border-sage-400/40 text-sage-400' : 'bg-navy-900 border-cream-300/15 text-cream-300'} border flex items-center justify-center font-serif font-bold text-sm shrink-0">
              ${name.charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm text-cream-100 truncate">${name}</span>
                ${isSpec ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-berry-500/20 text-berry-400 border border-berry-400/30">Spectator</span>' : ''}
              </div>
              <div class="text-[11px] text-cream-300/75 font-mono">
                X:${Math.round(p.x)} Y:${Math.round(p.y)} Z:${Math.round(p.z)}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${isLinked
              ? `<span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sage-500/20 text-sage-400 border border-sage-400/30">
                  ${p.muted ? 'Muted' : (p.speaking ? 'Speaking ●' : 'Linked')}
                 </span>`
              : `<span class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-navy-900 text-cream-300/70 border border-cream-300/15">
                  Waiting to Join
                 </span>`
            }
          </div>
        `;
        hostRosterList.appendChild(row);
      });
    }

    addManualPlayerBtn.addEventListener('click', () => {
      const name = manualPlayerInput.value.trim();
      if (!name) return;
      if (!state.worldPlayers[name]) {
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
      }
      manualPlayerInput.value = '';
      broadcastRosterFromHost();
      renderHostRoster();
    });

    manualPlayerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addManualPlayerBtn.click();
    });

    maxRangeSlider.addEventListener('input', (e) => {
      state.rules.maxRange = Number(e.target.value);
      maxRangeLabel.textContent = `${state.rules.maxRange} blocks`;
      broadcastRosterFromHost();
    });

    minRangeSlider.addEventListener('input', (e) => {
      state.rules.minRange = Number(e.target.value);
      minRangeLabel.textContent = `${state.rules.minRange} blocks`;
      broadcastRosterFromHost();
    });

    rolloffSelect.addEventListener('change', (e) => {
      state.rules.rolloff = e.target.value;
      broadcastRosterFromHost();
    });

    spectatorIsolationToggle.addEventListener('change', (e) => {
      state.rules.spectatorIsolation = e.target.checked;
      broadcastRosterFromHost();
    });

    copyInviteLinkBtn.addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?table=${state.roomCode}`;
      navigator.clipboard.writeText(url);
      copyInviteText.textContent = 'Invite Link Copied!';
      setTimeout(() => { copyInviteText.textContent = 'Copy Player Invite Link'; }, 2000);
    });

    copyMcCmdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mcConnectCommand.textContent.trim());
      copyMcCmdBtn.textContent = 'Copied!';
      setTimeout(() => { copyMcCmdBtn.textContent = 'Copy Command'; }, 1800);
    });

    joinTableBtn.addEventListener('click', async () => {
      const code = joinCodeInput.value.trim().toUpperCase();
      const selectedPlayer = joinPlayerSelect.value;
      if (!code || !selectedPlayer) return;

      joinErrorMsg.classList.add('hidden');
      joinTableBtn.disabled = true;
      joinTableBtn.textContent = 'Connecting Microphone...';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        state.localStream = stream;
        startPlayerSession(code, selectedPlayer);
      } catch (err) {
        joinErrorMsg.textContent = 'Microphone permission is required to join the voice table.';
        joinErrorMsg.classList.remove('hidden');
        joinTableBtn.disabled = false;
        joinTableBtn.textContent = 'Join Voice Table';
      }
    });

    function startPlayerSession(roomCode, playerName) {
      if (lobbyProbePeer) {
        try { lobbyProbePeer.destroy(); } catch (e) {}
        lobbyProbePeer = null;
      }
      if (lobbyProbeWs) {
        try { lobbyProbeWs.close(); } catch (e) {}
        lobbyProbeWs = null;
      }

      state.role = 'player';
      state.roomCode = roomCode;
      state.myPlayerName = playerName;

      lobbyScreen.classList.add('hidden');
      hostScreen.classList.add('hidden');
      playerScreen.classList.remove('hidden');
      playerScreen.classList.add('flex');
      topStatusArea.classList.remove('hidden');
      topStatusArea.classList.add('flex');
      roleBadge.textContent = playerName;

      playerTableCode.textContent = roomCode;
      playerDisplayName.textContent = playerName;
      playerAvatarInitial.textContent = playerName.charAt(0).toUpperCase();

      setupBroadcastChannel(roomCode);
      setupLocalMicMeter();
      setupPlayerWebRTC(roomCode, playerName);
    }

    function setupLocalMicMeter() {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = state.audioCtx.createMediaStreamSource(state.localStream);
      const analyser = state.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastBroadcastSpeaking = false;

      function tick() {
        if (state.role !== 'player') return;
        requestAnimationFrame(tick);

        if (state.muted || state.deafened) {
          playerMicBar.style.width = '0%';
          return;
        }

        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const pct = Math.min(100, Math.round((avg / 65) * 100));
        playerMicBar.style.width = `${pct}%`;

        const speaking = pct > 14;
        if (speaking !== lastBroadcastSpeaking) {
          lastBroadcastSpeaking = speaking;
          sendPlayerMicState(speaking);
        }
      }
      tick();
    }

    function sendPlayerMicState(speaking = false) {
      if (state.role !== 'player') return;
      const payload = {
        bcafe: true,
        type: 'PLAYER_MIC_STATE',
        playerName: state.myPlayerName,
        muted: state.muted,
        deafened: state.deafened,
        speaking
      };
      if (state.bc) state.bc.postMessage(payload);
      if (state.hostConn && state.hostConn.open) state.hostConn.send(payload);
      sendOverRelays(payload);
    }

    function setupPlayerWebRTC(roomCode, playerName) {
      if (state.peer) state.peer.destroy();
      state.peer = new Peer();

      state.peer.on('open', (myPeerId) => {
        const claimMsg = {
          bcafe: true,
          type: 'CLAIM_PLAYER',
          playerName,
          peerId: myPeerId
        };
        if (state.bc) state.bc.postMessage(claimMsg);

        try {
          const ws = new WebSocket(getCloudWssUrl(roomCode));
          state.wsRelays.push(ws);
          ws.onopen = () => {
            ws.send(JSON.stringify(claimMsg));
          };
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg && msg.bcafe && msg.type === 'ROSTER_SYNC') {
                state.worldPlayers = msg.worldPlayers || {};
                if (msg.rules) state.rules = msg.rules;
                dialOtherLinkedPlayers();
                updateSpatialAudioForAllPeers();
              }
            } catch (e) {}
          };
        } catch (e) {}

        state.hostConn = state.peer.connect(hostPeerId(roomCode), { reliable: true });
        state.hostConn.on('open', () => {
          state.hostConn.send(claimMsg);
        });
        state.hostConn.on('data', (data) => {
          if (data && data.type === 'ROSTER_SYNC') {
            state.worldPlayers = data.worldPlayers || {};
            if (data.rules) state.rules = data.rules;
            dialOtherLinkedPlayers();
            updateSpatialAudioForAllPeers();
          }
        });
      });

      state.peer.on('call', (call) => {
        call.answer(state.localStream);
        handleIncomingMediaCall(call);
      });
    }

    function dialOtherLinkedPlayers() {
      if (state.role !== 'player' || !state.peer || !state.peer.id) return;
      Object.values(state.worldPlayers).forEach(p => {
        if (!p.linkedPeerId || p.linkedPeerId === state.peer.id) return;
        if (!state.mediaCalls.has(p.linkedPeerId) && state.peer.id < p.linkedPeerId) {
          const call = state.peer.call(p.linkedPeerId, state.localStream, {
            metadata: { playerName: state.myPlayerName }
          });
          handleIncomingMediaCall(call);
        }
      });
    }

    function handleIncomingMediaCall(call) {
      state.mediaCalls.set(call.peer, call);
      call.on('stream', (remoteStream) => {
        setupRemoteSpatialNode(call.peer, remoteStream);
      });
      call.on('close', () => {
        cleanupRemoteNode(call.peer);
      });
    }

    function setupRemoteSpatialNode(peerId, remoteStream) {
      if (state.remoteAudioNodes.has(peerId)) return;
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }

      const audioEl = document.createElement('audio');
      audioEl.srcObject = remoteStream;
      audioEl.muted = true;
      audioEl.playsInline = true;
      document.getElementById('remoteAudioContainer').appendChild(audioEl);
      audioEl.play().catch(() => {});

      const source = state.audioCtx.createMediaStreamSource(remoteStream);
      const panner = state.audioCtx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 1;
      panner.maxDistance = 1000;
      panner.rolloffFactor = 0;

      const gainNode = state.audioCtx.createGain();
      gainNode.gain.value = 1;

      source.connect(panner);
      panner.connect(gainNode);
      gainNode.connect(state.audioCtx.destination);

      state.remoteAudioNodes.set(peerId, { audioEl, source, panner, gainNode });
      updateSpatialAudioForAllPeers();
    }

    function cleanupRemoteNode(peerId) {
      const node = state.remoteAudioNodes.get(peerId);
      if (node) {
        try {
          node.source.disconnect();
          node.panner.disconnect();
          node.gainNode.disconnect();
          node.audioEl.remove();
        } catch (e) {}
        state.remoteAudioNodes.delete(peerId);
      }
      state.mediaCalls.delete(peerId);
    }

    function calculateProximityGain(distance, minRange, maxRange, curve) {
      if (distance <= minRange) return 1.0;
      if (distance >= maxRange) return 0.0;
      const t = (distance - minRange) / Math.max(0.001, (maxRange - minRange));
      if (curve === 'linear') {
        return 1.0 - t;
      } else if (curve === 'inverse') {
        return Math.pow(1.0 - t, 2.2);
      } else {
        return 0.5 * (1 + Math.cos(Math.PI * t));
      }
    }

    function updateSpatialAudioForAllPeers() {
      if (state.role !== 'player' || !state.audioCtx) return;
      const me = state.worldPlayers[state.myPlayerName];
      if (!me) return;

      const listener = state.audioCtx.listener;
      const rad = (me.yaw || 0) * (Math.PI / 180);
      const fx = -Math.sin(rad);
      const fz = Math.cos(rad);

      if (listener.positionX) {
        listener.positionX.value = me.x || 0;
        listener.positionY.value = me.y || 64;
        listener.positionZ.value = me.z || 0;
        listener.forwardX.value = fx;
        listener.forwardY.value = 0;
        listener.forwardZ.value = fz;
      }

      for (const [peerId, node] of state.remoteAudioNodes.entries()) {
        if (state.deafened) {
          node.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.05);
          continue;
        }

        const other = Object.values(state.worldPlayers).find(p => p.linkedPeerId === peerId);
        if (!other) {
          node.gainNode.gain.setTargetAtTime(1, state.audioCtx.currentTime, 0.05);
          continue;
        }

        const meSpec = me.gamemode === 'spectator';
        const otherSpec = other.gamemode === 'spectator';

        if (state.rules.spectatorIsolation) {
          if (!meSpec && otherSpec) {
            node.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.05);
            continue;
          }
          if (meSpec && otherSpec) {
            node.gainNode.gain.setTargetAtTime(1, state.audioCtx.currentTime, 0.05);
            continue;
          }
        }

        if (node.panner.positionX) {
          node.panner.positionX.value = other.x || 0;
          node.panner.positionY.value = other.y || 64;
          node.panner.positionZ.value = other.z || 0;
        }

        const dx = (other.x || 0) - (me.x || 0);
        const dy = (other.y || 64) - (me.y || 64);
        const dz = (other.z || 0) - (me.z || 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const targetGain = calculateProximityGain(
          dist,
          state.rules.minRange,
          state.rules.maxRange,
          state.rules.rolloff
        );
        node.gainNode.gain.setTargetAtTime(targetGain, state.audioCtx.currentTime, 0.06);
      }
    }

    playerMuteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach(t => {
          t.enabled = !state.muted && !state.deafened;
        });
      }
      updatePlayerControlButtons();
      sendPlayerMicState(false);
    });

    playerDeafenBtn.addEventListener('click', () => {
      state.deafened = !state.deafened;
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach(t => {
          t.enabled = !state.muted && !state.deafened;
        });
      }
      updatePlayerControlButtons();
      updateSpatialAudioForAllPeers();
      sendPlayerMicState(false);
    });

    function updatePlayerControlButtons() {
      if (state.muted || state.deafened) {
        playerMuteBtn.className = 'py-3.5 px-4 rounded-2xl bg-rosewood-500/20 border border-rosewood-400/40 text-rosewood-400 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5';
        muteBtnLabel.textContent = 'Muted';
        playerMicStatusText.textContent = state.deafened ? 'Deafened' : 'Muted';
        playerMicStatusText.className = 'font-mono text-[11px] text-rosewood-400';
      } else {
        playerMuteBtn.className = 'py-3.5 px-4 rounded-2xl bg-navy-900 hover:bg-navy-700 border border-cream-300/20 text-cream-100 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5';
        muteBtnLabel.textContent = 'Mute';
        playerMicStatusText.textContent = 'Active';
        playerMicStatusText.className = 'font-mono text-[11px] text-sage-400';
      }

      if (state.deafened) {
        playerDeafenBtn.className = 'py-3.5 px-4 rounded-2xl bg-rosewood-500/20 border border-rosewood-400/40 text-rosewood-400 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5';
        deafenBtnLabel.textContent = 'Deafened';
      } else {
        playerDeafenBtn.className = 'py-3.5 px-4 rounded-2xl bg-navy-900 hover:bg-navy-700 border border-cream-300/20 text-cream-100 font-semibold text-xs transition flex flex-col items-center justify-center gap-1.5';
        deafenBtnLabel.textContent = 'Deafen';
      }
    }

    leaveBtn.addEventListener('click', () => {
      if (state.role === 'player' && state.myPlayerName) {
        const leavePayload = {
          bcafe: true,
          type: 'LEAVE_PLAYER',
          playerName: state.myPlayerName
        };
        if (state.bc) state.bc.postMessage(leavePayload);
        sendOverRelays(leavePayload);
      }
      location.href = location.pathname;
    });

    (function initFromUrl() {
      const params = new URLSearchParams(location.search);
      const tableParam = (params.get('table') || params.get('room') || '').trim().toUpperCase();
      if (tableParam) {
        joinCodeInput.value = tableParam;
        probeTableRoster(tableParam);
      }
    })();
  </script>
</body>
</html>
