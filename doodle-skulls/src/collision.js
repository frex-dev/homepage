/* Collision data recovered from the original CollisionData.build().
   Each key is the LOCAL tile id (gid - firstgid); each value is a polygon in
   normalised tile coordinates (x0,y0,x1,y1,...). The original game rasterises
   every polygon into a 64-entry column height table and never reads a PNG. */
(function (root) {
  'use strict';
  var T = 64;
  var POLYGONS = {
    18: [1, 0, 1, 1, 0, 1],
    19: [0, 0, 1, 1, 0, 1],
    21: [0, 0.4746, 1, 0.4824, 1, 1, 0, 1],
    22: [0, 0.4746, 1, 0.4746, 1, 1, 0, 1],
    23: [0.5156, 0, 1, 0, 1, 0.4687, 0.6562, 0.3593],
    24: [0, 0, 1, 0, 1, 1],
    25: [0, 0, 0.4882, 0, 0.3476, 0.3632, 0, 0.5],
    26: [0.664, 0.6289, 1, 0.5234, 1, 1, 0.5078, 0.996],
    27: [0, 0.5078, 0.332, 0.6289, 0.4765, 1, 0, 1],
    28: [0.7109, 0.4609, 1, 0, 1, 1, 0.5234, 1],
    29: [0, 0, 0.2968, 0.4531, 0.4843, 1, 0, 1],
    30: [0, 0.3945, 0.1015, 0.3867, 0.0761, 0.332, 0.1962, 0.1152, 0.352, 0.0654, 0.4943, 0.0795, 0.7589, 0.028, 1, 0.3945, 1, 1, 0, 1],
    31: [0, 0.3945, 1, 0.3945, 1, 1, 0, 1],
    32: [0, 0.3847, 1, 0.4023, 1, 1, 0, 1],
    33: [0, 0.3964, 1, 0.3984, 1, 1, 0, 1],
    34: [0, 0.4023, 1, 0.4042, 1, 1, 0, 1],
    35: [0, 0.4062, 1, 0.4062, 1, 1, 0, 1],
    36: [0, 0.4101, 1, 0.4101, 1, 1, 0, 1],
    37: [0, 0.4433, 0.3476, 0.4404, 0.4589, 0.3256, 0.5107, 0, 1, 0, 1, 1, 0, 1],
    39: [0, 0, 0.4814, 0, 0.517, 0.3115, 0.6503, 0.4199, 1, 0.4511, 1, 1, 0, 1],
    40: [0, 0.4238, 0.4628, 0.4238, 0.5458, 0.5732, 0.5234, 1, 0, 1],
    41: [0, 0.4062, 0.3984, 0, 1, 0, 1, 1, 0, 1],
    42: [0, 0, 0.6132, 0, 1, 0.414, 1, 1, 0, 1],
    43: [1, 0.4062, 1, 1, 0.3906, 1],
    44: [0, 0.414, 0.6093, 1, 0, 1],
    47: [0.3964, 0, 1, 0, 1, 1, 0, 1],
    48: [0, 0, 0.6015, 0, 1, 0.4238, 1, 1, 0, 1],
    49: [1, 0.4238, 1, 1, 0.3847, 1],
    50: [0, 0.4101, 0.6191, 1, 0, 1],
    51: [0, 0.4843, 1, 0.5039, 1, 1, 0, 1],
    52: [0, 0, 1, 0, 1, 1],
    53: [0, 0, 1, 0, 0, 1],
    55: [0.4921, 0, 1, 0, 1, 1, 0.4921, 1],
    56: [0.496, 0, 1, 0, 1, 1, 0.4882, 1],
    57: [0.5039, 0, 1, 0, 1, 1, 0.5039, 1],
    58: [0, 0, 1, 0, 1, 0.4726, 0.457, 0.4335],
    59: [0, 0, 1, 0, 0.8007, 0.25, 0.4257, 0.4863, 0, 0.4882],
    60: [0, 0, 1, 0, 1, 0.4687, 0, 0.4804],
    61: [0, 0, 1, 0, 1, 0.4687, 0, 0.4687],
    62: [0.5234, 0.6679, 1, 0.4609, 1, 1, 0, 1]
  };

  function pointInPolygon(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) &&
          x < (b.x - a.x) * (y - a.y) / (b.y - a.y + 1e-6) + a.x) inside = !inside;
    }
    return inside;
  }

  function rasterise(flat) {
    var pts = [];
    for (var i = 0; i < flat.length / 2; i++) pts.push({ x: flat[2 * i] * T, y: flat[2 * i + 1] * T });
    var heights = new Int32Array(T);
    for (var c = 0; c < T; c++) {
      heights[c] = T;
      for (var r = 0; r < T; r++) {
        if (pointInPolygon(c + 0.5, r + 0.5, pts)) { heights[c] = Math.max(0, r - 1); break; }
      }
    }
    return heights;
  }

  var heightMap = {}, hasColl = {}, source = 'polygons';
  function usePolygons() {
  heightMap = {}; hasColl = {}; source = 'polygons';
  Object.keys(POLYGONS).forEach(function (k) {
    var h = rasterise(POLYGONS[k]);
    heightMap[k] = h;
    var any = false;
    for (var i = 0; i < T; i++) if (h[i] < T) { any = true; break; }
    hasColl[k] = any;
  });
  }
  usePolygons();


  /* Builds per-tile column height tables from collisionsd.png pixel data.
     The sheet must share the visual tileset's grid (margin/spacing/columns). A pixel is solid when
     alpha > 127 (or brightness > 127 if the image has no transparency at all). */
  function useImageData(rgba, w, h, def) {
    var tw = def.tileWidth, th = def.tileHeight, cols = Math.max(1, def.columns), m = def.margin, sp = def.spacing;
    var total = def.tileCount > 0 ? def.tileCount : cols * Math.floor((h - m + sp) / (th + sp));
    var hasAlpha = false, i;
    for (i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { hasAlpha = true; break; }
    function solid(x, y) {
      var o = (y * w + x) * 4;
      if (hasAlpha) return rgba[o + 3] > 127;
      return rgba[o + 3] > 127 && (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3 > 127;
    }
    var hm = {}, hc = {}, any = 0;
    for (var id = 0; id < total; id++) {
      var sx = m + (id % cols) * (tw + sp), sy = m + Math.floor(id / cols) * (th + sp);
      if (sx + tw > w || sy + th > h) continue;
      var arr = new Int32Array(T), has = false;
      for (var c = 0; c < T; c++) {
        arr[c] = T;
        var px = sx + Math.min(tw - 1, Math.floor(c * tw / T));
        for (var r = 0; r < T; r++) {
          if (solid(px, sy + Math.min(th - 1, Math.floor(r * th / T)))) { arr[c] = r; has = true; break; }
        }
      }
      if (has) { hm[id] = arr; hc[id] = true; any++; }
    }
    if (!any) return false;
    heightMap = hm; hasColl = hc; source = 'collisionsd.png';
    return true;
  }

  function useImage(img, def) {
    try {
      var cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      return useImageData(cx.getImageData(0, 0, img.width, img.height).data, img.width, img.height, def);
    } catch (e) { return false; }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var Collision = {
    POLYGONS: POLYGONS,
    usePolygons: usePolygons,
    useImageData: useImageData,
    useImage: useImage,
    getSource: function () { return source; },
    hasCollision: function (id) { return hasColl[id] === true; },
    getSurfaceRow: function (id, x) {
      var h = heightMap[id];
      if (!h) return T;
      return h[clamp(x, 0, T - 1)];
    },
    isSolid: function (id, x, y) {
      var h = heightMap[id];
      if (!h) return false;
      var s = h[clamp(x, 0, T - 1)];
      return y >= s && s < T;
    }
  };
  root.DS2 = root.DS2 || {};
  root.DS2.Collision = Collision;
  if (typeof module !== 'undefined') module.exports = Collision;
})(typeof window !== 'undefined' ? window : globalThis);
