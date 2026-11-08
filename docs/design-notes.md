# Design notes

How the firmware and the Candles page work, and why. File and line references are to WLED v16.0.1.

## Candle Flame effect (`firmware/usermods/candle_flame/`)

- `candle_core.h` is the flame model, with no WLED or Arduino dependencies, so it runs on the ESP32 and in the
  host tests (`firmware/test/sim_test.cpp`). `candle_flame.cpp` is the WLED glue: the effect, palettes,
  settings and the preset-slot commands.
- Controls: Speed (sx), Flicker depth (ix), Randomness (c1), Softness (c2), Gusts (c3, 0–31), Unison (o1) and
  Warm white LED (o3). o2 has an empty label, so WLED hides it. Defaults: sx 80, ix 90, c1 100, c2 110, c3 6.
- **Every candle flickers on its own.** WLED's built-in "Candle" effect is one flame for the whole segment, so all
  candles move together. Candle Flame keeps a separate state per pixel (Unison shares one flame and isn't offered
  on the Candles page). Test 11 checks that candles are uncorrelated.
- The model: noise octaves with a contrast stretch so flicker depth reaches low levels; Randomness gives each
  candle its own tempo (±75%) and temperament (depth scale), drifting over time; Softness is a smoothing time
  constant (10–510 ms) and also mutes the fast octave; Speed scales 0.2–4×; Gusts arrive at a rate of
  gusts² × 0.9 per second as a brief ~3 Hz sway. Test 12 requires every slider to make a clear difference; test 16
  keeps a calm setting under 1.6 direction changes per second per candle.
- Flame level (0.08–1) drives both brightness and the palette index (0–240, kept below 255 so the palette doesn't
  wrap). A dipping flame gets dimmer and moves to the low end of the palette.
- **White LED (W) extraction:** the white LED's colour (from `whiteKelvin`) is subtracted out of RGB and sent to W,
  scaled by `whiteGainPct` and the palette's W boost. This needs the bus's Auto White mode set to **None**.
  `Segment::color_from_palette()` copies the segment colour's W into its result; the effect discards it and sets W
  itself.
- The effect's ID is assigned at boot (`strip.addEffect(255, …)`), and presets store effect IDs, so avoid adding
  other effect usermods casually. The Candles page finds the effect by name.

## Palettes

- Ten built-in palettes are registered as usermod palettes, IDs 255 (Classic) down to 246 (Warm white). New
  built-ins are appended at the end so existing IDs never move. IDs are stable only while candle_flame is the only
  palette-registering usermod in the build (presets store palette IDs).
- **Editable at runtime.** Each palette is stored in the usermod's config as `pal<ID>` text: `"idx:RRGGBB ...
  [bNNN]"`, 2–8 stops, first at 0 and last at 255, optional W boost 100–200%. Posting
  `{"um":{"CandleFlame":{"pal252":"..."}}}` to `/json/cfg` applies it immediately; `"default"` restores the
  built-in stops. Names are `name<ID>` (1–20 characters: letters, digits, space and `- _ . ( ) +`, nothing that
  needs escaping in JSON or HTML). Palettes are updated in place in WLED's palette list, never reallocated, because
  the other core may be rendering a frame.
- The config holds a copy of every palette, which wins at boot. After a firmware update that changes a built-in
  palette, post `"default"` for that palette to pick up the new version.
- **User palettes:** up to 20 more, IDs 245 down to 226, added from the Candles page. WLED looks usermod palettes up
  by position (`FX_fcn.cpp:278`, ID = 255 − index), so an entry can't be removed while running without moving
  every later ID. A deleted user palette stays registered as a grey placeholder named "(unused)" (the page hides
  these) and is reused by the next new palette; placeholders after the last used one are dropped at the next boot.
  The palette list's capacity is reserved at startup and new entries are added from the main loop, so the list
  never moves under a render.
- **Palette text length:** 8 stops of `255:RRGGBB` plus ` b150` is 92 characters. An earlier 72-byte buffer cut
  7–8 stop palettes short in `cfg.json`; they worked until the next boot, then failed to parse and disappeared.
  Test 17 checks that the longest text round-trips.
- `readFromConfig` applies only keys that are present: WLED passes partial config when any settings page is
  saved, and defaulting missing keys would silently reset them.
- **Warm white** (246) is W-first: a tall flame is the white LED at 100% plus a 20% amber layer (RGB 51,27,0). A
  palette colour can't hold "full white plus extra" (the white LED's colour at 3000 K, 255,177,110, already uses
  all of red), so the palette is encoded with W at 80% and a W boost of 125% lifts it back to 100% after
  extraction. Lower stops are encoded for fixed W/amber outputs; amber hue 255,135,0. Encoded for 3000 K.
- **Calm palettes.** `firmware/tools/palette_flicker.cpp` scores how busy a palette looks on the real output path
  (W split, gamma 2.2 before brightness, 8-bit steps) as visible steps per candle per second. Palettes with steep
  colour changes near the top of the flame look busy, because the flame spends most of its time there; the
  built-ins were smoothed to about Classic's score (1.9 at brightness 128). At very low master brightness every
  palette steps 2–3× more, since the output channels only reach a few dozen levels.

## Preset slots and the library

- Presets **1–5 are slots**: the looks HomeKit sees. Default names Everyday, Halloween, Christmas, Evening,
  Special; a slot's name lives in its preset and can be renamed. Presets 10 and up are the **library** (6–9 are
  spare). Presets never store brightness or on/off (`ib:false`; WLED then omits on/bri/transition,
  `json.cpp:647`), so HomeKit stays in charge of both.
