// SPDX-License-Identifier: EUPL-1.2
// Host-side tests for candle_core.h:  g++ -std=c++17 -O2 -I../usermods/candle_flame sim_test.cpp -o sim_test
// Also writes traces.csv for plotting.
#include "candle_core.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <cmath>
#include <cstring>
using namespace candleflame;

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } else printf("ok:   %s\n", msg); } while (0)

struct Stats { float minL, maxL, mean, roughness; };  // roughness = mean |dL| per frame

static Stats run(const Params &p, float seconds, float fps, uint32_t seed, std::vector<float> *trace = nullptr) {
  Rng rng; rng.s = seed; Candle c; initCandle(c, rng);
  const float dt = 1.0f / fps; const int frames = (int)(seconds * fps);
  Stats s{1, 0, 0, 0}; float prev = c.level;
  for (int i = 0; i < frames; i++) {
    float L = stepCandle(c, p, dt, rng);
    s.minL = fminf(s.minL, L); s.maxL = fmaxf(s.maxL, L); s.mean += L; s.roughness += fabsf(L - prev); prev = L;
    if (trace) trace->push_back(L);
  }
  s.mean /= frames; s.roughness /= frames; return s;
}

// Many candles at once, as the effect runs them. mean level, share of time below 0.7, mean movement
// per frame, and how much the candles differ from each other in flicker strength (CV of per-candle sd).
struct Multi { float mean, dips, movement, strengthSpread; };
static Multi runMany(const Params &p, int N = 23, float seconds = 120, uint32_t seed = 777) {
  const int F = (int)(seconds * 42); const float dt = 1.0f / 42;
  Rng rng; rng.s = seed; std::vector<Candle> c(N); for (auto &k : c) initCandle(k, rng);
  std::vector<double> s(N), s2(N); std::vector<float> prev(N, 1); double below = 0, mv = 0;
  for (int t = 0; t < F; t++) for (int i = 0; i < N; i++) {
    float L = stepCandle(c[i], p, dt, rng); s[i] += L; s2[i] += L * L; below += L < 0.7f; mv += fabsf(L - prev[i]); prev[i] = L; }
  double m = 0, a = 0, b = 0;
  for (int i = 0; i < N; i++) { double mi = s[i] / F, sd = sqrt(fmax(0, s2[i] / F - mi * mi)); m += mi; a += sd; b += sd * sd; }
  m /= N; a /= N; double cv = sqrt(fmax(0, b / N - a * a)) / a;
  return {(float)m, (float)(below / ((double)N * F)), (float)(mv / ((double)N * F)), (float)cv};
}

