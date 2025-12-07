const WebSocket = require("ws");

// ==================== CONFIGURACIÓN ====================
const CONFIG = {
  port: 443,
  tickRate: 120, // Tiempo real: 120 FPS
  worldWidth: 6400,
  worldHeight: 6400,
  maxPlayersPerRoom: 50,

  // Física del juego (valores calibrados del cliente 2017)
  friction: 0.92,
  acceleration: 340,
  dashPower: 500,
  retreatPower: 220,
  collisionDamage: 100,

  // Velocidad máxima
  maxSpeed: 200,
  dashMaxSpeed: 480,

  // Colisiones
  hornDamageMultiplier: 1.5,
  pushForce: 150,
  bounceForce: 80,

  // Crecimiento
  baseSize: 36,
  growthPerKill: 4,
  maxSize: 120,

  // Invincibilidad
  spawnInvincibleTime: 2.5,
  respawnDelay: 1.0,

  
};

// ==================== OPCODES (Exactos del cliente 2017) ====================
const OPCODES = {
  // Cliente -> Servidor
  JOIN: 16,
  LEAVE: 17,
  START: 18,
  GET_LOBBIES: 19,
  UPDATE_TARGET: 32,
  SPLIT_UP: 33,
  RIP: 34,
  RETREAT: 35,
  PING: 37,

  // Servidor -> Cliente
  JOIN_ROOM: 17,
  SET_ELEMENTS: 48,
  PLAYER_INFO: 49,
  LEADER_BOARD: 50,
  TEAM_INFO: 51,
  TRANSIENT_ELEMENT: 52,
};

// ==================== TIPOS DE ELEMENTOS ====================
const ELEMENT_TYPES = {
  FISH: 0,
  BALL: 1,
};

// ==================== TIPOS DE CAMPO ====================
const FIELD_TYPES = {
  NORMAL: 0,
  SOCCER: 1,
};

// ==================== TIPOS DE TRANSIENT ====================
const TRANSIENT_TYPES = {
  SMOKE_EXPLOSION: 0,
};

// ==================== UTILIDADES ====================
class Utils {
  static hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return (
      (Math.round(r * 255) << 16) |
      (Math.round(g * 255) << 8) |
      Math.round(b * 255)
    );
  }

  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
}

// ==================== PARTE DEL NARVAL ====================
class NarwhalePart {
  constructor(index) {
    this.index = index;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.rot = 0;
    this.vt = 0;
  }

  applyImpulse(fx, fy) {
    this.vx += fx;
    this.vy += fy;
  }
}

// ==================== JUGADOR ====================
class Player {
  constructor(id, socket, name = "Narwhal") {
    this.id = id;
    this.socket = socket;
    this.name = name.substring(0, 25);

    // Visual
    this.color = this.randomColor();
    this.team = Math.random() > 0.5 ? 1 : -1;
    this.size = CONFIG.baseSize;
    this.alpha = 1.0;
    this.level = 1;
    this.score = 0;
    this.kills = 0;

    // Física
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.angle = Math.random() * Math.PI * 2;

    // Partes del cuerpo
    this.parts = [];
    this.breakPoint = 6;

    // Habilidades
    this.maxDash = 1;
    this.curDash = 1;
    this.overDash = 0;
    this.tuskRatio = 0.5;
    this.decoration = 0;
    this.invincibleDur = 0;
    this.skincode = 0;

    // Estados
    this.isDashing = false;
    this.dashCooldown = 0;
    this.isRetreating = false;
    this.retreatCooldown = 0;
    this.lastRetreat = 0;
    this.hitStunDur = 0;

    // Estado
    this.isAlive = false;
    this.currentRoom = null;
    this.respawnTimer = 0;

    // Input
    this.inputDirX = 0;
    this.inputDirY = 0;
    this.lastInputTime = Date.now();
    this.lastAimX = 1;
    this.lastAimY = 0;
    this.cursorMag = 0;
  }

  initializeParts() {
  this.parts = [];
  for (let i = 0; i < 11; i++) {
    const part = new NarwhalePart(i);
      part.x = this.pos.x;
    part.y = this.pos.y;
    part.rot = this.angle;
    this.parts.push(part);
  }
  }

  randomColor() {
    const h = Math.random();
    const s = 0.85 + Math.random() * 0.1;
    const l = 0.6 + Math.random() * 0.1;
    return Utils.hslToRgb(h, s, l);
  }

