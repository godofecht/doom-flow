// RL Arena web worker: loads the WASM module and trains independently.
// Communicates weights, activations, and metrics back to the main thread.

let Module = null;
let trained = false;

self.onmessage = function(e) {
    var msg = e.data;
    if (msg.type === "init") {
        importScripts(msg.wasmJs);
        var wasmDir = msg.wasmJs.substring(0, msg.wasmJs.lastIndexOf("/") + 1);
        createRLArenaModule({
            locateFile: function(path) {
                return wasmDir + path;
            }
        }).then(function(M) {
            Module = M;
            Module._rl_init_u32(msg.seed);
            self.postMessage({ type: "ready", seed: msg.seed });
        }).catch(function(err) {
            self.postMessage({ type: "error", error: String(err) });
        });
    } else if (msg.type === "train") {
        if (!Module) return;
        var batch = msg.batch || 50;
        var epsilon = msg.epsilon;
        var lr = msg.lr;
        var gamma = msg.gamma;
        var seed = msg.seed;

        var kills = 0;
        for (var i = 0; i < batch; i++) {
            kills += Module._rl_train_episode_f32_f32_f32_u32(epsilon, lr, gamma, seed + i);
        }

        // Read weights and activations
        var w1 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_w1(), 128);
        var b1 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_b1(), 16);
        var w2 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_w2(), 64);
        var b2 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_b2(), 4);
        var hidden = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_hidden(), 16);
        var output = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_output(), 4);
        var input = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_input(), 8);

        var episode = Module._rl_get_episode();
        var totalKills = Module._rl_get_total_kills();
        var evalRate = Module._rl_get_eval_rate();
        var bestRate = Module._rl_get_best_rate();
        var avgReturn = Module._rl_get_avg_return();
        var loss = Module._rl_get_loss();

        self.postMessage({
            type: "trained",
            seed: msg.seed,
            batch: batch,
            kills: kills,
            episode: episode,
            totalKills: totalKills,
            evalRate: evalRate,
            bestRate: bestRate,
            avgReturn: avgReturn,
            loss: loss,
            weights: {
                w1: new Float32Array(w1),
                b1: new Float32Array(b1),
                w2: new Float32Array(w2),
                b2: new Float32Array(b2)
            },
            activations: {
                input: new Float32Array(input),
                hidden: new Float32Array(hidden),
                output: new Float32Array(output)
            }
        });
    } else if (msg.type === "eval") {
        if (!Module) return;
        var rate = Module._rl_eval_i32(msg.episodes || 50);
        self.postMessage({
            type: "eval",
            seed: msg.seed,
            evalRate: rate,
            bestRate: Module._rl_get_best_rate()
        });
    } else if (msg.type === "getWeights") {
        if (!Module) return;
        var w1 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_w1(), 128);
        var b1 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_b1(), 16);
        var w2 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_w2(), 64);
        var b2 = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_b2(), 4);
        var hidden = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_hidden(), 16);
        var output = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_output(), 4);
        var input = new Float32Array(Module.HEAPF32.buffer, Module._rl_get_input(), 8);
        self.postMessage({
            type: "weights",
            seed: msg.seed,
            weights: {
                w1: new Float32Array(w1),
                b1: new Float32Array(b1),
                w2: new Float32Array(w2),
                b2: new Float32Array(b2)
            },
            activations: {
                input: new Float32Array(input),
                hidden: new Float32Array(hidden),
                output: new Float32Array(output)
            },
            episode: Module._rl_get_episode(),
            evalRate: Module._rl_get_eval_rate(),
            bestRate: Module._rl_get_best_rate()
        });
    }
};
