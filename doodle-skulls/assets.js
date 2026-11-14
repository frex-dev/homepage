/* Asset loading, audio and persistence. All paths are relative to index.html
   and point at the already-extracted original folders (assets/textures, assets/levels, ...). */
(function (root) {
  'use strict';
  var DS2 = root.DS2 = root.DS2 || {};
  var BASE = 'assets/';

  var images = {};
  function loadImage(path) {
    if (images[path]) return images[path];
    images[path] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { console.warn('missing image', path); resolve(null); };
      img.src = BASE + path;
    });
    return images[path];
  }

  function loadText(path) {
    return fetch(BASE + path).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.text(); });
  }

  function loadFont(family, path) {
    if (!root.FontFace) return Promise.resolve();
    var f = new FontFace(family, 'url(' + BASE + path + ')');
    return f.load().then(function (ff) { document.fonts.add(ff); }).catch(function () { console.warn('font failed', path); });
  }

  /* ---------- levels ---------- */
  function pad3(n) { return ('000' + n).slice(-3); }
  function bgPath(level) {
    if (level <= 15) return 'textures/bg_new1hd.png';
    if (level <= 30) return 'textures/bg2.png';
    if (level <= 45) return 'textures/bg3.png';
    if (level <= 60) return 'textures/bg4.png';
    return 'textures/ds2_bg.png';
  }
  function basename(p) { return String(p || '').split('/').pop(); }

  function loadTsx(def) {
    var tsxPath = 'levels/' + def.source;
    return loadText(tsxPath).then(function (xml) {
      var t = /<tileset\b[^>]*>/.exec(xml);
      var a = {}, re = /([\w:.-]+)\s*=\s*"([^"]*)"/g, m;
      while ((m = re.exec(t ? t[0] : ''))) a[m[1]] = m[2];
      ['tilewidth:tileWidth', 'tileheight:tileHeight', 'spacing:spacing', 'margin:margin', 'tilecount:tileCount', 'columns:columns'].forEach(function (p) {
        var kv = p.split(':'); if (a[kv[0]] !== undefined) def[kv[1]] = parseInt(a[kv[0]], 10);
      });
      var im = /<image\b[^>]*source="([^"]*)"/.exec(xml);
      if (im) def.imageSource = 'textures/' + basename(im[1]);
    }).catch(function () { /* keep defaults, like the original */ });
  }

  /* Returns Promise<level> ready for DS2.World, with .tileImages resolved. */
  function loadLevel(n) {
    return loadText('levels/level_' + pad3(n) + '.tmx').then(function (xml) {
      return DS2.parseTMX(xml);
    }).catch(function (e) {
      console.warn('level load failed, using fallback map', e);
      return { ok: false };
    }).then(function (parsed) {
      var pending = [];
      if (parsed.ok) parsed.tilesets.forEach(function (d) {
        if (d.source) pending.push(loadTsx(d));
        else if (d.imageSource) d.imageSource = 'textures/' + basename(d.imageSource);
      });
      return Promise.all(pending).then(function () { return parsed; });
    }).then(function (parsed) {
      var level = DS2.buildLevel(parsed);
      level.tilesets.forEach(function (d) { if (!d.imageSource) d.imageSource = 'textures/tile64_new.png'; });
      var ts0 = level.tilesets[0];
      var colP = (DS2.collisionReady && DS2.collisionReady.key === ts0.imageSource) ? DS2.collisionReady.p :
        loadImage('textures/collisionsd.png').then(function (ci) {
          var ok = false;
          if (ci && !/[?&]collision=polygons/.test(root.location ? root.location.search : '')) ok = DS2.Collision.useImage(ci, ts0);
          if (!ok) { DS2.Collision.usePolygons(); console.warn('collisionsd.png unusable - using built-in polygon collision'); }
          else console.log('collision source: collisionsd.png');
        });
      DS2.collisionReady = { key: ts0.imageSource, p: colP };
      return colP.then(function () { return Promise.all(level.tilesets.map(function (d) {
        return loadImage(d.imageSource).then(function (img) { d.image = img; });
      })); }).then(function () { return loadImage(bgPath(n)); }).then(function (bg) { level.background = bg; return level; });
    });
  }

  /* ---------- audio ---------- */
  var Audio_ = {
    ctx: null, buffers: {}, sfxOn: true, musicOn: true, musicVol: 0.5, music: null, unlocked: false,
    init: function () {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (AC && !this.ctx) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } }
    },
    loadSfx: function (name) {
      var self = this, key = name;
      if (!this.ctx) return Promise.resolve();
      return fetch(BASE + 'textures/' + name + '.wav').then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
        return new Promise(function (res, rej) { self.ctx.decodeAudioData(ab, res, rej); });
      }).then(function (buf) { self.buffers[key] = buf; }).catch(function () { console.warn('sfx failed', name); });
    },
    play: function (name) {
      if (!this.sfxOn || !this.ctx || !this.buffers[name]) return;
      try {
        var src = this.ctx.createBufferSource(); src.buffer = this.buffers[name];
        src.connect(this.ctx.destination); src.start(0);
      } catch (e) { /* ignore */ }
    },
    playDeath: function () { this.play('death' + (1 + Math.floor(Math.random() * 5))); },
    startMusic: function () {
      if (!this.music) {
        this.music = new root.Audio(BASE + 'wellerman.mp3'); this.music.loop = true; this.music.preload = 'auto';
      }
      this.applyMusic();
    },
    applyMusic: function () {
      if (!this.music) return;
      this.music.volume = Math.max(0, Math.min(1, this.musicVol));
      if (this.musicOn && this.unlocked) { var p = this.music.play(); if (p && p.catch) p.catch(function () {}); }
      else this.music.pause();
    },
    unlock: function () {
      if (this.unlocked) return;
      this.unlocked = true;
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      this.startMusic();
    }
  };

  /* ---------- persistence (same keys as the Android SharedPreferences) ---------- */
  var Store = {
    get: function (k, d) { try { var v = localStorage.getItem('ds2.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('ds2.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  DS2.Assets = { loadImage: loadImage, loadText: loadText, loadFont: loadFont, loadLevel: loadLevel, bgPath: bgPath };
  DS2.Audio = Audio_;
  DS2.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