  spawn(room) {
    this.isAlive = true;

    // Spawn aleatorio
    if (room.config.options.fieldType === FIELD_TYPES.SOCCER) {
      const halfWidth = room.config.options.width / 2;
      this.pos.x =
        this.team === -1
          ? Math.random() * (halfWidth - 400) + 200
          : halfWidth + Math.random() * (halfWidth - 400) + 200;
      this.pos.y = Math.random() * (room.config.options.height - 400) + 200;
    } else {
      this.pos.x = Math.random() * (room.config.options.width - 400) + 200;
      this.pos.y = Math.random() * (room.config.options.height - 400) + 200;
    }

    this.vel.x = 0;
    this.vel.y = 0;
    this.invincibleDur = CONFIG.spawnInvincibleTime;
    this.curDash = this.maxDash;
    this.overDash = 0;
    this.size = CONFIG.baseSize;
    this.level = 1;
    this.isDashing = false;
    this.isRetreating = false;
    this.hitStunDur = 0;
    this.alpha = 1.0;

    this.initializeParts();

    // Calcular breakPoint basado en el tamaño (valor fijo para cliente 2017)
    this.breakPoint = Math.min(6, Math.floor(this.parts.length / 2));

    // CRÍTICO: Longitud de segmento debe coincidir con updateParts
    const SEGMENT_LENGTH = this.size * 0.95; // Misma distancia que en updateParts

    // Posicionar la cabeza (parte 0)
    this.parts[0].x = this.pos.x;
    this.parts[0].y = this.pos.y;
    this.parts[0].rot = this.angle;
    this.parts[0].vx = 0;
    this.parts[0].vy = 0;
    this.parts[0].vt = 0;

    // Posicionar todas las partes del cuerpo en línea recta detrás de la cabeza
    for (let i = 1; i < this.parts.length; i++) {
      const part = this.parts[i];
      part.x = this.pos.x - Math.cos(this.angle) * SEGMENT_LENGTH * i;
      part.y = this.pos.y - Math.sin(this.angle) * SEGMENT_LENGTH * i;
      part.rot = this.angle;
      part.vx = 0;
      part.vy = 0;
      part.vt = 0;
    }
  }

