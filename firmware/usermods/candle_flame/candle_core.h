// SPDX-License-Identifier: EUPL-1.2
// candle_core.h - portable candle flame model for the "Candle Flame" WLED effect.
//
// No WLED or Arduino dependencies, so the same code runs on the ESP32 and in the
// host-side tests (test/sim_test.cpp).
//
// Model, per candle:
//   * Two octaves of smooth 1D noise (a slow "wander" and a fast "flicker") produce
//     a dip signal. Most of the time the flame sits near full height; the noise
//     occasionally pulls it down. Flicker depth scales how far it can dip.
//   * Randomness gives each candle its own tempo and temperament (calm or lively),
//     both drifting slowly over time, so candles differ from each other.
//   * Random "gusts" add a decaying ~5-9 Hz flutter, like a draft hitting a real
//     flame (real candles flicker around 5 Hz when disturbed).
//   * The result is low-pass filtered with separate rise/fall time constants.
//     Softness sets the time constant: 0 = hard and jumpy, 1 = slow and rolling.
//     Falls are faster than rises, which reads as a flame being knocked down and
//     recovering.
// The output "level" (0..1) drives both brightness and the palette position, so
// a dipping flame gets dimmer AND moves toward the low-flame end of the palette.

#pragma once
#include <cstdint>
#include <cmath>

