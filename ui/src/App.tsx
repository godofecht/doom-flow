import { useState, useRef, useEffect, useCallback } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Play, Bot, Brain, ExternalLink, BookOpen, Code2 } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "play" | "ai" | "arena"

interface WorkerInfo {
  worker: Worker
  seed: number
  idx: number
  ready: boolean
  rate: number
  episodes: number
}

interface Weights {
  w1: Float32Array
  b1: Float32Array
  w2: Float32Array
  b2: Float32Array
}

interface Activations {
  input: Float32Array
  hidden: Float32Array
  output: Float32Array
}

// ---------------------------------------------------------------------------
// Doom panel (Play + Watch AI)
// ---------------------------------------------------------------------------

function DoomPanel({ mode }: { mode: "play" | "ai" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState("ready")
  const [started, setStarted] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const startedRef = useRef(false)
  const stopFnRef = useRef<(() => void) | null>(null)
  const scriptRef = useRef<HTMLScriptElement | null>(null)

  const isAI = mode === "ai"

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev.slice(-50), text])
  }, [])

  const boot = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    setStarted(true)
    setStatus("loading")
    window.focus()

    const canvas = canvasRef.current!
    const existing = document.querySelector('script[data-flow-wasm]')
    if (existing) existing.remove()
    ;(window as any).createFlowModule = undefined

    const script = document.createElement("script")
    script.src = "wasm/doom/doom.js"
    script.async = true
    script.dataset.flowWasm = "1"
    scriptRef.current = script

    script.onload = () => {
      const createModule = (window as any).createFlowModule
      if (typeof createModule !== "function") {
        setStatus("failed")
        log("createFlowModule missing")
        startedRef.current = false
        setStarted(false)
        return
      }

      createModule({
        canvas: canvas,
        locateFile: (path: string) => "wasm/doom/" + path,
        print: (t: string) => log(t),
        printErr: (t: string) => log(t),
        preRun: [
          (mod: any) => {
            if (mod && mod.ENV) {
              if (isAI) {
                mod.ENV.DOOMFLOW_AI = "1"
              } else {
                delete mod.ENV.DOOMFLOW_AI
                delete mod.ENV.DOOMFLOW_ARGS
                delete mod.ENV.DOOMFLOW_KEYSCRIPT
              }
            }
          },
        ],
      }).then((mod: any) => {
        if (typeof mod._doomflow_set_ai === "function") {
          mod._doomflow_set_ai(isAI ? 1 : 0)
        }
        setStatus("running")
        if (overlayRef.current) overlayRef.current.style.display = "none"
        ;(window as any).flowGfxOnStart = (_t: string, w: number, h: number) => {
          setStatus(`running ${w}x${h}`)
        }
        ;(window as any).flowGfxOnExit = (frames: number) => {
          setStatus(`finished, ${frames} frames`)
          setStarted(false)
          startedRef.current = false
        }
        try {
          mod.callMain([])
          if (typeof mod._doomflow_frame === "function") {
            let ctx = 0
            if (typeof mod._doomflow_get_gfx_ctx === "function") {
              ctx = mod._doomflow_get_gfx_ctx()
            }
            let rafId: number | null = null
            let stopped = false
            stopFnRef.current = () => {
              stopped = true
            }
            function frameLoop() {
              if (stopped) {
                if (rafId) cancelAnimationFrame(rafId)
                setStatus("stopped")
                setStarted(false)
                startedRef.current = false
                return
              }
              try {
                const alive = mod._doomflow_frame()
                if (!alive) {
                  if (rafId) cancelAnimationFrame(rafId)
                  if ((window as any).flowGfxOnExit)
                    (window as any).flowGfxOnExit(0)
                  return
                }
                if (mod._doomflow_present) mod._doomflow_present(ctx)
              } catch (e) {
                if (rafId) cancelAnimationFrame(rafId)
                log(String(e))
                setStatus("crashed")
                return
              }
              rafId = requestAnimationFrame(frameLoop)
            }
            rafId = requestAnimationFrame(frameLoop)
          }
        } catch (e: any) {
          if (!(e && e.name === "ExitStatus")) log(String(e))
        }
      }).catch((e: any) => {
        setStatus("failed")
        startedRef.current = false
        setStarted(false)
        log(String(e))
      })
    }
    script.onerror = () => {
      setStatus("failed")
      startedRef.current = false
      setStarted(false)
      log("failed to load wasm/doom/doom.js")
    }
    document.body.appendChild(script)
  }, [isAI, log])

  const stop = useCallback(() => {
    if (stopFnRef.current) stopFnRef.current()
    setStatus("stopping")
  }, [])

  useEffect(() => {
    return () => {
      if (stopFnRef.current) stopFnRef.current()
      if (scriptRef.current) scriptRef.current.remove()
      ;(window as any).createFlowModule = undefined
      startedRef.current = false
    }
  }, [])

  useEffect(() => {
    // Reset state when switching modes
    startedRef.current = false
    setStarted(false)
    setStatus("ready")
    if (overlayRef.current) overlayRef.current.style.display = ""
  }, [mode])

  const copy = isAI
    ? "An open-loop Flow pilot warps into E1M1 and cycles through the levels automatically."
    : "Doom compiled from Flow source through MLIR to WebAssembly. The shareware IWAD is preloaded. Audio is silent in this build."

  const hint = isAI
    ? "doomflow_set_ai / warp E1M1 / forward / turn / fire"
    : "Arrows / WASD move. X or F fire. Space or E use. 1-7 weapons. Tab automap. Esc menu."

  return (
    <Card className="w-full max-w-[920px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="font-mono text-xs text-muted-foreground">
            {isAI ? "WATCH AI" : "PLAY"}
          </span>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-mono text-xs text-green-500">{status}</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          Flow {"->"} MLIR {"->"} LLVM {"->"} emcc {"->"} WASM
        </span>
      </div>

      <div className="relative bg-black" style={{ lineHeight: 0 }}>
        <canvas
          id="canvas"
          ref={canvasRef}
          width={640}
          height={400}
          className="block w-full"
          style={{ imageRendering: "pixelated", maxHeight: "70vh" }}
        />
        <div
          ref={overlayRef}
          onClick={boot}
          className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8 cursor-pointer"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(13,13,15,0.7) 0%, rgba(13,13,15,0.95) 100%)",
          }}
        >
          <p className="m-0 font-mono text-6xl font-bold tracking-wider text-foreground drop-shadow-lg">
            DOOM<span className="text-primary">.FLOW</span>
          </p>
          <p className="max-w-[44ch] text-center text-base text-muted-foreground leading-relaxed">
            {copy}
          </p>
          <Button onClick={boot} size="lg" className="mt-2">
            <Play className="mr-2 h-4 w-4" />
            Boot Doom
          </Button>
          <p className="text-[11px] text-muted-foreground/50 font-mono">
            click to start, keyboard controls
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2">
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={stop}
          disabled={!started}
        >
          Stop
        </Button>
      </div>

      {logs.length > 0 && (
        <div className="max-h-32 overflow-auto border-t border-border bg-black/50 p-3">
          <pre className="m-0 whitespace-pre-wrap font-mono text-[10px] text-green-500/80">
            {logs.slice(-8).join("\n")}
          </pre>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// RL Arena panel
// ---------------------------------------------------------------------------

function ArenaPanel() {
  const netCanvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState("idle")
  const [running, setRunning] = useState(false)
  const [instances, setInstances] = useState(4)
  const [lr, setLr] = useState(5)
  const [batch, setBatch] = useState(50)
  const [metrics, setMetrics] = useState({
    episode: 0,
    killRate: 0,
    best: 0,
    avgReturn: 0,
    loss: 0,
  })
  const [workerRows, setWorkerRows] = useState<
    { idx: number; rate: number; episodes: number }[]
  >([])

  const workersRef = useRef<WorkerInfo[]>([])
  const arenaStateRef = useRef({
    running: false,
    bestRate: 0,
    bestWorker: 0,
    totalEpisodes: 0,
    totalKills: 0,
    episodeCounter: 0,
  })
  const latestWeightsRef = useRef<Weights | null>(null)
  const latestActivationsRef = useRef<Activations | null>(null)
  const lrRef = useRef(lr)
  const batchRef = useRef(batch)
  const instancesRef = useRef(instances)

  lrRef.current = lr
  batchRef.current = batch
  instancesRef.current = instances

  const drawNetwork = useCallback(() => {
    const canvas = netCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const weights = latestWeightsRef.current
    if (!weights) return

    const nIn = 8, nHid = 16, nOut = 4
    const padX = 60, padY = 40
    const colW = (w - 2 * padX) / 2

    const inPos: { x: number; y: number }[] = []
    const hidPos: { x: number; y: number }[] = []
    const outPos: { x: number; y: number }[] = []

    for (let i = 0; i < nIn; i++)
      inPos.push({ x: padX, y: padY + ((h - 2 * padY) * (i + 0.5)) / nIn })
    for (let j = 0; j < nHid; j++)
      hidPos.push({ x: padX + colW, y: padY + ((h - 2 * padY) * (j + 0.5)) / nHid })
    for (let k = 0; k < nOut; k++)
      outPos.push({ x: padX + 2 * colW, y: padY + ((h - 2 * padY) * (k + 0.5)) / nOut })

    // Layer 1 weights
    const w1 = weights.w1
    let maxW1 = 0.001
    for (let i = 0; i < w1.length; i++)
      if (Math.abs(w1[i]) > maxW1) maxW1 = Math.abs(w1[i])
    for (let hi = 0; hi < nHid; hi++) {
      for (let ii = 0; ii < nIn; ii++) {
        const val = w1[hi * nIn + ii]
        const norm = val / maxW1
        const alpha = Math.min(1, Math.abs(norm))
        if (alpha < 0.05) continue
        ctx.strokeStyle =
          norm > 0
            ? `rgba(212, 101, 74, ${alpha})`
            : `rgba(74, 122, 184, ${alpha})`
        ctx.lineWidth = Math.max(0.3, alpha * 2.5)
        ctx.beginPath()
        ctx.moveTo(inPos[ii].x, inPos[ii].y)
        ctx.lineTo(hidPos[hi].x, hidPos[hi].y)
        ctx.stroke()
      }
    }

    // Layer 2 weights
    const w2 = weights.w2
    let maxW2 = 0.001
    for (let i = 0; i < w2.length; i++)
      if (Math.abs(w2[i]) > maxW2) maxW2 = Math.abs(w2[i])
    for (let oi = 0; oi < nOut; oi++) {
      for (let hi = 0; hi < nHid; hi++) {
        const val = w2[oi * nHid + hi]
        const norm = val / maxW2
        const alpha = Math.min(1, Math.abs(norm))
        if (alpha < 0.05) continue
        ctx.strokeStyle =
          norm > 0
            ? `rgba(212, 101, 74, ${alpha})`
            : `rgba(74, 122, 184, ${alpha})`
        ctx.lineWidth = Math.max(0.3, alpha * 2.5)
        ctx.beginPath()
        ctx.moveTo(hidPos[hi].x, hidPos[hi].y)
        ctx.lineTo(outPos[oi].x, outPos[oi].y)
        ctx.stroke()
      }
    }

    // Nodes
    const acts = latestActivationsRef.current
    function drawNodes(
      positions: { x: number; y: number }[],
      activations: Float32Array | null,
      count: number,
      labels: string[] | null
    ) {
      for (let n = 0; n < count; n++) {
        const act = activations ? Math.abs(activations[n] || 0) : 0
        const radius = 4 + Math.min(6, act * 4)
        const intensity = Math.min(1, act)
        ctx.fillStyle = `rgba(232, 160, 74, ${0.3 + intensity * 0.7})`
        ctx.strokeStyle = "rgba(232, 160, 74, 0.8)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(positions[n].x, positions[n].y, radius, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()
        if (labels) {
          ctx.fillStyle = "rgba(139, 139, 148, 0.8)"
          ctx.font = "10px JetBrains Mono, monospace"
          ctx.textAlign = "right"
          ctx.fillText(labels[n], positions[n].x - 8, positions[n].y + 3)
        }
      }
    }

    const inLabels = ["wall", "LOS", "L", "R", "dist", "HP", "alive", "bias"]
    const outLabels = ["L", "R", "fwd", "fire"]

    drawNodes(inPos, acts ? acts.input : null, nIn, inLabels)
    drawNodes(hidPos, acts ? acts.hidden : null, nHid, null)
    drawNodes(outPos, acts ? acts.output : null, nOut, null)

    for (let o = 0; o < nOut; o++) {
      ctx.fillStyle = "rgba(139, 139, 148, 0.8)"
      ctx.font = "10px JetBrains Mono, monospace"
      ctx.textAlign = "left"
      ctx.fillText(outLabels[o], outPos[o].x + 10, outPos[o].y + 3)
    }

    ctx.fillStyle = "rgba(92, 92, 102, 0.6)"
    ctx.font = "9px JetBrains Mono, monospace"
    ctx.textAlign = "center"
    ctx.fillText("input", padX, h - 10)
    ctx.fillText("hidden (tanh)", padX + colW, h - 10)
    ctx.fillText("output", padX + 2 * colW, h - 10)
  }, [])

  const trainBatch = useCallback(() => {
    if (!arenaStateRef.current.running) return
    const decayOver = 2000
    const eps = Math.max(
      0.05,
      1.0 - (1.0 - 0.05) * (arenaStateRef.current.episodeCounter / decayOver)
    )
    for (const w of workersRef.current) {
      if (!w.ready) continue
      w.worker.postMessage({
        type: "train",
        batch: batchRef.current,
        epsilon: eps,
        lr: lrRef.current / 1000,
        gamma: 0.95,
        seed: 900 + w.episodes * 97,
      })
    }
  }, [])

  const handleWorkerMessage = useCallback(
    (idx: number, msg: any) => {
      const w = workersRef.current[idx]
      if (!w) return
      const st = arenaStateRef.current

      if (msg.type === "ready") {
        w.ready = true
        const allReady = workersRef.current.every((x) => x.ready)
        if (allReady) {
          setStatus("training")
          trainBatch()
        }
      } else if (msg.type === "trained") {
        w.episodes = msg.episode
        w.rate = msg.evalRate || w.rate
        st.totalEpisodes += msg.batch
        st.totalKills += msg.kills
        st.episodeCounter += msg.batch

        if (msg.bestRate > st.bestRate) {
          st.bestRate = msg.bestRate
          st.bestWorker = idx
          latestWeightsRef.current = msg.weights
          latestActivationsRef.current = msg.activations
        }

        setWorkerRows((prev) => {
          const next = [...prev]
          next[idx] = { idx, rate: msg.evalRate || 0, episodes: msg.episode }
          return next
        })

        setMetrics({
          episode: st.totalEpisodes,
          killRate: st.totalKills / Math.max(1, st.totalEpisodes),
          best: st.bestRate,
          avgReturn: msg.avgReturn || 0,
          loss: msg.loss || 0,
        })

        if (latestWeightsRef.current) drawNetwork()

        if (st.running) trainBatch()
      } else if (msg.type === "eval") {
        w.rate = msg.evalRate
        setWorkerRows((prev) => {
          const next = [...prev]
          next[idx] = { idx, rate: msg.evalRate, episodes: w.episodes }
          return next
        })
        if (msg.evalRate > st.bestRate) {
          st.bestRate = msg.evalRate
          st.bestWorker = idx
        }
        setMetrics((prev) => ({ ...prev, best: st.bestRate }))
      }
    },
    [trainBatch, drawNetwork]
  )

  const arenaStart = useCallback(() => {
    if (arenaStateRef.current.running) return
    const nWorkers = instancesRef.current

    arenaStateRef.current = {
      running: true,
      bestRate: 0,
      bestWorker: 0,
      totalEpisodes: 0,
      totalKills: 0,
      episodeCounter: 0,
    }
    workersRef.current = []
    setRunning(true)
    setStatus(`spawning ${nWorkers} workers`)
    setWorkerRows(
      Array.from({ length: nWorkers }, (_, i) => ({
        idx: i,
        rate: 0,
        episodes: 0,
      }))
    )

    const wasmJsUrl = "wasm/rl_arena/rl_arena.js"

    for (let j = 0; j < nWorkers; j++) {
      const seed = 1000 + j * 137
      const w = new Worker("rl_worker.js")
      workersRef.current.push({
        worker: w,
        seed,
        idx: j,
        ready: false,
        rate: 0,
        episodes: 0,
      })
      w.onmessage = (e: MessageEvent) =>
        handleWorkerMessage(j, e.data)
      w.postMessage({ type: "init", wasmJs: wasmJsUrl, seed })
    }
  }, [handleWorkerMessage])

  const arenaStop = useCallback(() => {
    arenaStateRef.current.running = false
    setRunning(false)
    setStatus("stopped")
  }, [])

  const arenaEval = useCallback(() => {
    if (arenaStateRef.current.running) return
    setStatus("evaluating")
    for (const w of workersRef.current) {
      if (!w.ready) continue
      w.worker.postMessage({ type: "eval", episodes: 50, seed: w.seed })
    }
    setTimeout(() => setStatus("idle"), 3000)
  }, [])

  useEffect(() => {
    drawNetwork()
  }, [drawNetwork])

  useEffect(() => {
    return () => {
      arenaStateRef.current.running = false
      for (const w of workersRef.current) w.worker.terminate()
    }
  }, [])

  const metricItems = [
    { label: "episode", value: metrics.episode.toString() },
    { label: "kill rate", value: metrics.killRate.toFixed(2) },
    { label: "best", value: metrics.best.toFixed(2) },
    { label: "avg return", value: metrics.avgReturn.toFixed(1) },
    { label: "loss", value: metrics.loss.toFixed(1) },
  ]

  return (
    <div className="grid w-full max-w-[920px] grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
      {/* Network visualization */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-mono text-xs text-muted-foreground">ARENA</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-mono text-xs text-green-500">{status}</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            DQN: 8 {"->"} 16 tanh {"->"} 4 Q-values
          </span>
        </div>
        <canvas
          ref={netCanvasRef}
          width={520}
          height={420}
          className="block w-full bg-background"
        />
        <div className="flex gap-4 border-t border-border px-4 py-2 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-primary" />
            positive weight
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-blue-500" />
            negative weight
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            activation
          </span>
        </div>
      </Card>

      {/* Control panel */}
      <div className="flex flex-col gap-3">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">instances</span>
                <span className="font-mono text-foreground">{instances}</span>
              </div>
              <Slider
                value={[instances]}
                min={1}
                max={8}
                step={1}
                onValueChange={(v) => setInstances(v[0])}
              />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">learning rate</span>
                <span className="font-mono text-foreground">
                  {(lr / 1000).toFixed(3)}
                </span>
              </div>
              <Slider
                value={[lr]}
                min={1}
                max={20}
                step={1}
                onValueChange={(v) => setLr(v[0])}
              />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">batch size</span>
                <span className="font-mono text-foreground">{batch}</span>
              </div>
              <Slider
                value={[batch]}
                min={10}
                max={200}
                step={10}
                onValueChange={(v) => setBatch(v[0])}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button
            onClick={arenaStart}
            disabled={running}
            className="flex-1"
            size="sm"
          >
            <Brain className="mr-1.5 h-3.5 w-3.5" />
            Start
          </Button>
          <Button
            variant="outline"
            onClick={arenaStop}
            disabled={!running}
            size="sm"
          >
            Stop
          </Button>
          <Button
            variant="outline"
            onClick={arenaEval}
            disabled={running}
            size="sm"
          >
            Evaluate
          </Button>
        </div>

        <Card>
          <CardContent className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border p-0">
            {metricItems.map((m) => (
              <div
                key={m.label}
                className="flex flex-col gap-0.5 bg-card p-2.5"
              >
                <span className="text-[10px] text-muted-foreground/60">
                  {m.label}
                </span>
                <span className="font-mono text-base font-semibold text-accent">
                  {m.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-1.5">
          {workerRows.map((row) => (
            <div
              key={row.idx}
              className="flex items-center gap-2 rounded border border-border bg-card px-3 py-1.5"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                w{row.idx}
              </span>
              <Progress
                value={Math.min(100, row.rate * 100)}
                className="h-1 flex-1"
              />
              <span className="font-mono text-[10px] text-foreground">
                {row.rate.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          DQN agent with experience replay and target network, trained with
          Flow stdlib ai.flow. Each worker loads the WASM module and trains
          independently. Architecture mirrors{" "}
          <a
            href="https://github.com/godofecht/flow-scikit"
            rel="noopener"
            className="text-accent hover:text-foreground"
          >
            flow-scikit
          </a>
          's MLPRegressor.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats section
// ---------------------------------------------------------------------------

function StatsSection() {
  const stats = [
    { num: "0", label: "render mismatches" },
    { num: "730", label: "samples compared" },
    { num: "-O2", label: "MLIR opt level" },
    { num: "410K", label: "wasm size" },
  ]
  return (
    <section className="mx-auto max-w-[920px] px-6 pb-10">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center gap-1 bg-card py-5"
          >
            <span className="font-mono text-2xl font-semibold text-accent">
              {s.num}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
        Title screen (3000 frames), AI gameplay (24000 frames covering E1M1
        through E1M6), and deterministic keyboard input replay (3000 frames)
        produce identical CRC32 values across the C and MLIR backends. The
        regression suite runs on every push.{" "}
        <a
          href="https://github.com/godofecht/doom-flow/blob/main/scripts/run_byte_identical.sh"
          rel="noopener"
          className="text-accent hover:text-foreground"
        >
          run_byte_identical.sh
        </a>
        ,{" "}
        <a
          href="https://github.com/godofecht/doom-flow/blob/main/scripts/run_gameplay_test.sh"
          rel="noopener"
          className="text-accent hover:text-foreground"
        >
          run_gameplay_test.sh
        </a>
        .
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pipeline section
// ---------------------------------------------------------------------------

function PipelineSection() {
  const steps = [
    { num: "1", title: "Flow source", desc: "Doom rewritten as *.flow modules." },
    { num: "2", title: "MLIR -> LLVM IR", desc: "mlir-opt O2: canonicalize, cse, sccp, mem2reg, licm." },
    { num: "3", title: "emcc link", desc: "gfx_wasm runtime, linked at -O2." },
    { num: "4", title: "WASM", desc: "Running in this tab." },
  ]
  return (
    <section className="mx-auto max-w-[920px] px-6 pb-10">
      <h2 className="mb-4 text-base font-semibold">Compile pipeline</h2>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {steps.map((s) => (
          <div
            key={s.num}
            className="flex gap-2.5 rounded-lg border border-border bg-card p-3"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-secondary font-mono text-xs font-semibold text-primary">
              {s.num}
            </span>
            <div>
              <strong className="block text-sm font-semibold">{s.title}</strong>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
        Native macOS builds use Flow's C backend. Both backends produce
        byte-identical framebuffer output.{" "}
        <a
          href="https://github.com/flooooooooooow/flow/issues/221"
          rel="noopener"
          className="text-accent hover:text-foreground"
        >
          Epic #221
        </a>{" "}
        tracks MLIR WASM parity.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Link cards
// ---------------------------------------------------------------------------

function LinkCards() {
  const links = [
    { icon: BookOpen, title: "Flow wiki", desc: "Language reference and tutorials", href: "https://flooooooooooow.github.io/flow/" },
    { icon: Code2, title: "Flow source", desc: "github.com/flooooooooooow/flow", href: "https://github.com/flooooooooooow/flow" },
    { icon: Code2, title: "doom-flow", desc: "github.com/godofecht/doom-flow", href: "https://github.com/godofecht/doom-flow" },
    { icon: Brain, title: "doom-flow-rl", desc: "Q-learning sister repo", href: "https://github.com/godofecht/doom-flow-rl" },
  ]
  return (
    <section className="mx-auto max-w-[920px] px-6 pb-10">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {links.map((l) => (
          <a
            key={l.title}
            href={l.href}
            rel="noopener"
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30 hover:bg-secondary"
          >
            <l.icon className="h-5 w-5 text-muted-foreground" />
            <div>
              <strong className="block text-sm font-semibold">{l.title}</strong>
              <span className="block text-xs text-muted-foreground">
                {l.desc}
              </span>
            </div>
            <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground/40" />
          </a>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-6 py-5 text-xs text-muted-foreground/60">
      <p className="m-0">
        doomgeneric lineage / GPL-2.0 / shareware{" "}
        <code className="font-mono text-muted-foreground">doom1.wad</code>
      </p>
      <p className="m-0 flex gap-2">
        <a
          href="https://github.com/godofecht/doom-flow"
          rel="noopener"
          className="hover:text-foreground"
        >
          doom-flow
        </a>
        <span className="text-muted-foreground/30">/</span>
        <a
          href="https://flooooooooooow.github.io/flow/playground/"
          rel="noopener"
          className="hover:text-foreground"
        >
          Flow playground
        </a>
        <span className="text-muted-foreground/30">/</span>
        <a
          href="https://discord.gg/YK7VaHy24T"
          rel="noopener"
          className="hover:text-foreground"
        >
          Discord
        </a>
      </p>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export default function App() {
  const [mode, setMode] = useState<Mode>("play")

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-3.5">
        <a href="./" className="font-mono text-base font-bold tracking-wide text-foreground" aria-label="DOOM.FLOW home">
          DOOM<span className="text-primary">.FLOW</span>
        </a>
        <nav className="flex gap-3 text-xs text-muted-foreground">
          <a
            href="https://flooooooooooow.github.io/flow/"
            rel="noopener"
            className="hover:text-foreground"
          >
            Wiki
          </a>
          <a
            href="https://github.com/flooooooooooow/flow"
            rel="noopener"
            className="hover:text-foreground"
          >
            Flow
          </a>
          <a
            href="https://github.com/godofecht/doom-flow"
            rel="noopener"
            className="hover:text-foreground"
          >
            Repo
          </a>
        </nav>
      </header>

      {/* Mode tabs */}
      <div className="border-b border-border bg-card/50 px-6 py-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full max-w-[920px] mx-auto">
          <div className="flex justify-center">
            <TabsList>
              <TabsTrigger value="play">
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Play
              </TabsTrigger>
              <TabsTrigger value="ai">
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                Watch AI
              </TabsTrigger>
              <TabsTrigger value="arena">
                <Brain className="mr-1.5 h-3.5 w-3.5" />
                RL Arena
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="play" className="mt-6 flex justify-center w-full">
            <DoomPanel mode="play" />
          </TabsContent>
          <TabsContent value="ai" className="mt-6 flex justify-center w-full">
            <DoomPanel mode="ai" />
          </TabsContent>
          <TabsContent value="arena" className="mt-6 flex justify-center w-full">
            <ArenaPanel />
          </TabsContent>
        </Tabs>
      </div>

      <StatsSection />
      <PipelineSection />
      <LinkCards />
      <Footer />
    </div>
  )
}
