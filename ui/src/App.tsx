import { useState, useRef, useEffect, useCallback } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Play, Brain, ExternalLink, BookOpen, Code2 } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "play"




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
// RL Arena panel (disabled, pending rework)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function StatsSection() {
  const stats = [
    { num: "0", label: "render mismatches" },
    { num: "1005", label: "samples compared" },
    { num: "-O2", label: "LLVM opt level" },
    { num: "419K", label: "wasm size" },
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
        Title screen (3000 frames), AI gameplay (32400 frames covering E1M1
        through E1M9), and deterministic keyboard input replay (3000 frames)
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
    { num: "2", title: "MLIR -> LLVM IR", desc: "Flow transpiler emits LLVM IR via MLIR." },
    { num: "3", title: "emcc link", desc: "gfx_wasm runtime, compiled and linked at -O2." },
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
// Backend comparison section
// ---------------------------------------------------------------------------

function BackendComparisonSection() {
  const rows = [
    { label: "WASM binary", c: "546 KB", m: "419 KB" },
    { label: "Functions", c: "615", m: "562" },
    { label: "Data segments", c: "597", m: "872" },
    { label: "Data segment bytes", c: "552,174", m: "421,076" },
    { label: "ASYNCIFY symbols", c: "15", m: "0" },
    { label: "Object file (pre-link)", c: "890 KB", m: "906 KB" },
    { label: "Generated IR lines", c: "44,612 (C)", m: "105,216 (LLVM IR)" },
    { label: "Optimization", c: "emcc -O2", m: "emcc -O2" },
  ]
  return (
    <section className="mx-auto max-w-[920px] px-6 pb-10">
      <h2 className="mb-4 text-base font-semibold">C vs MLIR backend comparison</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Metric</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">C backend</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">MLIR backend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 text-foreground">{r.label}</td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{r.c}</td>
                <td className="px-4 py-2.5 text-right font-mono text-accent">{r.m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-2 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
        <p>
          The C backend compiles Flow-generated C through emcc with
          ASYNCIFY enabled. ASYNCIFY requires unwind and rewind trampolines,
          a separate stack region, and dynamic call thunks. These add 53
          functions and approximately 131 KB of data segment overhead to
          the final WASM binary.
        </p>
        <p>
          The MLIR backend emits LLVM IR directly from the Flow transpiler,
          skipping the C intermediate. It uses a frame-driven architecture:
          main() returns after initialization, and JavaScript drives
          doomflow_frame() and doomflow_present() through requestAnimationFrame.
          This eliminates the ASYNCIFY requirement and its associated runtime
          overhead.
        </p>
        <p>
          Both paths apply LLVM -O2 at the emcc link stage. The MLIR path
          skips mlir-opt passes (canonicalize, cse, sccp, mem2reg, licm)
          because the 10 MB Doom MLIR module triggers a parser crash in
          Linux mlir-opt builds (LLVM 20 through 22). LLVM -O2 handles all
          optimization at the backend stage.
        </p>
      </div>
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
            </TabsList>
          </div>

          <TabsContent value="play" className="mt-6 flex justify-center w-full">
            <DoomPanel mode="play" />
          </TabsContent>
        </Tabs>
      </div>

      <StatsSection />
      <PipelineSection />
      <BackendComparisonSection />
      <LinkCards />
      <Footer />
    </div>
  )
}
