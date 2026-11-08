// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// candle_flame.cpp - "Candle Flame" effect + candle/holiday palettes for WLED 16.x
//
// Adds one effect and ten named palettes. The flame model itself lives in
// candle_core.h (shared with the host-side tests).
//
// Effect controls (WLED effect sliders/checkboxes):
//   Speed          (sx) flicker speed
//   Flicker depth  (ix) how far a flame can dip (0 = steady)
//   Randomness     (c1) how much candles differ from each other (tempo and temperament)
//   Softness       (c2) 0 = hard/jumpy, 255 = soft/rolling
//   Gusts          (c3) how often a draft disturbs the flame (0-31)
//   Unison         (o1) every candle in the segment shares one flame (kept for completeness;
//                       the design calls for individual candles, so it's normally off)
//   (o2 unused: "Spread palette" was removed 2026-11-06)
//   Warm white LED (o3) move warm-white light onto the W channel (RGBW pixels)
//
// Palette: the flame's height picks the colour, low end (index 0) = low flame,
// high end = tall flame. Any WLED palette works, including custom 2-5 stop
// palettes made in WLED's palette editor. Palette "Default" = solid segment colour.
//
// Patterns (alternating, groups of 3/4): use overlapping segments with
// grouping 1 + spacing N-1 + an offset, each with its own palette. Gap pixels
// are left untouched by WLED, so interleaved segments combine cleanly.

#include "wled.h"
#include "candle_core.h"

using namespace candleflame;

// ---------------------------------------------------------------------------
// Settings shared between the usermod (config page) and the effect function
// ---------------------------------------------------------------------------
static uint16_t s_whiteKelvin = 3000;   // colour temperature of the pixels' white LED
static uint8_t  s_whiteGainPct = 100;   // W brightness trim, 50-200 %
static uint8_t  s_wr = 255, s_wg = 180, s_wb = 107;  // white LED as RGB (from Kelvin)

