# Revision 2 — Custom HomeKit Plugin (planning notes)

Status: **Phase 1 (MVP) built**: `homebridge-wled-candles` in `homebridge/`. Design approved 2026-11-07:
[homebridge-design.md](homebridge-design.md); testing, HOOBS install options and cutover: [homebridge-testing.md](homebridge-testing.md). Revision 1 uses the existing **Simpler WLED** plugin (`homebridge-simpler-wled`) on HOOBS.
This document records the options considered, what Revision 1 does not cover, and an assessment of building
our own plugin, published only as far as **Level 1: listed and installable**.

---

## 1. Environment (as of 2026-11-07)

| Item | Value |
|---|---|
| HOOBS | 5.1.8, at `<HOOBS_IP>` (hardware in `site.local.md`) |
| Homebridge (inside HOOBS) | 1.8.4 |
| Node.js (inside HOOBS) | 20.5.1 |
| Candle controller | QuinLED Dig-Next-2, WLED 16.0.1 + candle_flame usermod, at `<CONTROLLER_IP>` (DHCP reservation in the router) |
| Candle web page | http://`<CONTROLLER_HOSTNAME>`.local/ (also http://`<CONTROLLER_IP>`/candles.htm) |

---

## 2. Plugins considered for Revision 1

| Plugin | On/off | Brightness | Colour | How presets appear | Scene can choose a look | Notes |
|---|---|---|---|---|---|---|
| **Simpler WLED** (`homebridge-simpler-wled`, v3.1.1) | Yes | Yes | Yes | TV-style input selector **and** a switch per preset; can be filtered to selected presets | Yes (via per-preset switches) | Homebridge-verified. Reads presets from WLED. Needs Homebridge ≥1.3, Node ≥14. Its discovery UI is for Homebridge Config UI X, so on HOOBS add the device by IP. Homebridge 2.0 support not stated. |
| Simple WLED (`homebridge-simple-wled`, v2.1.2) | Yes | Yes | Yes | Preset switch built from a hand-typed list of names (order must match WLED preset numbers) | Unverified | States Homebridge 1.8+ and 2.0 support. |
| WLED Presets (`@ncovercash/homebridge-wled-presets`, v1.1.4) | Per preset | Per preset | No | Each preset is its own light | Yes | Low usage; maintenance unverified. |
| WLED Preset (`homebridge-wled-preset`, v0.5.3) | Via presets | Unverified | No | Preset switching | Unverified | Older, small project. |

**Chosen for Revision 1:** Simpler WLED. It syncs presets from WLED automatically and offers per-preset switches,
and it runs on our HOOBS.

### Revision 1 operating model
- Presets **1–5 are slots**: 1 Everyday, 2 Halloween, 3 Christmas, 4 Evening, 5 Special by default. Simpler WLED is filtered to these five, so the set of HomeKit switches never changes and HOOBS never needs a restart. (Slots became renameable on the Candles page on 2026-11-07; a rename changes the name HomeKit shows, which may need the plugin to refresh.)
- Presets **10+ are a library**. The Candles page's Looks tab puts a look into a slot (Slot picker) or the library (checkbox).
- Presets are saved **without brightness**, so HomeKit owns brightness.
- Boot preset = 1 (Everyday); "turn LEDs on after power up" off.
- Automations: sunset → Candles on at a set brightness; later → dim; bedtime → off. Looks are chosen manually in the Candles tile, or by a date-checking Home automation converted to a Shortcut.
- In the Home app, keep **Show as Separate Tiles** off so the light and slot switches share one Candles tile.

### Checks after installing Simpler WLED (any failure is a reason to start Revision 2 early)
1. The slot switches appear **inside** the Candles tile, not as separate tiles.
2. The switches behave sensibly: no two "on" at once, and turning a slot switch off doesn't turn off the candles unexpectedly.
3. The plugin stays maintained, including Homebridge 2.0 support once HOOBS moves to it.

---

## 3. Original requirements vs. Revision 1 (Simpler WLED)

| Original requirement | In HomeKit (Rev 1) | Otherwise handled in |
|---|---|---|
| On/off with other lights in a scene (e.g. dusk) | Yes | — |
| Set the look from HomeKit | Yes, via the 5 slot switches | Looks built in WLED / candles.htm |
| Master brightness | Yes | — |
| 2–5 colour flame scale | No | WLED palette and palette editor |
| Flicker speed and randomization | No | candles.htm / WLED sliders |
| Soft vs hard movement | No | candles.htm / WLED (Softness, Gusts) |
| Holiday patterns (alternating, threes, fours) | No | WLED segments, saved into presets |
| Common colours twinkle together | No | WLED "Linked" option per segment |
| Halloween / Christmas looks | Yes, as slots | Built once in WLED |

**Gap:** no fine-tuning from HomeKit. Changing a look's character means using candles.htm.
**Caution:** the HomeKit colour control may fight with palette-based candle looks. Avoid it, or test once.

---

## 4. What a custom plugin could add (Revision 2 candidates)

The Home app only shows standard controls (switches, brightness and fan-speed sliders, colour pickers),
so every feature must be expressed through those.

