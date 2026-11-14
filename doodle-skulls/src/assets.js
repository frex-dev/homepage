
/* Asset loading, audio and persistence.
   All paths are relative to index.html and point at the extracted
   original folders (assets/textures, assets/levels, ...).
*/
(function (root) {
  'use strict';

  var DS2 = root.DS2 = root.DS2 || {};
  var BASE = 'assets/';

  var images = Object.create(null);

  function loadImage(path) {
    if (images[path]) return images[path];

    images[path] = new Promise(function (resolve) {
      var img = new Image();

      img.onload = function () {
        resolve(img);
      };

      img.onerror = function () {
        console.warn('[DS2] Missing image:', path);
        resolve(null);
      };

      img.src = BASE + path;
    });

    return images[path];
  }

  function loadText(path) {
    return fetch(BASE + path).then(function (response) {
      if (!response.ok) {
        throw new Error(path + ' HTTP ' + response.status);
      }

      return response.text();
    });
  }

  function loadFont(family, path) {
    if (!root.FontFace) return Promise.resolve();

    var font = new FontFace(
      family,
      'url(' + BASE + path + ')'
    );

    return font.load().then(function (loadedFont) {
      document.fonts.add(loadedFont);
    }).catch(function () {
      console.warn('[DS2] Font failed to load:', path);
    });
  }

  /* ---------- levels ---------- */

  function pad3(n) {
    return ('000' + n).slice(-3);
  }

  function bgPath(level) {
    if (level <= 15) return 'textures/bg_new1hd.png';
    if (level <= 30) return 'textures/bg2.png';
    if (level <= 45) return 'textures/bg3.png';
    if (level <= 60) return 'textures/bg4.png';

    return 'textures/ds2_bg.png';
  }

  function basename(path) {
    return String(path || '').split('/').pop();
  }

  function loadTsx(def) {
    var tsxPath = 'levels/' + def.source;

    return loadText(tsxPath).then(function (xml) {
      var tilesetTag = /<tileset\b[^>]*>/.exec(xml);
      var attributes = {};
      var attributeRegex = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
      var match;

      while ((match = attributeRegex.exec(
        tilesetTag ? tilesetTag[0] : ''
      ))) {
        attributes[match[1]] = match[2];
      }

      [
        'tilewidth:tileWidth',
        'tileheight:tileHeight',
        'spacing:spacing',
        'margin:margin',
        'tilecount:tileCount',
        'columns:columns'
      ].forEach(function (pair) {
        var keys = pair.split(':');

        if (attributes[keys[0]] !== undefined) {
          def[keys[1]] = parseInt(attributes[keys[0]], 10);
        }
      });

      var imageTag = /<image\b[^>]*source="([^"]*)"/.exec(xml);

      if (imageTag) {
        def.imageSource = 'textures/' + basename(imageTag[1]);
      }
    }).catch(function (error) {
      console.warn(
        '[DS2] Could not load tileset definition:',
        tsxPath,
        error
      );

      throw error;
    });
  }

  /*
   * Collision image is independent of the visual tileset.
   * It has its own fixed grid and must never use visual tileset metadata.
   *
   * The promise is shared between levels so the image is processed once.
   */
  function loadCollisionData() {
    if (DS2.collisionReady) {
      return DS2.collisionReady;
    }

    if (!DS2.Collision) {
      return Promise.reject(
        new Error('DS2.Collision is not available.')
      );
    }

    DS2.collisionReady = loadImage(
      'textures/collisionsd.png'
    ).then(function (image) {
      if (!image) {
        throw new Error(
          'Required collision image is missing: ' +
          'assets/textures/collisionsd.png'
        );
      }

      // Collision.useImage uses its own fixed 992x992 tileset grid.
      DS2.Collision.useImage(image);

      if (DS2.Collision.getSource() !== 'collisionsd.png') {
        throw new Error(
          'Collision image did not become the active collision source.'
        );
      }

      return true;
    }).catch(function (error) {
      // Do not silently switch to another collision source.
      DS2.collisionReady = null;

      console.error(
        '[DS2] CRITICAL: collision data could not be loaded.',
        error
      );

      throw error;
    });

    return DS2.collisionReady;
  }

  /*
   * Returns Promise<level> ready for DS2.World.
   * Collision data must load successfully before the level is returned.
   */
  function loadLevel(n) {
    return loadText(
      'levels/level_' + pad3(n) + '.tmx'
    ).then(function (xml) {
      return DS2.parseTMX(xml);
    }).catch(function (error) {
      console.warn(
        '[DS2] Level file failed to load:',
        error
      );

      return { ok: false };
    }).then(function (parsed) {
      var pending = [];

      if (parsed.ok) {
        parsed.tilesets.forEach(function (tileset) {
          if (tileset.source) {
            pending.push(loadTsx(tileset));
          } else if (tileset.imageSource) {
            tileset.imageSource =
              'textures/' + basename(tileset.imageSource);
          }
        });
      }

      return Promise.all(pending).then(function () {
        return parsed;
      });
    }).then(function (parsed) {
      var level = DS2.buildLevel(parsed);

      level.tilesets.forEach(function (tileset) {
        if (!tileset.imageSource) {
          tileset.imageSource = 'textures/tile64_new.png';
        }
      });

      // Load collision data before allowing the level to finish loading.
      return loadCollisionData().then(function () {
        return Promise.all(
          level.tilesets.map(function (tileset) {
            return loadImage(tileset.imageSource).then(function (image) {
              if (!image) {
                throw new Error(
                  'Required tileset image missing: ' +
                  tileset.imageSource
                );
              }

              tileset.image = image;
            });
          })
        );
      }).then(function () {
        return loadImage(bgPath(n));
      }).then(function (background) {
        if (!background) {
          console.warn(
            '[DS2] Background failed to load:',
            bgPath(n)
          );
        }

        level.background = background;
        return level;
      });
    });
  }

  /* ---------- audio ---------- */

  var Audio_ = {
    ctx: null,
    buffers: {},
    sfxOn: true,
    musicOn: true,
    musicVol: 0.5,
    music: null,
    unlocked: false,

    init: function () {
      var AudioContextClass =
        root.AudioContext || root.webkitAudioContext;

      if (AudioContextClass && !this.ctx) {
        try {
          this.ctx = new AudioContextClass();
        } catch (error) {
          this.ctx = null;
        }
      }

      this.loadMusic();
    },

    loadSfx: function (name) {
      var self = this;

      if (!this.ctx) return Promise.resolve();

      return fetch(BASE + 'textures/' + name + '.wav')
        .then(function (response) {
          if (!response.ok) {
            throw new Error(name + '.wav HTTP ' + response.status);
          }

          return response.arrayBuffer();
        })
        .then(function (arrayBuffer) {
          return new Promise(function (resolve, reject) {
            self.ctx.decodeAudioData(
              arrayBuffer,
              resolve,
              reject
            );
          });
        })
        .then(function (buffer) {
          self.buffers[name] = buffer;
        })
        .catch(function () {
          console.warn('[DS2] Sound effect failed:', name);
        });
    },

    play: function (name) {
      if (!this.sfxOn || !this.ctx || !this.buffers[name]) {
        return;
      }

      try {
        var source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        source.connect(this.ctx.destination);
        source.start(0);
      } catch (error) {
        // Ignore playback errors.
      }
    },

    playDeath: function () {
      this.play('death' + (1 + Math.floor(Math.random() * 5)));
    },

    loadMusic: function () {
      var self = this;

      if (!this.ctx || this.musicLoading) return;

      this.musicLoading = true;

      fetch(BASE + 'wellerman.mp3')
        .then(function (response) {
          if (!response.ok) {
            throw new Error(
              'wellerman.mp3 HTTP ' + response.status
            );
          }

          return response.arrayBuffer();
        })
        .then(function (arrayBuffer) {
          return new Promise(function (resolve, reject) {
            self.ctx.decodeAudioData(
              arrayBuffer,
              resolve,
              reject
            );
          });
        })
        .then(function (buffer) {
          self.musicBuf = buffer;
          self.applyMusic();
        })
        .catch(function (error) {
          console.warn(
            '[DS2] Music (WebAudio) failed:',
            error
          );

          self.useElement = true;
          self.applyMusic();
        });
    },

    startMusic: function () {
      this.applyMusic();
    },

    applyMusic: function () {
      var volume = Math.max(
        0,
        Math.min(1, this.musicVol)
      );

      var shouldPlay = this.musicOn && this.unlocked;

      if (this.musicBuf && this.ctx) {
        if (!this.gain) {
          this.gain = this.ctx.createGain();
          this.gain.connect(this.ctx.destination);
        }

        this.gain.gain.value = volume;

        if (shouldPlay && !this.musicSrc) {
          var source = this.ctx.createBufferSource();

          source.buffer = this.musicBuf;
          source.loop = true;
          source.connect(this.gain);
          source.start(0);

          this.musicSrc = source;
        } else if (!shouldPlay && this.musicSrc) {
          try {
            this.musicSrc.stop();
          } catch (error) {
            // Already stopped.
          }

          this.musicSrc = null;
        }

        return;
      }

      if (this.useElement || !this.ctx) {
        if (!this.music) {
          this.music = new root.Audio(BASE + 'wellerman.mp3');
          this.music.loop = true;
          this.music.preload = 'auto';
        }

        this.music.volume = volume;

        if (shouldPlay) {
          var playback = this.music.play();

          if (playback && playback.catch) {
            playback.catch(function (error) {
              console.warn(
                '[DS2] Music element failed:',
                error
              );
            });
          }
        } else {
          this.music.pause();
        }
      }
    },

    unlock: function () {
      if (this.unlocked) return;

      this.unlocked = true;

      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this.applyMusic();
    }
  };

  /* ---------- persistence ---------- */

  var Store = {
    get: function (key, defaultValue) {
      try {
        var value = localStorage.getItem('ds2.' + key);

        return value === null
          ? defaultValue
          : JSON.parse(value);
      } catch (error) {
        return defaultValue;
      }
    },

    set: function (key, value) {
      try {
        localStorage.setItem(
          'ds2.' + key,
          JSON.stringify(value)
        );
      } catch (error) {
        // Private mode or storage unavailable.
      }
    }
  };

  DS2.Assets = {
    loadImage: loadImage,
    loadText: loadText,
    loadFont: loadFont,
    loadLevel: loadLevel,
    bgPath: bgPath
  };

  DS2.Audio = Audio_;
  DS2.Store = Store;

})(typeof window !== 'undefined' ? window : globalThis);
