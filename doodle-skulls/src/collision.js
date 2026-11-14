
/* Collision system: strictly uses collisionsd.png.
 *
 * Collision tileset:
 * firstgid = 1
 * image = 992x992
 * tile size = 64x64
 * columns = 15
 * tile count = 225
 * margin = 2
 * spacing = 2
 *
 * No polygon data or fallback is used.
 */
(function (root) {
  'use strict';

  var T = 64;

  var CONFIG = {
    firstgid: 1,
    tileWidth: 64,
    tileHeight: 64,
    columns: 15,
    tileCount: 225,
    margin: 2,
    spacing: 2,
    imageWidth: 992,
    imageHeight: 992
  };

  var heightMap = {};
  var hasColl = {};
  var source = 'unloaded';

  function reset() {
    heightMap = {};
    hasColl = {};
    source = 'unloaded';
  }

  function useImageData(rgba, w, h) {
    reset();

    if (!rgba || w !== CONFIG.imageWidth ||
        h !== CONFIG.imageHeight ||
        rgba.length !== w * h * 4) {
      throw new Error(
        'Invalid collisionsd.png. Expected 992x992 RGBA image.'
      );
    }

    var hasAlpha = false;

    for (var i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 255) {
        hasAlpha = true;
        break;
      }
    }

    function solid(x, y) {
      var offset = (y * w + x) * 4;
      var alpha = rgba[offset + 3];

      if (hasAlpha) {
        return alpha > 127;
      }

      var brightness =
        (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3;

      return alpha > 127 && brightness > 127;
    }

    var columns = CONFIG.columns;
    var tw = CONFIG.tileWidth;
    var th = CONFIG.tileHeight;
    var margin = CONFIG.margin;
    var spacing = CONFIG.spacing;

    for (var id = 0; id < CONFIG.tileCount; id++) {
      var sx = margin + (id % columns) * (tw + spacing);
      var sy = margin + Math.floor(id / columns) * (th + spacing);

      if (sx + tw > w || sy + th > h) {
        throw new Error('Collision tile outside image bounds: ' + id);
      }

      var heights = new Int32Array(T);
      var has = false;

      for (var c = 0; c < T; c++) {
        heights[c] = T;

        var px = sx + c;

        for (var r = 0; r < T; r++) {
          var py = sy + r;

          if (solid(px, py)) {
            heights[c] = r;
            has = true;
            break;
          }
        }
      }

      if (has) {
        heightMap[id] = heights;
        hasColl[id] = true;
      }
    }

    source = 'collisionsd.png';

    console.log(
      '[DS2] Collision source: collisionsd.png',
      '| Tiles:', CONFIG.tileCount,
      '| Image:', w + 'x' + h
    );

    return true;
  }

  function useImage(img) {
    reset();

    if (!img ||
        img.width !== CONFIG.imageWidth ||
        img.height !== CONFIG.imageHeight) {
      throw new Error(
        'collisionsd.png missing or invalid. Expected 992x992.'
      );
    }

    try {
      var canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      var ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not create collision canvas context.');
      }

      ctx.drawImage(img, 0, 0);

      var imageData = ctx.getImageData(
        0, 0, img.width, img.height
      );

      return useImageData(
        imageData.data,
        img.width,
        img.height
      );
    } catch (error) {
      reset();
      throw new Error(
        'Failed to load collision data from collisionsd.png: ' +
        error.message
      );
    }
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  var Collision = {
    CONFIG: CONFIG,

    useImage: useImage,
    useImageData: useImageData,

    getSource: function () {
      return source;
    },

    hasCollision: function (id) {
      return hasColl[id] === true;
    },

    getSurfaceRow: function (id, x) {
      var heights = heightMap[id];

      if (!heights) return T;

      return heights[clamp(x, 0, T - 1)];
    },

    isSolid: function (id, x, y) {
      var heights = heightMap[id];

      if (!heights) return false;

      var surface = heights[clamp(x, 0, T - 1)];

      return y >= surface && surface < T;
    }
  };

  root.DS2 = root.DS2 || {};
  root.DS2.Collision = Collision;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Collision;
  }

})(typeof window !== 'undefined' ? window : globalThis);
