// doom_shim.c: non-async canvas blit for rAF-driven game loop.
// Linked alongside gfx_wasm.c when building without ASYNCIFY.
//
// The FlowGfxWasm struct is defined inside gfx_wasm.c and not exposed
// in a header, so we mirror its layout here (width, height, pixels).
// The pixels pointer is at byte offset 8 (two int32_t fields before it).

#include <emscripten.h>
#include <stdint.h>

typedef struct {
    int32_t width;
    int32_t height;
    uint8_t *pixels;
    int32_t presented;
    uint8_t should_close;
} DoomFlowGfx;

// Blit the internal RGBA8 pixel buffer to the canvas. No yield, no
// ASYNCIFY. The JS host calls this after doomflow_frame() returns.
EM_JS(void, doomflow_js_blit, (int32_t w, int32_t h, uint8_t *pixels), {
    var state = (typeof window !== "undefined") ? window.flowGfx : null;
    if (!state || !state.ctx || !state.image) { return; }
    state.image.data.set(HEAPU8.subarray(pixels, pixels + w * h * 4));
    state.ctx.putImageData(state.image, 0, 0);
    state.frames++;
    for (var i = 0; i < 256; i++) {
        if (!state.release[i]) { continue; }
        state.age[i]++;
        if (state.seen[i] || state.age[i] > 4) {
            state.keys[i] = 0;
            state.release[i] = 0;
            state.age[i] = 0;
        }
    }
});

// Called from JS after doomflow_frame() returns. Reads the pixel
// buffer from the gfx handle and blits to canvas without yielding.
int32_t doomflow_present(void *handle) {
    DoomFlowGfx *g = (DoomFlowGfx *)handle;
    if (!g || !g->pixels) return 0;
    doomflow_js_blit(g->width, g->height, g->pixels);
    g->presented++;
    return 1;
}

// Check if the window should close (Esc or tab close).
int32_t doomflow_should_close(void *handle) {
    DoomFlowGfx *g = (DoomFlowGfx *)handle;
    if (!g) return 0;
    return (int32_t)g->should_close;
}

// Dump framebuffer info for debugging. Returns the pixel at (x,y) as
// packed RGBA (r<<24 | g<<16 | b<<8 | a). Also reports non-zero pixel
// count in a sample grid via the count output parameter.
int32_t doomflow_dump_pixel(void *handle, int32_t x, int32_t y) {
    DoomFlowGfx *g = (DoomFlowGfx *)handle;
    if (!g || !g->pixels) return -1;
    if (x < 0 || x >= g->width || y < 0 || y >= g->height) return -2;
    int32_t idx = (y * g->width + x) * 4;
    return ((int32_t)g->pixels[idx] << 24) |
           ((int32_t)g->pixels[idx + 1] << 16) |
           ((int32_t)g->pixels[idx + 2] << 8) |
           ((int32_t)g->pixels[idx + 3]);
}

// Count non-zero pixels in a stride-sampled grid. Returns count.
int32_t doomflow_count_nonzero(void *handle, int32_t stride) {
    DoomFlowGfx *g = (DoomFlowGfx *)handle;
    if (!g || !g->pixels) return -1;
    int32_t count = 0;
    for (int32_t y = 0; y < g->height; y += stride) {
        for (int32_t x = 0; x < g->width; x += stride) {
            int32_t idx = (y * g->width + x) * 4;
            if (g->pixels[idx] || g->pixels[idx + 1] || g->pixels[idx + 2]) {
                count++;
            }
        }
    }
    return count;
}

// Get first 4 bytes of the pixel buffer as packed i32 for quick check.
int32_t doomflow_first_pixel(void *handle) {
    DoomFlowGfx *g = (DoomFlowGfx *)handle;
    if (!g || !g->pixels) return -1;
    return ((int32_t)g->pixels[0] << 24) |
           ((int32_t)g->pixels[1] << 16) |
           ((int32_t)g->pixels[2] << 8) |
           ((int32_t)g->pixels[3]);
}
