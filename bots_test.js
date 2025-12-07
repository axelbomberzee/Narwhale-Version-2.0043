// narwhale_bots.js
// Node.js script para crear bots que se unen a una sala y envían paquetes binarios
// Requisitos: npm install ws
//
// Uso:
//   NODE_ENV=development node narwhale_bots.js
//
// Configura abajo: HOST, PORT, ROOM_ID, NUM_BOTS, BOT_PREFIX, TICK_MS

const WebSocket = require('ws');

const CONFIG = {
  HOST: 'localhost',   // cambiar por la IP o dominio del server (o repl.it)
  PORT: 443,           // puerto websocket del server
  ROOM_ID: 1,          // sala a la que se unen los bots
  NUM_BOTS: 10,         // cantidad de bots a crear
  BOT_PREFIX: 'bot',   // prefijo para nombre de cada bot
  TICK_MS: 120,        // cada cuánto ms los bots envían UPDATE_TARGET
  ATTACK_PROBABILITY: 0.05, // probabilidad por tick de enviar RIP (ataque)
  MOVE_RADIUS: 1000,   // radio de movimiento aleatorio alrededor del centro
  SKINCODE: 0x1,       // skin que envían (uint32LE)
  COLORCODE: 0xFFFFFF, // color (uint32LE)
};


// OPCODES según tu servidor (websocket_test.js)
const OPCODES = {
  JOIN: 16,
  LEAVE: 17,
  START: 18,
  GET_LOBBIES: 19,
  UPDATE_TARGET: 32,
  SPLIT_UP: 33,
  RIP: 34,
  RETREAT: 35,
  PING: 37,
  // Servidor->cliente: SET_ELEMENTS 48, etc.
};

function floatToBufferLE(f) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(f, 0);
  return b;
}