- **Why the firmware copies presets:** WLED's JSON API can't store preset content without applying it. `psave`
  alone saves the live state; `psave` with `o:true` applies the posted segments to the live candles before saving
  (`json.cpp:459–505`). The only other route is re-uploading all of `presets.json`. So candle_flame has a
  **CandleSlots** command, queued from `readFromJsonState` and run in the main loop with WLED's own
  `writeObjectToFileUsingId` (strip suspended, JSON buffer locked), like WLED's own saves. Commands (POST to
  `/json/state`, each with optional `t` = unix time and `rq` = request ID):
  - `{"CandleSlots":{"assign":{"from":12,"to":2}}}` copies a stored preset. Into a slot it keeps the slot's
    name; elsewhere it keeps the look's name.
  - `{"CandleSlots":{"restore":1}}` writes the built-in default look into a slot, keeping the slot's name.
  - `{"CandleSlots":{"saved":{"id":2,"n":"Amber glow"}}}` records that a slot was just saved from the live state.
  - `{"CandleSlots":{"edited":2}}` marks a slot as re-saved from the live state.
  - `{"CandleSlots":{"rename":{"id":2,"n":"Spooky"}}}` renames any preset 1–250 in place, without applying it.
  - `/json/state` reports `{"CandleSlots":{"rq":<last finished>,"err":""}}`; the page polls for its request ID.
- `/candle-slots.json` on the controller records, per slot: `src` (library number, 0 = built-in default,
  −1 = unknown), `name` (the look's), `slot` (the slot's own name), `t` and `edited`.
- The **default look**: one segment per LED output (from the actual bus layout), Candle Flame with default sliders,
  palette 255, Warm white LED on, unused segments cleared (stop 0), no on/bri.
- **Preset 1 is recreated at boot** if `presets.json` is absent, or parses cleanly and lacks preset 1, under slot
  1's last known name. A damaged `presets.json` is left alone. This is done in the firmware because the boot preset
  and HomeKit's first slot must work with no browser open, e.g. after a reflash. Without a boot preset, any
  restart comes up on WLED's default Solid effect: flat colour, no flicker.

## Candles page (`firmware/web/candles.htm`)

- A single self-contained file, uploaded to WLED's filesystem as `/index.htm` (and `/candles.htm`), so it's the
  controller's front page (an `/index.htm` on the filesystem replaces WLED's built-in UI, `wled_server.cpp:615`).
- WLED's own UI moves to `/wled.htm.gz`, made by `firmware/tools/wled_ui.py` from the firmware's built-in UI with
  three patches: WLED's UI treats any non-root path as a reverse-proxy folder and would request
  `/wled.htm/json/…` ("Init failed: lJson.shift is not a function"); a **Candles** button is added to WLED's top
  toolbar; and the toolbar shares its width on small screens. Re-run it after any firmware build that changes
  WLED's UI.
- Talks to WLED over its WebSocket (`/ws`): state pushes, and `{"lv":true}` streams live LED colours (binary `L`
  frames). Only one client gets the live stream at a time. HTTP is the fallback.
- **Tabs:** HomeKit (power, master brightness, the five slots), Looks (every look with a Slot picker and a Library
  checkbox; tapping a look opens its editor: name, colours, flame, save), Palettes (palette list and editor),
  Strings, and links to WLED's settings.
- **Looks list:** library looks, then looks that live only in slots (one row per distinct content), plus
  "Showing now" when the live state matches no stored look. A slot counts as holding a library look while its
  record points at it, it hasn't been edited, and the content still matches.
- **Patterns** (the Colours part of the look editor) use interleaved segments: grouping 1 and spacing N−1, shifted
  by **Start**, not Offset, which wraps a pixel on odd-length strings. WLED leaves spacing gaps untouched, so the
  segments overlay cleanly. The page reuses each string's segment IDs and clears extras with stop 0.
- **Responsiveness:** rows are rebuilt only when what they show changes, and live details are updated in place.
  Rebuilding a button between press and release swallows the click.
- **Reliability:** WLED can serve `presets.json` half-written while it's saving, so every poll tolerates a bad
  read and tries again. State changes are retried, since the web server occasionally drops a request. Palette
  edits are posted to `/json/cfg` (debounced) and checked for `{"success":true}`: WLED answers `{"error":3}` when
  its JSON buffer is busy.
- Palette bars are drawn "as lit": with Warm white LED on, the part carried by the white LED is drawn cream, so
  W-heavy palettes don't look orange on a monitor.
- Before saving a look that isn't on Candle Flame (e.g. WLED's Solid default after a restart), the page asks
  first, so a restart can't silently replace a look with flat colour.

## Security and network

- The settings PIN doesn't protect `/json/state`, `/presets.json`, `/ws` or preset save/delete, so anything on the
  network can change looks. Keep a backup of `presets.json`. An isolated network for the controller is the
  stronger option where the router supports it.

## Build notes

- `pio run -t clean` doesn't force a full recompile: WLED's build cache restores the objects. WLED's web UI step
  (`tools/cdata.js`) also skips when the UI looks already built; run `node tools/cdata.js --force` in the WLED
  tree to rebuild it (e.g. after a Node upgrade). The UI's size depends on the Node version (gzip via Node's zlib).
- `esptool image-info` fails on a merged factory image ("invalid magic number 0xff") because it starts with
  padding; check the bootloader (0x1000) and app (0x10000) slices instead.
- Builds made on different machines never match byte for byte (toolchain paths are embedded), so a hash only
  identifies one specific build.
