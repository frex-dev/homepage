
/* Physics, pixel-mask collision queries, camera and render interpolation.
   Physics advances at 120 Hz; rendering follows the display refresh rate.
*/
(function (root) {
  'use strict';

  var DS2 = root.DS2 = root.DS2 || {};
  var Col = DS2.Collision ||
    (typeof require !== 'undefined' ? require('./collision.js') : null);

  var K = {
    TILE: 64,
    ZOOM: 1.9,
    GRAVITY: 1500,
    MAX_FALL: 900,
    MAX_RUN_SPEED: 360,
    GROUND_ACCEL: 2800,
    GROUND_DECEL: 4500,
    GROUND_FRICT: 3,
    AIR_ACCEL: 700,
    AIR_DRAG: 1.2,
    JUMP_FORCE: -660,
    JUMP_CD_MS: 850,
    COYOTE_MS: 150,
    SLOPE_GRAV_SCALE: 0.4,
    UPHILL_ASSIST: 4000,
    INTRO_DUR: 1.8,
    HEAD_RADIUS: 33,
    HEAD_VISUAL_RADIUS: 43,
    VIEW_ZOOM: 1.15,
    CAM_INTRO: 0,
    CAM_PLAY: 1,
    CAM_OUTRO: 2,

    FAITHFUL_LEFT_UPHILL_QUIRK: true,
    FIX_JUMP_CANCEL: true,

    PHYSICS_HZ: 120,
    PHYSICS_STEP: 1000 / 120,
    MAX_FRAME_TIME: 100,
    MAX_SUBSTEPS: 12
  };

  function sign(v) {
    return v > 0 ? 1 : (v < 0 ? -1 : 0);
  }

  function clampI(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function World(level) {
    this.level = level;
    this.cols = level.cols;
    this.rows = level.rows;
    this.firstGid = level.firstGid;
    this.tileLayer = level.fg;
    this.coins = level.coins;
    this.flyingCoins = [];

    this.flagBlueX = level.flagBlue.x;
    this.flagBlueY = level.flagBlue.y;
    this.flagOrangeX = level.flagOrange.x;
    this.flagOrangeY = level.flagOrange.y;

    this.headRadius = K.HEAD_RADIUS;
    this.visualRadius = K.HEAD_VISUAL_RADIUS;

    this.screenW = 1280;
    this.screenH = 720;
    this.zoom = K.ZOOM;

    this.events = [];
    this.reset(true);
  }

  var P = World.prototype;

  P.reset = function (initial) {
    this.coinsCollected = 0;
    this.levelComplete = false;
    this.levelCompleteTimer = 0;

    this.rollAngle = 0;
    this.wasGrounded = false;
    this.jumpPressed = false;
    this.jumpLock = false;
    this.completeFired = false;

    this.left = false;
    this.right = false;
    this.paused = false;

    this.physicsAccumulator = 0;

    this.flyingCoins.length = 0;

    this.coins.forEach(function (coin) {
      coin.collected = false;
    });

    this.headX = this.flagBlueX;
    this.headY = this.flagBlueY - this.headRadius - 2;

    this.headDrawX = this.headX;
    this.headDrawY = this.headY;
    this.rollDraw = this.rollAngle;

    this.prevHeadX = this.headX;
    this.prevHeadY = this.headY;
    this.prevRollDraw = this.rollDraw;
    this.renderHeadX = this.headX;
    this.renderHeadY = this.headY;
    this.renderRoll = this.rollDraw;

    this.headVX = 0;
    this.headVY = 0;
    this.onGround = false;

    this.jumpCooldown = 0;
    this.jumpCoyoteMs = K.COYOTE_MS;

    this.camState = K.CAM_INTRO;
    this.camIntroTimer = 0;

    this.camLerpX = this.headX - 120;
    this.camLerpY = this.headY + 80;

    this.camX = this.camLerpX;
    this.camY = this.camLerpY;
    this.camVelX = 0;
  };

  P.respawn = function () {
    this.headX = this.flagBlueX;
    this.headY = this.flagBlueY - this.headRadius - 2;

    this.headDrawX = this.headX;
    this.headDrawY = this.headY;

    this.prevHeadX = this.headX;
    this.prevHeadY = this.headY;
    this.prevRollDraw = 0;
    this.renderHeadX = this.headX;
    this.renderHeadY = this.headY;
    this.renderRoll = 0;

    this.headVX = 0;
    this.headVY = 0;
    this.onGround = false;

    this.jumpCooldown = 0;
    this.jumpCoyoteMs = 0;

    this.rollAngle = 0;
    this.rollDraw = 0;
    this.jumpLock = false;

    this.physicsAccumulator = 0;

    this.paused = false;
    this.camState = K.CAM_INTRO;
    this.camIntroTimer = 0;
    this.camVelX = 0;
  };

  /* ---------- tile queries ---------- */

  P.isBlockingAtWorld = function (x, y) {
    var col = Math.floor(x / K.TILE);
    var row = Math.floor(y / K.TILE);

    if (
      col < 0 || col >= this.cols ||
      row < 0 || row >= this.rows
    ) {
      return false;
    }

    var gid = this.tileLayer[row * this.cols + col];

    if (gid <= 0) return false;

    var local = gid - this.firstGid;

    if (local < 0 || !Col.hasCollision(local)) {
      return false;
    }

    var lx = clampI(
      Math.floor(x - col * K.TILE),
      0,
      63
    );

    var ly = clampI(
      Math.floor(y - row * K.TILE),
      0,
      63
    );

    return Col.isSolid(local, lx, ly);
  };

  /* ---------- surface lookup ---------- */

  P.findSurfaceY = function (x, minY, maxY, nearest) {
    var feet = this.headY + this.headRadius;

    if (minY === undefined) minY = feet - 8;
    if (maxY === undefined) maxY = feet + 400;

    var col = Math.floor(x / K.TILE);
    if (col < 0 || col >= this.cols) return NaN;

    var bestY = NaN;
    var bestDistance = Infinity;

    var from = Math.floor(minY);
    var to = Math.ceil(maxY);

    for (var y = from; y <= to; y++) {
      var solid = this.isBlockingAtWorld(x, y);

      if (!solid) continue;

      // Only accept the top boundary of a solid surface.
      if (this.isBlockingAtWorld(x, y - 1)) continue;

      if (!nearest) return y;

      var distance = Math.abs(y - feet);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestY = y;
      }
    }

    return bestY;
  };

  P.overlapX = function (col) {
    var left = Math.max(
      this.headX - this.headRadius + 6,
      col * K.TILE
    );

    var right = Math.min(
      this.headX + this.headRadius - 6,
      (col + 1) * K.TILE
    );

    if (right <= left) return NaN;

    return (left + right) * 0.5;
  };

  /* ---------- horizontal collision ---------- */

  P.resolveX = function () {
    if (Math.abs(this.headVX) < 0.1) return;

    var radius = this.headRadius;
    var movingRight = this.headVX > 0;

    var edge = movingRight
      ? this.headX + radius
      : this.headX - radius;

    var ys = [
      this.headY + radius * 0.2,
      this.headY - radius * 0.15,
      this.headY - radius * 0.38
    ];

    var hits = 0;

    for (var i = 0; i < ys.length; i++) {
      if (this.isBlockingAtWorld(edge, ys[i])) hits++;
    }

    if (hits >= 2) {
      var col = Math.floor(edge / K.TILE);

      this.headX = movingRight
        ? col * K.TILE - radius
        : (col + 1) * K.TILE + radius;

      this.headVX = 0;
    }
  };

  /* ---------- vertical collision ---------- */

  P.resolveY = function () {
    // Ground collisions are handled by stickToSurface().
    // Here we only resolve upward movement into a ceiling.
    if (this.headVY >= 0) return;

    var radius = this.headRadius;
    var top = this.headY - radius;
    var points = [
      this.headX - radius * 0.65,
      this.headX,
      this.headX + radius * 0.65
    ];

    var resolvedBottom = -Infinity;
    var maxScan = Math.ceil(radius * 2 + K.TILE);

    for (var i = 0; i < points.length; i++) {
      if (!this.isBlockingAtWorld(points[i], top)) continue;

      // Find the first empty pixel below the solid ceiling at this x.
      var y = Math.floor(top);
      var limit = y + maxScan;

      while (y <= limit && this.isBlockingAtWorld(points[i], y)) {
        y++;
      }

      if (y <= limit && y > resolvedBottom) {
        resolvedBottom = y;
      }
    }

    if (resolvedBottom !== -Infinity) {
      this.headY = resolvedBottom + radius + 0.5;
      this.headVY = 0;
    }
  };

  /* Stable ground following uses the skull's circular footprint. */
  P.stickToSurface = function (dt) {
    if (K.FIX_JUMP_CANCEL && this.jumpLock) {
      if (this.headVY < 0) return;
      this.jumpLock = false;
    }

    var radius = this.headRadius;
    var feet = this.headY + radius;
    var samples = 9;
    var targetY = Infinity;
    var found = false;

    // The smallest candidate is the highest support constraint.
    for (var i = 0; i < samples; i++) {
      var dx = -radius * 0.85 +
        (radius * 1.7) * i / (samples - 1);

      var surface = this.findSurfaceY(
        this.headX + dx,
        feet - 24,
        feet + 48,
        true
      );

      if (isNaN(surface)) continue;

      var arc = Math.sqrt(
        Math.max(0, radius * radius - dx * dx)
      );

      var candidate = surface - arc;

      if (candidate < targetY) targetY = candidate;
      found = true;
    }

    if (!found) {
      this.onGround = false;
      return;
    }

    var difference = targetY - this.headY;
    var allowedDown = Math.max(
      12,
      Math.abs(this.headVY) * dt + 4
    );

    // Do not snap across a gap or teleport up onto a distant ledge.
    if (difference > allowedDown || difference < -14) {
      this.onGround = false;
      return;
    }

    this.headY = targetY;
    this.onGround = true;
  };

  /* ---------- camera ---------- */

  P.updateCamera = function (dt) {
    var halfW = this.screenW / (2 * this.zoom);
    var halfH = this.screenH / (2 * this.zoom);

    var tx, ty, rate;

    if (this.camState === K.CAM_PLAY) {
      this.camVelX +=
        (this.headVX - this.camVelX) * Math.min(1, 8 * dt);

      var look = Math.max(
        -100,
        Math.min(100, this.camVelX * 0.2)
      );

      tx = this.headX + look;
      ty = this.headY + 20;

      if (Math.abs(this.headVY) > 80) {
        ty += this.headVY * 0.035;
      }

      var kY = this.onGround ? 0.18 : 0.1;

      ty = this.camLerpY + (ty - this.camLerpY) * kY;

      var speed = Math.sqrt(
        this.headVX * this.headVX +
        this.headVY * this.headVY
      );

      rate = Math.min(22, 10 + speed * 0.035);

    } else if (this.camState === K.CAM_INTRO) {
      this.camIntroTimer += dt;

      var t = Math.min(
        this.camIntroTimer / K.INTRO_DUR,
        1
      );

      var e = t * t * (3 - 2 * t);

      var sx = this.flagBlueX - 150;
      var sy = this.flagBlueY + 100;

      tx = sx + (this.headX - sx) * e;
      ty = sy + (this.headY - sy) * e;

      rate = 26;

      if (this.camIntroTimer >= K.INTRO_DUR) {
        this.camState = K.CAM_PLAY;
      }

    } else {
      tx = this.flagOrangeX + 80;
      ty = this.flagOrangeY + 60;
      rate = 22;
    }

    var maxX = this.cols * K.TILE;
    var maxY = this.rows * K.TILE;

    var cx = Math.max(
      halfW,
      Math.min(tx, maxX - halfW)
    );

    var cy = Math.max(
      halfH,
      Math.min(ty, maxY - halfH)
    );

    var a = 1 - Math.exp(-rate * dt);

    this.camLerpX += (cx - this.camLerpX) * a;
    this.camLerpY += (cy - this.camLerpY) * a;

    this.camX = this.camLerpX;
    this.camY = this.camLerpY;
  };

  /* ---------- fixed physics step ---------- */

  P.step = function (dtMs) {
    if (this.paused) return;

    this.prevHeadX = this.headX;
    this.prevHeadY = this.headY;
    this.prevRollDraw = this.rollDraw;

    if (this.levelComplete) {
      this.levelCompleteTimer += dtMs / 1000;

      if (
        this.levelCompleteTimer > 2.5 &&
        !this.completeFired
      ) {
        this.completeFired = true;
        this.events.push('complete');
      }

      return;
    }

    var dt = dtMs / 1000;

    this.jumpCooldown -= dtMs;
    this.wasGrounded = this.onGround;

    var move = 0;

    if (this.left) move -= 1;
    if (this.right) move += 1;

    if (this.onGround) {
      this.jumpCoyoteMs = K.COYOTE_MS;
    } else {
      this.jumpCoyoteMs = Math.max(
        0,
        this.jumpCoyoteMs - dtMs
      );
    }

    var jumped = false;

    if (
      this.jumpPressed &&
      this.jumpCoyoteMs > 0 &&
      this.jumpCooldown <= 0
    ) {
      this.headVY = K.JUMP_FORCE;
      this.onGround = false;
      jumped = true;

      this.jumpCoyoteMs = 0;
      this.jumpCooldown = K.JUMP_CD_MS;
      this.jumpLock = true;

      this.events.push('jump');
    }

    this.jumpPressed = false;

    /* Ground movement and slope following. */
    if (this.onGround) {
      var radius = this.headRadius * 0.95;
      var feet = this.headY + this.headRadius;

      var s0 = this.findSurfaceY(
        this.headX,
        feet - 64,
        feet + 64,
        true
      );

      var sL = this.findSurfaceY(
        this.headX - radius,
        feet - 64,
        feet + 64,
        true
      );

      var sR = this.findSurfaceY(
        this.headX + radius,
        feet - 64,
        feet + 64,
        true
      );

      if (isNaN(sL)) sL = s0;
      if (isNaN(sR)) sR = s0;

      if (isNaN(s0) || isNaN(sL) || isNaN(sR)) {
        this.onGround = false;
      } else {
        var dx = 2 * radius;
        var dy = sR - sL;

        var length = Math.sqrt(dx * dx + dy * dy);

        var tx = dx / length;
        var ty = dy / length;

        var vAlong =
          this.headVX * tx +
          this.headVY * ty;

        var slopeAcc =
          K.GRAVITY * ty * K.SLOPE_GRAV_SCALE;

        if (
          move !== 0 &&
          sign(move) * sign(slopeAcc) < 0
        ) {
          slopeAcc *= 0.18;
        }

        vAlong += slopeAcc * dt;

        if (move !== 0) {
          var acc =
            sign(move) * sign(vAlong) < 0 &&
            Math.abs(vAlong) > 20
              ? K.GROUND_DECEL
              : K.GROUND_ACCEL;

          vAlong += acc * move * dt;

          if (ty < -0.025 && move > 0) {
            vAlong += K.UPHILL_ASSIST * dt;
          }

          if (ty > 0.025 && move < 0) {
            vAlong +=
              (K.FAITHFUL_LEFT_UPHILL_QUIRK ? 1 : -1) *
              K.UPHILL_ASSIST * dt;
          }

        } else {
          vAlong *= Math.exp(-K.GROUND_FRICT * dt);
        }

        vAlong = Math.max(
          -K.MAX_RUN_SPEED,
          Math.min(K.MAX_RUN_SPEED, vAlong)
        );

        this.headVX = vAlong * tx;
        this.headVY = vAlong * ty;
      }
    }

    /* Air movement. */
    if (!this.onGround) {
      if (!jumped) {
        this.headVY += K.GRAVITY * dt;
      }

      if (this.headVY > K.MAX_FALL) {
        this.headVY = K.MAX_FALL;
      }

      if (move !== 0) {
        this.headVX += K.AIR_ACCEL * move * dt;

        this.headVX = Math.max(
          -K.MAX_RUN_SPEED,
          Math.min(K.MAX_RUN_SPEED, this.headVX)
        );
      } else {
        this.headVX *= Math.exp(-K.AIR_DRAG * dt);
      }
    }

    /* Integrate movement and resolve collisions. */
    this.headX += this.headVX * dt;

    this.resolveX();

    this.headY += this.headVY * dt;

    this.onGround = false;

    this.resolveY();
    this.stickToSurface(dt);

    if (!this.wasGrounded && this.onGround) {
      this.events.push('land');
    }

    /* Rolling animation. */
    var speed = Math.sqrt(
      this.headVX * this.headVX +
      this.headVY * this.headVY
    );

    this.rollAngle +=
      (speed * dt / this.headRadius * 57.29578) *
      (this.headVX >= 0 ? 1 : -1);

    var lerp = Math.min(1, 32 * dt);

    this.headDrawX +=
      (this.headX - this.headDrawX) * lerp;

    this.headDrawY +=
      (this.headY - this.headDrawY) * lerp;

    this.rollDraw +=
      (this.rollAngle - this.rollDraw) * lerp;

    /* World boundaries. */
    var maxX = this.cols * K.TILE;

    if (this.headX - this.headRadius < 0) {
      this.headX = this.headRadius;
      this.headVX = 0;
    }

    if (this.headX > maxX - this.headRadius) {
      this.headX = maxX - this.headRadius;
      this.headVX = 0;
    }

    if (this.headY > this.rows * K.TILE + 300) {
      this.events.push('death');
      this.respawn();
    }

    /* Coins. */
    var coinRadius = this.headRadius + 24;
    var coinRadius2 = coinRadius * coinRadius;

    for (var i = 0; i < this.coins.length; i++) {
      var coin = this.coins[i];

      if (coin.collected) continue;

      var ddx = this.headX - coin.x;
      var ddy = this.headY - coin.y;

      if (ddx * ddx + ddy * ddy < coinRadius2) {
        coin.collected = true;
        this.coinsCollected++;

        this.events.push('coin');

        this.flyingCoins.push({
          wx: coin.x,
          wy: coin.y,
          progress: 0,
          alpha: 1
        });
      }
    }

    for (var j = this.flyingCoins.length - 1; j >= 0; j--) {
      var flying = this.flyingCoins[j];

      flying.progress += dt * 1.6;
      flying.alpha = 1 - flying.progress;

      if (flying.progress >= 1) {
        this.flyingCoins.splice(j, 1);
      }
    }

    this.updateCamera(dt);

    /* Level completion. */
    if (!this.levelComplete) {
      var fx = this.headX - this.flagOrangeX;
      var fy = this.headY - this.flagOrangeY;
      var finishRadius = this.headRadius + 50;

      if (
        fx * fx + fy * fy <
        finishRadius * finishRadius
      ) {
        this.levelComplete = true;
        this.camState = K.CAM_OUTRO;
        this.events.push('checkpoint');
      }
    }
  };

  /* Frame-rate-independent update. */
  P.update = function (dtMs) {
    if (this.paused) {
      this.physicsAccumulator = 0;
      return;
    }

    dtMs = Math.max(
      0,
      Math.min(dtMs, K.MAX_FRAME_TIME)
    );

    this.physicsAccumulator += dtMs;

    var step = K.PHYSICS_STEP;
    var steps = 0;

    while (
      this.physicsAccumulator >= step &&
      steps < K.MAX_SUBSTEPS
    ) {
      this.step(step);

      this.physicsAccumulator -= step;
      steps++;

      if (this.paused) {
        this.physicsAccumulator = 0;
        break;
      }
    }

    // Prevent an excessive backlog after a long frame.
    if (steps >= K.MAX_SUBSTEPS) {
      this.physicsAccumulator = 0;
    }

    var alpha = this.physicsAccumulator / K.PHYSICS_STEP;

    this.renderHeadX =
      this.prevHeadX + (this.headX - this.prevHeadX) * alpha;

    this.renderHeadY =
      this.prevHeadY + (this.headY - this.prevHeadY) * alpha;

    this.renderRoll =
      this.prevRollDraw + (this.rollDraw - this.prevRollDraw) * alpha;
  };

  DS2.K = K;
  DS2.World = World;

  if (typeof module !== 'undefined') {
    module.exports = {
      K: K,
      World: World
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
