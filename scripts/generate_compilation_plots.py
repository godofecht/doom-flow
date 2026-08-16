#!/usr/bin/env python3
"""Extract compilation statistics from the Flow compiler and generate plots.

Runs the Flow transpiler on doom.flow, collects AST/IR stats, and produces
matplotlib plots saved as PNGs to the Obsidian vault.
"""

import sys
import os
import re
import time
import json
from pathlib import Path
from collections import Counter

# Add Flow to path
sys.path.insert(0, os.path.expanduser("~/flow/src"))

DOOM_DIR = os.path.expanduser("~/doom-flow")
FLOW_DIR = os.path.expanduser("~/flow")
OBSIDIAN_DIR = os.path.expanduser("~/obsidian/obsidian")
IMG_DIR = os.path.join(OBSIDIAN_DIR, "assets", "doom-flow")
os.makedirs(IMG_DIR, exist_ok=True)


def collect_flow_stats():
    """Run the Flow transpiler and collect stats."""
    from flow.module_resolver import resolve_modules
    from flow.c_header_parser import resolve_c_imports
    from flow.type_checker import TypeChecker
    from flow.mlir_generator import flow_to_mlir

    stats = {}

    # Phase 1: Parse + resolve modules
    t0 = time.time()
    declarations = resolve_modules(os.path.join(DOOM_DIR, "doom.flow"))
    source_dir = os.path.dirname(os.path.abspath(os.path.join(DOOM_DIR, "doom.flow")))
    declarations = resolve_c_imports(declarations, source_dir)
    t_parse = time.time() - t0
    stats["parse_time_s"] = round(t_parse, 3)

    # Count AST nodes
    from flow.parser import FunctionDecl, StructDecl, StaticDecl

    functions = [d for d in declarations if isinstance(d, FunctionDecl)]
    structs = [d for d in declarations if isinstance(d, StructDecl)]
    statics = [d for d in declarations if isinstance(d, StaticDecl)]

    stats["function_count"] = len(functions)
    stats["struct_count"] = len(structs)
    stats["static_count"] = len(statics)
    stats["source_files"] = len([d for d in declarations])  # total declarations

    # Function parameter counts
    param_counts = Counter()
    for f in functions:
        param_counts[len(f.parameters)] += 1
    stats["param_count_dist"] = dict(param_counts)

    # Return type distribution
    return_types = Counter()
    for f in functions:
        if f.return_type:
            return_types[f.return_type.name] += 1
    stats["return_type_dist"] = dict(return_types)

    # Parameter type distribution
    param_types = Counter()
    for f in functions:
        for p in f.parameters:
            if p.type:
                param_types[p.type.name] += 1
    stats["param_type_dist"] = dict(param_types)

    # Struct field counts
    struct_fields = []
    for s in structs:
        struct_fields.append(len(s.fields))
    stats["struct_field_counts"] = struct_fields

    # Static variable types
    static_types = Counter()
    for s in statics:
        if s.type:
            static_types[s.type.name] += 1
    stats["static_type_dist"] = dict(static_types)

    # Extern vs defined functions
    extern_count = sum(1 for f in functions if getattr(f, "is_extern", False))
    stats["extern_functions"] = extern_count
    stats["defined_functions"] = len(functions) - extern_count

    # Function names for call graph analysis
    func_names = [f.name for f in functions if not getattr(f, "is_extern", False)]
    stats["function_names"] = func_names

    # Phase 2: Type check
    t0 = time.time()
    tc = TypeChecker()
    tc.strict = False
    tc.check(declarations)
    t_typecheck = time.time() - t0
    stats["typecheck_time_s"] = round(t_typecheck, 3)

    # Phase 3: MLIR generation
    t0 = time.time()
    mlir_code = flow_to_mlir(
        declarations,
        source_file=os.path.join(DOOM_DIR, "doom.flow"),
        size_t_bits=32,
    )
    t_mlir = time.time() - t0
    stats["mlir_gen_time_s"] = round(t_mlir, 3)
    stats["mlir_lines"] = mlir_code.count("\n")
    stats["mlir_size_bytes"] = len(mlir_code)

    # Count MLIR operations
    mlir_ops = Counter()
    for line in mlir_code.split("\n"):
        line = line.strip()
        if "=" in line:
            op = line.split("=")[1].strip().split("(")[0].strip()
            mlir_ops[op] += 1
    stats["mlir_op_dist"] = dict(mlir_ops.most_common(20))

    # Count string constants
    stats["string_constants"] = mlir_code.count("llvm.mlir.global internal constant @str_")

    # Count globals
    stats["mlir_globals"] = mlir_code.count("llvm.mlir.global internal @")

    # Count functions in MLIR
    stats["mlir_functions"] = mlir_code.count("func.func @")

    # Phase timing
    stats["total_time_s"] = round(
        stats["parse_time_s"] + stats["typecheck_time_s"] + stats["mlir_gen_time_s"], 3
    )

    return stats