  update(dt, room) {
    if (!this.isAlive) {
      this.respawnTimer -= dt;
      return;
    }

    // Actualizar timers
    this.invincibleDur = Math.max(0, this.invincibleDur - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.retreatCooldown = Math.max(0, this.retreatCooldown - dt);
    this.hitStunDur = Math.max(0, this.hitStunDur - dt);

    // Regenerar dash
    if (this.curDash < this.maxDash) {
      this.overDash += dt * 0.5;
      if (this.overDash >= 1.0) {
        this.curDash = Math.min(this.maxDash, this.curDash + 1);
        this.overDash = 0;
      }
    }

    // Actualizar estados
    if (this.isDashing && this.dashCooldown <= 0) {
      this.isDashing = false;
    }
    if (this.isRetreating && this.retreatCooldown <= 0) {
      this.isRetreating = false;
    }

    this.processMovement(dt);
    this.updateParts(dt);
    this.clampToWorld(room);
    // Efecto de parpadeo durante invincibilidad
    if (this.invincibleDur > 0) {
      this.alpha = 0.4 + Math.sin(Date.now() * 0.01) * 0.3;
    } else {
      this.alpha = 1.0;
    }
  }

  processMovement(dt) {
    if (this.hitStunDur > 0) {
      this.vel.x *= 0.9;
      this.vel.y *= 0.9;
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      return;
    }

    const inputMagnitude = Math.sqrt(
      this.inputDirX * this.inputDirX + this.inputDirY * this.inputDirY,
    );

    if (inputMagnitude > 0.01) {
      const sizeFactor = Math.max(0.6, 1 - (this.size - CONFIG.baseSize) / 200);

      // Aceleración en tiempo real hacia el cursor
      const accelMag = CONFIG.acceleration * sizeFactor * inputMagnitude * 3;
      const normalX = this.inputDirX / inputMagnitude;
      const normalY = this.inputDirY / inputMagnitude;

      // Aplicar aceleración
      this.vel.x += normalX * accelMag * dt;
      this.vel.y += normalY * accelMag * dt;

      const currentSpeed = Math.sqrt(
        this.vel.x * this.vel.x + this.vel.y * this.vel.y,
      );
      let maxSpeed = CONFIG.maxSpeed * sizeFactor;

      if (this.isDashing) {
        maxSpeed = CONFIG.dashMaxSpeed;
      }

      if (currentSpeed > maxSpeed) {
        this.vel.x = (this.vel.x / currentSpeed) * maxSpeed;
        this.vel.y = (this.vel.y / currentSpeed) * maxSpeed;
      }

      // La cabeza apunta al cursor
      this.angle = Math.atan2(this.lastAimY, this.lastAimX);
    } else {
      // Sin input, apuntar en dirección de movimiento
      const speed = Math.sqrt(
        this.vel.x * this.vel.x + this.vel.y * this.vel.y,
      );
      if (speed > 0.1) {
        const moveAngle = Math.atan2(this.vel.y, this.vel.x);
        let angDiff = moveAngle - this.angle;
        while (angDiff > Math.PI) angDiff -= Math.PI * 2;
        while (angDiff < -Math.PI) angDiff += Math.PI * 2;
        this.angle += angDiff * 0.15;
      }
    }

    // Fricción
    this.vel.x *= CONFIG.friction;
    this.vel.y *= CONFIG.friction;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

 updateParts(dt) {
   const SEGMENT_LENGTH = 20 + this.size * 0.3;
  const posBlend = Math.min(1, dt * 18);
  const rotBlend = Math.min(1, dt * 12);

  // --- Cabeza ---
  this.parts[0].x = this.pos.x;
  this.parts[0].y = this.pos.y;
  this.parts[0].rot = this.angle;
  this.parts[0].vx = this.vel.x;
  this.parts[0].vy = this.vel.y;
  this.parts[0].vt = 0;

    // Actualizar el resto del cuerpo con física de peso
  for (let i = 1; i < this.parts.length; i++) {
    const part = this.parts[i];
    const prev = this.parts[i - 1];

  // Calcular donde DEBE estar la parte (detrás de la anterior)
  const segL = i >= this.parts.length - 2 ? SEGMENT_LENGTH * 0.08 : SEGMENT_LENGTH;
  const targetX = prev.x - Math.cos(prev.rot) * segL;
  const targetY = prev.y - Math.sin(prev.rot) * segL;
    const oldX = part.x;
    const oldY = part.y;
  part.x += (targetX - part.x) * posBlend;
  part.y += (targetY - part.y) * posBlend;
     const cdx = part.x - prev.x;
     const cdy = part.y - prev.y;
     const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
     if (cdist > 1e-6) {
      const k = segL / cdist;
       part.x = prev.x + cdx * k;
       part.y = prev.y + cdy * k;
     } else {
    part.x = prev.x - Math.cos(prev.rot) * segL;
    part.y = prev.y - Math.sin(prev.rot) * segL;
        }

    const dx = prev.x - part.x;
    const dy = prev.y - part.y;

    const targetRot = Math.atan2(dy, dx);

    let rotDiff = targetRot - part.rot;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

    part.rot += rotDiff * rotBlend;

    // Normaliza rot
    while (part.rot > Math.PI) part.rot -= Math.PI * 2;
    while (part.rot < -Math.PI) part.rot += Math.PI * 2;

    // 3) Calcular velocidades reales de la animación
    const invDt = 1 / (dt > 0 ? dt : 0.016);
    part.vx = (part.x - oldX) * invDt;
    part.vy = (part.y - oldY) * invDt;
    this.parts[i].vy = 0;
  }
}


  clampToWorld(room) {
  const half = this.size / 1.5;
  const minX = half;
  const maxX = room.config.options.width - half;
  const minY = half;
  const maxY = room.config.options.height - half;

  const bounce = -0.7; // Rebote elástico (0.7 = pierde energía)

  if (this.pos.x < minX) {
    this.pos.x = minX;
    this.vel.x *= bounce;
  }

  if (this.pos.x > maxX) {
    this.pos.x = maxX;
    this.vel.x *= bounce;
  }

  if (this.pos.y < minY) {
    this.pos.y = minY;
    this.vel.y *= bounce;
  }

  if (this.pos.y > maxY) {
    this.pos.y = maxY;
    this.vel.y *= bounce;
  }
}

  setInputDirection(dirX, dirY) {
    const magnitude = Math.sqrt(dirX * dirX + dirY * dirY);
    if (magnitude > 1.0) {
      this.inputDirX = dirX / magnitude;
      this.inputDirY = dirY / magnitude;
    } else {
      this.inputDirX = dirX;
      this.inputDirY = dirY;
    }
    this.lastInputTime = Date.now();

    if (magnitude > 0.001) {
      this.lastAimX = this.inputDirX;
      this.lastAimY = this.inputDirY;
    }
  }

  useDash() {
    if (this.curDash > 0 && this.dashCooldown <= 0 && !this.isDashing) {
      this.curDash--;
      this.isDashing = true;
      this.dashCooldown = 2.0;

      const dashPower = CONFIG.dashPower;
      this.vel.x += Math.cos(this.angle) * dashPower;
      this.vel.y += Math.sin(this.angle) * dashPower;

      for (let i = 1; i < this.parts.length; i++) {
        const factor = 1 - i / this.parts.length;
        this.parts[i].applyImpulse(
          Math.cos(this.angle) * dashPower * factor * 0.3,
          Math.sin(this.angle) * dashPower * factor * 0.3,
        );
      }

      return true;
    }
    return false;
  }

 useRetreat() {
  // ⛔ No permitir si está en cooldown
  if (this.retreatCooldown > 0 || this.curDash <= 0) return false;

  // Consumir stamina
  this.curDash -= CONFIG.retreatCost;
  if (this.curDash < 0) this.curDash = 0;

  this.retreatCooldown = CONFIG.retreatCooldown; 
  this.isRetreating = true;

  const retreatAngle = this.angle + Math.PI;
  const strength = this.size * 0.9 + CONFIG.retreatPower;

  const impulseX = Math.cos(retreatAngle) * strength;
  const impulseY = Math.sin(retreatAngle) * strength;

  this.vel.x += impulseX;
  this.vel.y += impulseY;

  for (let i = 1; i < this.parts.length; i++) {
    const factor = 0.08 * (i / this.parts.length);
    this.parts[i].vx += impulseX * factor;
    this.parts[i].vy += impulseY * factor;
  }

  return true;   // 🔥 NECESARIO PARA QUE EL CLIENTE SEPA QUE SE USÓ EL RETREAT
}

  getHornTip() {
    const hornLength = this.size * 0.8 * this.tuskRatio;
    return {
      x: this.pos.x + Math.cos(this.angle) * hornLength,
      y: this.pos.y + Math.sin(this.angle) * hornLength,
    };
  }

  applyHit(attacker) {
    if (this.invincibleDur > 0) return false;

    const dx = this.pos.x - attacker.pos.x;
    const dy = this.pos.y - attacker.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
      const pushForce = CONFIG.pushForce * (attacker.size / this.size);
      this.vel.x += (dx / dist) * pushForce;
      this.vel.y += (dy / dist) * pushForce;
    }

    this.hitStunDur = 0.2;
    return true;
  }

  grow(amount) {
    this.size = Math.min(CONFIG.maxSize, this.size + amount);
    this.level = Math.floor((this.size - CONFIG.baseSize) / 10) + 1;
  }

  die(killer = null) {
    if (!this.isAlive || this.invincibleDur > 0) return;

    this.isAlive = false;
    this.respawnTimer = CONFIG.respawnDelay;

    if (killer && killer !== this) {
      killer.kills++;
      killer.score += this.level * 100;
      killer.grow(CONFIG.growthPerKill);
    }

    const ripBuffer = Buffer.from([OPCODES.RIP]);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(ripBuffer);
    }

    return true;
  }

