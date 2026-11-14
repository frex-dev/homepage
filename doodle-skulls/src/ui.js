/* Menu / level-select / avatar / settings / info screens and game state machine.
   State ids match the original GameView constants. Layouts are an approximation of the
   original screens (the exact pixel layout lives in GameView.draw*, not yet ported 1:1). */
(function (root) {
  'use strict';
  var DS2 = root.DS2 = root.DS2 || {};
  var S = { LOADING: 0, MENU: 1, AVATAR: 2, INFO: 3, SETTINGS: 4, PLAYING: 5, LEVEL_SELECT: 6 };
  var TOTAL_LEVELS = 150, LEVELS_PER_PAGE = 15, HEAD_COUNT = 18;
  var LINKS = { youtube: 'https://www.youtube.com/@fantomxda2', discord: 'https://discord.gg/KbC4EvF45Z' };
  var INFO_LINES = ["Appsomniacs' Doodle Army 2.", 'Built entirely on AIDE — Android IDE.', 'for the original Doodle Skulls series.', 'two classics that defined mobile gaming.'];

  function UI(app) {
    this.app = app; this.state = S.LOADING; this.buttons = [];
    var st = DS2.Store;
    this.coins = st.get('total_coins', 0); this.selectedHead = st.get('selected_head', 0);
    this.playerName = st.get('player_name', 'Player');
    this.unlocked = st.get('unlocked_levels', null);
    if (!this.unlocked || this.unlocked.length !== TOTAL_LEVELS) { this.unlocked = []; for (var i = 0; i < TOTAL_LEVELS; i++) this.unlocked.push(i === 0); }
    this.avatarUnlocked = st.get('avatar_unlocked', null);
    if (!this.avatarUnlocked || this.avatarUnlocked.length !== HEAD_COUNT) { this.avatarUnlocked = []; for (var j = 0; j < HEAD_COUNT; j++) this.avatarUnlocked.push(j === 0); }
    DS2.Audio.musicOn = st.get('music_on', true); DS2.Audio.sfxOn = st.get('sfx_on', true); DS2.Audio.musicVol = st.get('music_vol', 0.5);
    this.page = 0; this.selectedLevel = 1; this.infoScroll = 0; this.loadingStart = Date.now(); this.dragSlider = false;
    this.scale = {};
  }
  var U = UI.prototype;

  U.save = function () {
    var st = DS2.Store, A = DS2.Audio;
    st.set('total_coins', this.coins); st.set('selected_head', this.selectedHead); st.set('player_name', this.playerName);
    st.set('unlocked_levels', this.unlocked); st.set('avatar_unlocked', this.avatarUnlocked);
    st.set('music_on', A.musicOn); st.set('sfx_on', A.sfxOn); st.set('music_vol', A.musicVol);
  };
  U.avatarCost = function (i) {
    if (this.avatarUnlocked[i]) return 0;
    var n = 0; this.avatarUnlocked.forEach(function (u) { if (u) n++; });
    return n * 5;
  };
  U.go = function (s) { if (s === S.AVATAR) this.car = null; this.state = s; DS2.Audio.play('reload'); };

  /* ----- drawing helpers ----- */
  U.btn = function (r, label, cb, opts) {
    opts = opts || {};
    var ctx = this.app.ctx, a = this.app.assets, key = label + r.x + r.y, sc = this.scale[key] || 1;
    var target = (this.pressedKey === key) ? 0.88 : 1;
    sc += (target - sc) * 0.3; this.scale[key] = sc;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, w = r.w * sc, h = r.h * sc;
    var img = opts.small ? a.btnBox : a.btnBig;
    ctx.globalAlpha = opts.disabled ? 0.5 : 1;
    if (img) ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    else { ctx.fillStyle = 'rgb(40,70,140)'; ctx.fillRect(cx - w / 2, cy - h / 2, w, h); }
    ctx.globalAlpha = 1;
    if (label) {
      ctx.fillStyle = opts.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = Math.round(h * (opts.fs || 0.42)) + 'px grobold, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
      ctx.fillText(label, cx, cy); ctx.shadowColor = 'transparent';
    }
    this.buttons.push({ r: r, cb: cb, key: key, disabled: opts.disabled });
  };
  U.icon = function (img, r, cb, key) {
    var ctx = this.app.ctx;
    if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    this.buttons.push({ r: r, cb: cb, key: key || ('i' + r.x + r.y) });
  };
  U.text = function (t, x, y, size, color, align) {
    var ctx = this.app.ctx;
    ctx.fillStyle = color || '#fff'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.font = Math.round(size) + 'px grobold, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillText(t, x, y); ctx.shadowColor = 'transparent';
  };
  U.background = function () {
    var ctx = this.app.ctx, a = this.app.assets, W = this.app.W, H = this.app.H;
    if (a.bg) {
      var s = Math.max(W / a.bg.width, H / a.bg.height), w = a.bg.width * s, h = a.bg.height * s;
      ctx.drawImage(a.bg, (W - w) / 2, (H - h) / 2, w, h);
    } else { ctx.fillStyle = 'rgb(30,30,50)'; ctx.fillRect(0, 0, W, H); }
  };
  U.hud = function () {
    var ctx = this.app.ctx, a = this.app.assets, H = this.app.H, s = H * 0.07;
    if (a.coin) ctx.drawImage(a.coin, 24, 20, s, s);
    this.text(String(this.coins), 24 + s + 12, 20 + s / 2, s * 0.75, '#fff', 'left');
  };
  U.back = function (to) {
    var self = this, a = this.app.assets, s = this.app.H * 0.1;
    this.icon(a.exit, { x: this.app.W - s - 20, y: 20, w: s, h: s }, function () { self.go(to); }, 'back');
  };

  /* ----- screens ----- */
  U.drawLoading = function () {
    var ctx = this.app.ctx, a = this.app.assets, W = this.app.W, H = this.app.H;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (a.loading) { var s = Math.min(W / a.loading.width, H / a.loading.height); ctx.drawImage(a.loading, (W - a.loading.width * s) / 2, (H - a.loading.height * s) / 2, a.loading.width * s, a.loading.height * s); }
    this.text('Loading… ' + Math.round(this.app.loadProgress * 100) + '%', W / 2, H * 0.92, H * 0.04);
  };

  U.drawMenu = function () {
    var self = this, a = this.app.assets, W = this.app.W, H = this.app.H, ctx = this.app.ctx;
    this.background(); this.hud();
    DS2.drawSkull(ctx, a.heads[this.selectedHead], W * 0.25, H * 0.5 + Math.sin(Date.now() / 500) * 6, H * 0.3, 0, Date.now());
    this.text('Doodle Skulls 2', W / 2, H * 0.14, H * 0.11, '#ffe45e');
    this.text(this.playerName, W * 0.25, H * 0.74, H * 0.05);
    this.btn({ x: W * 0.55, y: H * 0.38, w: W * 0.3, h: H * 0.18 }, 'START', function () { self.go(S.LEVEL_SELECT); });
    var s = H * 0.1, y = H - s - 24, x = 24;
    [['cog', S.SETTINGS], ['avatar', S.AVATAR], ['info', S.INFO]].forEach(function (p, i) {
      self.icon(a[p[0]], { x: x + i * (s + 18), y: y, w: s, h: s }, function () { self.go(p[1]); }, p[0]);
    });
    this.icon(a.youtube, { x: W - 3 * (s + 18) - 6, y: y, w: s, h: s }, function () { root.open(LINKS.youtube, '_blank'); }, 'yt');
    this.icon(a.discord, { x: W - 2 * (s + 18) - 6, y: y, w: s, h: s }, function () { root.open(LINKS.discord, '_blank'); }, 'dc');
    this.icon(a.donate, { x: W - 1 * (s + 18) - 6, y: y, w: s, h: s }, function () { /* donate link is not part of the recovered strings */ }, 'dn');
  };

  U.drawLevelSelect = function () {
    var self = this, a = this.app.assets, W = this.app.W, H = this.app.H, ctx = this.app.ctx;
    this.background(); this.hud(); this.back(S.MENU);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(W * 0.08, H * 0.16, W * 0.84, H * 0.66);
    var cols = 5, rows = 3, cw = W * 0.84 / cols, ch = H * 0.66 / rows, size = Math.min(cw, ch) * 0.78;
    for (var i = 0; i < LEVELS_PER_PAGE; i++) {
      var lv = this.page * LEVELS_PER_PAGE + i + 1; if (lv > TOTAL_LEVELS) break;
      var cx = W * 0.08 + (i % cols) * cw + cw / 2, cy = H * 0.16 + Math.floor(i / cols) * ch + ch / 2;
      var r = { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, open = this.unlocked[lv - 1];
      (function (lv, open) {
        self.btn(r, open ? String(lv) : '', function () { if (open) self.startLevel(lv); }, { small: true, fs: 0.5 });
      })(lv, open);
      if (!open && a.locked) ctx.drawImage(a.locked, r.x + size * 0.2, r.y + size * 0.2, size * 0.6, size * 0.6);
    }
    var ay = H * 0.9, as = H * 0.1;
    this.text('Page ' + (this.page + 1) + ' / ' + (TOTAL_LEVELS / LEVELS_PER_PAGE), W / 2, ay, H * 0.045);
    if (this.page > 0) this.icon(this.rot(a.arrow, true), { x: W * 0.3, y: ay - as / 2, w: as, h: as }, function () { self.page--; DS2.Audio.play('reload'); }, 'prev');
    if (this.page < TOTAL_LEVELS / LEVELS_PER_PAGE - 1) this.icon(a.arrow, { x: W * 0.7 - as, y: ay - as / 2, w: as, h: as }, function () { self.page++; DS2.Audio.play('reload'); }, 'next');
  };
  U.rot = function (img, flip) {
    if (!img) return null;
    if (!this._flip) this._flip = {};
    var k = img.src + flip;
    if (!this._flip[k]) {
      var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      var x = c.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(img, 0, 0); this._flip[k] = c;
    }
    return this._flip[k];
  };

  U.dark = function (i) {
    this._dark = this._dark || {};
    var img = this.app.assets.heads[i];
    if (!img) return null;
    if (!this._dark[i]) {
      var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(0,0,0,.62)'; x.fillRect(0, 0, c.width, c.height);
      this._dark[i] = c;
    }
    return this._dark[i];
  };

  U.arrowBtn = function (x, y, s, dir, cb) {
    var ctx = this.app.ctx, a = this.app.assets, r = { x: x - s / 2, y: y - s / 2, w: s, h: s };
    var img = dir > 0 ? a.arrow : this.rot(a.arrow, true);
    var key = 'car' + dir, sc = this.scale[key] || 1;
    sc += ((this.pressedKey === key ? 0.88 : 1) - sc) * 0.3; this.scale[key] = sc;
    if (img) ctx.drawImage(img, x - s * sc / 2, y - s * sc / 2, s * sc, s * sc);
    else { this.text(dir > 0 ? '>' : '<', x, y, s * 0.8); }
    this.buttons.push({ r: r, cb: cb, key: key });
  };

  U.drawAvatar = function () {
    var self = this, a = this.app.assets, W = this.app.W, H = this.app.H, ctx = this.app.ctx, N = HEAD_COUNT;
    this.background(); this.hud(); this.back(S.MENU);
    var now = Date.now(), dt = Math.min(0.05, (this.dt || 16.7) / 1000);
    if (!this.car) this.car = { pos: this.selectedHead, target: this.selectedHead };
    var c = this.car;
    c.pos += (c.target - c.pos) * (1 - Math.exp(-9 * dt));
    if (Math.abs(c.target - c.pos) < 0.002) c.pos = c.target;
    var settled = Math.abs(c.target - c.pos) < 0.08;
    var mod = function (k) { return ((k % N) + N) % N; };
    var size = H * 0.4, gap = W / 2 + size / 2 + 40, cy = H * 0.46, R = size / 2;
    this.text('Choose your skull', W / 2, H * 0.1, H * 0.07);
    for (var k = Math.floor(c.pos) - 1; k <= Math.floor(c.pos) + 2; k++) {
      var d = (k - c.pos) * gap;
      if (Math.abs(d) > W / 2 + size) continue;
      var idx = mod(k), img = this.avatarUnlocked[idx] ? a.heads[idx] : this.dark(idx);
      DS2.drawSkull(ctx, img, W / 2 + d, cy, size, d / R, now);
    }
    var cur = mod(c.target), cost = this.avatarCost(cur), owned = this.avatarUnlocked[cur];
    this.text((cur + 1) + ' / ' + N, W / 2, H * 0.74, H * 0.045);
    var label = owned ? (cur === this.selectedHead ? 'SELECTED' : 'SELECT') : 'BUY  ' + cost;
    var act = function () {
      if (!settled) return;
      if (self.avatarUnlocked[cur]) { self.selectedHead = cur; self.save(); DS2.Audio.play('reload'); }
      else if (self.coins >= cost) { self.coins -= cost; self.avatarUnlocked[cur] = true; self.selectedHead = cur; self.save(); DS2.Audio.play('gotcoin'); }
    };
    this.btn({ x: W / 2 - W * 0.12, y: H * 0.8, w: W * 0.24, h: H * 0.11 }, label, act, { disabled: !settled || (!owned && this.coins < cost) || (owned && cur === this.selectedHead), fs: 0.4 });
    this.buttons.push({ r: { x: W / 2 - size / 2, y: cy - size / 2, w: size, h: size }, cb: act, key: 'carc' });
    var as = H * 0.16;
    this.arrowBtn(W * 0.1, cy, as, -1, function () { c.target += 1; DS2.Audio.play('reload'); });
    this.arrowBtn(W * 0.9, cy, as, 1, function () { c.target -= 1; DS2.Audio.play('reload'); });
  };

  U.drawInfo = function () {
    var W = this.app.W, H = this.app.H, ctx = this.app.ctx;
    this.background(); this.back(S.MENU);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W * 0.15, H * 0.15, W * 0.7, H * 0.7);
    ctx.save(); ctx.beginPath(); ctx.rect(W * 0.15, H * 0.15, W * 0.7, H * 0.7); ctx.clip();
    this.infoScroll += 0.4;
    var y = H * 0.85 - this.infoScroll;
    this.text('Doodle Skulls 2', W / 2, y, H * 0.07, '#ffe45e');
    for (var i = 0; i < INFO_LINES.length; i++) this.text(INFO_LINES[i], W / 2, y + H * 0.12 + i * H * 0.07, H * 0.04);
    if (y + H * 0.5 < H * 0.15) this.infoScroll = 0;
    ctx.restore();
  };

  U.drawSettings = function () {
    var self = this, W = this.app.W, H = this.app.H, ctx = this.app.ctx, A = DS2.Audio;
    this.background(); this.back(S.MENU);
    this.text('Settings', W / 2, H * 0.1, H * 0.08);
    var lx = W * 0.3, rx = W * 0.62, tw = W * 0.1, th = H * 0.07;
    function toggle(label, y, on, cb) {
      self.text(label, lx, y, H * 0.05, '#fff', 'left');
      var r = { x: rx, y: y - th / 2, w: tw, h: th };
      ctx.fillStyle = on ? 'rgb(60,180,80)' : 'rgb(120,120,120)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#fff'; ctx.fillRect(r.x + (on ? tw * 0.5 : 0) + 3, r.y + 3, tw * 0.5 - 6, th - 6);
      self.buttons.push({ r: r, cb: cb, key: label });
    }
    toggle('Music', H * 0.28, A.musicOn, function () { A.musicOn = !A.musicOn; A.applyMusic(); self.save(); });
    toggle('Sound FX', H * 0.4, A.sfxOn, function () { A.sfxOn = !A.sfxOn; self.save(); });
    this.text('Volume', lx, H * 0.52, H * 0.05, '#fff', 'left');
    var tr = { x: rx - W * 0.1, y: H * 0.52 - 8, w: W * 0.2 + tw, h: 16 }; this.sliderTrack = tr;
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
    ctx.fillStyle = '#ffe45e'; ctx.fillRect(tr.x, tr.y, tr.w * A.musicVol, tr.h);
    ctx.beginPath(); ctx.arc(tr.x + tr.w * A.musicVol, tr.y + 8, 14, 0, 7); ctx.fill();
    this.buttons.push({ r: { x: tr.x - 14, y: tr.y - 18, w: tr.w + 28, h: 52 }, key: 'slider', slider: true, cb: function () {} });
    this.btn({ x: W * 0.3, y: H * 0.64, w: W * 0.17, h: H * 0.1 }, 'NAME', function () {
      var n = root.prompt('Player name', self.playerName); if (n && n.trim()) { self.playerName = n.trim().slice(0, 16); self.save(); }
    }, { small: false, fs: 0.4 });
    this.btn({ x: W * 0.53, y: H * 0.64, w: W * 0.17, h: H * 0.1 }, 'RESET', function () {
      if (root.confirm('Reset all progress?')) { self.coins = 0; self.selectedHead = 0; self.unlocked = self.unlocked.map(function (_, i) { return i === 0; }); self.avatarUnlocked = self.avatarUnlocked.map(function (_, i) { return i === 0; }); self.save(); }
    }, { fs: 0.4 });
  };
  U.setSlider = function (x) {
    var tr = this.sliderTrack; if (!tr) return;
    DS2.Audio.musicVol = Math.max(0, Math.min(1, (x - tr.x) / tr.w)); DS2.Audio.applyMusic();
  };

  U.draw = function (dtMs) {
    this.dt = dtMs;
    this.buttons = [];
    switch (this.state) {
      case S.LOADING: this.drawLoading(); break;
      case S.MENU: this.drawMenu(); break;
      case S.LEVEL_SELECT: this.drawLevelSelect(); break;
      case S.AVATAR: this.drawAvatar(); break;
      case S.INFO: this.drawInfo(); break;
      case S.SETTINGS: this.drawSettings(); break;
    }
  };

  U.pointerDown = function (x, y) {
    for (var i = this.buttons.length - 1; i >= 0; i--) {
      var b = this.buttons[i], r = b.r;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && !b.disabled) {
        this.pressedKey = b.key;
        if (b.slider) { this.dragSlider = true; this.setSlider(x); }
        else this.activeButton = b;
        return true;
      }
    }
    return false;
  };
  U.pointerMove = function (x) { if (this.dragSlider) this.setSlider(x); };
  U.pointerUp = function (x, y) {
    if (this.dragSlider) { this.dragSlider = false; this.save(); }
    var b = this.activeButton; this.pressedKey = null; this.activeButton = null;
    if (b) { var r = b.r; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) b.cb(); }
  };

  U.startLevel = function (n) {
    var self = this;
    this.selectedLevel = n; this.state = S.LOADING; this.app.loadProgress = 0.5; this.loadingStart = Date.now();
    DS2.Audio.play('reload');
    DS2.Assets.loadLevel(n).then(function (level) { self.app.beginLevel(level, n, self.selectedHead); self.state = S.PLAYING; });
  };
  U.levelComplete = function (coins) {
    this.coins += coins;
    var n = this.selectedLevel; if (n < TOTAL_LEVELS) this.unlocked[n] = true;
    this.page = Math.floor((Math.min(n + 1, TOTAL_LEVELS) - 1) / LEVELS_PER_PAGE);
    this.save(); this.state = S.LEVEL_SELECT;
  };

  DS2.UI = UI; DS2.STATE = S;
})(typeof window !== 'undefined' ? window : globalThis);