def collect_binary_stats():
    """Collect WASM binary statistics."""
    import subprocess

    stats = {}

    # MLIR WASM
    mlir_wasm = "/tmp/doom_mlir_o3v2/doom.wasm"
    c_wasm = "/tmp/doom_c_o3v2/doom.wasm"

    for label, path in [("c", c_wasm), ("mlir", mlir_wasm)]:
        if not os.path.exists(path):
            continue
        st = os.stat(path)
        stats[f"{label}_wasm_bytes"] = st.st_size

        # Get function count and data segments
        result = subprocess.run(
            ["wasm-objdump", "-x", path],
            capture_output=True, text=True
        )
        output = result.stdout + result.stderr
        stats[f"{label}_functions"] = output.count(" - func[")
        stats[f"{label}_data_segments"] = output.count("data[")

        # Get disassembly for instruction stats
        result2 = subprocess.run(
            ["wasm-objdump", "-d", path],
            capture_output=True, text=True
        )
        disasm = result2.stdout + result2.stderr
        stats[f"{label}_instructions"] = disasm.count("|")

        # Count specific instruction types
        for inst in ["i32.add", "i32.sub", "i32.mul", "i32.div", "i32.load",
                      "i32.store", "call", "local.get", "local.set",
                      "br", "if", "loop", "block", "i32.const"]:
            stats[f"{label}_{inst.replace('.', '_')}"] = disasm.count(inst)

    return stats


def collect_ll_stats():
    """Collect LLVM IR statistics from the generated .ll file."""
    ll_path = os.path.join(DOOM_DIR, "build", "wasm", "doom.ll")
    if not os.path.exists(ll_path):
        ll_path = "/tmp/doom_stats.ll"

    if not os.path.exists(ll_path):
        return {}

    with open(ll_path) as f:
        ll = f.read()

    stats = {}
    stats["ll_lines"] = ll.count("\n")
    stats["ll_size_bytes"] = len(ll)
    stats["ll_functions"] = ll.count("\ndefine ")
    stats["ll_globals"] = len(re.findall(r'^@', ll, re.MULTILINE))
    stats["ll_string_constants"] = ll.count("internal constant")
    stats["ll_loads"] = ll.count("load ")
    stats["ll_stores"] = ll.count("store ")
    stats["ll_calls"] = ll.count("call ")
    stats["ll_alloca"] = ll.count("alloca")
    stats["ll_getelementptr"] = ll.count("getelementptr")
    stats["ll_branch"] = ll.count("br ")
    stats["ll_icmp"] = ll.count("icmp ")
    stats["ll_phi"] = ll.count("phi ")

    # Function size distribution (lines per function)
    func_sizes = []
    current_func = []
    for line in ll.split("\n"):
        if line.startswith("define "):
            if current_func:
                func_sizes.append(len(current_func))
            current_func = [line]
        elif current_func:
            current_func.append(line)
            if line.strip() == "}":
                func_sizes.append(len(current_func))
                current_func = []
    if current_func:
        func_sizes.append(len(current_func))
    stats["ll_func_size_dist"] = func_sizes

    return stats