static void updateWhiteReference() {
  byte rgb[4] = {0, 0, 0, 0};
  colorKtoRGB(s_whiteKelvin, rgb);
  s_wr = rgb[0]; s_wg = rgb[1]; s_wb = rgb[2];
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------
struct FlameHeader {
  Rng      rng;
  uint16_t count;      // number of candles the state was built for
  uint16_t reserved;
};

static float paletteWBoost(uint8_t pal);  // per-palette W boost (defined after kPalettes)

static void mode_static_fallback() { SEGMENT.fill(SEGCOLOR(0)); }

static void mode_candle_flame(void) {
  const unsigned n = SEGLEN;
  if (n == 0) { mode_static_fallback(); return; }

  const size_t bytes = sizeof(FlameHeader) + n * sizeof(Candle);
  if (!SEGENV.allocateData(bytes)) { mode_static_fallback(); return; }
  FlameHeader *hdr = reinterpret_cast<FlameHeader *>(SEGENV.data);
  Candle *candles  = reinterpret_cast<Candle *>(SEGENV.data + sizeof(FlameHeader));

  // (Re)initialise on first call or if the segment length changed
  if (SEGENV.call == 0 || hdr->count != n) {
    hdr->rng.s = hw_random() | 1u;  // xorshift must not start at 0
    hdr->count = n;
    for (unsigned i = 0; i < n; i++) initCandle(candles[i], hdr->rng);
    SEGENV.step = strip.now;
  }

  // Elapsed time since the last frame, clamped so a stall doesn't cause a jump
  float dt = (strip.now - SEGENV.step) * 0.001f;
  SEGENV.step = strip.now;
  if (dt < 0.0f) dt = 0.0f;
  if (dt > 0.1f) dt = 0.1f;

  Params p;
  p.speed      = SEGMENT.speed     / 255.0f;
  p.depth      = SEGMENT.intensity / 255.0f;
  p.randomness = SEGMENT.custom1   / 255.0f;
  p.softness   = SEGMENT.custom2   / 255.0f;
  p.gusts      = SEGMENT.custom3   / 31.0f;

  const bool unison = SEGMENT.check1;
  const bool useW   = SEGMENT.check3;
  const float gain  = s_whiteGainPct / 100.0f * paletteWBoost(SEGMENT.palette);

  // Unison: one shared flame (candle 0) drives every pixel in the segment
  const unsigned active = unison ? 1 : n;
  for (unsigned i = 0; i < active; i++) stepCandle(candles[i], p, dt, hdr->rng);

  for (unsigned i = 0; i < n; i++) {
    const float level = unison ? candles[0].level : candles[i].level;
    const uint8_t idx = paletteIndexForLevel(level);
    const uint32_t c = SEGMENT.color_from_palette(idx, false, false, 0, brightnessForLevel(level));
    uint8_t r = R(c), g = G(c), b = B(c), w = 0;  // ignore any W from the segment colour
    if (useW) extractWhite(r, g, b, w, s_wr, s_wg, s_wb, gain);
    SEGMENT.setPixelColor(i, RGBW32(r, g, b, w));
  }
}

// Metadata: name@sliders/checkboxes;colours;palette;flags;defaults
// Default palette 255 = "Candle: Classic" (first usermod palette, see setup()).
static const char _data_FX_MODE_CANDLE_FLAME[] PROGMEM =
  "Candle Flame@Speed,Flicker depth,Randomness,Softness,Gusts,Unison,,Warm white LED;!;!;1;"
  "sx=80,ix=90,c1=100,c2=110,c3=6,o3=1,pal=255";

// ---------------------------------------------------------------------------
// Palettes (gradient format: index, R, G, B ... last index must be 255)
// Low index = low/dipping flame, high index = tall flame.
// ---------------------------------------------------------------------------
static const uint8_t pal_classic[]  = {   0, 150,  28,   0,   90, 255,  85,   0,  170, 255, 140,  25,  255, 255, 196, 105 };
// Calmed 2026-11-07 (looked busier than Classic): same colours, steep stretches near the top spread out. Top warmed (was
// FFD696) so it no longer flips to a blue-green tint above the 3000 K white LED.
static const uint8_t pal_soft[] = {   0, 200,  70,  10,  80, 255, 140,  40, 165, 255, 190,  98,
                                       255, 255, 200, 119 };
static const uint8_t pal_deep[]     = {   0, 110,  12,   0,  128, 200,  48,   0,  255, 255, 110,  10 };
static const uint8_t pal_hw_orange[]= {   0, 120,  18,   0,  128, 255,  75,   0,  255, 255, 128,   0 };
static const uint8_t pal_hw_green[] = {   0,   0,  55,   0,  128,  30, 200,   0,  255, 120, 255,  20 };
// Calmed 2026-11-07 (looked busier than Classic): same colours, steep stretches near the top spread out. Low end lifted (was 28003C)
// so dips don't plunge to near-black.
static const uint8_t pal_hw_purple[] = {   0,  80,   0, 116, 110, 120,   0, 200, 255, 176,  48, 240 };
static const uint8_t pal_xm_red[]   = {   0,  90,   0,   0,  128, 220,   0,   0,  255, 255,  40,  20 };
static const uint8_t pal_xm_green[] = {   0,   0,  60,   0,  128,   0, 180,  10,  255,  40, 255,  40 };
// Calmed 2026-11-07 (looked busier than Classic): same colours, steep stretches near the top spread out. Top warmed (was FFDCAA).
static const uint8_t pal_xm_white[] = {   0, 180,  90,  30, 100, 255, 180, 100, 255, 255, 212, 150 };
// Warm white: W-first. A tall flame (most of the time) is the white LED at 100% plus a 20% amber layer
// (W 255 + RGB 51,27,0). A palette colour can't hold "full white plus extra" (the white LED's colour,
// colorKtoRGB(3000) = 255,177,110, already uses all of red), so this palette is encoded with W at 80% and has
// a white boost of 1.25 (kPalettes wBoostPct) that lifts it back to 100% after extraction. Lower stops are
// encoded for these outputs (W/amber, amber hue 255,135,0): 20/235 at the bottom, 70/190 (idx 60), 130/140 (120),
// 195/95 (175), 255/51 from 235 up. 2026-11-07: the ramp was spread evenly (it used to jump from W 166 to 255
// between idx 170 and 200, so the flame's smallest dips made big changes: 3.2 visible steps/s vs 2.0 now).
// Tuned on real candles 2026-11-06: subtler, not deep orange -> white always with amber -> 10% warmer ->
// top end at 100% W plus 20% amber. If whiteKelvin changes, re-encode from colorKtoRGB(whiteKelvin).
static const uint8_t pal_warm_w[] = {   0, 251, 136,   7,  60, 246, 139,  24, 120, 244, 146,  45,
                                       175, 251, 159,  67, 235, 255, 169,  88, 255, 255, 169,  88 };

static const char _palBase[]      PROGMEM = "Candle";
static const char _pn_classic[]   PROGMEM = "Classic";
static const char _pn_soft[]      PROGMEM = "Soft white";
static const char _pn_deep[]      PROGMEM = "Deep amber";
static const char _pn_hwOrange[]  PROGMEM = "Halloween orange";
static const char _pn_hwGreen[]   PROGMEM = "Halloween green";
static const char _pn_hwPurple[]  PROGMEM = "Halloween purple";
static const char _pn_xmRed[]     PROGMEM = "Christmas red";
static const char _pn_xmGreen[]   PROGMEM = "Christmas green";
static const char _pn_xmWhite[]   PROGMEM = "Christmas white";
static const char _pn_warmW[]     PROGMEM = "Warm white";

// Defaults. wBoostPct: extra W gain for this palette (100 = none), applied with "Warm white LED" on.
struct PalDef { const uint8_t *grad; uint8_t bytes; const char *name; uint8_t wBoostPct; };
#define PALDEF(arr, nm, boost) { arr, (uint8_t)sizeof(arr), nm, boost }
static const PalDef kPalettes[] = {
  PALDEF(pal_classic,   _pn_classic,  100),   // ID 255
  PALDEF(pal_soft,      _pn_soft,     100),   // ID 254
  PALDEF(pal_deep,      _pn_deep,     100),   // ID 253
  PALDEF(pal_hw_orange, _pn_hwOrange, 100),   // ID 252
  PALDEF(pal_hw_green,  _pn_hwGreen,  100),   // ID 251
  PALDEF(pal_hw_purple, _pn_hwPurple, 100),   // ID 250
  PALDEF(pal_xm_red,    _pn_xmRed,    100),   // ID 249
  PALDEF(pal_xm_green,  _pn_xmGreen,  100),   // ID 248
  PALDEF(pal_xm_white,  _pn_xmWhite,  100),   // ID 247
  PALDEF(pal_warm_w,    _pn_warmW,    125),   // ID 246 (append new palettes here so existing IDs never move)
};
constexpr unsigned kNumPal = sizeof(kPalettes) / sizeof(kPalettes[0]);
// After the built-ins come user-made palettes, added from the Candles page (2026-11-07): IDs 245 down,
// up to kMaxUserPal of them. WLED looks usermod palettes up by position (ID 255 - index), so an entry can never
// be removed while running without moving every later ID: a deleted user palette stays as a grey placeholder
// named kUnusedName ("pal<ID>":"-" in config) until it's reused; placeholders after the last used one are
// dropped at the next boot. usermodPalettes gets its full capacity reserved in setup(), so adding an entry
// never reallocates the vector while a frame is being rendered.
constexpr unsigned kMaxUserPal = 20;
constexpr unsigned kMaxPal = kNumPal + kMaxUserPal;
static const char kUnusedName[] = "(unused)";
static const uint8_t pal_unused[] = { 0, 64, 64, 64, 255, 64, 64, 64 };
static unsigned s_palRegistered = 0;   // our entries in usermodPalettes (built-ins + user incl. placeholders)
static unsigned s_palWanted = kNumPal; // entries needed (highest used user palette + 1); loop() registers more
static bool isUserPal(unsigned i) { return i >= kNumPal && i < kMaxPal; }

// Live palettes: start as the defaults above; the Candles page can edit them (saved in config as
// "pal<ID>" strings, see candle_core.h parseStops). Edited palettes keep their IDs, so looks keep working.
static PaletteStops s_pal[kMaxPal];
static bool s_palEdited[kMaxPal];
static bool s_palUsed[kMaxPal];        // user palettes: in use (false = free / placeholder)
// Display names, editable from the Candles page ("name<ID>" in config). WLED copies the name out of this
// buffer whenever it lists palettes (util.cpp extractModeName), so it can live in RAM.
static char s_palName[kMaxPal][kMaxNameLen + 1];
static void loadDefaultName(unsigned i) {
  strncpy(s_palName[i], i < kNumPal ? kPalettes[i].name : kUnusedName, kMaxNameLen); s_palName[i][kMaxNameLen] = 0;
}
static void loadPlaceholder(unsigned i) {   // free user palette: grey, named "(unused)"
  PaletteStops &p = s_pal[i];
  p.len = sizeof(pal_unused) / 4; memcpy(p.grad, pal_unused, sizeof(pal_unused)); p.boost = 100;
  s_palUsed[i] = false; s_palEdited[i] = false;
  loadDefaultName(i);
}

static void loadDefaultPalette(unsigned i) {
  if (i >= kNumPal) { loadPlaceholder(i); return; }
  PaletteStops &p = s_pal[i];
  p.len = kPalettes[i].bytes / 4;
  if (p.len > kMaxStops) p.len = kMaxStops;
  memcpy(p.grad, kPalettes[i].grad, p.len * 4);
  p.boost = kPalettes[i].wBoostPct;
  s_palEdited[i] = false;
}

static float paletteWBoost(uint8_t pal) {
  if (pal > 255 - s_palRegistered) return s_pal[255 - pal].boost / 100.0f;  // our palettes are IDs 255 down
  return 1.0f;
}

// Add our entries to usermodPalettes up to s_palWanted. Runs in setup() and loop() (the render task), never
// from the web server. Capacity is reserved in setup(), so push_back doesn't move existing entries.
static void registerPalettes() {
  while (s_palRegistered < s_palWanted && s_palRegistered < kMaxPal &&
         usermodPalettes.size() < WLED_MAX_USERMOD_PALETTES) {
    const unsigned i = s_palRegistered;
    if (i < kNumPal) { if (!s_palEdited[i]) loadDefaultPalette(i); }
    else if (!s_palUsed[i]) loadPlaceholder(i);
    if (!s_palName[i][0]) loadDefaultName(i);
    CRGBPalette16 pal;
    pal.loadDynamicGradientPalette(s_pal[i].grad);
    usermodPalettes.push_back({pal, _palBase, (uint8_t)i, s_palName[i]});
    s_palRegistered++;
  }
}

// Rebuild the CRGBPalette16 of palette i in place (no vector reallocation, so a frame being
// rendered on the other core never sees a moved buffer).
static void applyPalette(unsigned i) {
  CRGBPalette16 pal;
  pal.loadDynamicGradientPalette(s_pal[i].grad);
  for (auto &up : usermodPalettes)
    if (up.name == _palBase && up.palIndex == i) { up.palette = pal; return; }
}

// ---------------------------------------------------------------------------
// Preset slots
//
// Presets 1-5 are "slots": the looks HomeKit sees (Simpler WLED, filtered to presets 1-5). Each slot's
// name lives in the preset itself, which is what HomeKit reads. Defaults: Everyday, Halloween, Christmas,
// Evening, Special; renameable from the Candles page. Presets 10+ are the library of looks.
// WLED's own JSON API can only store a preset by applying it to the live candles first (json.cpp applies
// "seg" before "psave"), so copies and renames are done here instead, in the main loop, with the same file
// routine WLED uses for its own saves. Nothing live changes.
//
// Commands (POST /json/state), each with optional "t" (unix s) and "rq" (request id):
//   {"CandleSlots":{"assign":{"from":12,"to":2}}}     copy preset 12 into preset 2. Into a slot the copy
//                                                      keeps the slot's name; elsewhere the look's name.
//   {"CandleSlots":{"restore":1}}                     write the built-in default look into a slot (keeps its name)
//   {"CandleSlots":{"edited":2}}                      note that slot 2 was re-saved from the live state
//   {"CandleSlots":{"rename":{"id":2,"n":"Spooky"}}}  rename any preset 1-250 without applying it
//   {"CandleSlots":{"saved":{"id":2,"n":"Amber glow"}}}   record that slot 2 was just saved from the live candles
//                                                      as "Amber glow" (the page sends it with the psave)
// /candle-slots.json keeps, per slot: src (library number, 0 = built-in default, -1 = unknown), name (the
// look's name), slot (the slot's own name), t, edited. /json/state reports {"CandleSlots":{"rq":..,"err":..}}.
//
// At boot, if presets.json is readable and has no preset 1, the default look is written as preset 1 under
// slot 1's last known name (from /candle-slots.json, else "Everyday"), so the boot preset and HomeKit's
// first slot always work.
// ---------------------------------------------------------------------------
static const char *const kSlotDefaults[] = {"Everyday", "Halloween", "Christmas", "Evening", "Special"};
static constexpr unsigned kNumSlots = sizeof(kSlotDefaults) / sizeof(kSlotDefaults[0]);
static constexpr size_t kNameLen = 33;     // WLED preset names: up to 32 characters
static const char kSlotsFile[] PROGMEM = "/candle-slots.json";
static const char kDefaultLookName[] = "Default Everyday";
static uint8_t s_fxId = 255;               // Candle Flame's effect ID, assigned at boot

enum : uint8_t { OP_NONE, OP_ASSIGN, OP_RESTORE, OP_EDITED, OP_RENAME, OP_SAVED };
static volatile uint8_t  s_op = OP_NONE;    // request from the web server, done in loop()
static volatile uint8_t  s_opFrom = 0, s_opTo = 0;
static volatile uint32_t s_opTime = 0, s_opRq = 0;
static char s_opName[kNameLen] = "";
static uint32_t s_doneRq = 0;               // rq of the last finished request
static char s_opErr[48] = "";

static bool isSlot(unsigned id) { return id >= 1 && id <= kNumSlots; }

// 1-32 printable characters, not starting or ending with a space.
static bool validPresetName(const char *n) {
  if (!n) return false;
  size_t len = strlen(n);
  if (len == 0 || len > kNameLen - 1 || n[0] == ' ' || n[len - 1] == ' ') return false;
  for (size_t i = 0; i < len; i++) if ((uint8_t)n[i] < 0x20 || n[i] == 0x7f) return false;
  return true;
}

static void readSlotMeta(uint8_t slot, JsonDocument &d) {
  if (!readObjectFromFileUsingId(kSlotsFile, slot, &d)) d.clear();
}
static void writeSlotMeta(uint8_t slot, int src, const char *lookName, const char *slotName, uint32_t t, bool edited) {
  StaticJsonDocument<384> d;
  d["src"] = src;                // library preset number, 0 = built-in default, -1 = unknown
  d["name"] = (char *)lookName;  // char* so ArduinoJson copies it
  d["slot"] = (char *)slotName;
  d["t"] = t;
  d["edited"] = edited;          // re-saved from the live state after it was assigned
  writeObjectToFileUsingId(kSlotsFile, slot, &d);
  closeFile();
}

// Name of preset id, or "" if it doesn't exist. Uses pDoc: caller holds the JSON buffer lock.
static void presetName(uint8_t id, char *out) {
  out[0] = 0;
  if (readObjectFromFileUsingId(getPresetsFileName(), id, pDoc) && !(*pDoc)["n"].isNull())
    strlcpy(out, (*pDoc)["n"] | "", kNameLen);
}
// The name a slot should carry: its preset's current name, else its last known name, else the default.
static void slotName(uint8_t slot, char *out) {
  presetName(slot, out);
  if (out[0]) return;
  StaticJsonDocument<384> m;
  readSlotMeta(slot, m);
  const char *last = m["slot"] | "";
  strlcpy(out, validPresetName(last) ? last : kSlotDefaults[slot - 1], kNameLen);
}

static void presetsChanged() {
  presetsModifiedTime = toki.second() ? toki.second() : presetsModifiedTime + 1;
  cacheInvalidate++;
  updateFSInfo();
}

// Built-in default look: one segment per LED output (so it fits whatever strings are wired),
// Candle Flame with its default sliders, palette 255 (built-in name "Classic"), Warm white LED
// on. No "on"/"bri": brightness and on/off belong to HomeKit. Unused segments get stop 0 like
// WLED's own presets, so applying it clears pattern segments. Caller holds the JSON buffer lock.
static bool writeDefaultLook(uint8_t slot, const char *name) {
  if (s_fxId == 255 || !isSlot(slot)) return false;
  pDoc->clear();
  JsonObject o = pDoc->to<JsonObject>();
  o["n"] = (char *)name;
  o["mainseg"] = 0;
  JsonArray seg = o.createNestedArray("seg");
  unsigned id = 0;
  auto addSeg = [&](unsigned start, unsigned stop) {
    JsonObject s = seg.createNestedObject();
    s["id"] = id++; s["start"] = start; s["stop"] = stop;
    s["grp"] = 1; s["spc"] = 0; s["of"] = 0; s["on"] = true; s["frz"] = false; s["bri"] = 255;
    s["n"] = "";
    JsonArray col = s.createNestedArray("col");
    JsonArray c0 = col.createNestedArray(); c0.add(255); c0.add(160); c0.add(0); c0.add(0);
    JsonArray c1 = col.createNestedArray(); for (int k = 0; k < 4; k++) c1.add(0);
    JsonArray c2 = col.createNestedArray(); for (int k = 0; k < 4; k++) c2.add(0);
    s["fx"] = s_fxId; s["sx"] = 80; s["ix"] = 90; s["c1"] = 100; s["c2"] = 110; s["c3"] = 6;
    s["pal"] = 255; s["sel"] = true; s["rev"] = false; s["mi"] = false;
    s["o1"] = false; s["o2"] = false; s["o3"] = true; s["si"] = 0; s["m12"] = 0;
  };
  for (size_t b = 0; b < BusManager::getNumBusses() && id < WS2812FX::getMaxSegments(); b++) {
    Bus *bus = BusManager::getBus(b);
    if (!bus || !bus->isDigital() || bus->isVirtual() || bus->getLength() == 0) continue;
    addSeg(bus->getStart(), bus->getStart() + bus->getLength());
  }
  if (id == 0) addSeg(0, strip.getLengthTotal());
  for (; id < WS2812FX::getMaxSegments(); id++) seg.createNestedObject()["stop"] = 0;
  initPresetsFile();
  bool ok = writeObjectToFileUsingId(getPresetsFileName(), slot, pDoc);
  closeFile();
  return ok;
}

// Boot check: recreate preset 1 if it's missing. Only when presets.json is absent or parses
// cleanly: writing into a damaged file could make it worse, so a damaged file is left alone.
static void ensureEveryday() {
  if (!requestJSONBufferLock(JSON_LOCK_UNKNOWN)) return;
  bool missing = true, readable = true;
  char fn[33]; strncpy_P(fn, getPresetsFileName(), 32); fn[32] = 0;
  if (WLED_FS.exists(fn)) {
    File pf = WLED_FS.open(fn, "r");
    if (!pf) readable = false;
    else {
      StaticJsonDocument<32> filter; filter["1"] = true;
      DeserializationError e = deserializeJson(*pDoc, pf, DeserializationOption::Filter(filter));
      pf.close();
      if (e) readable = false;
      else missing = (*pDoc)["1"].isNull() || (*pDoc)["1"]["n"].isNull();
    }
  }
  if (readable && missing) {
    char name[kNameLen];
    slotName(1, name);
    if (writeDefaultLook(1, name)) {
      writeSlotMeta(1, 0, kDefaultLookName, name, toki.second(), false);
      presetsChanged();
    }
  }
  releaseJSONBufferLock();
}

static void runSlotOp() {
  if (s_op == OP_NONE || !requestJSONBufferLock(JSON_LOCK_UNKNOWN)) return;  // retried next loop
  const uint8_t op = s_op, from = s_opFrom, to = s_opTo;
  const uint32_t t = s_opTime ? s_opTime : toki.second();
  s_opErr[0] = 0;

  unsigned long maxWait = millis() + strip.getFrameTime();
  while (strip.isUpdating() && millis() < maxWait) delay(1);  // FS access during sendout glitches
  strip.suspend();

  char tname[kNameLen] = "";
  if (op == OP_ASSIGN) {
    if (isSlot(to)) slotName(to, tname);
    char srcName[kNameLen] = "";
    if (!readObjectFromFileUsingId(getPresetsFileName(), from, pDoc) || pDoc->isNull() || (*pDoc)["n"].isNull()) {
      snprintf(s_opErr, sizeof(s_opErr), "look %u not found", from);
    } else {
      strlcpy(srcName, (*pDoc)["n"] | "", sizeof(srcName));
      if (isSlot(to)) (*pDoc)["n"] = (char *)tname;
      if (!writeObjectToFileUsingId(getPresetsFileName(), to, pDoc)) strlcpy(s_opErr, "write failed", sizeof(s_opErr));
      else {
        closeFile();
        if (isSlot(to)) writeSlotMeta(to, from, srcName, tname, t, false);
        presetsChanged();
      }
    }
  } else if (op == OP_RESTORE) {
    slotName(to, tname);
    if (!writeDefaultLook(to, tname)) strlcpy(s_opErr, "write failed", sizeof(s_opErr));
    else { writeSlotMeta(to, 0, kDefaultLookName, tname, t, false); presetsChanged(); }
  } else if (op == OP_EDITED) {
    slotName(to, tname);
    StaticJsonDocument<384> m;
    readSlotMeta(to, m);
    char lookName[kNameLen]; strlcpy(lookName, m["name"] | "", sizeof(lookName));
    writeSlotMeta(to, m["src"] | -1, lookName, tname, t, true);
  } else if (op == OP_SAVED) {
    slotName(to, tname);
    writeSlotMeta(to, -1, s_opName, tname, t, false);
  } else if (op == OP_RENAME) {
    if (!readObjectFromFileUsingId(getPresetsFileName(), to, pDoc) || pDoc->isNull() || (*pDoc)["n"].isNull()) {
      snprintf(s_opErr, sizeof(s_opErr), "preset %u not found", to);
    } else {
      (*pDoc)["n"] = (char *)s_opName;
      if (!writeObjectToFileUsingId(getPresetsFileName(), to, pDoc)) strlcpy(s_opErr, "write failed", sizeof(s_opErr));
      else {
        closeFile();
        if (isSlot(to)) {   // remember the slot's name, so a recreated preset 1 keeps it
          StaticJsonDocument<384> m;
          readSlotMeta(to, m);
          char lookName[kNameLen]; strlcpy(lookName, m["name"] | "", sizeof(lookName));
          writeSlotMeta(to, m["src"] | -1, lookName, s_opName, m["t"] | t, m["edited"] | false);
        }
        presetsChanged();
      }
    }
  }

  strip.resume();
  releaseJSONBufferLock();
  s_doneRq = s_opRq;
  s_op = OP_NONE;
}

// ---------------------------------------------------------------------------
// Usermod
// ---------------------------------------------------------------------------
class CandleFlameUsermod : public Usermod {
 private:
  static const char _name[];
  static const char _slots[];

 public:
  void setup() override {
    updateWhiteReference();
    s_fxId = strip.addEffect(255, &mode_candle_flame, _data_FX_MODE_CANDLE_FLAME);

    // Register named palettes. Usermod palette IDs count down from 255 in
    // registration order, so keep this the only palette-registering usermod
    // in the build (or register first) to keep IDs stable for presets.
    // readFromConfig() runs before setup(), so edits and user palettes are already loaded.
    removeUsermodPalettes(_palBase);
    usermodPalettes.reserve(WLED_MAX_USERMOD_PALETTES);
    s_palRegistered = 0;
    registerPalettes();

    // Runs before the first loop(), so a recreated preset 1 is in place before WLED applies
    // the boot preset (beginStrip() only queues it).
    ensureEveryday();
  }

  void loop() override {
    if (s_palWanted > s_palRegistered) registerPalettes();   // a palette was added from the Candles page
    if (s_op != OP_NONE) runSlotOp();
  }

  // Called from the web server (another task): only queue the request.
  void readFromJsonState(JsonObject &root) override {
    JsonObject cs = root[FPSTR(_slots)];
    if (cs.isNull()) return;
    const uint32_t rq = cs["rq"] | 0;
    if (s_op != OP_NONE) { strlcpy(s_opErr, "busy, try again", sizeof(s_opErr)); s_doneRq = rq; return; }
    uint8_t op = OP_NONE; int from = 0, to = 0;
    if (!cs["assign"].isNull()) { op = OP_ASSIGN; from = cs["assign"]["from"] | 0; to = cs["assign"]["to"] | 0; }
    else if (!cs["restore"].isNull()) { op = OP_RESTORE; to = cs["restore"] | 0; }
    else if (!cs["edited"].isNull())  { op = OP_EDITED;  to = cs["edited"] | 0; }
    else if (!cs["rename"].isNull()) {
      op = OP_RENAME; to = cs["rename"]["id"] | 0;
      const char *n = cs["rename"]["n"] | "";
      if (validPresetName(n)) strlcpy(s_opName, n, sizeof(s_opName)); else op = OP_NONE;
    }
    else if (!cs["saved"].isNull()) {
      op = OP_SAVED; to = cs["saved"]["id"] | 0;
      const char *n = cs["saved"]["n"] | "";
      if (validPresetName(n)) strlcpy(s_opName, n, sizeof(s_opName)); else op = OP_NONE;
    }
    const bool ok = (op == OP_ASSIGN)  ? (from >= 1 && from <= 250 && to >= 1 && to <= 250 && from != to)
                  : (op == OP_RENAME)  ? (to >= 1 && to <= 250)
                  : (op != OP_NONE)    ? isSlot(to) : false;
    if (!ok) { strlcpy(s_opErr, "bad request", sizeof(s_opErr)); s_doneRq = rq; return; }
    s_opFrom = from; s_opTo = to; s_opTime = cs["t"] | 0; s_opRq = rq;
    s_op = op;   // last: loop() starts on this
  }

  void addToJsonState(JsonObject &root) override {
    JsonObject cs = root.createNestedObject(FPSTR(_slots));
    cs["rq"] = s_doneRq;
    cs["err"] = s_opErr;
  }

  void addToConfig(JsonObject &root) override {
    JsonObject top = root.createNestedObject(FPSTR(_name));
    top[F("whiteKelvin")]  = s_whiteKelvin;
    top[F("whiteGainPct")] = s_whiteGainPct;
    // Every palette is written (current stops), so the Candles page can read and edit them. A free user palette
    // below the last used one is written as "-" (keeps its place; later IDs mustn't move).
    char key[8], buf[kStopsTextLen];
    const unsigned n = s_palWanted > s_palRegistered ? s_palWanted : s_palRegistered;
    for (unsigned i = 0; i < n && i < kMaxPal; i++) {
      if (i < kNumPal && !s_palEdited[i] && s_pal[i].len == 0) loadDefaultPalette(i);
      snprintf(key, sizeof(key), "pal%u", 255 - i);
      if (isUserPal(i) && !s_palUsed[i]) { top[key] = "-"; continue; }
      formatStops(s_pal[i], buf, sizeof(buf));
      top[key] = buf;   // ArduinoJson copies a char* value
      if (!s_palName[i][0]) loadDefaultName(i);
      snprintf(key, sizeof(key), "name%u", 255 - i);
      top[key] = (char *)s_palName[i];
    }
  }

  // Only keys that are present are applied: WLED passes partial config here when settings are posted
  // (e.g. a PowerManager change), and missing keys must not reset anything.
  bool readFromConfig(JsonObject &root) override {
    JsonObject top = root[FPSTR(_name)];
    if (top.isNull()) return false;
    if (!top[F("whiteKelvin")].isNull())  s_whiteKelvin  = top[F("whiteKelvin")]  | s_whiteKelvin;
    if (!top[F("whiteGainPct")].isNull()) s_whiteGainPct = top[F("whiteGainPct")] | s_whiteGainPct;
    if (s_whiteKelvin < 1900)  s_whiteKelvin = 1900;
    if (s_whiteKelvin > 10000) s_whiteKelvin = 10000;
    if (s_whiteGainPct < 50)   s_whiteGainPct = 50;
    if (s_whiteGainPct > 200)  s_whiteGainPct = 200;
    updateWhiteReference();

    char key[8];
    for (unsigned i = 0; i < kNumPal; i++) {
      snprintf(key, sizeof(key), "pal%u", 255 - i);
      if (top[key].isNull()) continue;
      const char *v = top[key].as<const char *>();
      if (!v) continue;
      if (s_pal[i].len == 0) loadDefaultPalette(i);
      PaletteStops def; def.len = kPalettes[i].bytes / 4; memcpy(def.grad, kPalettes[i].grad, def.len * 4);
      def.boost = kPalettes[i].wBoostPct;
      if (!strcmp(v, "default") || !*v) { loadDefaultPalette(i); }
      else if (parseStops(v, s_pal[i])) {
        s_palEdited[i] = !(s_pal[i].len == def.len && s_pal[i].boost == def.boost &&
                           !memcmp(s_pal[i].grad, def.grad, def.len * 4));
      }
      applyPalette(i);
    }
    // User palettes: "pal<ID>" = stops adds or changes one, "-" (or "delete") frees it.
    for (unsigned i = kNumPal; i < kMaxPal; i++) {
      snprintf(key, sizeof(key), "pal%u", 255 - i);
      const char *v = top[key].as<const char *>();
      if (!v) continue;
      if (!strcmp(v, "-") || !strcmp(v, "delete")) {
        if (s_palUsed[i]) { loadPlaceholder(i); applyPalette(i); }
        continue;
      }
      PaletteStops ps;
      if (!parseStops(v, ps)) continue;
      const bool isNew = !s_palUsed[i];
      s_pal[i] = ps; s_palUsed[i] = true; s_palEdited[i] = true;
      if (isNew && (!s_palName[i][0] || !strcmp(s_palName[i], kUnusedName))) {
        snprintf(s_palName[i], sizeof(s_palName[i]), "My palette %u", i - kNumPal + 1);
      }
      if (i + 1 > s_palWanted) s_palWanted = i + 1;   // loop() (or setup()) registers it
      applyPalette(i);
    }
    for (unsigned i = 0; i < kMaxPal; i++) {   // names: "default" restores the built-in name
      snprintf(key, sizeof(key), "name%u", 255 - i);
      const char *v = top[key].as<const char *>();
      if (!v) continue;
      if (isUserPal(i) && !s_palUsed[i]) continue;   // a free palette keeps "(unused)"
      if (!strcmp(v, "default")) { if (i < kNumPal) loadDefaultName(i); }
      else if (validPalName(v) && strcmp(v, kUnusedName)) { strncpy(s_palName[i], v, kMaxNameLen); s_palName[i][kMaxNameLen] = 0; }
    }
    return !top[F("whiteKelvin")].isNull();
  }

  void appendConfigData(Print &settingsScript) override {
    settingsScript.print(F("addInfo('CandleFlame:whiteKelvin',1,'K (colour temp of the pixels\\' white LED)');"));
    settingsScript.print(F("addInfo('CandleFlame:whiteGainPct',1,'% (trim if W looks too bright/dim vs RGB)');"));
    settingsScript.print(F("addInfo('CandleFlame:pal255',1,'palettes: edit on the Candles page (/candles.htm)');"));
  }

  uint16_t getId() override { return USERMOD_ID_UNSPECIFIED; }
};

const char CandleFlameUsermod::_name[] PROGMEM = "CandleFlame";
const char CandleFlameUsermod::_slots[] PROGMEM = "CandleSlots";

static CandleFlameUsermod candle_flame;
REGISTER_USERMOD(candle_flame);
