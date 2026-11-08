# Firmware: Candle Flame for WLED (QuinLED Dig-Next-2)

WLED 16.0.1 + QuinLED's PowerManager usermod + a custom `candle_flame` usermod that adds a
**Candle Flame** effect and ten named candle/holiday palettes.

Build and flash: [BUILD.md](BUILD.md). Settings after flashing: [docs/setup.md](../docs/setup.md).
How it works and why: [docs/design-notes.md](../docs/design-notes.md).

## Folder layout

| Path | What it is |
|---|---|
| `usermods/candle_flame/candle_core.h` | The flame model. No WLED dependencies, so it can be tested on a computer. |
| `usermods/candle_flame/candle_flame.cpp` | WLED glue: the effect, palettes, and settings page entries. |
| `usermods/candle_flame/library.json` | Tells WLED's build system this is a usermod. |
| `platformio_override.ini` | Dig-Next-2 build environment (`dig-next-2-candles`). |
| `test/sim_test.cpp` | Host-side tests of the flame model; `traces.png` shows example output. |
| `web/candles.htm` | The Candles control page, uploaded to the controller's filesystem as its front page. |
| `tools/wled_ui.py` | Makes WLED's built-in UI servable at `/wled.htm` (extracts it from the build, applies one patch). |

## Candles page

Open **http://`<CONTROLLER_HOSTNAME>`.local/** (or http://`<CONTROLLER_IP>`/) on a phone or computer: the Candles page is the
controller's front page. It's a single self-contained file (no external resources), served by WLED
from its filesystem, so firmware updates don't touch it. The **WLED ↗** button in its header opens WLED's own
interface (at `/wled.htm`) for things like segment layouts; the amber **Candles** button at the start of WLED's
toolbar brings you back.

| Tab | What's there |
|---|---|
| HomeKit | Live view, power, master brightness, and the five HomeKit slots: tap to show, **Rename**, **Restore default** on slot 1 |
| Looks | Every look on one row with a **Slot** picker and a **Library** checkbox (library looks, looks that live only in a slot, and "Showing now"). Tap a look to show it and open its editor: name, colours (one or more palettes alternating along the strings), flame sliders, Save. **+ New look** |
| Palettes | The ten Candle palettes plus up to 20 of your own (**+ New palette**) with as-lit previews and an **Edit** button for each (name, colours, positions, white boost, reset or delete); WLED palette-maker palettes; tap one to try it |
| Strings | Per-string on/off and brightness, plus controller status (current, fps, Wi-Fi, PowerManager) |
| ⚙ | Links to WLED's full controls and settings pages |

Looks are saved without brightness (HomeKit owns brightness) and with segment bounds, so patterns come back
exactly.

## The Candle Flame effect

| Control | WLED name | Does |
|---|---|---|
| Speed | Speed | Flicker speed |
| Flicker depth | Intensity | How far the flame can dip. 0 = steady. |
| Randomness | Custom 1 | How much candles differ from each other: each gets its own pace and temperament (calm or lively), drifting over time |
| Softness | Custom 2 | 0 = hard and jumpy, max = soft and rolling |
| Gusts | Custom 3 | How often a "draft" hits the flame (a brief ~3 Hz sway) |
| Unison | Checkbox 1 | Every candle in the segment shares one flame. Not used: the design calls for individual candles, and the Candles page doesn't offer it |
| Warm white LED | Checkbox 3 | Moves pale warm tones onto the W channel (leave on for RGBW pixels) |

Flame height drives **both** brightness and colour: a dipping flame gets dimmer and moves toward the
low end of the palette (index 0); a tall flame moves toward the high end. Any palette works,
including up to 20 Candle palettes of your own (2–8 colours, made on the Palettes tab) and
palettes from WLED's own palette editor. Palette **Default** = solid segment colour.

Master brightness is WLED's normal brightness, which is also what HomeKit will control.

## Palettes

Registered by the usermod, listed in WLED as "Candle: …". IDs are fixed while candle_flame is the only
palette-registering usermod in the build (presets store these IDs).

| ID | Name | | ID | Name |
|---|---|---|---|---|
| 255 | Classic | | 250 | Halloween purple |
| 254 | Soft white | | 249 | Christmas red |
| 253 | Deep amber | | 248 | Christmas green |
| 252 | Halloween orange | | 247 | Christmas white |
| 251 | Halloween green | | 246 | Warm white |

**Warm white** is W-first: a tall flame is the pixels' white LED at 100% plus a 20% amber layer from RGB, and
dips ease warmer toward soft amber. Use it with **Warm white LED** on.

## Settings after flashing

See [docs/setup.md](../docs/setup.md).

## Patterns with segments

Holiday patterns use overlapping segments, each with its own palette. WLED leaves a segment's
spacing gaps untouched, so interleaved segments combine cleanly. Use **Start** (not Offset) to shift each
segment, so odd-length strings don't wrap a pixel back to the beginning.

Alternating on string A (pixels 0–11):

| Segment | Start | Stop | Grouping | Spacing | Palette |
|---|---|---|---|---|---|
| A1 | 0 | 12 | 1 | 1 | Halloween orange |
| A2 | 1 | 12 | 1 | 1 | Halloween purple |

Groups of three: three segments, starts 0/1/2, spacing 2. Groups of four: starts 0/1/2/3, spacing 3.
String B (11 pixels) starts at pixel 12, so add 12 to each start and use stop 23.

## Presets

Presets 1–5 are **HomeKit slots**, named 1 Everyday, 2 Halloween, 3 Christmas, 4 Evening, 5 Special by default
(renameable on the Candles page; a slot keeps its name when its look changes).
HomeKit only sees these five, so its set of controls never changes. Every other look lives in the **library**
(presets 10 and up; 6–9 are spare). On the Candles page's Looks tab, each look has a **Slot** picker and a **Library** checkbox.
Assigning copies the stored look into the slot under the slot's name (done by the candle_flame firmware, so the
live candles don't change); `/candle-slots.json` on the controller records which look each slot came from.
Looks never store brightness or on/off: HomeKit owns those.