int main() {
  // 1. Bounds over a long run with aggressive settings
  { Params p{1, 1, 1, 0, 1}; Stats s = run(p, 600, 42, 123);
    CHECK(s.minL >= kMinLevel - 1e-6f && s.maxL <= 1.0f + 1e-6f, "level stays within [kMinLevel, 1] (10 min, max settings)"); }

  // 2. Depth 0 and no gusts -> steady full flame
  { Params p{0.5f, 0, 0.5f, 0.5f, 0}; Stats s = run(p, 60, 42, 7);
    CHECK(s.minL > 0.999f, "depth 0 + no gusts = steady flame"); }

  // 3. More depth -> lower average level
  { Params lo{0.4f, 0.2f, 0.3f, 0.4f, 0}, hi{0.4f, 0.9f, 0.3f, 0.4f, 0};
    CHECK(run(hi, 120, 42, 9).mean < run(lo, 120, 42, 9).mean - 0.05f, "more flicker depth dims the average flame"); }

  // 4. Softness reduces frame-to-frame roughness
  { Params hard{0.6f, 0.8f, 0.3f, 0.0f, 0}, soft{0.6f, 0.8f, 0.3f, 1.0f, 0};
    float rh = run(hard, 120, 42, 11).roughness, rs = run(soft, 120, 42, 11).roughness;
    printf("      roughness hard=%.4f soft=%.4f\n", rh, rs);
    CHECK(rs < rh * 0.5f, "softness smooths the flame (roughness at least halved)"); }

  // 5. Speed increases roughness
  { Params slow{0.0f, 0.8f, 0.2f, 0.2f, 0}, fast{1.0f, 0.8f, 0.2f, 0.2f, 0};
    CHECK(run(fast, 120, 42, 13).roughness > run(slow, 120, 42, 13).roughness * 2, "speed makes the flame busier"); }

  // 6. Gusts produce occasional deep dips even at low depth
  { Params calm{0.4f, 0.1f, 0.2f, 0.3f, 0}, windy{0.4f, 0.1f, 0.2f, 0.3f, 1};
    CHECK(run(windy, 120, 42, 15).minL < run(calm, 120, 42, 15).minL - 0.2f, "gusts cause occasional deep dips"); }

  // 7. Noise is continuous across the periodic wrap
  { float maxJump = 0; for (float x = 1020; x < 1028; x += 0.001f) {
      float a = valueNoise(wrapPos(x), 42), b = valueNoise(wrapPos(x + 0.001f), 42); maxJump = fmaxf(maxJump, fabsf(a - b)); }
    CHECK(maxJump < 0.01f, "noise has no discontinuity at the wrap point"); }

  // 8. Variable frame times (WLED frames are not perfectly regular) stay stable
  { Params p{0.7f, 0.9f, 0.8f, 0.1f, 0.5f}; Rng rng; rng.s = 99; Candle c; initCandle(c, rng); bool ok = true;
    for (int i = 0; i < 20000; i++) { float dt = (5 + rng.next() % 96) / 1000.0f; float L = stepCandle(c, p, dt, rng); if (!(L >= kMinLevel && L <= 1.0f) || std::isnan(L)) ok = false; }
    CHECK(ok, "stable with irregular frame times (5-100 ms)"); }

  // 9. White extraction: pale warm colour moves onto W, saturated orange stays RGB
  { uint8_t r = 255, g = 196, b = 105, w; extractWhite(r, g, b, w, 255, 180, 107, 1.0f);
    printf("      warm white (255,196,105) -> rgbw(%d,%d,%d,%d)\n", r, g, b, w);
    CHECK(w > 200 && b < 10, "pale warm colour goes mostly to the W channel");
    uint8_t r2 = 255, g2 = 85, b2 = 0, w2; extractWhite(r2, g2, b2, w2, 255, 180, 107, 1.0f);
    CHECK(w2 == 0 && r2 == 255 && g2 == 85, "saturated orange stays on RGB"); }

  // 10. Palette index range never reaches the wrap zone
  CHECK(paletteIndexForLevel(1.0f) == 240 && paletteIndexForLevel(0.0f) == 0, "palette index spans 0..240");

  // 13. "Warm white" palette (white boost 1.25): a tall flame is the white LED at 100% plus a 20% amber
  //     layer (W 255 + RGB ~51,27,0), never bare white; the 71% stop keeps its earlier output (W ~166 + amber ~89).
  { uint8_t r = 255, g = 169, b = 88, w = 0; extractWhite(r, g, b, w, 255, 177, 110, 1.25f);
    printf("      warm-white top (255,169,88) x1.25 -> rgbw(%d,%d,%d,%d)\n", r, g, b, w);
    CHECK(w == 255 && b == 0 && r >= 48 && r <= 54 && g >= 24 && g <= 30, "Warm white top = W 100% + 20% amber");
    uint8_t r2 = 222, g2 = 139, b2 = 57, w2 = 0; extractWhite(r2, g2, b2, w2, 255, 177, 110, 1.25f);
    printf("      warm-white 71%% stop (222,139,57) x1.25 -> rgbw(%d,%d,%d,%d)\n", r2, g2, b2, w2);
    CHECK(b2 == 0 && w2 >= 160 && w2 <= 172 && r2 >= 84 && r2 <= 94, "its 71% stop keeps W ~166 + amber ~89"); }

  // 11. Candles flicker independently: 12 candles sharing one Rng, exactly as the effect runs them
  //     (Unison off), at the effect's default sliders (sx 80, ix 90, c1 100, c2 110, c3 6).
  { const int N = 12, frames = 120 * 42; const float dt = 1.0f / 42;   // 2 min: slower flames need a longer sample
    Params p{80 / 255.0f, 90 / 255.0f, 100 / 255.0f, 110 / 255.0f, 6 / 31.0f};
    Rng rng; rng.s = 0xC0FFEEu; std::vector<Candle> c(N);
    for (auto &k : c) initCandle(k, rng);
    std::vector<std::vector<float>> L(N, std::vector<float>(frames));
    for (int t = 0; t < frames; t++) for (int i = 0; i < N; i++) L[i][t] = stepCandle(c[i], p, dt, rng);
    float maxR = 0, sumR = 0; int pairs = 0;
    for (int i = 0; i < N; i++) for (int j = i + 1; j < N; j++) {
      double mi = 0, mj = 0; for (int t = 0; t < frames; t++) { mi += L[i][t]; mj += L[j][t]; }
      mi /= frames; mj /= frames;
      double cov = 0, vi = 0, vj = 0;
      for (int t = 0; t < frames; t++) { double a = L[i][t] - mi, b = L[j][t] - mj; cov += a * b; vi += a * a; vj += b * b; }
      float r = fabsf((float)(cov / sqrt(vi * vj))); maxR = fmaxf(maxR, r); sumR += r; pairs++;
    }
    float spread = 0;  // mean across frames of the max-min level spread between candles
    for (int t = 0; t < frames; t++) { float lo = 1, hi = 0; for (int i = 0; i < N; i++) { lo = fminf(lo, L[i][t]); hi = fmaxf(hi, L[i][t]); } spread += hi - lo; }
    spread /= frames;
    printf("      (independence: mean |r| %.3f, max |r| %.3f, mean spread %.3f)\n", sumR / pairs, maxR, spread);
    CHECK(sumR / pairs < 0.15f && maxR < 0.4f, "candles flicker independently (pairwise level correlation low)");
    CHECK(spread > 0.15f, "at any moment the candles are visibly at different heights"); }

  // 12. Every slider visibly changes the flame (min vs max, others at the effect defaults).
  //     Added 2026-11-06 because the sliders barely did anything on real candles (the old model's flicker
  //     was too shallow: ~90% height, below 70% only 3% of the time, and Randomness had no effect).
  { const Params D{80 / 255.0f, 90 / 255.0f, 100 / 255.0f, 110 / 255.0f, 6 / 31.0f};
    auto with = [&](float Params::*f, float v) { Params p = D; p.*f = v; return runMany(p); };
    Multi s0 = with(&Params::speed, 0), s1 = with(&Params::speed, 1);
    Multi d0 = with(&Params::depth, 0), d1 = with(&Params::depth, 1);
    Multi r0 = with(&Params::randomness, 0), r1 = with(&Params::randomness, 1);
    Multi f0 = with(&Params::softness, 0), f1 = with(&Params::softness, 1);
    Multi g0 = with(&Params::gusts, 0), g1 = with(&Params::gusts, 1);
    Multi def = runMany(D);
    printf("      defaults: mean %.2f, below 0.7 %.0f%% of the time\n", def.mean, def.dips * 100);
    printf("      speed movement %.4f -> %.4f | depth mean %.2f -> %.2f, dips %.0f%% | randomness spread %.0f%% -> %.0f%%\n",
           s0.movement, s1.movement, d0.mean, d1.mean, d1.dips * 100, r0.strengthSpread * 100, r1.strengthSpread * 100);
    printf("      softness movement %.4f -> %.4f | gusts movement %.4f -> %.4f\n", f0.movement, f1.movement, g0.movement, g1.movement);
    CHECK(def.dips > 0.08f && def.dips < 0.35f, "defaults flicker visibly but calmly (below 70% height 8-35% of the time)");
    CHECK(s1.movement > s0.movement * 3, "Speed: max moves at least 3x as much as min");
    CHECK(d0.mean - d1.mean > 0.25f && d1.dips > 0.35f, "Flicker depth: max dims the flame by 0.25+ and dips it often");
    CHECK(r1.strengthSpread > 3 * r0.strengthSpread && r1.strengthSpread > 0.2f, "Randomness: max makes candles clearly differ");
    CHECK(f1.movement < f0.movement * 0.35f, "Softness: max cuts movement to a third or less");
    CHECK(g1.movement > g0.movement * 2.5f, "Gusts: max at least 2.5x the movement of none"); }

  // 14. Editable palettes: config text round-trips, and bad input is rejected without touching the palette.
  { PaletteStops p; bool ok = parseStops("0:FB8807 70:F28917 255:ffa958 b125", p);
    char buf[80]; if (ok) formatStops(p, buf, sizeof(buf)); else buf[0] = 0;
    printf("      parsed -> \"%s\"\n", buf);
    CHECK(ok && p.len == 3 && p.boost == 125 && p.grad[4] == 70 && p.grad[5] == 0xF2 && !strcmp(buf, "0:FB8807 70:F28917 255:FFA958 b125"),
          "palette text parses and formats back identically");
    PaletteStops q = p; bool bad = false;
    for (const char *s : {"10:FF0000 255:00FF00", "0:FF0000 128:00FF00", "0:FF0000 200:00FF00 100:0000FF 255:000000",
                          "0:FF00 255:00FF00", "0:FF0000", "0:FF0000 255:00FF00 b50",
                          "0:000000 20:000000 40:000000 60:000000 80:000000 100:000000 120:000000 140:000000 255:000000"})
      bad |= parseStops(s, q);
    CHECK(!bad && q.len == p.len && !memcmp(q.grad, p.grad, 4 * p.len), "bad palette text is rejected and leaves the palette alone");
    PaletteStops d; CHECK(parseStops("0:000000, 255:FFFFFF", d) && d.boost == 100, "commas work as separators; boost defaults to 100"); }

  // 15. Palette names: safe characters only (they end up in JSON and WLED's HTML), 1-20 long, trimmed.
  { bool good = validPalName("Classic") && validPalName("Warm white (2)") && validPalName("A") &&
                validPalName("Twenty chars exactly");
    bool bad = validPalName("") || validPalName(" lead") || validPalName("trail ") || validPalName("<b>x</b>") ||
               validPalName("quote\"s") || validPalName("amp&") || validPalName("twenty-one chars long");
    CHECK(good && !bad, "palette names: safe characters, 1-20 long, no leading/trailing space"); }

  // 16. Not fluttery (2026-11-07: it still looked a bit too fluttery). At calm sliders (sx 80, ix 75, c1 110,
  //     c2 150, c3 6) the flame changes direction about once a second, not 3x; was 3.0/s before the calming.
  { Params p{80 / 255.0f, 75 / 255.0f, 110 / 255.0f, 150 / 255.0f, 6 / 31.0f};
    const int N = 23, F = 120 * 42; const float dt = 1.0f / 42;
    Rng rng; rng.s = 4242; std::vector<Candle> c(N); for (auto &k : c) initCandle(k, rng);
    double wig = 0; std::vector<float> prev(N, 1), pd(N, 0);
    for (int t = 0; t < F; t++) for (int i = 0; i < N; i++) {
      float L = stepCandle(c[i], p, dt, rng), d = L - prev[i]; prev[i] = L;
      if (fabsf(d) > 0.002f) { if (d * pd[i] < 0) wig++; pd[i] = d; } }
    const double perSec = wig / N / 120.0;
    printf("      calm-look direction changes: %.2f per second per candle\n", perSec);
    CHECK(perSec < 1.6, "calm look: under 1.6 direction changes per second"); }

  // 17. The longest palette text fits the config buffer and round-trips (2026-11-07: a 7-stop palette was cut short
  //     in cfg.json by a 72-byte buffer and lost at the next boot).
  { PaletteStops p; p.len = kMaxStops; p.boost = 150;
    const uint8_t idx[kMaxStops] = {0, 100, 140, 175, 200, 225, 240, 255};
    for (unsigned i = 0; i < kMaxStops; i++) { p.grad[4 * i] = idx[i]; p.grad[4 * i + 1] = 0xF1; p.grad[4 * i + 2] = 0xC9; p.grad[4 * i + 3] = 0xFE; }
    char buf[kStopsTextLen]; const bool fit = formatStops(p, buf, sizeof(buf));
    PaletteStops q; const bool ok = parseStops(buf, q);
    printf("      longest palette text: %u chars (buffer %u)\n", (unsigned)strlen(buf), kStopsTextLen);
    CHECK(fit && ok && q.len == p.len && q.boost == 150 && !memcmp(q.grad, p.grad, 4 * kMaxStops),
          "8-stop palette with boost formats in full and parses back");
    char small[72]; CHECK(!formatStops(p, small, sizeof(small)), "formatStops reports a buffer that's too small"); }

  // Write example traces (10 s at 42 fps) for plotting
  struct Preset { const char *name; Params p; } presets[] = {
    {"Calm - soft and shallow",    {0.30f, 0.45f, 0.40f, 0.75f, 0.00f}},
    {"Default",                 {0.31f, 0.55f, 0.39f, 0.43f, 0.19f}},
    {"Drafty (gusts)",          {0.45f, 0.60f, 0.60f, 0.35f, 0.85f}},
    {"Frenetic - fast and hard",   {0.85f, 0.85f, 0.80f, 0.05f, 0.30f}},
  };
  FILE *f = fopen("traces.csv", "w");
  std::vector<std::vector<float>> tr(4);
  for (int k = 0; k < 4; k++) run(presets[k].p, 10, 42, 1000 + k, &tr[k]);
  fprintf(f, "t"); for (auto &pr : presets) fprintf(f, ",%s", pr.name); fprintf(f, "\n");
  for (size_t i = 0; i < tr[0].size(); i++) { fprintf(f, "%.4f", i / 42.0f); for (int k = 0; k < 4; k++) fprintf(f, ",%.4f", tr[k][i]); fprintf(f, "\n"); }
  fclose(f);

  printf(failures ? "\n%d FAILED\n" : "\nall tests passed\n", failures);
  return failures ? 1 : 0;
}