  sendPlayerInfo() {
    const buffer = Buffer.alloc(3);
    buffer.writeUInt8(OPCODES.PLAYER_INFO, 0);
    buffer.writeUInt8(this.level & 0xff, 1);
    buffer.writeUInt8(0, 2);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(buffer);
    }
  }
}

// ==================== PELOTA (SOCCER) ====================
class Ball {
  constructor(id, x, y) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = 270;
    this.friction = 0.985;
    this.bounceRestitution = 0.8;
  }

  update(dt, room) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.vx *= this.friction;
    this.vy *= this.friction;

const margin = this.radius;
const MIN_BOUNCE_SPEED = 120;             // rebote solo si va rápido

// --- TOP WALL ---
if (this.y < margin) {
  // fijamos posición exacta para que NO se meta dentro
  this.y = margin;

  if (Math.abs(this.vy) > MIN_BOUNCE_SPEED) {
    this.vy = Math.abs(this.vy) * this.bounceRestitution; // rebote real
  } else {
    this.vy = 0; // pegada a la pared sin botar
  }
}

// --- BOTTOM WALL ---
else if (this.y > room.config.options.height - margin) {
  this.y = room.config.options.height - margin;

  if (Math.abs(this.vy) > MIN_BOUNCE_SPEED) {
    this.vy = -Math.abs(this.vy) * this.bounceRestitution;
  } else {
    this.vy = 0;
  }
}

// --- LEFT WALL ---
if (this.x < margin) {
  this.x = margin;

  if (Math.abs(this.vx) > MIN_BOUNCE_SPEED) {
    this.vx = Math.abs(this.vx) * this.bounceRestitution;
  } else {
    this.vx = 0;
  }
}

// --- RIGHT WALL ---
else if (this.x > room.config.options.width - margin) {
  this.x = room.config.options.width - margin;

  if (Math.abs(this.vx) > MIN_BOUNCE_SPEED) {
    this.vx = -Math.abs(this.vx) * this.bounceRestitution;
  } else {
    this.vx = 0;
  }
}
  }

  applyForce(fx, fy) {
    this.vx += fx;
    this.vy += fy;

    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const maxSpeed = 600;
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
  }
}

  reset(room) {
    this.x = room.config.options.width / 2;
    this.y = room.config.options.height / 2;
    this.vx = 0;
    this.vy = 0;
  }
  }


// ==================== SALA DE JUEGO ====================
class GameRoom {
  constructor(config, server) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.server = server;
    this.players = new Map();
    this.elements = new Map();
    this.nextElementId = 10000;
    this.gameTime = 0;
    this.teamScores = { left: 0, right: 0 };