namespace candleflame {

// All parameters normalised to 0..1 (the WLED glue maps sliders onto these).
struct Params {
  float speed;       // flicker speed
  float depth;       // how far the flame can dip
  float randomness;  // per-candle and over-time tempo variation
  float softness;    // 0 = hard/jumpy, 1 = soft/rolling
  float gusts;       // how often drafts disturb the flame
};

// Per-candle state. Kept small: 32 bytes.
struct Candle {
  float    pSlow;      // noise position, slow octave   [0, kNoisePeriod)
  float    pFast;      // noise position, fast octave   [0, kNoisePeriod)
  float    pTempo;     // noise position, tempo wander  [0, kNoisePeriod)
  float    level;      // smoothed output 0..1
  float    gust;       // current gust energy 0..1
  float    gustPhase;  // flutter phase, radians
  float    jitter;     // fixed per-candle random in [-1, 1], scaled by randomness
  uint32_t seed;       // noise seed
};

// Simple xorshift32 RNG; deterministic so host tests are repeatable.
struct Rng {
  uint32_t s = 0x9E3779B9u;
  uint32_t next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
  float uniform() { return (next() >> 8) * (1.0f / 16777216.0f); } // [0,1)
};

constexpr float kNoisePeriod = 1024.0f;  // noise is periodic, so positions wrap seamlessly
constexpr float kMinLevel    = 0.08f;    // never fully dark (unless brightness says so)
constexpr float kTwoPi       = 6.28318530718f;

// Integer hash -> [0,1]
inline float hash01(uint32_t n) {
  n = (n << 13) ^ n;
  n = n * (n * n * 15731u + 789221u) + 1376312589u;
  return (n & 0x00FFFFFFu) * (1.0f / 16777215.0f);
}

// Smooth 1D value noise in [0,1], periodic over kNoisePeriod (lattice wraps at 1024).
inline float valueNoise(float x, uint32_t seed) {
  const float fl = floorf(x);
  const uint32_t i0 = static_cast<uint32_t>(static_cast<int32_t>(fl)) & 1023u;
  const uint32_t i1 = (i0 + 1u) & 1023u;
  const float f = x - fl;
  const float u = f * f * (3.0f - 2.0f * f);  // smoothstep
  const float a = hash01(i0 * 0x9E3779B1u ^ seed);
  const float b = hash01(i1 * 0x9E3779B1u ^ seed);
  return a + (b - a) * u;
}

inline float wrapPos(float p) {
  if (p >= kNoisePeriod) p -= kNoisePeriod * floorf(p / kNoisePeriod);
  return p;
}

inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

inline void initCandle(Candle &c, Rng &rng) {
  c.seed      = rng.next();
  c.pSlow     = rng.uniform() * kNoisePeriod;
  c.pFast     = rng.uniform() * kNoisePeriod;
  c.pTempo    = rng.uniform() * kNoisePeriod;
  c.level     = 1.0f;
  c.gust      = 0.0f;
  c.gustPhase = rng.uniform() * kTwoPi;
  c.jitter    = rng.uniform() * 2.0f - 1.0f;
}

// Advance one candle by dt seconds and return its new level (kMinLevel..1).
// Every slider is tuned to have a clearly visible effect across its whole range
// (test/sim_test.cpp checks this); see the per-section notes.
inline float stepCandle(Candle &c, const Params &p, float dt, Rng &rng) {
  if (dt <= 0.0f) return c.level;
  const float speed = clamp01(p.speed), depth = clamp01(p.depth), rnd = clamp01(p.randomness);
  const float soft = clamp01(p.softness), gusts = clamp01(p.gusts);

  // --- tempo ---------------------------------------------------------------
  // Speed: 0.2x .. 4x of the base rates (exponential so the slider feels even). The fast octave's base rate
  // was lowered 2026-11-07, so every setting is calmer than before.
  const float speedScale = 0.2f * powf(20.0f, speed);
  // Randomness part 1: each candle gets its own tempo (+-75%), which also wanders over time (+-80%).
  const float tempoWander = (valueNoise(c.pTempo, c.seed ^ 0x51ED270Bu) - 0.5f) * 2.0f;
  float tempo = (1.0f + rnd * 0.75f * c.jitter) * (1.0f + rnd * 0.80f * tempoWander);
  if (tempo < 0.15f) tempo = 0.15f;
  const float rate = speedScale * tempo;

  c.pSlow  = wrapPos(c.pSlow  + 0.8f  * rate * dt);  // ~0.16-3.2 Hz wander
  c.pFast  = wrapPos(c.pFast  + 4.5f  * rate * dt);  // ~0.9-18 Hz flicker (calmed 2026-11-07: was 6.0)
  c.pTempo = wrapPos(c.pTempo + 0.15f * dt);         // character drifts over ~7 s

  // Randomness part 2: a temperament per candle (some calm, some lively) that also drifts,
  // so at high randomness the candles visibly differ from each other and over time.
  const float temper   = hash01(c.seed ^ 0x7E3A91C5u) * 2.0f - 1.0f;
  const float restless = (valueNoise(c.pTempo * 0.6f + 300.0f, c.seed ^ 0x3C6EF372u) - 0.5f) * 2.0f;
  float depthScale = 1.0f + rnd * (0.75f * temper + 1.1f * restless);
  if (depthScale < 0.05f) depthScale = 0.05f;
  if (depthScale > 2.2f)  depthScale = 2.2f;

  // --- base flicker --------------------------------------------------------
  // Softness also mutes the fast octave, so a soft flame rolls instead of jittering.
  const float fastW = 0.45f * (1.0f - 0.6f * soft);
  const float n = (1.0f - fastW) * valueNoise(c.pSlow, c.seed)
                + fastW * valueNoise(c.pFast, c.seed ^ 0xA5A5A5A5u);
  // Blended noise clusters around 0.5, so stretch it; then only the upper part dips the flame,
  // which keeps a real candle's habit of spending much of its time near full height.
  const float ns = clamp01((n - 0.5f) * 2.4f + 0.5f);
  const float dipBase = clamp01((ns - 0.25f) / 0.75f);
  const float dip = depth * depthScale * powf(dipBase, 1.3f) * 0.9f;

  // --- gusts ---------------------------------------------------------------
  // Calmed 2026-11-07 (the flame looked too fluttery): gusts were most of the flutter even at a low setting. Rarer at the low end
  // (squared), and the draft is a slower ~3 Hz sway instead of a 5-9 Hz shake.
  const float gustRate = gusts * gusts * 0.9f;        // events per second per candle (max 0.9)
  if (gustRate > 0.0f && rng.uniform() < gustRate * dt) {
    c.gust = clamp01(c.gust + 0.5f + 0.5f * rng.uniform());
  }
  c.gust *= expf(-dt / 0.9f);                         // a draft dies away in ~1-2 s
  const float flutterHz = 3.0f * (1.0f + 0.2f * c.jitter);   // 2.4-3.6 Hz sway
  c.gustPhase += kTwoPi * flutterHz * dt;
  if (c.gustPhase > kTwoPi) c.gustPhase -= kTwoPi * floorf(c.gustPhase / kTwoPi);
  const float gustDip = c.gust * 0.5f * (0.5f + 0.5f * sinf(c.gustPhase));

  // --- target & smoothing ---------------------------------------------------
  float target = 1.0f - (dip + gustDip);
  if (target < kMinLevel) target = kMinLevel;

  const float tauRise = 0.010f + 0.50f * powf(soft, 1.4f);   // 10 ms .. 510 ms (was 4-304 ms)
  const float tau = (target < c.level) ? tauRise * 0.6f : tauRise;  // drop faster than recover
  const float a = 1.0f - expf(-dt / tau);
  c.level += (target - c.level) * a;
  if (c.level < kMinLevel) c.level = kMinLevel;
  if (c.level > 1.0f) c.level = 1.0f;
  return c.level;
}

// Palette position for a level: 0 = low-flame colour, 240 = high-flame colour.
// (Stops at 240 so palettes don't wrap back to their first colour at the top.)
inline uint8_t paletteIndexForLevel(float level) {
  return static_cast<uint8_t>(clamp01(level) * 240.0f + 0.5f);
}

// Brightness (0..255) for a level.
inline uint8_t brightnessForLevel(float level) {
  return static_cast<uint8_t>(clamp01(level) * 255.0f + 0.5f);
}

// Move the part of an RGB colour that matches the warm-white LED onto the W channel.
// (wr, wg, wb) is the white LED's colour as RGB (from its Kelvin rating);
// gain scales W to match the white LED's actual brightness (1.0 = nominal).
// Saturated colours (deep orange, green, purple) have little white in them and
// stay on RGB; pale warm colours at the top of a candle palette move onto W.
inline void extractWhite(uint8_t &r, uint8_t &g, uint8_t &b, uint8_t &w,
                         uint8_t wr, uint8_t wg, uint8_t wb, float gain) {
  if (wr == 0 || wg == 0 || wb == 0) { w = 0; return; }
  float k = r / (float)wr;
  const float kg = g / (float)wg; if (kg < k) k = kg;
  const float kb = b / (float)wb; if (kb < k) k = kb;
  if (k <= 0.0f) { w = 0; return; }
  if (k > 1.0f) k = 1.0f;
  const float rr = r - k * wr, gg = g - k * wg, bb = b - k * wb;
  r = static_cast<uint8_t>(rr < 0 ? 0 : rr + 0.5f);
  g = static_cast<uint8_t>(gg < 0 ? 0 : gg + 0.5f);
  b = static_cast<uint8_t>(bb < 0 ? 0 : bb + 0.5f);
  float ww = k * 255.0f * gain;
  w = static_cast<uint8_t>(ww > 255.0f ? 255 : ww + 0.5f);
}

// ---------------------------------------------------------------------------
// Editable palettes. A palette is 2-8 gradient stops (index 0..255, R, G, B), first index 0, last 255,
// strictly increasing, plus a W boost (100-200 %) applied with "Warm white LED" on. Stored in WLED's
// config as text, e.g. "0:FB8807 70:F28917 255:FFA958 b125" (the b-term is omitted when 100).
// ---------------------------------------------------------------------------
constexpr unsigned kMaxStops = 8;
struct PaletteStops {
  uint8_t grad[4 * kMaxStops];  // WLED dynamic-gradient layout: index, R, G, B per stop
  uint8_t len = 0;              // number of stops
  uint8_t boost = 100;          // W boost, percent
};

inline bool validStops(const PaletteStops &p) {
  if (p.len < 2 || p.len > kMaxStops) return false;
  if (p.grad[0] != 0 || p.grad[4 * (p.len - 1)] != 255) return false;
  for (unsigned i = 1; i < p.len; i++) if (p.grad[4 * i] <= p.grad[4 * (i - 1)]) return false;
  return p.boost >= 100 && p.boost <= 200;
}

// Parse "idx:RRGGBB ... [bNNN]" (separators: spaces or commas). Returns false and leaves out alone on error.
inline bool parseStops(const char *s, PaletteStops &out) {
  PaletteStops t;
  auto hex = [](char c) -> int { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10
                                      : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; };
  const char *q = s;
  while (*q) {
    while (*q == ' ' || *q == ',') q++;
    if (!*q) break;
    if (*q == 'b' || *q == 'B') {
      int v = 0, digits = 0; q++;
      while (*q >= '0' && *q <= '9') { v = v * 10 + (*q - '0'); q++; if (++digits > 3) return false; }
      if (!digits) return false;
      t.boost = (uint8_t)(v > 255 ? 255 : v);
      continue;
    }
    int idx = 0, digits = 0;
    while (*q >= '0' && *q <= '9') { idx = idx * 10 + (*q - '0'); q++; if (++digits > 3) return false; }
    if (!digits || *q != ':' || idx > 255) return false;
    q++;
    uint32_t rgb = 0;
    for (int k = 0; k < 6; k++) { int h = hex(*q); if (h < 0) return false; rgb = (rgb << 4) | (uint32_t)h; q++; }
    if (t.len >= kMaxStops) return false;
    uint8_t *g = &t.grad[4 * t.len++];
    g[0] = (uint8_t)idx; g[1] = (uint8_t)(rgb >> 16); g[2] = (uint8_t)(rgb >> 8); g[3] = (uint8_t)rgb;
  }
  if (!validStops(t)) return false;
  out = t;
  return true;
}

// Longest text: kMaxStops stops of "255:RRGGBB" (10), spaces between them, " b150" and the terminator = 93.
// 2026-11-07: addToConfig used a 72-byte buffer, so a 7-stop palette lost its last digit in cfg.json, failed to
// parse at the next boot and vanished after an OTA update.
constexpr unsigned kStopsTextLen = kMaxStops * 10 + (kMaxStops - 1) + 5 + 1;
// Format as "idx:RRGGBB ..." plus " bNNN" when boost != 100. Returns false if buf was too small (text cut).
inline bool formatStops(const PaletteStops &p, char *buf, unsigned size) {
  static const char H[] = "0123456789ABCDEF";
  unsigned n = 0; bool fit = size > 0;
  auto put = [&](char c) { if (n + 1 < size) buf[n++] = c; else fit = false; };
  for (unsigned i = 0; i < p.len; i++) {
    const uint8_t *g = &p.grad[4 * i];
    if (i) put(' ');
    unsigned v = g[0];
    if (v >= 100) put((char)('0' + v / 100));
    if (v >= 10) put((char)('0' + (v / 10) % 10));
    put((char)('0' + v % 10));
    put(':');
    for (int k = 1; k <= 3; k++) { put(H[g[k] >> 4]); put(H[g[k] & 15]); }
  }
  if (p.boost != 100) {
    put(' '); put('b');
    unsigned v = p.boost;
    if (v >= 100) put((char)('0' + v / 100));
    if (v >= 10) put((char)('0' + (v / 10) % 10));
    put((char)('0' + v % 10));
  }
  if (size) buf[n < size ? n : size - 1] = 0;
  return fit;
}

// Palette display names (editable): 1-20 characters, letters, digits, space and - _ . ( ) +, no leading or
// trailing space. Nothing that needs escaping in JSON or HTML (WLED's own UI builds its list with innerHTML).
constexpr unsigned kMaxNameLen = 20;
inline bool validPalName(const char *s) {
  unsigned n = 0;
  for (const char *q = s; *q; q++, n++) {
    const char c = *q;
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                    c == ' ' || c == '-' || c == '_' || c == '.' || c == '(' || c == ')' || c == '+';
    if (!ok || n >= kMaxNameLen) return false;
  }
  return n > 0 && s[0] != ' ' && s[n - 1] != ' ';
}

} // namespace candleflame
