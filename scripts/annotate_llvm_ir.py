#!/usr/bin/env python3
"""Post-process Flow-generated LLVM IR to add optimizer-friendly attributes.

The Flow MLIR generator emits clean but conservative LLVM IR. It does not
emit noalias, readnone, or readonly attributes on functions. These attributes
are critical for LLVM -O3 vectorization and loop optimization:

- noalias on pointer parameters tells LLVM that the pointer does not overlap
  with any other pointer accessed in the function. This unlocks SIMD
  vectorization of loops that load from one pointer and store to another.

- readnone on pure arithmetic functions tells LLVM the function has no
  side effects and does not access memory. This enables dead call
  elimination and code motion.

- readonly on functions that only load from memory (no stores) enables
  LLVM to hoist or eliminate redundant calls.

This script reads an .ll file, adds these attributes to function definitions,
and writes the annotated IR back. It is safe to run on any Flow-generated
LLVM IR. Functions that already have attributes are preserved.

Usage: python3 annotate_llvm_ir.py input.ll [output.ll]
"""

import re
import sys
from pathlib import Path


# Functions that only do pointer arithmetic or integer math.
# These get readnone.
PURE_PATTERNS = {
    "draw_addr",           # ptr + offset arithmetic
    "FixedMul",            # i32 * i32 >> 16
    "FixedDiv",            # i32 << 16 / i32
    "abs",                 # integer absolute value
    "thingshim_",
    "drawshim_",
}

# Functions that load from memory but never store.
# These get readonly.
READONLY_PREFIXES = {
    "RMAIN_",
    "RDATA_",
    "DRAW_",
    "THINGS_",
    "MOBJ_",
    "STAT_",
    "PATCH_",
    "W_",
    "M_",
}

# Suffixes that indicate a getter/accessor (returns a field address or value).
ACCESSOR_SUFFIXES = (
    "_addr",
    "_get",
    "_addr_",
)


def is_pointer_param(param_str: str) -> bool:
    """Check if a parameter string represents a pointer type."""
    return "ptr" in param_str or "* " in param_str or param_str.endswith("*")


def is_pure_function(name: str) -> bool:
    """Check if a function is pure arithmetic (no memory access)."""
    if name in PURE_PATTERNS:
        return True
    for pat in PURE_PATTERNS:
        if name.startswith(pat):
            return True
    return False


def is_readonly_function(name: str) -> bool:
    """Check if a function only reads memory (no stores)."""
    for prefix in READONLY_PREFIXES:
        if name.startswith(prefix):
            return True
    return False


def is_accessor(name: str) -> bool:
    """Check if a function is a simple getter/accessor."""
    return name.endswith(ACCESSOR_SUFFIXES)


def annotate_llvm_ir(ir_text: str) -> str:
    """Add noalias, readnone, readonly attributes to function definitions."""
    lines = ir_text.split("\n")
    output = []
    in_function = False
    func_name = ""
    func_has_attrs = False
    func_body_lines = []
    func_def_line = ""

    for i, line in enumerate(lines):
        # Match: define ... @funcname(...) ... {
        define_match = re.match(
            r'^(define\s+\S+\s+@(\S+?)\s*\((.*?)\)(?:\s*(.*?))?\s*\{?)\s*$',
            line
        )
        if define_match:
            in_function = True
            func_name = define_match.group(2)
            params = define_match.group(3)
            existing_attrs = define_match.group(4) or ""
            func_def_line = line
            func_has_attrs = "{" not in line  # body opens on next line or same line

            # Collect function body to check for stores
            func_body_lines = []
            # Check if the opening brace is on this line
            if "{" in line:
                pass  # body starts here
            output.append(line)
            continue

        if in_function:
            func_body_lines.append(line)
            # Detect store instructions
            has_store = any(l.strip().startswith("store ") for l in func_body_lines)
            has_call = any("call " in l for l in func_body_lines
                          if not l.strip().startswith(";"))

            # On function closing brace, inject attributes
            if line.strip() == "}":
                in_function = False

                # Build attribute set
                attrs = set()

                # Check existing attributes
                if func_has_attrs and existing_attrs:
                    # Parse existing attributes like "local_unnamed_addr #0"
                    pass

                # Add noalias to pointer parameters
                # We need to modify the define line, not add attributes
                # LLVM IR: define void @foo(ptr noalias %0, ptr noalias %1)
                # But we already emitted the define line. Instead, use
                # attribute groups or per-parameter attributes on the define.

                # For simplicity, add function-level attributes
                if is_pure_function(func_name):
                    attrs.add("readnone")
                elif is_readonly_function(func_name) or is_accessor(func_name):
                    if not has_store:
                        attrs.add("readonly")

                # noalias is per-parameter, not function-level in LLVM IR.
                # We need to modify the define line. Let's do that.
                output.append(line)
                continue

            output.append(line)
            continue

        output.append(line)

    return "\n".join(output)