    this.initializeGameElements();
  }

  initializeGameElements() {
    if (this.config.options.fieldType === FIELD_TYPES.SOCCER) {
      const ball = new Ball(
        this.nextElementId++,
        this.config.options.width / 2,
        this.config.options.height / 2,
      );
      this.elements.set(ball.id, ball);
    }
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    player.currentRoom = this.id;
    this.config.playerCount = this.players.size;

    if (this.config.options.fieldType === FIELD_TYPES.SOCCER) {
      const leftCount = Array.from(this.players.values()).filter(
        (p) => p.team === -1,
      ).length;
      const rightCount = Array.from(this.players.values()).filter(
        (p) => p.team === 1,
      ).length;
      player.team = leftCount <= rightCount ? -1 : 1;
    }
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
      this.config.playerCount = this.players.size;
    }
  }

  update(dt) {
    this.gameTime += dt;

    for (const player of this.players.values()) {
      if (!player.isAlive) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
          player.spawn(this);
        }
      } else {
        player.update(dt, this);
      }
    }

    for (const element of this.elements.values()) {
      if (typeof element.update === "function") {
        element.update(dt, this);
      }
    }

    this.checkCollisions();

    if (this.config.options.fieldType === FIELD_TYPES.SOCCER) {
      this.updateSoccerMode();
    }
  }

  checkCollisions() {
    const alivePlayers = Array.from(this.players.values()).filter(
      (p) => p.isAlive,
    );

    for (let i = 0; i < alivePlayers.length; i++) {
      for (let j = i + 1; j < alivePlayers.length; j++) {
        this.checkPlayerCollision(alivePlayers[i], alivePlayers[j]);
      }
    }

    if (this.config.options.fieldType === FIELD_TYPES.SOCCER) {
      for (const element of this.elements.values()) {
        if (element instanceof Ball) {
          this.checkBallCollisions(element, alivePlayers);
        }
      }
    }
  }

  checkPlayerCollision(p1, p2) {
    for (const part1 of p1.parts) {
      for (const part2 of p2.parts) {
        const dx = part1.x - part2.x;
        const dy = part1.y - part2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const collisionRadius1 =
          part1 === p1.parts[0] ? p1.size * 0.6 : p1.size * 0.4;
        const collisionRadius2 =
          part2 === p2.parts[0] ? p2.size * 0.6 : p2.size * 0.4;
        const collisionDist = collisionRadius1 + collisionRadius2;

        if (distance < collisionDist && distance > 0.01) {
          const overlap = collisionDist - distance;
          const nx = dx / distance;
          const ny = dy / distance;
          const pushAmount = overlap * 0.5;

          p1.vel.x += nx * pushAmount * 10;
          p1.vel.y += ny * pushAmount * 10;
          p2.vel.x -= nx * pushAmount * 10;
          p2.vel.y -= ny * pushAmount * 10;

          const bounceForce = CONFIG.bounceForce;
          p1.vel.x += nx * bounceForce;
          p1.vel.y += ny * bounceForce;
          p2.vel.x -= nx * bounceForce;
          p2.vel.y -= ny * bounceForce;

          if (part1 === p1.parts[0]) {
            this.checkHornCollision(p1, p2);
          }
          if (part2 === p2.parts[0]) {
            this.checkHornCollision(p2, p1);
          }

          return;
        }
      }
    }
  }

  checkHornCollision(attacker, victim) {
    if (victim.invincibleDur > 0) return;

    const hornTip = attacker.getHornTip();
    const distToHorn = Math.sqrt(
      (hornTip.x - victim.pos.x) ** 2 + (hornTip.y - victim.pos.y) ** 2,
    );

    if (distToHorn < victim.size * 0.6) {
      const toVictim = Math.atan2(
        victim.pos.y - attacker.pos.y,
        victim.pos.x - attacker.pos.x,
      );
      let angleDiff = Math.abs(toVictim - attacker.angle);
      while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

      if (angleDiff < Math.PI / 4) {
        const sizeDiff = attacker.size - victim.size;
        const threshold = 8;
        const attackerBonus = attacker.isDashing ? 15 : 0;

        if (sizeDiff + attackerBonus > threshold) {
          victim.die(attacker);
          this.broadcastSmokeExplosion(victim);
        } else if (sizeDiff + attackerBonus > -threshold) {
          victim.applyHit(attacker);
        }
      }
    }
  }

  checkBallCollisions(ball, players) {
    for (const player of players) {
      const dx = ball.x - player.pos.x;
      const dy = ball.y - player.pos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const collisionDist = player.size * 0.5 + ball.radius;

      if (distance < collisionDist && distance > 0) {
        const playerSpeed = Math.sqrt(player.vel.x ** 2 + player.vel.y ** 2);
        let pushForce = playerSpeed * 0.8 + player.size * 2;

        if (player.isDashing) {
          pushForce *= 2;
        }

        const nx = dx / distance;
        const ny = dy / distance;

        ball.applyForce(nx * pushForce, ny * pushForce);

        const overlap = collisionDist - distance;
        ball.x += nx * overlap;
        ball.y += ny * overlap;
      }
    }
  }

  broadcastSmokeExplosion(player) {
    const buffer = Buffer.alloc(6);
    let offset = 0;

    buffer.writeUInt8(OPCODES.TRANSIENT_ELEMENT, offset++);
    buffer.writeUInt8(TRANSIENT_TYPES.SMOKE_EXPLOSION, offset++);

    const normX = Math.max(
      0,
      Math.min(1, player.pos.x / this.config.options.width),
    );
    const normY = Math.max(
      0,
      Math.min(1, player.pos.y / this.config.options.height),
    );

    buffer.writeUInt16LE(Math.floor(normX * 65535), offset);
    offset += 2;
    buffer.writeUInt16LE(Math.floor(normY * 65535), offset);
    offset += 2;

    this.broadcastToAll(buffer);
  }

  updateSoccerMode() {
    let ball = null;
    for (const el of this.elements.values()) {
      if (el instanceof Ball) {
        ball = el;
        break;
      }
    }
    if (!ball) return;

    const goalWidth = this.config.options.height / 3;
    const goalTop = this.config.options.height / 2 - goalWidth / 2;
    const goalBottom = this.config.options.height / 2 + goalWidth / 2;

    if (ball.x < 50 && ball.y > goalTop && ball.y < goalBottom) {
      this.teamScores.right++;
      ball.reset(this);
      this.broadcastTeamScore();
    } else if (
      ball.x > this.config.options.width - 50 &&
      ball.y > goalTop &&
      ball.y < goalBottom
    ) {
      this.teamScores.left++;
      ball.reset(this);
      this.broadcastTeamScore();
    }
  }

  broadcastToAll(data) {
    for (const player of this.players.values()) {
      if (player.socket.readyState === WebSocket.OPEN) {
        player.socket.send(data);
      }
    }
  }

  broadcastLeaderboard() {
    const topPlayers = Array.from(this.players.values())
      .filter((p) => p.isAlive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (topPlayers.length === 0) return;

    const parts = [];
    parts.push(Buffer.from([OPCODES.LEADER_BOARD]));
    parts.push(Buffer.from([topPlayers.length & 0xff]));

    for (const player of topPlayers) {
      parts.push(Buffer.from([player.level & 0xff]));
      parts.push(stringToZeroTermBytes(player.name || ""));
    }

    parts.push(Buffer.from([topPlayers.length & 0xff]));
    for (const player of topPlayers) {
      parts.push(Buffer.from([Math.min(player.level, 255)]));
    }

    this.broadcastToAll(Buffer.concat(parts));
  }

  broadcastTeamScore() {
    const buffer = Buffer.alloc(5);
    buffer.writeUInt8(OPCODES.TEAM_INFO, 0);
    buffer.writeUInt8(this.teamScores.left, 1);
    buffer.writeUInt8(this.teamScores.right, 2);

    let winTeam = -1;
    if (this.teamScores.left >= 10) winTeam = 0;
    else if (this.teamScores.right >= 10) winTeam = 1;

    buffer.writeInt8(winTeam, 3);
    buffer.writeUInt8(winTeam >= 0 ? 1 : 0, 4);

    this.broadcastToAll(buffer);
  }
}

