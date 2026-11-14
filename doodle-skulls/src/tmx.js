/* TMX parsing. Mirrors GamePlay.parseTMX() from the original game and adds
   (a) csv-encoded layers and (b) generic object list for future map features. */
(function (root) {
  'use strict';
  var DS2 = root.DS2 = root.DS2 || {};

  function attrs(tag) {
    var o = {}, re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(tag))) o[m[1]] = m[3] !== undefined ? m[3] : m[4];
    return o;
  }

  function decodeTileData(text, size) {
    var out = new Int32Array(size);
    try {
      text = text.trim();
      if (text.indexOf(',') >= 0 || /^\d+$/.test(text)) {
        var parts = text.split(',');
        for (var k = 0; k < size && k < parts.length; k++) {
          var gv = parseInt(parts[k], 10) & 0x0fffffff;
          out[k] = gv < 0 ? 0 : gv;
        }
        return out;
      }
      var bytes = DS2.gunzip(DS2.base64ToBytes(text));
      for (var i = 0; i < size && i * 4 + 3 < bytes.length; i++) {
        var v = ((bytes[i * 4 + 3] << 24) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 1] << 8) | bytes[i * 4]) & 0x0fffffff;
        out[i] = v < 0 ? 0 : v;
      }
    } catch (e) { /* original returns an empty array on failure */ }
    return out;
  }

  /* Returns the raw description; tileset sources are resolved by the loader. */
  function parseTMX(xml) {
    var map = { cols: 30, rows: 10, tilesets: [], bg: null, fg: null, objects: [], ok: false };
    var m = /<map\b[^>]*>/.exec(xml);
    if (!m) return map;
    var ma = attrs(m[0]);
    map.cols = parseInt(ma.width, 10); map.rows = parseInt(ma.height, 10);
    var re = /<tileset\b[^>]*?(\/>|>[\s\S]*?<\/tileset>)/g, t;
    while ((t = re.exec(xml))) {
      var ta = attrs(/<tileset\b[^>]*>/.exec(t[0])[0]);
      var def = { firstGid: ta.firstgid ? parseInt(ta.firstgid, 10) : 1, source: ta.source || null,
                  tileWidth: 64, tileHeight: 64, margin: 2, spacing: 2, tileCount: 0, columns: 15, imageSource: null };
      if (!def.source) {
        ['tilewidth','tileheight','spacing','margin','tilecount','columns'].forEach(function (k) {
          var key = { tilewidth:'tileWidth', tileheight:'tileHeight', tilecount:'tileCount' }[k] || k;
          if (ta[k] !== undefined) def[key] = parseInt(ta[k], 10);
        });
        var im = /<image\b[^>]*>/.exec(t[0]);
        if (im) def.imageSource = attrs(im[0]).source;
      }
      map.tilesets.push(def);
    }
    var lre = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/g, l, size = map.cols * map.rows;
    while ((l = lre.exec(xml))) {
      var name = attrs('<x ' + l[1] + '>').name;
      var d = /<data\b[^>]*>([\s\S]*?)<\/data>/.exec(l[2]);
      var arr = decodeTileData(d ? d[1] : '', size);
      if (name === 'tilebg') map.bg = arr; else if (name === 'tile') map.fg = arr;
    }
    var ore = /<object\b[^>]*>/g, o;
    while ((o = ore.exec(xml))) {
      var oa = attrs(o[0]);
      map.objects.push({ name: oa.name || '', type: oa.type || oa.class || '', x: parseFloat(oa.x), y: parseFloat(oa.y),
                         width: parseFloat(oa.width || 0), height: parseFloat(oa.height || 0), gid: oa.gid ? parseInt(oa.gid, 10) : 0 });
    }
    map.ok = true;
    return map;
  }

  /* Builds the level state exactly like the original fallbacks: 30x10 map with
     a floor row (gid 32) when the file is missing/broken, default flag spots. */
  function buildLevel(parsed) {
    var L = { cols: parsed.cols, rows: parsed.rows, bg: parsed.bg, fg: parsed.fg, tilesets: parsed.tilesets,
              flagBlue: { x: 0, y: 0 }, flagOrange: { x: 0, y: 0 }, coins: [], objects: parsed.objects, firstGid: 1 };
    if (!parsed.ok || !(L.cols > 0 && L.rows > 0)) {
      L.cols = 30; L.rows = 10;
      L.bg = new Int32Array(300); L.fg = new Int32Array(300);
      for (var c = 0; c < L.cols; c++) L.fg[(L.rows - 1) * L.cols + c] = 32;
      L.flagBlue = { x: 200, y: 500 }; L.flagOrange = { x: 1700, y: 500 };
      L.tilesets = [];
    } else {
      if (!L.bg) L.bg = new Int32Array(L.cols * L.rows);
      if (!L.fg) L.fg = new Int32Array(L.cols * L.rows);
      parsed.objects.forEach(function (o) {
        if (o.name === 'flagBlue') L.flagBlue = { x: o.x, y: o.y };
        else if (o.name === 'flagOrange') L.flagOrange = { x: o.x, y: o.y };
        else if (o.name === 'coin') L.coins.push({ x: o.x, y: o.y, bob: Math.random() * Math.PI * 2, collected: false });
      });
    }
    if (!L.tilesets.length) {
      L.tilesets.push({ firstGid: 1, tileWidth: 64, tileHeight: 64, margin: 2, spacing: 2, tileCount: 0, columns: 15, imageSource: 'textures/tile64_new.png' });
    }
    L.firstGid = L.tilesets[0].firstGid;
    return L;
  }

  DS2.parseTMX = parseTMX;
  DS2.buildLevel = buildLevel;
  DS2.decodeTileData = decodeTileData;
  if (typeof module !== 'undefined') module.exports = { parseTMX: parseTMX, buildLevel: buildLevel, decodeTileData: decodeTileData };
})(typeof window !== 'undefined' ? window : globalThis);
