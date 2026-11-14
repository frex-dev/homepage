
/* Full pixel collision masks from collisionsd.png.
   No polygon fallback and no heightfield approximation. */
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

  var masks = Object.create(null);
  var hasColl = Object.create(null);
  var source = 'unloaded';

  function reset() {
    masks = Object.create(null);
    hasColl = Object.create(null);
    source = 'unloaded';
  }

  function useImageData(rgba, w, h) {
    reset();

    if (!rgba || w !== 992 || h !== 992 ||
        rgba.length !== w * h * 4) {
      throw new Error('Expected collisionsd.png at 992x992.');
    }

    var hasAlpha = false;

    for (var i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 255) {
        hasAlpha = true;
        break;
      }
    }

    function solid(x, y) {
      var p = (y * w + x) * 4;
      var a = rgba[p + 3];

      if (a <= 127) return false;
      if (hasAlpha) return true;

      return (
        rgba[p] + rgba[p + 1] + rgba[p + 2]
      ) / 3 > 127;
    }

    for (var id = 0; id < CONFIG.tileCount; id++) {
      var sx = CONFIG.margin +
        (id % CONFIG.columns) * (T + CONFIG.spacing);

      var sy = CONFIG.margin +
        Math.floor(id / CONFIG.columns) * (T + CONFIG.spacing);

      if (sx + T > w || sy + T > h) {
        throw new Error('Collision tile outside image: ' + id);
      }

      var mask = new Uint8Array(T * T);
      var found = false;

      for (var y = 0; y < T; y++) {
        for (var x = 0; x < T; x++) {
          if (solid(sx + x, sy + y)) {
            mask[y * T + x] = 1;
            found = true;
          }
        }
      }

      if (found) {
        masks[id] = mask;
        hasColl[id] = true;
      }
    }

    source = 'collisionsd.png';

    console.log(
      '[DS2] Full collision masks loaded:',
      CONFIG.tileCount,
      'tiles'
    );

    return true;
  }

  function useImage(img) {
    reset();

    if (!img || img.width !== 992 || img.height !== 992) {
      throw new Error('Invalid collisionsd.png. Expected 992x992.');
    }

    try {
      var canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      var ctx = canvas.getContext('2d', {
        willReadFrequently: true
      });

      if (!ctx) throw new Error('Canvas context unavailable.');

      ctx.drawImage(img, 0, 0);

      var data = ctx.getImageData(
        0, 0, img.width, img.height
      );

      return useImageData(data.data, img.width, img.height);
    } catch (error) {
      reset();
      throw new Error(
        'Could not read collisionsd.png: ' + error.message
      );
    }
  }

  function validPixel(x, y) {
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 && x < T &&
      y >= 0 && y < T
    );
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

    isSolid: function (id, x, y) {
      var mask = masks[id];

      if (!mask || !validPixel(x, y)) return false;

      return mask[
        Math.floor(y) * T + Math.floor(x)
      ] === 1;
    },

    /* Retained for compatibility with older engine code. */
    getSurfaceRow: function (id, x) {
      var mask = masks[id];

      if (!mask) return T;

      x = Math.max(0, Math.min(T - 1, Math.floor(x)));

      for (var y = 0; y < T; y++) {
        if (mask[y * T + x]) return y;
      }

      return T;
    }
  };

  root.DS2 = root.DS2 || {};
  root.DS2.Collision = Collision;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Collision;
  }
})(typeof window !== 'undefined' ? window : globalThis);