// ==================== CONFIGURACIÓN DE SALAS ====================
const ROOMS_CONFIG = [
  {
    options: {
      width: 6400,
      height: 6400,
      cellWidth: 1280,
      hasIndicator: false,
      isPriority: true,
      fieldType: FIELD_TYPES.NORMAL,
      desirablePlayerNum: 25,
      hasSlowFactor: false,
    },
    name: "Large 1",
    id: 1,
    playerCount: 0,
  },
  {
    options: {
      width: 6400,
      height: 6400,
      cellWidth: 1280,
      hasIndicator: false,
      isPriority: true,
      fieldType: FIELD_TYPES.NORMAL,
      desirablePlayerNum: 25,
      hasSlowFactor: false,
    },
    name: "Large 2",
    id: 2,
    playerCount: 0,
  },
  {
    options: {
      width: 6400,
      height: 6400,
      cellWidth: 1280,
      hasIndicator: false,
      isPriority: false,
      fieldType: FIELD_TYPES.NORMAL,
      desirablePlayerNum: 15,
      hasSlowFactor: false,
    },
    name: "Sparse",
    id: 3,
    playerCount: 0,
  },
  {
    options: {
      width: 3840,
      height: 3840,
      cellWidth: 1280,
      hasIndicator: false,
      isPriority: false,
      fieldType: FIELD_TYPES.NORMAL,
      desirablePlayerNum: 9,
      hasSlowFactor: false,
    },
    name: "Small 1",
    id: 4,
    playerCount: 0,
  },
  {
    options: {
      width: 3840,
      height: 3840,
      cellWidth: 1280,
      hasIndicator: false,
      isPriority: false,
      fieldType: FIELD_TYPES.NORMAL,
      desirablePlayerNum: 9,
      hasSlowFactor: false,
    },
    name: "Small 2",
    id: 5,
    playerCount: 0,
  },
  {
    options: {
      width: 6400,
      height: 3840,
      cellWidth: 1280,
      hasIndicator: true,
      isPriority: false,
      fieldType: FIELD_TYPES.SOCCER,
      desirablePlayerNum: 25,
      hasSlowFactor: true,
    },
    name: "Narwhale Ball!",
    id: 6,
    playerCount: 0,
  }
];

// ==================== UTILIDADES ====================
function floatToInt8Angle(angleRad) {
  const v = Math.round((angleRad / Math.PI) * 127);
  return Math.max(-128, Math.min(127, v));
}

function packDashByte(curDash, maxDash) {
  return ((curDash & 15) << 4) | (maxDash & 15);
}

function stringToZeroTermBytes(str) {
  const encoded = encodeURIComponent(str || "");
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
  bytes.push(0);
  return Buffer.from(bytes);
}

// ==================== SERVIDOR PRINCIPAL ====================
class NarwhaleGameServer {
  constructor() {
    this.wss = null;
    this.players = new Map();
    this.lastTick = Date.now();
    this.rooms = new Map();
    this.initializeRooms();
  }

  initializeRooms() {
    for (const config of ROOMS_CONFIG) {
      const room = new GameRoom(config, this);
      this.rooms.set(config.id, room);
    }
  }

  start() {
    this.wss = new WebSocket.Server({ port: CONFIG.port, host: "0.0.0.0" });

    this.wss.on("connection", (socket, request) => {
      this.handleNewConnection(socket, request);
    });

    this.startGameLoop();

    console.log(
      `🌊 Servidor Narwhale.io Clásico iniciado en puerto ${CONFIG.port}`,
    );
    console.log(
      `🎮 Salas disponibles: ${ROOMS_CONFIG.map((r) => r.name).join(", ")}`,
    );
  }

  handleNewConnection(socket, request) {
    const playerId = Math.floor(Math.random() * 0xffff);
    socket.playerId = playerId;
    socket.currentRoom = null;

    console.log(`➕ Nueva conexión: ${playerId}`);

    // Enviar START inicial con UID de 32 bits (cliente 2017)
    const startBuf = Buffer.alloc(5);
    startBuf.writeUInt8(OPCODES.START, 0);
    startBuf.writeUInt32LE(socket.playerId >>> 0, 1);
    socket.send(startBuf);

    socket.on("message", (data) => {
      this.handleMessage(socket, data);
    });

    socket.on("close", () => {
      this.handleDisconnection(socket);
    });

    socket.on("error", (err) => {
      console.error(`Error en socket ${playerId}:`, err.message);
    });
  }

  handleMessage(socket, data) {
    if (!data || data.length === 0) return;

    const opcode = data[0];

    try {
      switch (opcode) {
        case OPCODES.GET_LOBBIES:
          this.handleGetLobbies(socket);
          break;
        case OPCODES.JOIN:
          this.handleJoin(socket, data);
          break;
        case OPCODES.START:
          this.handleStart(socket, data);
          break;
        case OPCODES.UPDATE_TARGET:
          this.handleUpdateTarget(socket, data);
          break;
        case OPCODES.SPLIT_UP:
          this.handleSplitUp(socket);
          break;
        case OPCODES.RETREAT:
          this.handleRetreat(socket);
          break;
        case OPCODES.PING:
          this.handlePing(socket, data);
          break;
        case OPCODES.LEAVE:
          this.handleLeave(socket);
          break;
      }
    } catch (error) {
      console.error("Error procesando mensaje:", error);
    }
  }

