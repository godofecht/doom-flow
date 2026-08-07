/* DOOM.FLOW pages — loads WASM modules for Play / Watch AI / RL Arena. */
(function () {
  var canvas = document.getElementById("canvas");
  var overlay = document.getElementById("overlay");
  var overlayCopy = document.getElementById("overlay-copy");
  var startBtn = document.getElementById("start");
  var stopBtn = document.getElementById("stop");
  var statusEl = document.getElementById("status");
  var modeLabel = document.getElementById("mode-label");
  var hint = document.getElementById("hint");
  var out = document.getElementById("out");
  var modeBtns = document.querySelectorAll(".mode");

  var mode = "play";
  var started = false;
  var loadingScript = null;
  var activeModule = null;

  var MODES = {
    play: {
      label: "PLAY",
      script: "wasm/doom/doom.js",
      assetDir: "wasm/doom/",
      canvasW: 640,
      canvasH: 400,
      copy: "Flow source → C backend → Emscripten. Click to boot the shareware episode.",
      hint: "Arrows / WASD · X fire · E use · Esc menu",
      env: {}
    },
    ai: {
      label: "WATCH AI",
      script: "wasm/doom/doom.js",
      assetDir: "wasm/doom/",
      canvasW: 640,
      canvasH: 400,
      copy: "A Flow pilot opens a new game and takes the stick. Sit back.",
      hint: "DOOMFLOW_AI pilot · menu boot · open-loop combat",
      env: { DOOMFLOW_AI: "1" }
    },
    arena: {
      label: "RL ARENA",
      script: "wasm/ai/ai.js",
      assetDir: "wasm/ai/",
      canvasW: 368,
      canvasH: 400,
      copy: "Tabular Q-learning trains in-page, then the greedy policy clears the room.",
      hint: "stdlib/ai.flow · amber marine · rust imp · green HP",
      env: {}
    }
  };

  // Pages lives at /doom-flow/; wasm bundles are under site/wasm/...
  // Dynamic <script> loads break emscripten's default scriptDirectory, so
  // locateFile must point at the module folder for .wasm / .data.
  function assetUrl(dir, path) {
    var base = dir || "";
    if (path.indexOf("://") >= 0 || path.charAt(0) === "/") return path;
    return base + path;
  }

  function log(text, isErr) {
    out.hidden = false;
    var line = document.createElement("span");
    if (isErr) line.className = "err";
    line.textContent = text + "\n";
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function applyMode(next) {
    if (started) {
      if (window.flowGfxStop) window.flowGfxStop();
      started = false;
      stopBtn.disabled = true;
      overlay.classList.remove("hidden");
      setStatus("ready");
    }
    mode = next;
    var cfg = MODES[mode];
    modeLabel.textContent = cfg.label;
    overlayCopy.textContent = cfg.copy;
    hint.textContent = cfg.hint;
    canvas.width = cfg.canvasW;
    canvas.height = cfg.canvasH;
    modeBtns.forEach(function (btn) {
      var on = btn.getAttribute("data-mode") === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    var url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    history.replaceState(null, "", url);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (loadingScript === src && window.createFlowModule) {
        resolve();
        return;
      }
      // Drop previous module factory if switching between doom/ai bundles.
      window.createFlowModule = undefined;
      var old = document.querySelector('script[data-flow-wasm]');
      if (old) old.remove();
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.flowWasm = "1";
      s.onload = function () {
        loadingScript = src;
        resolve();
      };
      s.onerror = function () {
        reject(new Error("failed to load " + src));
      };
      document.body.appendChild(s);
    });
  }

  function boot() {
    if (started) return;
    started = true;
    overlay.classList.add("hidden");
    setStatus("loading");
    window.focus();

    var cfg = MODES[mode];
    loadScript(cfg.script)
      .then(function () {
        if (typeof createFlowModule !== "function") {
          throw new Error("createFlowModule missing from " + cfg.script);
        }
        return createFlowModule({
          canvas: canvas,
          locateFile: function (path) {
            return assetUrl(cfg.assetDir, path);
          },
          print: function (t) { log(t, false); },
          printErr: function (t) { log(t, true); }
        });
      })
      .then(function (mod) {
        activeModule = mod;
        // getenv() reads Module.ENV on first use — set before callMain.
        if (mod.ENV) {
          Object.keys(cfg.env).forEach(function (k) {
            mod.ENV[k] = cfg.env[k];
          });
          if (mode === "play") {
            delete mod.ENV.DOOMFLOW_AI;
            delete mod.ENV.DOOMFLOW_ARGS;
            delete mod.ENV.DOOMFLOW_KEYSCRIPT;
          }
        }
        stopBtn.disabled = false;
        setStatus("running");
        window.flowGfxOnStart = function (title, w, h) {
          setStatus("running " + w + "×" + h);
        };
        window.flowGfxOnExit = function (frames) {
          setStatus("finished · " + frames + " frames");
          stopBtn.disabled = true;
        };
        try {
          mod.callMain([]);
        } catch (e) {
          if (!(e && e.name === "ExitStatus")) log(String(e), true);
        }
      })
      .catch(function (e) {
        setStatus("failed");
        started = false;
        overlay.classList.remove("hidden");
        log(String(e), true);
      });
  }

  modeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyMode(btn.getAttribute("data-mode"));
    });
  });

  overlay.addEventListener("click", boot);
  startBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    boot();
  });
  stopBtn.addEventListener("click", function () {
    if (window.flowGfxStop) window.flowGfxStop();
    setStatus("stopping");
  });

  document.addEventListener("click", function () { window.focus(); });

  var initial = new URLSearchParams(window.location.search).get("mode") || "play";
  if (!MODES[initial]) initial = "play";
  applyMode(initial);

  if (location.search.indexOf("autostart=1") >= 0) {
    boot();
  }
})();
