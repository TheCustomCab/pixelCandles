// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// palette_flicker.cpp - score how busy each palette looks under the real flame model.
//
// Build (from firmware/):  g++ -std=c++17 -O2 -Iusermods/candle_flame tools/palette_flicker.cpp -o palette_flicker
// Run:    ./palette_flicker "Name|0:961C00 90:FF5500 170:FF8C19 255:FFC469" "Other|..."
//         (palette text as stored in the controller's config, um.CandleFlame.pal<ID>; /json/cfg)
//
// Follows WLED's real output path: flame level -> palette colour x brightness(level) -> W extraction
// (3000 K white LED, palette boost) -> colour gamma 2.2 (applied before brightness, FX_fcn.cpp:1724)
// -> master brightness -> 8-bit output. "Visible steps" = frame-to-frame light changes over 8%, per candle
// per second, at master brightness 27 and 128. Sliders are fixed below (a typical calm setting).
// Reference: Classic scores 1.9 at brightness 128; the 2026-11-07 calming
// brought Warm white 3.2 -> 2.0, Soft white 2.5 -> 1.8, Halloween purple 2.3 -> 1.75.
#include "candle_core.h"
#include <cstdio>
#include <vector>
#include <cmath>
#include <string>
using namespace candleflame;
// Real output path: level -> palette colour x brightness(level) -> W extraction -> gamma 2.2 table (before
// brightness, FX_fcn.cpp:1724) -> master brightness scale8 -> 8-bit PWM. Then light = linear sum of channels
// (W weighted as white). "Visible steps" = frame-to-frame light changes bigger than 8% (Weber-ish threshold).
static uint8_t G[256];
static void lookup(const PaletteStops &p, int idx, float out[3]) {
  int i = 0; while (i < p.len - 1 && p.grad[4 * (i + 1)] < idx) i++;
  const uint8_t *a = &p.grad[4 * i], *b = &p.grad[4 * (i + 1 < p.len ? i + 1 : i)];
  float t = b[0] == a[0] ? 0 : (idx - a[0]) / float(b[0] - a[0]);
  for (int k = 0; k < 3; k++) out[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * t;
}
int main(int argc, char **argv) {
  for (int i = 0; i < 256; i++) G[i] = (uint8_t)(powf(i / 255.f, 2.2f) * 255.f + .5f);
  Params P{89 / 255.f, 119 / 255.f, 157 / 255.f, 197 / 255.f, 8 / 31.f};
  const int N = 23, F = 90 * 42; const float dt = 1.f / 42;
  for (int bri : {27, 128}) {
    printf("master brightness %d:\n", bri);
    for (int a = 1; a < argc; a++) {
      std::string arg = argv[a]; auto bar = arg.find('|');
      PaletteStops p; parseStops(arg.substr(bar + 1).c_str(), p);
      Rng rng; rng.s = 99; std::vector<Candle> c(N); for (auto &k : c) initCandle(k, rng);
      std::vector<double> prev(N, -1); long steps = 0, n = 0; double lsum = 0; int maxch = 0;
      for (int t = 0; t < F; t++) for (int i = 0; i < N; i++) {
        float L = stepCandle(c[i], P, dt, rng), col[3]; lookup(p, paletteIndexForLevel(L), col);
        float br = brightnessForLevel(L) / 255.f;
        uint8_t r = (uint8_t)(col[0] * br + .5f), g = (uint8_t)(col[1] * br + .5f), b = (uint8_t)(col[2] * br + .5f), w;
        extractWhite(r, g, b, w, 255, 177, 110, p.boost / 100.f);
        int R = (G[r] * bri) >> 8, Gg = (G[g] * bri) >> 8, B = (G[b] * bri) >> 8, W = (G[w] * bri) >> 8;
        if (R > maxch) maxch = R; if (W > maxch) maxch = W;
        double light = 0.2126 * R + 0.7152 * Gg + 0.0722 * B + 0.85 * W;
        if (prev[i] >= 0) { double ref = fmax(prev[i], 0.5); if (fabs(light - prev[i]) / ref > 0.08) steps++; n++; lsum += light; }
        prev[i] = light;
      }
      printf("  %-18s visible steps %5.2f per candle per second   (avg light %5.1f, top output level %d of 255)\n",
             arg.substr(0, bar).c_str(), (double)steps / N / 90.0, lsum / n, maxch);
    }
  }
}