def collect_c_stats():
    """Collect C backend statistics."""
    c_path = "/tmp/doom_c_gen.c"
    if not os.path.exists(c_path):
        return {}

    with open(c_path) as f:
        c = f.read()

    stats = {}
    stats["c_lines"] = c.count("\n")
    stats["c_size_bytes"] = len(c)
    stats["c_functions"] = len(re.findall(r'^[a-z].*\(.*\)\s*\{', c, re.MULTILINE))
    stats["c_static_functions"] = len(re.findall(r'^static ', c, re.MULTILINE))
    stats["c_globals"] = len(re.findall(r'^static.*=', c, re.MULTILINE))
    stats["c_string_literals"] = c.count('"') // 2

    return stats


def generate_plots(flow_stats, binary_stats, ll_stats, c_stats):
    """Generate matplotlib plots and save to Obsidian assets."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker
    import numpy as np

    plt.rcParams.update({
        "figure.facecolor": "#1e1e2e",
        "axes.facecolor": "#1e1e2e",
        "axes.edgecolor": "#cdd6f4",
        "axes.labelcolor": "#cdd6f4",
        "xtick.color": "#cdd6f4",
        "ytick.color": "#cdd6f4",
        "text.color": "#cdd6f4",
        "font.family": "monospace",
        "font.size": 10,
        "figure.dpi": 150,
    })

    plots = []

    # 1. Compilation phase timing
    fig, ax = plt.subplots(figsize=(8, 3))
    phases = ["Parse", "Type check", "MLIR gen"]
    times = [flow_stats["parse_time_s"], flow_stats["typecheck_time_s"], flow_stats["mlir_gen_time_s"]]
    colors = ["#89b4fa", "#a6e3a1", "#f9e2af"]
    bars = ax.barh(phases, times, color=colors)
    ax.set_xlabel("Seconds")
    ax.set_title("Flow compiler phase timing (doom.flow)")
    for bar, t in zip(bars, times):
        ax.text(bar.get_width() + 0.01, bar.get_y() + bar.get_height()/2,
                f"{t}s", va="center", fontsize=9)
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "phase_timing.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("phase_timing.png")

    # 2. Function count breakdown
    fig, ax = plt.subplots(figsize=(6, 4))
    labels = ["Defined", "Extern"]
    counts = [flow_stats["defined_functions"], flow_stats["extern_functions"]]
    ax.bar(labels, counts, color=["#89b4fa", "#f38ba8"])
    ax.set_ylabel("Count")
    ax.set_title(f"Functions: {flow_stats['function_count']} total")
    for i, (l, c) in enumerate(zip(labels, counts)):
        ax.text(i, c + 50, str(c), ha="center", fontsize=11)
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "function_counts.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("function_counts.png")

    # 3. Parameter type distribution
    fig, ax = plt.subplots(figsize=(8, 4))
    pt = flow_stats["param_type_dist"]
    sorted_pt = sorted(pt.items(), key=lambda x: -x[1])[:12]
    names = [x[0] for x in sorted_pt]
    vals = [x[1] for x in sorted_pt]
    ax.barh(names, vals, color="#cba6f7")
    ax.set_xlabel("Count")
    ax.set_title("Parameter type distribution (top 12)")
    ax.invert_yaxis()
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "param_types.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("param_types.png")

    # 4. Return type distribution
    fig, ax = plt.subplots(figsize=(6, 4))
    rt = flow_stats["return_type_dist"]
    sorted_rt = sorted(rt.items(), key=lambda x: -x[1])[:10]
    names = [x[0] for x in sorted_rt]
    vals = [x[1] for x in sorted_rt]
    ax.bar(names, vals, color="#a6e3a1")
    ax.set_ylabel("Count")
    ax.set_title("Return type distribution")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "return_types.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("return_types.png")

    # 5. MLIR operation distribution
    fig, ax = plt.subplots(figsize=(8, 5))
    ops = flow_stats["mlir_op_dist"]
    names = list(ops.keys())[:15]
    vals = list(ops.values())[:15]
    ax.barh(names, vals, color="#f9e2af")
    ax.set_xlabel("Count")
    ax.set_title("MLIR operation distribution (top 15)")
    ax.invert_yaxis()
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "mlir_ops.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("mlir_ops.png")

    # 6. C vs MLIR IR size comparison
    fig, ax = plt.subplots(figsize=(7, 4))
    labels = ["Generated C", "Generated LLVM IR", "MLIR (before lowering)"]
    lines = [c_stats.get("c_lines", 0), ll_stats.get("ll_lines", 0), flow_stats.get("mlir_lines", 0)]
    sizes = [c_stats.get("c_size_bytes", 0), ll_stats.get("ll_size_bytes", 0), flow_stats.get("mlir_size_bytes", 0)]
    x = np.arange(len(labels))
    width = 0.35
    ax.bar(x - width/2, lines, width, label="Lines", color="#89b4fa")
    ax.bar(x + width/2, [s/1024 for s in sizes], width, label="KB", color="#f38ba8")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8)
    ax.legend()
    ax.set_title("Intermediate representation size")
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "ir_size_comparison.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("ir_size_comparison.png")

    # 7. WASM binary size comparison
    if binary_stats:
        fig, ax = plt.subplots(figsize=(7, 4))
        labels = ["C backend", "MLIR backend"]
        sizes = [binary_stats.get("c_wasm_bytes", 0), binary_stats.get("mlir_wasm_bytes", 0)]
        ax.bar(labels, [s/1024 for s in sizes], color=["#89b4fa", "#a6e3a1"])
        ax.set_ylabel("KB")
        ax.set_title("WASM binary size")
        for i, (l, s) in enumerate(zip(labels, sizes)):
            ax.text(i, s/1024 + 5, f"{s/1024:.0f} KB", ha="center", fontsize=11)
        plt.tight_layout()
        path = os.path.join(IMG_DIR, "wasm_size.png")
        plt.savefig(path, bbox_inches="tight")
        plt.close()
        plots.append("wasm_size.png")

    # 8. WASM instruction mix comparison
    if binary_stats:
        fig, ax = plt.subplots(figsize=(10, 5))
        insts = ["i32_add", "i32_load", "i32_store", "call", "local_get", "local_set", "br", "if", "loop", "i32_const"]
        c_vals = [binary_stats.get(f"c_{i}", 0) for i in insts]
        m_vals = [binary_stats.get(f"mlir_{i}", 0) for i in insts]
        x = np.arange(len(insts))
        width = 0.35
        ax.bar(x - width/2, c_vals, width, label="C backend", color="#89b4fa")
        ax.bar(x + width/2, m_vals, width, label="MLIR backend", color="#a6e3a1")
        ax.set_xticks(x)
        ax.set_xticklabels([i.replace("_", ".") for i in insts], rotation=45, ha="right")
        ax.legend()
        ax.set_title("WASM instruction mix")
        ax.set_ylabel("Count")
        plt.tight_layout()
        path = os.path.join(IMG_DIR, "instruction_mix.png")
        plt.savefig(path, bbox_inches="tight")
        plt.close()
        plots.append("instruction_mix.png")

    # 9. LLVM IR function size distribution (histogram)
    if ll_stats and "ll_func_size_dist" in ll_stats:
        fig, ax = plt.subplots(figsize=(8, 4))
        sizes = ll_stats["ll_func_size_dist"]
        ax.hist(sizes, bins=50, color="#cba6f7", edgecolor="#1e1e2e")
        ax.set_xlabel("Lines per function")
        ax.set_ylabel("Count")
        ax.set_title(f"LLVM IR function size distribution ({len(sizes)} functions)")
        plt.tight_layout()
        path = os.path.join(IMG_DIR, "func_size_dist.png")
        plt.savefig(path, bbox_inches="tight")
        plt.close()
        plots.append("func_size_dist.png")

    # 10. Struct field count distribution
    fig, ax = plt.subplots(figsize=(6, 4))
    fields = flow_stats["struct_field_counts"]
    ax.bar(range(len(fields)), sorted(fields, reverse=True), color="#f38ba8")
    ax.set_xlabel("Struct (sorted by field count)")
    ax.set_ylabel("Field count")
    ax.set_title(f"Struct complexity ({len(fields)} structs)")
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "struct_complexity.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("struct_complexity.png")

    # 11. Static variable type distribution
    fig, ax = plt.subplots(figsize=(7, 4))
    st = flow_stats["static_type_dist"]
    sorted_st = sorted(st.items(), key=lambda x: -x[1])[:10]
    names = [x[0] for x in sorted_st]
    vals = [x[1] for x in sorted_st]
    ax.bar(names, vals, color="#94e2d5")
    ax.set_ylabel("Count")
    ax.set_title("Static variable type distribution")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "static_types.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("static_types.png")

    # 12. Compilation pipeline flow diagram
    fig, ax = plt.subplots(figsize=(10, 3))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 4)
    ax.axis("off")

    boxes = [
        (0.5, "doom.flow\n5993 functions"),
        (2.5, "Parser\n%.2fs" % flow_stats["parse_time_s"]),
        (4.5, "Type checker\n%.2fs" % flow_stats["typecheck_time_s"]),
        (6.5, "MLIR gen\n%.2fs" % flow_stats["mlir_gen_time_s"]),
        (8.5, "LLVM IR\n%d lines" % ll_stats.get("ll_lines", 0)),
        (10.5, "WASM\n%d KB" % (binary_stats.get("mlir_wasm_bytes", 0) // 1024)),
    ]
    colors = ["#89b4fa", "#f9e2af", "#a6e3a1", "#cba6f7", "#f38ba8", "#94e2d5"]
    for i, (x, label) in enumerate(boxes):
        rect = plt.Rectangle((x-0.7, 1), 1.4, 2, facecolor=colors[i],
                             edgecolor="#cdd6f4", linewidth=1.5)
        ax.add_patch(rect)
        ax.text(x, 2, label, ha="center", va="center", fontsize=8,
                fontweight="bold")
        if i < len(boxes) - 1:
            ax.annotate("", xy=(boxes[i+1][0]-0.7, 2), xytext=(x+0.7, 2),
                       arrowprops=dict(arrowstyle="->", color="#cdd6f4", lw=1.5))
    ax.set_title("Flow compilation pipeline", fontsize=12, pad=10)
    plt.tight_layout()
    path = os.path.join(IMG_DIR, "pipeline_flow.png")
    plt.savefig(path, bbox_inches="tight")
    plt.close()
    plots.append("pipeline_flow.png")

    return plots


def main():
    print("Collecting Flow compiler stats...", file=sys.stderr)
    flow_stats = collect_flow_stats()

    print("Collecting LLVM IR stats...", file=sys.stderr)
    ll_stats = collect_ll_stats()

    print("Collecting C backend stats...", file=sys.stderr)
    c_stats = collect_c_stats()

    print("Collecting binary stats...", file=sys.stderr)
    binary_stats = collect_binary_stats()

    print("Generating plots...", file=sys.stderr)
    plots = generate_plots(flow_stats, binary_stats, ll_stats, c_stats)

    # Save raw stats as JSON
    stats_path = os.path.join(IMG_DIR, "compilation_stats.json")
    all_stats = {
        "flow": {k: v for k, v in flow_stats.items() if k != "function_names"},
        "ll": ll_stats,
        "c": c_stats,
        "binary": binary_stats,
    }
    with open(stats_path, "w") as f:
        json.dump(all_stats, f, indent=2, default=str)

    print(f"\nGenerated {len(plots)} plots:", file=sys.stderr)
    for p in plots:
        print(f"  {IMG_DIR}/{p}", file=sys.stderr)
    print(f"\nStats: {stats_path}", file=sys.stderr)

    # Print summary
    print(f"\n=== Flow Compiler Stats ===", file=sys.stderr)
    print(f"Functions: {flow_stats['function_count']}", file=sys.stderr)
    print(f"Structs: {flow_stats['struct_count']}", file=sys.stderr)
    print(f"Static vars: {flow_stats['static_count']}", file=sys.stderr)
    print(f"Parse: {flow_stats['parse_time_s']}s", file=sys.stderr)
    print(f"Type check: {flow_stats['typecheck_time_s']}s", file=sys.stderr)
    print(f"MLIR gen: {flow_stats['mlir_gen_time_s']}s", file=sys.stderr)
    print(f"MLIR lines: {flow_stats['mlir_lines']}", file=sys.stderr)
    print(f"LLVM IR lines: {ll_stats.get('ll_lines', '?')}", file=sys.stderr)
    print(f"C lines: {c_stats.get('c_lines', '?')}", file=sys.stderr)


if __name__ == "__main__":
    main()
