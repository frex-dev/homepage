/* Canvas rendering for gameplay: tile layers, flags, coins, head, HUD, controls, overlays.
   Mirrors GamePlay.draw() from the original. The collision layer is never drawn. */
(function (root) {
  'use strict';
  var DS2 = root.DS2 = root.DS2 || {};

  function tileSource(level, gid) {
    var sets = level.tilesets;
    for (var i = sets.length - 1; i >= 0; i--) {
      var d = sets[i];
      if (gid < d.firstGid || !d.image) continue;
      var idx = gid - d.firstGid, cols = Math.max(1, d.columns);
      var sx = d.margin + (idx % cols) * (d.tileWidth + d.spacing);
      var sy = d.margin + Math.floor(idx / cols) * (d.tileHeight + d.spacing);
      if (sx + d.tileWidth > d.image.width || sy + d.tileHeight > d.image.height) return null;
      return { img: d.image, sx: sx, sy: sy, w: d.tileWidth, h: d.tileHeight };
    }
    return null;
  }

  function Renderer(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.k = 1;            /* device px per logical px */
    this.W = 1280; this.H = 720;
    this.tileCache = null; this.cacheLevel = null;
    this.rects = { left: null, right: null, jump: null, pause: null, resume: null, restart: null, quit: null };
  }
  var R = Renderer.prototype;

  /* Logical height is fixed at 720 so the on-screen scale matches the original's proportions. */
  R.resize = function (cssW, cssH, dpr) {
    dpr = Math.min(dpr || 1, 2);
    this.canvas.width = Math.max(2, Math.round(cssW * dpr));
    this.canvas.height = Math.max(2, Math.round(cssH * dpr));
    this.k = this.canvas.height / 720;
    this.H = 720; this.W = this.canvas.width / this.k;
  };

  R.zoom = function () { return DS2.K.ZOOM * (this.H / 1080); };

  R.buildCache = function (level) {
    var n = level.cols * level.rows;
    this.tileCache = { fg: new Array(n), bg: new Array(n) };
    for (var i = 0; i < n; i++) {
      if (level.fg[i] > 0) this.tileCache.fg[i] = tileSource(level, level.fg[i]);
      if (level.bg[i] > 0) this.tileCache.bg[i] = tileSource(level, level.bg[i]);
    }
    this.cacheLevel = level;
  };

  R.drawTiles = function (cam, level, layer, cache, alpha, halfW, halfH) {
    var ctx = this.ctx, cols = level.cols, rows = level.rows;
    var c0 = Math.max(0, Math.floor((cam.x - halfW) / 64)), c1 = Math.min(cols - 1, Math.floor((cam.x + halfW) / 64) + 1);
    var r0 = Math.max(0, Math.floor((cam.y - halfH) / 64)), r1 = Math.min(rows - 1, Math.floor((cam.y + halfH) / 64) + 1);
    ctx.globalAlpha = alpha / 255;
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var t = cache[r * cols + c];
      if (t) ctx.drawImage(t.img, t.sx, t.sy, t.w, t.h, c * 64, r * 64, 64.5, 64.5); /* +0.5 hides sub-pixel seams */
    }
    ctx.globalAlpha = 1;
  };

  R.drawWorld = function (world, level, assets, headImg, now) {
    var ctx = this.ctx, W = this.W, H = this.H, k = this.k, z = this.zoom();
    if (this.cacheLevel !== level) this.buildCache(level);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (level.background) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.drawImage(level.background, 0, 0, W, H);
    } else { ctx.fillStyle = 'rgb(30,30,50)'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }

    world.screenW = W; world.screenH = H; world.zoom = z;
    var halfW = W / (2 * z), halfH = H / (2 * z);
    var ox = Math.round((halfW - world.camX) * z * k), oy = Math.round((halfH - world.camY) * z * k);
    ctx.setTransform(z * k, 0, 0, z * k, ox, oy);
    var cam = { x: world.camX, y: world.camY };
    this.drawTiles(cam, level, 'bg', this.tileCache.bg, 130, halfW, halfH);
    this.drawTiles(cam, level, 'fg', this.tileCache.fg, 255, halfW, halfH);

    var fb = assets.flagBlue, fo = assets.flagOrange;
    if (fb) { var wb = 96 * fb.width / fb.height; ctx.drawImage(fb, world.flagBlueX - wb / 2, world.flagBlueY - 96, wb, 96); }
    if (fo) { var wo = 96 * fo.width / fo.height; ctx.drawImage(fo, world.flagOrangeX - wo / 2, world.flagOrangeY - 96, wo, 96); }

    if (assets.coin) {
      var tt = now / 1200;
      world.coins.forEach(function (c) {
        if (c.collected) return;
        ctx.drawImage(assets.coin, c.x - 22, c.y - 22 + Math.sin(tt + c.bob) * 5, 44, 44);
      });
    }

    ctx.save();
    ctx.translate(world.headDrawX, world.headDrawY);
    ctx.rotate(world.rollDraw * Math.PI / 180);
    ctx.beginPath(); ctx.arc(0, 0, world.headRadius, 0, Math.PI * 2); ctx.closePath();
    if (headImg) {
      ctx.clip();
      var sc = (world.headRadius * 2) / Math.min(headImg.width, headImg.height);
      var w = headImg.width * sc, h = headImg.height * sc;
      ctx.drawImage(headImg, -w / 2, -h / 2, w, h);
    } else { ctx.fillStyle = '#fff'; ctx.fill(); }
    ctx.restore();

    ctx.setTransform(k, 0, 0, k, 0, 0);
    this.drawHUD(world, assets, z, halfW, halfH);
    this.drawControls(world, assets);
    this.drawPauseButton();
    if (world.levelComplete) this.drawLevelComplete(world);
    if (world.paused) this.drawPauseOverlay();
  };

  R.drawHUD = function (world, assets, z, halfW, halfH) {
    var ctx = this.ctx, W = this.W, H = this.H, size = H * 0.07, x = 24, y = 20;
    if (assets.coin) ctx.drawImage(assets.coin, x, y, size, size);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = Math.round(size * 0.75) + 'px digitalax, grobold, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillText(String(world.coinsCollected), x + size + 12, y + size * 0.78);
    ctx.shadowColor = 'transparent';
    var iconX = x + size / 2, iconY = y + size / 2;
    world.flyingCoins.forEach(function (f) {
      var p = f.progress, e = p * p * (3 - 2 * p);
      var sx = (f.wx - world.camX) * z + W / 2, sy = (f.wy - world.camY) * z + H / 2;
      var cx = sx + (iconX - sx) * e, cy = sy + (iconY - sy) * e, s = size * (1 - p * 0.5);
      ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
      if (assets.coin) ctx.drawImage(assets.coin, cx - s / 2, cy - s / 2, s, s);
    });
    ctx.globalAlpha = 1;
  };

  R.drawCtrlBtn = function (r, img, label, down) {
    var ctx = this.ctx, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.globalAlpha = down ? 0.95 : 0.6;
    if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    else {
      ctx.fillStyle = 'rgba(40,70,140,.8)'; ctx.beginPath(); ctx.arc(cx, cy, r.w / 2, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = (r.h * 0.5) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx, cy);
    }
    ctx.globalAlpha = 1;
  };

  R.drawControls = function (world, assets) {
    var W = this.W, H = this.H, s = Math.min(W, H) * 0.13, m = W * 0.025, b = H * 0.04, gap = W * 0.015;
    this.rects.left = { x: m, y: H - b - s, w: s, h: s };
    this.rects.right = { x: m + s + gap, y: H - b - s, w: s, h: s };
    var js = Math.min(W, H) * 0.15;
    this.rects.jump = { x: W - m - js, y: H - b - js, w: js, h: js };
    this.drawCtrlBtn(this.rects.left, assets.left, '←', world.left);
    this.drawCtrlBtn(this.rects.right, assets.right, '→', world.right);
    this.drawCtrlBtn(this.rects.jump, assets.jump, '↑', world.jumpHeld || world.jumpCooldown > 0);
  };

  R.drawPauseButton = function () {
    var ctx = this.ctx, W = this.W, H = this.H, s = Math.min(W, H) * 0.09, x = W - s - W * 0.02, y = H * 0.02;
    this.rects.pause = { x: x, y: y, w: s, h: s };
    ctx.fillStyle = 'rgba(40,70,140,.78)'; ctx.beginPath(); ctx.ellipse(x + s / 2, y + s / 2, s / 2, s / 2, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgb(130,190,255)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(s * 0.52) + 'px grobold, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3; ctx.fillText('II', x + s / 2, y + s / 2 + s * 0.17); ctx.shadowColor = 'transparent';
  };

  R.drawLevelComplete = function (world) {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.fillStyle = 'rgba(0,0,0,' + (160 / 255) + ')'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ff0'; ctx.font = Math.round(H * 0.09) + 'px grobold, sans-serif';
    ctx.fillText('★ LEVEL CLEAR! ★', W / 2, H * 0.43);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff'; ctx.font = Math.round(H * 0.05) + 'px grobold, sans-serif';
    ctx.fillText('Coins: ' + world.coinsCollected, W / 2, H * 0.56);
  };

  R.drawPauseOverlay = function () {
    var ctx = this.ctx, W = this.W, H = this.H, bw = W * 0.3, bh = H * 0.11, x = (W - bw) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = Math.round(H * 0.08) + 'px grobold, sans-serif'; ctx.fillText('PAUSED', W / 2, H * 0.22);
    var items = [['resume', 'RESUME', 0.34], ['restart', 'RESTART', 0.5], ['quit', 'QUIT', 0.66]], self = this;
    items.forEach(function (it) {
      var r = { x: x, y: H * it[2], w: bw, h: bh }; self.rects[it[0]] = r;
      ctx.fillStyle = 'rgba(40,70,140,.9)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgb(130,190,255)'; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#fff'; ctx.font = Math.round(bh * 0.5) + 'px grobold, sans-serif'; ctx.fillText(it[1], W / 2, r.y + bh / 2);
    });
  };

  DS2.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
