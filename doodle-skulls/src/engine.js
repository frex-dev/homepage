/* Physics, collision queries and camera.
   Faithful port of GamePlay.update/resolveX/resolveY/stickToSurface/findSurfaceY/updateCamera
   from the original Android build. DOM-free so it can be tested headless. */
(function (root) {
  'use strict';
  var DS2 = root.DS2 = root.DS2 || {};
  var Col = DS2.Collision || (typeof require !== 'undefined' ? require('./collision.js') : null);

  var K = {
    TILE: 64, ZOOM: 1.9, GRAVITY: 1500, MAX_FALL: 900, MAX_RUN_SPEED: 360,
    GROUND_ACCEL: 2800, GROUND_DECEL: 4500, GROUND_FRICT: 3, AIR_ACCEL: 700, AIR_DRAG: 1.2,
    JUMP_FORCE: -660, JUMP_CD_MS: 850, COYOTE_MS: 150, SLOPE_GRAV_SCALE: 0.4, UPHILL_ASSIST: 4000,
    INTRO_DUR: 1.8, HEAD_RADIUS: 33, CAM_INTRO: 0, CAM_PLAY: 1, CAM_OUTRO: 2,
    /* The original adds +4000 (not -4000) when walking uphill to the left. Kept for fidelity. */
    FAITHFUL_LEFT_UPHILL_QUIRK: true,
    /* Original stickToSurface() re-grounds the player on the frame after a jump at >=~30fps (rise < 18px/frame),
       cancelling the jump. true = keep the player airborne until the jump's apex. */
    FIX_JUMP_CANCEL: true
  };

  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function clampI(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function World(level) {
    this.level = level;
    this.cols = level.cols; this.rows = level.rows;
    this.firstGid = level.firstGid;
    this.tileLayer = level.fg;
    this.coins = level.coins;
    this.flyingCoins = [];
    this.flagBlueX = level.flagBlue.x; this.flagBlueY = level.flagBlue.y;
    this.flagOrangeX = level.flagOrange.x; this.flagOrangeY = level.flagOrange.y;
    this.headRadius = K.HEAD_RADIUS;
    this.screenW = 1280; this.screenH = 720; this.zoom = K.ZOOM;
    this.events = [];          /* 'land','jump','coin','death','checkpoint','complete' */
    this.reset(true);
  }

  var P = World.prototype;

  P.reset = function (initial) {
    this.coinsCollected = 0; this.levelComplete = false; this.levelCompleteTimer = 0;
    this.rollAngle = 0; this.wasGrounded = false; this.jumpPressed = false; this.jumpLock = false; this.completeFired = false;
    this.left = false; this.right = false; this.paused = false;
    this.flyingCoins.length = 0;
    this.coins.forEach(function (c) { c.collected = false; });
    this.headX = this.flagBlueX; this.headY = this.flagBlueY - this.headRadius - 2;
    this.headDrawX = this.headX; this.headDrawY = this.headY; this.rollDraw = this.rollAngle;
    this.headVX = 0; this.headVY = 0; this.onGround = false;
    this.jumpCooldown = 0; this.jumpCoyoteMs = 150;
    this.camState = K.CAM_INTRO; this.camIntroTimer = 0;
    this.camLerpX = this.headX - 120; this.camLerpY = this.headY + 80;
    this.camX = this.camLerpX; this.camY = this.camLerpY; this.camVelX = 0;
  };

  P.respawn = function () {
    this.headX = this.flagBlueX; this.headY = this.flagBlueY - this.headRadius - 2;
    this.headDrawX = this.headX; this.headDrawY = this.headY;
    this.headVX = 0; this.headVY = 0; this.onGround = false;
    this.jumpCooldown = 0; this.jumpCoyoteMs = 0; this.rollAngle = 0; this.rollDraw = 0; this.jumpLock = false;
    this.paused = false; this.camState = K.CAM_INTRO; this.camIntroTimer = 0; this.camVelX = 0;
  };

  /* ---------- tile queries ---------- */
  P.isBlockingAtWorld = function (x, y) {
    var col = Math.trunc(x / 64), row = Math.trunc(y / 64);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    var gid = this.tileLayer[row * this.cols + col];
    if (gid <= 0) return false;
    var local = gid - this.firstGid;
    if (local < 0) return false;
    if (!Col.hasCollision(local)) return false;
    var lx = clampI(Math.trunc(x - col * 64), 0, 63), ly = clampI(Math.trunc(y - row * 64), 0, 63);
    return Col.isSolid(local, lx, ly);
  };

  P.findSurfaceY = function (x) {
    var startY = this.headY + this.headRadius - 8, endY = startY + 400;
    for (var y = startY; y < endY; y += 3) {
      if (!this.isBlockingAtWorld(x, y)) continue;
      var yy = y, steps = 0;
      while (steps < 120 && this.isBlockingAtWorld(x, yy - 1)) { yy -= 1; steps++; }
      var c = Math.trunc(x / 64), row = Math.trunc(yy / 64);
      if (c >= 0 && c < this.cols && row >= 0 && row < this.rows) {
        var gid = this.tileLayer[row * this.cols + c];
        if (gid > 0) {
          var local = gid - this.firstGid;
          if (local >= 0 && Col.hasCollision(local)) {
            var lx = clampI(Math.trunc(x - c * 64), 0, 63);
            var sr = Col.getSurfaceRow(local, lx);
            if (sr < 64) return row * 64 + sr;
          }
        }
      }
      return yy;
    }
    return NaN;
  };

  P.overlapX = function (col) {
    var l = Math.max(this.headX - this.headRadius + 6, col * 64);
    var r = Math.min(this.headX + this.headRadius - 6, (col + 1) * 64);
    if (r <= l) return NaN;
    return (l + r) * 0.5;
  };

  P.resolveX = function () {
    if (Math.abs(this.headVX) < 0.1) return;
    var r = this.headRadius, hits = 0, dir = this.headVX > 0;
    var edge = dir ? this.headX + r : this.headX - r;
    var ys = [this.headY + r * 0.2, this.headY - r * 0.15, this.headY - r * 0.38];
    for (var i = 0; i < ys.length; i++) if (this.isBlockingAtWorld(edge, ys[i])) hits++;
    if (hits >= 2) {
      var col = Math.trunc(edge / 64);
      this.headX = dir ? col * 64 - r : (col + 1) * 64 + r;
      this.headVX = 0;
    }
  };

  P.resolveY = function () {
    var r = this.headRadius;
    var c0 = clampI(Math.trunc((this.headX - r + 6) / 64), 0, this.cols - 1);
    var c1 = clampI(Math.trunc((this.headX + r - 6) / 64), 0, this.cols - 1);
    if (this.headVY >= 0) {
      var row = Math.trunc((this.headY + r) / 64);
      for (var c = c0; c <= c1; c++) {
        var ox = this.overlapX(c);
        if (isNaN(ox)) continue;
        if (this.isBlockingAtWorld(ox, this.headY + r)) {
          var sy = this.findSurfaceY(ox);
          if (!isNaN(sy)) { this.headY = sy - r - 0.5; this.headVY = 0; this.onGround = true; return; }
        }
      }
    } else {
      for (var c2 = c0; c2 <= c1; c2++) {
        var ox2 = this.overlapX(c2);
        if (isNaN(ox2)) continue;
        if (this.isBlockingAtWorld(ox2, this.headY - r)) {
          var rowT = Math.trunc((this.headY - r) / 64);
          this.headY = (rowT + 1) * 64 + r; this.headVY = 0; return;
        }
      }
    }
  };

  P.stickToSurface = function (dt) {
    if (K.FIX_JUMP_CANCEL && this.jumpLock) { if (this.headVY < 0) return; this.jumpLock = false; }
    var sy = this.findSurfaceY(this.headX);
    if (isNaN(sy)) return;
    var feet = this.headY + this.headRadius;
    if (feet < sy - 18 || feet > sy + 42) return;
    var k = Math.min(1, 26 * dt);
    this.headY += (sy - this.headRadius - 0.5 - this.headY) * k;
    if (this.headVY > 80) this.headVY *= (1 - 0.55 * k);
    else if (this.headVY > 0) this.headVY *= (1 - 0.85 * k);
    this.onGround = true;
  };

  /* ---------- camera ---------- */
  P.updateCamera = function (dt) {
    var halfW = this.screenW / (2 * this.zoom), halfH = this.screenH / (2 * this.zoom);
    var tx, ty, rate;
    if (this.camState === K.CAM_PLAY) {
      this.camVelX += (this.headVX - this.camVelX) * Math.min(1, 8 * dt);
      var look = Math.max(-100, Math.min(100, this.camVelX * 0.2));
      tx = this.headX + look;
      ty = this.headY + 20;
      if (Math.abs(this.headVY) > 80) ty += this.headVY * 0.035;
      var kY = this.onGround ? 0.18 : 0.1;
      ty = this.camLerpY + (ty - this.camLerpY) * kY;
      var speed = Math.sqrt(this.headVX * this.headVX + this.headVY * this.headVY);
      rate = Math.min(22, 10 + speed * 0.035);
    } else if (this.camState === K.CAM_INTRO) {
      this.camIntroTimer += dt;
      var t = Math.min(this.camIntroTimer / K.INTRO_DUR, 1), e = t * t * (3 - 2 * t);
      var sx = this.flagBlueX - 150, sy = this.flagBlueY + 100;
      tx = sx + (this.headX - sx) * e;
      ty = sy + (this.headY - sy) * e;
      rate = 26;
      if (this.camIntroTimer >= K.INTRO_DUR) this.camState = K.CAM_PLAY;
    } else {
      tx = this.flagOrangeX + 80; ty = this.flagOrangeY + 60; rate = 22;
    }
    var maxX = this.cols * 64, maxY = this.rows * 64;
    var cx = Math.max(halfW, Math.min(tx, maxX - halfW));
    var cy = Math.max(halfH, Math.min(ty, maxY - halfH));
    var a = 1 - Math.exp(-rate * dt);
    this.camLerpX += (cx - this.camLerpX) * a;
    this.camLerpY += (cy - this.camLerpY) * a;
    this.camX = this.camLerpX; this.camY = this.camLerpY;
  };

  /* ---------- main step (dtMs = real elapsed ms) ---------- */
  P.update = function (dtMs) {
    if (this.paused) return;
    if (this.levelComplete) {
      this.levelCompleteTimer += dtMs / 1000;
      if (this.levelCompleteTimer > 2.5 && !this.completeFired) { this.completeFired = true; this.events.push('complete'); }
      return;
    }
    var dt = Math.min(dtMs / 1000, 0.033);
    this.jumpCooldown -= dtMs;
    this.wasGrounded = this.onGround;
    var move = 0;
    if (this.left) move -= 1;
    if (this.right) move += 1;
    if (this.onGround) this.jumpCoyoteMs = 150; else this.jumpCoyoteMs = Math.max(0, this.jumpCoyoteMs - dtMs);

    var jumped = false;
    if (this.jumpPressed && this.jumpCoyoteMs > 0 && this.jumpCooldown <= 0) {
      this.headVY = K.JUMP_FORCE; this.onGround = false; jumped = true;
      this.jumpCoyoteMs = 0; this.jumpCooldown = K.JUMP_CD_MS; this.jumpLock = true;
      this.events.push('jump');
    }
    this.jumpPressed = false;

    if (this.onGround) {
      var r = this.headRadius * 0.95;
      var s0 = this.findSurfaceY(this.headX), sL = this.findSurfaceY(this.headX - r), sR = this.findSurfaceY(this.headX + r);
      if (isNaN(sL)) sL = s0;
      if (isNaN(sR)) sR = s0;
      var dx = 2 * r, tx = 1, ty = 0;
      if (isNaN(sL) || isNaN(sR)) { this.onGround = false; }
      else {
        var dy = sR - sL, len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.001) { tx = dx / len; ty = dy / len; }
      }
      if (this.onGround) {
        var vAlong = this.headVX * tx + this.headVY * ty;
        var slopeAcc = K.GRAVITY * ty * K.SLOPE_GRAV_SCALE;
        if (move !== 0 && sign(move) * sign(slopeAcc) < 0) slopeAcc *= 0.18;
        vAlong += slopeAcc * dt;
        if (move !== 0) {
          var acc = (sign(move) * sign(vAlong) < 0 && Math.abs(vAlong) > 20) ? K.GROUND_DECEL : K.GROUND_ACCEL;
          vAlong += acc * move * dt;
          if (ty < -0.025 && move > 0) vAlong += K.UPHILL_ASSIST * dt;
          if (ty > 0.025 && move < 0) vAlong += (K.FAITHFUL_LEFT_UPHILL_QUIRK ? 1 : -1) * K.UPHILL_ASSIST * dt;
        } else {
          vAlong *= Math.exp(-K.GROUND_FRICT * dt);
        }
        vAlong = Math.max(-K.MAX_RUN_SPEED, Math.min(K.MAX_RUN_SPEED, vAlong));
        this.headVX = vAlong * tx; this.headVY = vAlong * ty;
      }
    }

    if (!this.onGround) {
      if (!jumped) this.headVY += K.GRAVITY * dt;
      if (this.headVY > K.MAX_FALL) this.headVY = K.MAX_FALL;
      if (move !== 0) {
        this.headVX += K.AIR_ACCEL * move * dt;
        this.headVX = Math.max(-K.MAX_RUN_SPEED, Math.min(K.MAX_RUN_SPEED, this.headVX));
      } else {
        this.headVX *= Math.exp(-K.AIR_DRAG * dt);
      }
    }

    this.headX += this.headVX * dt;
    this.resolveX();
    this.headY += this.headVY * dt;
    this.onGround = false;
    this.resolveY();
    this.stickToSurface(dt);
    if (!this.wasGrounded && this.onGround) this.events.push('land');

    var spd = Math.sqrt(this.headVX * this.headVX + this.headVY * this.headVY);
    this.rollAngle += (spd * dt / this.headRadius * 57.29578) * (this.headVX >= 0 ? 1 : -1);
    var lerp = Math.min(1, 32 * dt);
    this.headDrawX += (this.headX - this.headDrawX) * lerp;
    this.headDrawY += (this.headY - this.headDrawY) * lerp;
    this.rollDraw += (this.rollAngle - this.rollDraw) * lerp;

    var maxX = this.cols * 64;
    if (this.headX - this.headRadius < 0) { this.headX = this.headRadius; this.headVX = 0; }
    if (this.headX > maxX - this.headRadius) { this.headX = maxX - this.headRadius; this.headVX = 0; }
    if (this.headY > this.rows * 64 + 300) { this.events.push('death'); this.respawn(); }

    var cr = this.headRadius + 24, cr2 = cr * cr;
    for (var i = 0; i < this.coins.length; i++) {
      var c = this.coins[i];
      if (c.collected) continue;
      var ddx = this.headX - c.x, ddy = this.headY - c.y;
      if (ddx * ddx + ddy * ddy < cr2) {
        c.collected = true; this.coinsCollected++; this.events.push('coin');
        this.flyingCoins.push({ wx: c.x, wy: c.y, progress: 0, alpha: 1 });
      }
    }
    for (var j = this.flyingCoins.length - 1; j >= 0; j--) {
      var f = this.flyingCoins[j];
      f.progress += dt * 1.6; f.alpha = 1 - f.progress;
      if (f.progress >= 1) this.flyingCoins.splice(j, 1);
    }

    this.updateCamera(dt);

    if (!this.levelComplete) {
      var fx = this.headX - this.flagOrangeX, fy = this.headY - this.flagOrangeY, fr = this.headRadius + 50;
      if (fx * fx + fy * fy < fr * fr) {
        this.levelComplete = true; this.camState = K.CAM_OUTRO; this.events.push('checkpoint');
      }
    }
  };

  DS2.K = K;
  DS2.World = World;
  if (typeof module !== 'undefined') module.exports = { K: K, World: World };
})(typeof window !== 'undefined' ? window : globalThis);