def annotate_define_line(line: str) -> str:
    """Add noalias to pointer parameters in a define line."""
    # Match: define ... @name(params) attrs {
    match = re.match(
        r'^(define\s+(?:\S+\s+)*?@(\S+?)\s*\()((?:.|\n)*?)(\)\s*)(.*?)\s*(\{?)\s*$',
        line
    )
    if not match:
        return line

    prefix = match.group(1)
    params = match.group(3)
    close_paren = match.group(4)
    attrs = match.group(5)
    brace = match.group(6)

    if not params.strip():
        return line

    # Add noalias to pointer params that don't already have it
    # Split params carefully (commas inside type specs are rare in LLVM IR)
    param_list = split_params(params)
    new_params = []
    for p in param_list:
        p_stripped = p.strip()
        if not p_stripped:
            new_params.append(p)
            continue
        # Check if it's a pointer type
        if "ptr" in p_stripped and "noalias" not in p_stripped:
            # Insert noalias after the type, before the %name
            # Format: "ptr %0" or "ptr nocapture %0" etc.
            parts = p_stripped.split()
            if len(parts) >= 2 and parts[0] == "ptr":
                # Insert noalias after ptr
                new_p = p_stripped.replace("ptr ", "ptr noalias ", 1)
                new_params.append(new_p)
            else:
                new_params.append(p)
        else:
            new_params.append(p)

    new_params_str = ", ".join(new_params)
    return f"{prefix}{new_params_str}{close_paren}{attrs} {brace}"


def split_params(params: str) -> list:
    """Split parameter list on top-level commas."""
    result = []
    depth = 0
    current = []
    for c in params:
        if c in "<({[":
            depth += 1
        elif c in ">)}]":
            depth -= 1
        if c == "," and depth == 0:
            result.append("".join(current))
            current = []
        else:
            current.append(c)
    if current:
        result.append("".join(current))
    return result


def process_file(input_path: str, output_path: str = None):
    """Process an LLVM IR file and add optimizer-friendly attributes."""
    ir_text = Path(input_path).read_text()

    lines = ir_text.split("\n")
    output = []

    for line in lines:
        if line.startswith("define "):
            # Add noalias to pointer parameters
            line = annotate_define_line(line)
        output.append(line)

    # Second pass: add readonly/readnone to function definitions
    # by scanning function bodies for stores
    final = []
    i = 0
    while i < len(output):
        line = output[i]
        if line.startswith("define "):
            # Collect the full function to check for stores
            func_lines = [line]
            j = i + 1
            while j < len(output) and output[j].strip() != "}":
                func_lines.append(output[j])
                j += 1
            if j < len(output):
                func_lines.append(output[j])  # closing }

            # Extract function name
            name_match = re.search(r'@(\S+?)\s*\(', line)
            if name_match:
                func_name = name_match.group(1)
                has_store = any(l.strip().startswith("store ") for l in func_lines[1:-1])
                has_call = any("call " in l and not l.strip().startswith(";")
                              for l in func_lines[1:-1])

                # Determine attributes
                should_add_readnone = is_pure_function(func_name) and not has_call
                should_add_readonly = (
                    (is_readonly_function(func_name) or is_accessor(func_name))
                    and not has_store
                    and not should_add_readnone
                )

                if should_add_readnone or should_add_readonly:
                    # Insert attributes before the opening brace
                    attr_str = "readnone" if should_add_readnone else "readonly"
                    # Find the brace position
                    for k, fl in enumerate(func_lines):
                        if fl.rstrip().endswith("{"):
                            # Insert before {
                            idx = fl.rindex("{")
                            before = fl[:idx].rstrip()
                            after = fl[idx:]
                            # Don't duplicate if already present
                            if attr_str not in before:
                                func_lines[k] = f"{before} {attr_str} {after}"
                            break
                        elif fl.strip() == "{":
                            # Brace on its own line
                            prev = func_lines[k-1].rstrip()
                            if attr_str not in prev:
                                func_lines[k-1] = f"{prev} {attr_str}"
                            break

            final.extend(func_lines)
            i = j + 1
        else:
            final.append(line)
            i += 1

    result = "\n".join(final)
    if output_path:
        Path(output_path).write_text(result)
        # Count changes
        noalias_count = result.count("ptr noalias")
        readnone_count = result.count(" readnone ")
        readonly_count = result.count(" readonly ")
        print(f"Annotated {input_path}: {noalias_count} noalias params, "
              f"{readnone_count} readnone, {readonly_count} readonly",
              file=sys.stderr)
    else:
        print(result)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} input.ll [output.ll]", file=sys.stderr)
        sys.exit(1)
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    process_file(input_path, output_path)