  handleGetLobbies(socket) {
    const roomsData = ROOMS_CONFIG.map((config) => {
      const room = this.rooms.get(config.id);
      return {
        options: config.options,
        name: config.name,
        id: config.id,
        playerCount: room ? room.players.size : 0,
      };
    });

    const jsonData = JSON.stringify(roomsData);
    const response = Buffer.concat([
      Buffer.from([OPCODES.GET_LOBBIES]),
      Buffer.from(jsonData, "utf8"),
      Buffer.from([0x00]),
    ]);

    socket.send(response);
  }

  handleJoin(socket, data) {
    const roomId = data.readUInt32LE(1);
    const room = this.rooms.get(roomId);

    if (!room) {
      console.log(`⚠ Sala ${roomId} no existe`);
      return;
    }

    socket.currentRoom = roomId;
    console.log(`🚪 Cliente ${socket.playerId} entró a ${room.name}`);

    // Enviar JOIN_ROOM y estado inicial de la sala
    this.sendJoinRoom(socket, room);
    this.sendElements(socket, room);
    room.broadcastTeamScore();
  }

  handleStart(socket, data) {
    let offset = 1;

    const skincode = data.readUInt32LE(offset);
    offset += 4;
    const colorcode = data.readUInt32LE(offset);
    offset += 4;

    let nameBytes = [];
    while (data[offset] !== 0 && offset < data.length) {
      nameBytes.push(data[offset]);
      offset++;
    }

    let playerName = Buffer.from(nameBytes).toString("utf8");
    if (!playerName || playerName.length === 0) playerName = "Narwhal";

    let player = this.players.get(socket.playerId);
    if (!player) {
      player = new Player(socket.playerId, socket, playerName);
      this.players.set(socket.playerId, player);
    } else {
      player.name = playerName;
      player.socket = socket;
    }

    player.skincode = skincode;
    player.color = colorcode;

    // Enviar START con UID de 32 bits (compatibilidad cliente 2017)
    const startBuffer = Buffer.alloc(5);
    startBuffer.writeUInt8(OPCODES.START, 0);
    startBuffer.writeUInt32LE(socket.playerId >>> 0, 1);
    socket.send(startBuffer);

    if (socket.currentRoom !== null) {
      const room = this.rooms.get(socket.currentRoom);
      if (room) {
        room.addPlayer(player);
        player.spawn(room);
        console.log(`🐳 ${playerName} spawneó en ${room.name}`);

        // Enviar estado inicial después de spawn
        setTimeout(() => {
          if (player.socket.readyState === WebSocket.OPEN) {
            player.sendPlayerInfo();
            this.sendElements(player.socket, room);
          }
        }, 50);
      }
    }
  }

  handleUpdateTarget(socket, data) {
    if (data.length >= 9) {
      const dirX = data.readFloatLE(1);
      const dirY = data.readFloatLE(5);

      const player = this.players.get(socket.playerId);
      if (player && player.isAlive) {
        const mag = Math.sqrt(dirX * dirX + dirY * dirY);
        if (mag > 1e-6) {
          player.cursorMag = Math.min(mag, 1);
          player.setInputDirection(dirX / mag, dirY / mag);
        } else {
          player.cursorMag = 0;
          player.setInputDirection(0, 0);
        }
      }
    }
  }

  handleSplitUp(socket) {
    const player = this.players.get(socket.playerId);
    if (player && player.isAlive) {
      player.useDash();
    }
  }

  handleRetreat(socket) {
    const player = this.players.get(socket.playerId);
    if (player && player.isAlive) {
      player.useRetreat();
    }
  }

  handlePing(socket, data) {
    if (data.length >= 5) {
      const timestamp = data.readFloatLE(1);
      const response = Buffer.alloc(5);
      response.writeUInt8(OPCODES.PING, 0);
      response.writeFloatLE(timestamp, 1);
      socket.send(response);
    }
  }

  handleLeave(socket) {
    this.handleDisconnection(socket);
  }

  handleDisconnection(socket) {
    const player = this.players.get(socket.playerId);
    if (player && player.currentRoom !== null) {
      const room = this.rooms.get(player.currentRoom);
      if (room) {
        room.removePlayer(socket.playerId);
      }
      console.log(`➖ Jugador ${socket.playerId} desconectado`);
    }
    this.players.delete(socket.playerId);
  }