function uint32ToBufferLE(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function writeZeroTermString(str) {
  const enc = Buffer.from(String(str), 'utf8');
  return Buffer.concat([enc, Buffer.from([0x00])]);
}

class Bot {
  constructor(index, config) {
    this.index = index;
    this.config = config;
    this.name = `${config.BOT_PREFIX}_${index}`;
    this.ws = null;
    this.playerId = null;
    this.connected = false;

    // simple local target (relative to spawn)
    this.target = { x: 0, y: 0 }; // will be randomised at spawn
  }

  connect() {
    const url = `wss://${this.config.HOST}:${this.config.PORT}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      console.log(`[bot ${this.index}] connected -> ${url}`);
      this.joinRoom(this.config.ROOM_ID);
      // slight delay before START to mimic real client sequence
      setTimeout(() => this.sendStart(), 60 + Math.random() * 300);
      // randomize initial target
      this.pickRandomTarget();
      // start tick
      this._tickInterval = setInterval(() => this.tick(), this.config.TICK_MS);
    });

    this.ws.on('message', (data) => {
      // data can be Buffer or string
      if (Buffer.isBuffer(data)) {
        // minimal parsing: log opcode
        const opcode = data[0];
        // log important server messages: RIP, SET_ELEMENTS etc
        if (opcode === 34) {
          console.log(`[bot ${this.index}] received RIP (you died?)`);
        } else if (opcode === 48) {
          // skip heavy parsing; maybe inspect first bytes
          // console.log(`[bot ${this.index}] SET_ELEMENTS frame (len ${data.length})`);
        } else {
          // console.log(`[bot ${this.index}] recv opcode=${opcode}`);
        }
      } else {
        // text message
        // console.log(`[bot ${this.index}] text: ${data}`);
      }
    });

    this.ws.on('close', () => {
      console.log(`[bot ${this.index}] disconnected`);
      this.connected = false;
      if (this._tickInterval) clearInterval(this._tickInterval);
      // try reconnect by default
      setTimeout(() => this.connect(), 1500 + Math.random() * 1500);
    });

    this.ws.on('error', (err) => {
      console.error(`[bot ${this.index}] ws err:`, err.message);
    });
  }

  sendRaw(buf) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    }
  }

  // JOIN packet: opcode (1) + roomId (uint32LE)
  joinRoom(roomId) {
    const buf = Buffer.alloc(1 + 4);
    buf.writeUInt8(OPCODES.JOIN, 0);
    buf.writeUInt32LE(roomId >>> 0, 1);
    this.sendRaw(buf);
    console.log(`[bot ${this.index}] sent JOIN -> room ${roomId}`);
  }

  // START packet: opcode + skincode(uint32LE) + colorcode(uint32LE) + name zterm
  sendStart() {
    const skincode = this.config.SKINCODE || 0;
    const colorcode = this.config.COLORCODE || 0xFFFFFF;
    const nameBuf = writeZeroTermString(this.name);
    const buf = Buffer.alloc(1 + 4 + 4 + nameBuf.length);
    let off = 0;
    buf.writeUInt8(OPCODES.START, off++);              // 1
    buf.writeUInt32LE(skincode >>> 0, off); off += 4;  // 4
    buf.writeUInt32LE(colorcode >>> 0, off); off += 4; // 4
    nameBuf.copy(buf, off);
    this.sendRaw(buf);
    console.log(`[bot ${this.index}] sent START name=${this.name}`);
  }

  // UPDATE_TARGET: opcode + floatLE x + floatLE y
  sendUpdateTarget(x, y) {
    const buf = Buffer.alloc(1 + 4 + 4);
    buf.writeUInt8(OPCODES.UPDATE_TARGET, 0);
    buf.writeFloatLE(x, 1);
    buf.writeFloatLE(y, 5);
    this.sendRaw(buf);
    //console.log(`[bot ${this.index}] target -> ${x.toFixed(1)},${y.toFixed(1)}`);
  }

  // RIP: just opcode single byte
  sendRip() {
    const buf = Buffer.from([OPCODES.RIP]);
    this.sendRaw(buf);
    console.log(`[bot ${this.index}] sent RIP`);
  }

  sendSplit() {
    const buf = Buffer.from([OPCODES.SPLIT_UP]);
    this.sendRaw(buf);
    console.log(`[bot ${this.index}] sent SPLIT`);
  }

  sendRetreat() {
    const buf = Buffer.from([OPCODES.RETREAT]);
    this.sendRaw(buf);
    console.log(`[bot ${this.index}] sent RETREAT`);
  }

  pickRandomTarget() {
    // choose random point around center
    const r = Math.random() * this.config.MOVE_RADIUS;
    const a = Math.random() * Math.PI * 2;
    const cx = 3200; // center guess (match server room sizes)
    const cy = 3200;
    this.target.x = cx + Math.cos(a) * r;
    this.target.y = cy + Math.sin(a) * r;
  }

  tick() {
    if (!this.connected) return;

    // send update target toward local target (normalized)
    const tx = this.target.x;
    const ty = this.target.y;

    // for server expects direction (unit vector) or absolute?
    // Your server expects dirX / dirY that are normalized in handleUpdateTarget
    // So we convert to relative from center assumption; if remote server uses absolute, adjust.
    // It's safer to send normalized vector (dirX,dirY)
    // Let's aim relative to center of map (we don't know player pos), we send random small directions

    // Send a pseudo-random normalized direction
    const angle = Math.random() * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    this.sendUpdateTarget(dirX, dirY);

    // Small chance to perform attack actions
    const p = Math.random();
    if (p < this.config.ATTACK_PROBABILITY) {
      // choose action
      const r = Math.random();
      if (r < 0.5) this.sendRip();
      else if (r < 0.8) this.sendSplit();
      else this.sendRetreat();
    }

    // occasionally change target
    if (Math.random() < 0.02) this.pickRandomTarget();
  }
}


// Launcher
function startBots() {
  const bots = [];
  for (let i = 0; i < CONFIG.NUM_BOTS; i++) {
    const bot = new Bot(i + 1, CONFIG);
    bot.connect();
    bots.push(bot);
  }
  return bots;
}

// Run
startBots();

module.exports = { startBots };