| Feature | How it appears in HomeKit | Benefit |
|---|---|---|
| Radio-button slot switches | 5 switches inside the Candles tile; one on at a time | Always shows the active look |
| ~~Candle character sliders~~ | Dropped 2026-11-07: the flame is tuned on the Candles page; a calmer look in a slot covers "calmer after 10 PM" | |
| Per-string control | String A / String B lights in the tile | Independent strings if wanted |
| ~~Built-in seasons~~ | Dropped 2026-11-07: seasonal Home app automations do this | |
| Fade-in on | Built into the on action | Gentle sunset start |
| Offline sensor | A status sensor | Home app can notify if the controller drops |
| Full parameter set | Custom HomeKit properties | Visible in Eve / Controller for HomeKit, hidden in Apple Home |

**Design gotcha:** sliders presented as lights (a "Flicker" light at 40%) are caught by "turn off all the lights,"
show bulb icons, and count in the Home app's lights summary. Fan-speed sliders have their own oddities.
This must be designed and tested deliberately. The Eve-app route for full controls avoids it.

**Scope decision before building:** candle-specific, or a general WLED plugin with candle extras that switch on
when the candle_flame usermod is detected. The general version is more useful to others; the candle-only version is simpler.

---

## 5. Publishing target: Level 1 — listed and installable

Revision 2 aims only to make the plugin installable through HOOBS / Homebridge plugin search.
It does **not** aim for the Homebridge Verified badge (see Appendix A).

### Steps
1. **Name** the package with the `homebridge-` prefix (e.g. `homebridge-wled-candles`) and add the `homebridge-plugin` keyword in `package.json`.
2. **Publish to npm.** Free account; enable two-factor authentication.
3. **Source on GitHub** with issues enabled. At this point, set a real or GitHub noreply git email (the repo currently uses a placeholder).
4. **License:** MIT is typical for Homebridge plugins. The plugin is separate from the WLED usermod (which falls under WLED's EUPL licence).
5. **Install in HOOBS** by searching the package name.

Note: HOOBS has its own certification program, separate from Homebridge Verified. Not investigated.

---

## 6. Difficulty assessment (Level 1 only)

**Overall: low to moderate.** Without verification, Homebridge 2.0 support, the settings form, release-note discipline
and review turnaround all become optional, so most of the remaining effort is the plugin itself.
The hard parts are connection reliability and HomeKit display quirks.

| Component | Difficulty | Notes |
|---|---|---|
| Scaffold from the official Homebridge plugin template | Low | TypeScript project structure provided |
| WLED communication (WebSocket + JSON API) | Low–moderate | Commands are easy; clean reconnection after Wi-Fi drops, reboots and power cuts needs care |
| Candles light: on/off, brightness, fade-in | Low | WLED transition time handles the fade |
| 5 radio-button slot switches in one tile | Moderate | Naming and grouping in the Home app need HomeKit-specific handling |
| ~~Candle sliders~~ (dropped) | Moderate (UX) | Writing values to WLED is easy; presentation is the work (see gotcha) |
| Custom properties for Eve / Controller | Moderate | Optional |
| ~~Seasonal auto-selection~~ | Dropped | Home app automations enabled by time of year instead |
| Offline sensor | Low | |
| Settings form (`config.schema.json`) | Low | Optional at Level 1, but recommended for easy setup in HOOBS |
| Testing | Low–moderate | Must pass on our setup: Homebridge 1.8.4, Node 20. Homebridge 2.0 testing optional but recommended before HOOBS upgrades to it. |
| Publishing to npm + GitHub | Low | About half a day the first time |

### Effort estimate

| Stage | Scope | Rough effort |
|---|---|---|
| MVP (private) | Light, brightness, slot switches, reconnection | 1–2 days |
| Revision 2 feature set | Plus fade-in, look list, offline indication | ~1–1.5 weeks part-time |
| Level 1 publishing | npm package, GitHub repo, README, licence | ~½ day |
| Ongoing | Keeping up with HOOBS / Homebridge updates | A few hours per year, more at a major Homebridge version change |

### Recommendation
Live with Revision 1 through at least one season and note which controls you actually reach for from the Home app.
Build the custom plugin when that list makes the case. Most likely triggers: "calmer tonight" from HomeKit, built-in seasons,
or any failure of the Section 2 checks.

---

## Appendix A — Homebridge Verified (not targeted; for reference)

Requirements seen in recent verification requests:
- Published to npm; source on GitHub with issues enabled
- Dynamic platform plugin (DynamicPlatformPlugin)
- Implements the Homebridge settings GUI (`config.schema.json`)
- Supports Homebridge v2 (`engines.homebridge: "^1.8.0 || ^2.0.0-beta.0"`)
- Supports current Node.js LTS versions (^20 || ^22 || ^24)
- No analytics or user tracking
- Catches and logs its own errors (no unhandled exceptions)
- A GitHub release with notes for every version
- Must not offer the same or less functionality than an existing verified plugin. Simpler WLED is verified, so ours would need clearly more (slots, candle controls, seasons).

Process: https://github.com/homebridge/verified

Extra effort over Level 1: roughly one more week (Homebridge 2.0 testing, settings form, release process, docs), plus review wait.
