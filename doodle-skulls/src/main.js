/* Boot, main loop and input. */
(function (root) {
  'use strict';
  var DS2 = root.DS2, S = DS2.STATE;

  var canvas = document.getElementById('game');
  var app = { canvas: canvas, ctx: canvas.getContext('2d'), assets: { heads: [] }, W: 1280, H: 720, loadProgress: 0, world: null, level: null };
  var renderer = new DS2.Renderer(canvas);
  var ui = new DS2.UI(app);
  app.ui = ui;
  var keys = {}, pointers = {}, last = performance.now();

  function resize() {
    renderer.resize(root.innerWidth, root.innerHeight, root.devicePixelRatio || 1);
    canvas.style.width = root.innerWidth + 'px'; canvas.style.height = root.innerHeight + 'px';
    app.W = renderer.W; app.H = renderer.H;
  }
  root.addEventListener('resize', resize); resize();

  /* ---------- loading ---------- */
  function loadAll() {
    var A = DS2.Assets, total = 0, done = 0;
    function track(p) { total++; return p.then(function (v) { done++; app.loadProgress = done / total; return v; }); }
    var names = { bg: 'ds2_bg', btnBig: 'b03_big', btnBox: 'b03_box', arrow: 'arrow', cog: 'cog', avatar: 'avatar', info: 'info',
      youtube: 'youtube', discord: 'discord', donate: 'donate', coin: 'coin', exit: 'exit', edit: 'edit', locked: 'locked', loading: 'loading',
      flagBlue: 'flagBlue', flagOrange: 'flagOrange', left: 'leftarrow', right: 'rightarrow', jump: 'jump', mascot: 'characters' };
    var jobs = [];
    Object.keys(names).forEach(function (k) { jobs.push(track(A.loadImage('textures/' + names[k] + '.png').then(function (img) { app.assets[k] = img; }))); });
    for (var i = 0; i < 18; i++) (function (i) { jobs.push(track(A.loadImage('textures/head' + i + '.png').then(function (img) { app.assets.heads[i] = img; }))); })(i);
    jobs.push(track(A.loadFont('grobold', 'fonts/grobold.ttf')));
    jobs.push(track(A.loadFont('digitalax', 'fonts/digitalax.ttf')));
    DS2.Audio.init();
    ['gotcoin', 'checkpoint', 'land', 'reload', 'death1', 'death2', 'death3', 'death4', 'death5'].forEach(function (n) { jobs.push(track(DS2.Audio.loadSfx(n))); });
    return Promise.all(jobs);
  }

  /* ---------- gameplay ---------- */
  app.beginLevel = function (level, n, headIndex) {
    app.level = level; app.levelNumber = n; app.headIndex = headIndex;
    app.world = new DS2.World(level);
    app.world.screenW = renderer.W; app.world.screenH = renderer.H; app.world.zoom = renderer.zoom();
    app.world.updateCamera(0.0001);
  };
  function endPlay(toRestart) {
    if (toRestart) { ui.startLevel(app.levelNumber); return; }
    app.world = null; ui.state = S.LEVEL_SELECT;
  }

  function handleEvents(w) {
    var A = DS2.Audio;
    while (w.events.length) {
      var e = w.events.shift();
      if (e === 'jump' || e === 'land') A.play('land');
      else if (e === 'coin') A.play('gotcoin');
      else if (e === 'checkpoint') A.play('checkpoint');
      else if (e === 'death') A.playDeath();
      else if (e === 'complete') { var c = w.coinsCollected; app.world = null; ui.levelComplete(c); return; }
    }
  }

  function frame(now) {
    var dtMs = Math.min(now - last, 100); last = now;
    var ctx = app.ctx;
    if (ui.state === S.PLAYING && app.world) {
      var w = app.world;
      w.left = !!(keys.ArrowLeft || keys.a || keys.A || pointers.left);
      w.right = !!(keys.ArrowRight || keys.d || keys.D || pointers.right);
      w.update(dtMs);
      if (app.world) handleEvents(w);
      if (app.world) renderer.drawWorld(w, app.level, app.assets, app.assets.heads[app.headIndex], Date.now());
    } else {
      ctx.setTransform(renderer.k, 0, 0, renderer.k, 0, 0);
      ui.draw(dtMs);
    }
    root.requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * renderer.W, y: (e.clientY - r.top) / r.height * renderer.H };
  }
  function inRect(p, r) { return r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  var ownerOf = {};   /* pointerId -> 'left' | 'right' | 'jump' */

  function playDown(e, p) {
    var w = app.world, R = renderer.rects; if (!w) return;
    if (w.paused) {
      if (inRect(p, R.resume)) w.paused = false;
      else if (inRect(p, R.restart)) endPlay(true);
      else if (inRect(p, R.quit)) endPlay(false);
      return;
    }
    if (inRect(p, R.pause)) { w.paused = true; return; }
    if (inRect(p, R.left)) { pointers.left = true; ownerOf[e.pointerId] = 'left'; }
    else if (inRect(p, R.right)) { pointers.right = true; ownerOf[e.pointerId] = 'right'; }
    else if (inRect(p, R.jump)) { w.jumpPressed = true; w.jumpHeld = true; ownerOf[e.pointerId] = 'jump'; }
  }

  canvas.addEventListener('pointerdown', function (e) {
    DS2.Audio.unlock(); e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    var p = pt(e);
    if (ui.state === S.PLAYING) playDown(e, p); else ui.pointerDown(p.x, p.y);
  });
  canvas.addEventListener('pointermove', function (e) { if (ui.state !== S.PLAYING) ui.pointerMove(pt(e).x); });
  function up(e) {
    var p = pt(e), o = ownerOf[e.pointerId];
    if (ui.state === S.PLAYING) {
      if (o === 'left') pointers.left = false; else if (o === 'right') pointers.right = false;
      else if (o === 'jump' && app.world) app.world.jumpHeld = false;
      delete ownerOf[e.pointerId];
    } else ui.pointerUp(p.x, p.y);
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  root.addEventListener('keydown', function (e) {
    DS2.Audio.unlock();
    var w = app.world;
    if (ui.state === S.PLAYING && w) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].indexOf(e.key) >= 0) e.preventDefault();
      if (!e.repeat && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W')) { w.jumpPressed = true; w.jumpHeld = true; }
      if (!e.repeat && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) w.paused = !w.paused;
      if (!e.repeat && (e.key === 'r' || e.key === 'R') && w.paused) endPlay(true);
    } else if (e.key === 'Escape') {
      if (ui.state === S.LEVEL_SELECT || ui.state === S.SETTINGS || ui.state === S.AVATAR || ui.state === S.INFO) ui.go(S.MENU);
    }
    keys[e.key] = true;
  });
  root.addEventListener('keyup', function (e) {
    keys[e.key] = false;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { if (app.world) app.world.jumpHeld = false; }
  });
  root.addEventListener('blur', function () { keys = {}; pointers = {}; if (app.world) app.world.paused = true; });

  /* ---------- start ---------- */
  root.requestAnimationFrame(frame);          /* loading screen starts drawing immediately */
  loadAll().then(function () {
    var wait = Math.max(0, 800 - (Date.now() - ui.loadingStart));
    setTimeout(function () {
      ui.state = S.MENU;
      var q = /[?&]level=(\d+)/.exec((root.location && root.location.search) || '');
      if (q) ui.startLevel(Math.max(1, Math.min(150, parseInt(q[1], 10))));
    }, wait);
  });
  root.DS2.app = app;
})(window);