  sendElements(socket, room) {
    const parts = [];

    parts.push(Buffer.from([OPCODES.SET_ELEMENTS]));

    const timeBuf = Buffer.alloc(8);
    timeBuf.writeDoubleLE(Date.now(), 0);
    parts.push(timeBuf);

    const meta = Buffer.alloc(5);
    meta.writeUInt8(1, 0);
    meta.writeUInt16LE(32767, 1);
    meta.writeUInt16LE(32767, 3);
    parts.push(meta);

    // Enviar elementos (pelotas)
    for (const element of room.elements.values()) {
      if (element instanceof Ball) {
        const buf = Buffer.alloc(15);
        let off = 0;
        buf.writeUInt32LE(element.id >>> 0, off);
        off += 4;
        buf.writeFloatLE(element.x, off);
        off += 4;
        buf.writeFloatLE(element.y, off);
        off += 4;

        const speed = Math.round(Math.hypot(element.vx || 0, element.vy || 0));
        buf.writeUInt16LE(Math.min(0xffff, speed), off);
        off += 2;

        const angle = speed === 0 ? 0 : Math.atan2(element.vy, element.vx);
        buf.writeInt8(floatToInt8Angle(angle), off);

        const ballPacket = Buffer.concat([
          Buffer.from([ELEMENT_TYPES.BALL]),
          buf,
        ]);
        parts.push(ballPacket);
      }
    }

    // Enviar jugadores
    for (const player of room.players.values()) {
      if (!player.isAlive) continue;

      const pieces = [];
      pieces.push(Buffer.from([ELEMENT_TYPES.FISH]));

      const idBuf = Buffer.alloc(4);
      idBuf.writeUInt32LE(player.id >>> 0, 0);
      pieces.push(idBuf);

      const color = player.color || 0xffffff;
      pieces.push(
        Buffer.from([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]),
      );

      pieces.push(stringToZeroTermBytes(player.name || ""));

      const team = typeof player.team === "number" ? player.team & 7 : 7;
      const partsLen = player.parts.length;

      let breakPointEnc = Math.floor(5 + (player.size - CONFIG.baseSize) * 0.05);
      breakPointEnc = Utils.clamp(breakPointEnc, 3, partsLen - 3);

      const sByte = (team & 7) | ((breakPointEnc & 31) << 3);
      pieces.push(Buffer.from([sByte]));

      const alphaByte = Math.round(player.alpha * 255);
      pieces.push(Buffer.from([alphaByte & 0xff]));

      pieces.push(Buffer.from([packDashByte(player.curDash, player.maxDash)]));

      const overDashB = Math.round(player.overDash * 255);
      pieces.push(Buffer.from([overDashB & 0xff]));

      const tuskByte = Math.round((player.tuskRatio / 2) * 255);
      pieces.push(Buffer.from([tuskByte & 0xff]));

      pieces.push(Buffer.from([player.decoration & 0xff]));

      const head = player.parts[0];
      const xyBuf = Buffer.alloc(8);
      xyBuf.writeFloatLE(head.x, 0);
      xyBuf.writeFloatLE(head.y, 4);
      pieces.push(xyBuf);

      const sp = Math.round(Math.hypot(head.vx, head.vy));
      const spBuf = Buffer.alloc(2);
      spBuf.writeUInt16LE(Math.min(0xffff, sp), 0);
      pieces.push(spBuf);

      const ang = sp === 0 ? 0 : Math.atan2(head.vy, head.vx);
      pieces.push(Buffer.from([floatToInt8Angle(ang) & 0xff]));
      pieces.push(Buffer.from([floatToInt8Angle(head.rot) & 0xff]));

      pieces.push(Buffer.from([player.skincode & 0xff]));

      const invByte = Math.round((player.invincibleDur / 2) * 255);
      pieces.push(Buffer.from([invByte & 0xff]));

      const partsCount = partsLen - 1;
      pieces.push(Buffer.from([partsCount & 0xff]));

      for (let r = 1; r <= partsCount; r++) {
  const part = player.parts[r];

        if (r !== breakPointEnc) {
          const rotByte = floatToInt8Angle(part.rot);
          pieces.push(Buffer.from([rotByte & 0xff]));
        } else {
  const full = Buffer.alloc(16);
  full.writeFloatLE(part.x, 0);
  full.writeFloatLE(part.y, 4);
  full.writeFloatLE(part.vx, 8);
  full.writeFloatLE(part.vy, 12);
  pieces.push(full);
}
      }

      parts.push(Buffer.concat(pieces));
    }

    const out = Buffer.concat(parts);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(out);
    }
  }

  sendJoinRoom(socket, room) {
    const buf = Buffer.alloc(2);
    let o = 0;
    buf.writeUInt8(OPCODES.JOIN_ROOM, o++);
    buf.writeUInt8(room.id & 0xFF, o++);
    if (socket.readyState === WebSocket.OPEN) socket.send(buf);
  }

  startGameLoop() {
    const targetFrameTime = 1000 / CONFIG.tickRate;
    let frameCount = 0;

    setInterval(() => {
      const now = Date.now();
      const dt = Math.min((now - this.lastTick) / 1000, 0.016); // Max 16ms para estabilidad
      this.lastTick = now;
      frameCount++;

      // Actualizar todas las salas
      for (const room of this.rooms.values()) {
        room.update(dt);
      }

      // Enviar updates cada frame para tiempo real
      this.sendUpdates();

      // Leaderboard cada 2 segundos
      if (frameCount % (CONFIG.tickRate * 2) === 0) {
        for (const room of this.rooms.values()) {
          if (room.players.size > 0) {
            room.broadcastLeaderboard();
          }
        }
      }
    }, targetFrameTime);
  }

  sendUpdates() {
    for (const room of this.rooms.values()) {
      if (room.players.size > 0) {
        for (const player of room.players.values()) {
          if (player.socket && player.socket.readyState === WebSocket.OPEN) {
            this.sendElements(player.socket, room);
          }
        }
      }
    }
  }
}

// ==================== INICIAR SERVIDOR ====================
const server = new NarwhaleGameServer();
server.start();
