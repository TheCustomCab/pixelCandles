# HomeKit integration research (2026-11-06)

Research only: nothing on HOOBS, WLED or the firmware was changed.

**Goal:** HomeKit (via HOOBS) controls on/off, master brightness, and which look
(WLED preset) is active. It must work from scenes and automations ("on at dusk with the Classic look").
Both strings (segment A, 12 px; segment B, 11 px) act as **one light**.

> **Update 2026-11-06: the IoT VLAN plan is dropped.** This research assumed the controller would sit on an
> isolated VLAN reachable only from HOOBS. That isn't practical with the home router, so the controller
> lives on the main network. VLAN and firewall steps below are struck through; the plugin choice is unaffected.

> **Update 2026-11-07: plugin choice is Simpler WLED** (homebridge-simpler-wled), filtered to presets 1–5. Those are
> slots (default names 1 Everyday, 2 Halloween, 3 Christmas, 4 Evening, 5 Special; renameable) managed from the Candles
> page, so the set of looks HomeKit sees never changes; see [design-notes.md](design-notes.md) "Preset slots". Per section 2 below, its published 3.1.1
> code shows presets as a TV-style input selector, not switches; check how it behaves when installing. Presets
> carry no on/off or brightness, so picking a look while the candles are off may change the look without turning
> them on, unless the plugin also sends "on".

**Recommendation (2026-11-06):** [homebridge-wled-ws](https://github.com/smhex/homebridge-wled-ws), with presets
saved *without* brightness and a scene that turns on the Candles light **and** the preset's switch.
First check that HOOBS's Node.js version meets the plugin's requirement (see [Open questions](#open-questions)).

## How the facts were checked

- **Release history:** npm registry metadata (`registry.npmjs.org/<package>`) for every version date and engine requirement.
- **Issue and PR activity:** GitHub REST API (repos, issues, comments, releases, search).
- **Homebridge verified status:** [homebridge/plugins `verified-plugins.json`](https://github.com/homebridge/plugins/blob/latest/verified-plugins.json).
- **Plugin behaviour:** read from each plugin's **published npm package code** (`dist/`), not just its README.
  READMEs and code disagree in places, as noted below.
- **WLED behaviour:** read from our WLED v16.0.1 checkout (commit 29b389d) in `WLED/wled00/`.
- All figures are as of 2026-11-06. "Last 12 months" means 2025-11-06 to 2026-11-06.

## 1. WLED plugins for Homebridge/HOOBS

### Actively maintained

| | **homebridge-wled-ws** | **homebridge-simple-wled** | **homebridge-simpler-wled** | **@ncovercash/homebridge-wled-presets** | **homebridge-ultimate-wled** |
|---|---|---|---|---|---|
| Repo | [smhex/homebridge-wled-ws](https://github.com/smhex/homebridge-wled-ws) | [jstrausd/homebridge-simple-wled](https://github.com/jstrausd/homebridge-simple-wled) | [drewcovi/homebridge-simpler-wled](https://github.com/drewcovi/homebridge-simpler-wled) | [ncovercash/homebridge-wled-presets](https://github.com/ncovercash/homebridge-wled-presets) (fork of simple-wled) | [michel-tricot/homebridge-ultimate-wled](https://github.com/michel-tricot/homebridge-ultimate-wled) |
| Latest release | 0.0.28, **2026-11-06** | 2.1.2, 2026-05-05 | 3.1.1, 2026-03-14 | 1.1.4, 2026-04-25 | 1.0.3, 2025-12-01 |
| Release frequency (npm versions) | 46 since 2024-01: 32 in 2024, 6 in 2025, 8 in 2026 | 39 since 2020-10: 3 in 2023, 0 in 2024, 1 in 2025, 5 in 2026 | 17 since 2024-03: 5 in 2024, 12 in 2026 | 10, all 2026-04-18 to 04-25 | 4, 2025-08 to 2025-12 |
| Issues (open / closed) | 3 / 19 | 0 / 69 | 2 / 0 | 0 / 0 | 1 / 0 |
| Maintainer responsiveness | Owner replied on all 3 open issues ([#121](https://github.com/smhex/homebridge-wled-ws/issues/121), [#146](https://github.com/smhex/homebridge-wled-ws/issues/146), [#318](https://github.com/smhex/homebridge-wled-ws/issues/318)) and asked for retests on 2026-10-16. Merges outside contributors' fixes (e.g. [#483](https://github.com/smhex/homebridge-wled-ws/pull/483), 2026-10-23). 32 non-bot PRs. | 3 issues in the last 12 months, all answered (median first reply about 0.5 day) and closed (median 27 days), e.g. [#75](https://github.com/jstrausd/homebridge-simple-wled/issues/75) | No maintainer reply on [#1](https://github.com/drewcovi/homebridge-simpler-wled/issues/1) (2026-03-11) or [#5](https://github.com/drewcovi/homebridge-simpler-wled/issues/5) (2026-04-16) | No issues filed, so no track record. 0 stars. | No reply on [#3](https://github.com/michel-tricot/homebridge-ultimate-wled/issues/3) (2026-08-02) |
| Homebridge v2 (`engines`) | `^1.8.0 \|\| ^2.0.0-beta.0`. HB2 fixes in [#477](https://github.com/smhex/homebridge-wled-ws/pull/477) (2026-10-15) | `^1.8.0 \|\| ^2.0.0`. HB2 cache bug fixed in [#75](https://github.com/jstrausd/homebridge-simple-wled/issues/75) (2026-05) | `>=1.6.0 \|\| ^2.0.0-beta.0` | `^1.8.0 \|\| ^2.0.0` | `^1.8.0 \|\| ^2.0.0-beta.0` |
| Node.js (`engines`) | `^20.19 \|\| ^22.14 \|\| ^24 \|\| ^26` | `>=18` | `>=14` | `>=18` | `^18.20.4 \|\| ^20.18 \|\| ^22.10` (no 24/26) |
| Homebridge verified | **Yes** | No | Yes | Yes | No |
| HOOBS certified | Not verified (see [Open questions](#open-questions)) | Not verified | Not verified | Not verified | Not verified |
| WLED 0.15 / 16.x | README tests list 0.15.0, 0.15.4, "0.16.0", "0.16.1" (probably meaning 16.0.x; unconfirmed) | README says WLED 0.13+; no 16.x statement | README says 0.13+; no 16.x statement | No statement | README says 0.13+ |
| Local only (no cloud)? | **Yes**: no outbound URLs in the code | Yes: only `http://<host>/json/...` and `ws://<host>/ws` | Yes for control. mDNS/SSDP used only by the config-UI discovery scan | Control is local, but it **calls `api.github.com`** to check for WLED updates (`softwareUpdateCheckIntervalSeconds`) | Yes |
| Device addressing | Fixed `address` (IP or hostname) per controller. No discovery. | Fixed `host` (IP or list) | Fixed `host` works. Optional mDNS/SSDP discovery in the UI (fails across VLANs) | Fixed `host` | Fixed `ip` |
| State updates | WebSocket (`wled-client`). Sends a heartbeat after 30 s of silence and reconnects if there's no reply within 10 s. Falls back to HTTP if a send fails. | WebSocket `ws://host/ws`, auto-reconnect | WebSocket, falling back to HTTP polling every `pollInterval` (default 10 s) | WebSocket, plus periodic `presets.json` re-fetch | WebSocket (`wled-client`) |

### Stale (last release 2023 or earlier): not considered further

| Package | Latest | Note |
|---|---|---|
| [homebridge-wled-preset](https://www.npmjs.com/package/homebridge-wled-preset) | 0.5.3, 2021-12-16 | Homebridge `>=1.0.0`, Node `>=10.17`; pre-dates HB2 |
| [homebridge-wled-presets](https://www.npmjs.com/package/homebridge-wled-presets) (drewcovi) | 1.3.4, 2023-04-17 | Single release; superseded by homebridge-simpler-wled |
| [homebridge-wled-simple](https://www.npmjs.com/package/homebridge-wled-simple) | 0.0.1, 2020-04-11 | No repository listed; uses the deprecated `request` library |
| [homebridge-wled](https://www.npmjs.com/package/homebridge-wled) | 0.0.1, 2020-01-17 | No repository listed |

## 2. How presets appear in the Home app, and multi-segment behaviour

| Plugin | Presets in the Home app | Usable from a scene or automation? | On/off and brightness across our 2 segments |
|---|---|---|---|
| **homebridge-wled-ws** | One **Switch** per preset named in config (matched **by name**), alongside the light in the same accessory. A switch shows On only while that preset is active **and** the lights are on (`synchronizePresetSwitches`). Turning a preset switch **off turns the whole controller off**. Playlists act as momentary switches. | **Yes.** Switches are ordinary HomeKit services. | **Global**: on/off sends `on`, brightness sends top-level `bri`, so it's one light for both strings. Colour and colour temperature act on **segment 0 only** (README limitation, [#318](https://github.com/smhex/homebridge-wled-ws/issues/318)), but they only change the colour (`setColor`); the effect keeps running. |
| **homebridge-simple-wled** | A separate **Television** accessory named "Presets", with each preset as an **input**. Preset ID = position in the `presets` list + 1, so WLED presets must be numbered 1..N in that order. Effects and presets can't both be enabled. | **Uncertain.** Scenes can turn the "TV" on/off, but I couldn't confirm that the Home app scene editor can choose a TV *input*. User reports say it can't; I found no Apple documentation either way. | Global `on`/`bri`. **But any colour change from HomeKit also sends `fx:0` to segment 0** (`turnOffAllEffects`), which stops the Candle Flame effect on string A only. |
| **homebridge-simpler-wled** | Television-style **input selector** (Television + InputSource). The README also promises per-preset switches, but the published 3.1.1 code contains no Switch service. Treat that as not present. | Same uncertainty as simple-wled | `useSegments: false` gives one light; `true` gives one light per segment (not wanted here). Unanswered issue [#1](https://github.com/drewcovi/homebridge-simpler-wled/issues/1) says `usePresetService: false` is ignored. |
| **@ncovercash/homebridge-wled-presets** | Every preset is its own **Lightbulb** with its own brightness. Turning one on shows the others off. There is no separate master light. | Yes (they are lights) | Brightness is per-preset-light, applied as WLED's global brightness. The Home app counts each preset as a light, so "turn off all lights" and room light counts include them. |
| **homebridge-ultimate-wled** | **No preset support** (on/off, brightness, colour only) | n/a | n/a |

## 3. Alternative routes

| Route | Status (verified) | Pros | Cons |
|---|---|---|---|
| **WLED native HomeKit/Matter** | None in WLED 16.0.1 (no HomeKit or Matter code in our checkout). A Matter-over-Wi-Fi usermod PR, [wled/WLED#5456](https://github.com/wled/WLED/pull/5456), targeted **ESP32-S3 only** and was **closed without merging** (last updated 2026-07-19). | No bridge needed | Not available. The Dig-Next-2 is a classic ESP32 (PICO-V3-02) anyway. |
| **[wled-matter-bridge](https://github.com/zackelia/wled-matter-bridge)** (Docker) | Last push 2026-06-07, 50 stars | Matter, works with any WLED | Separate service, not a HOOBS plugin. Light only, **no presets**. Discovers by mDNS (manual add exists). README lists HomeKit quirks. |
| **Generic command/HTTP plugins**: [homebridge-cmd4](https://www.npmjs.com/package/homebridge-cmd4) (8.0.4, 2026-02-03, HB2-ready), [homebridge-http-webhooks](https://www.npmjs.com/package/homebridge-http-webhooks) (0.2.0, 2025-03-30), [homebridge-http-switch](https://www.npmjs.com/package/homebridge-http-switch) (0.5.36, 2022-09-20, stale) | As listed | Exact control: one call can send `{"on":true,"ps":3}`, which avoids any ordering issue. No dependence on a WLED-specific plugin's quirks. | You write and maintain the scripts. State comes from polling, not push. Each preset switch is built by hand. More to debug. |
| **Home hub runs a Shortcut "Get contents of URL"** | Not tested | No plugin at all | ~~The home hub would have to reach the IoT VLAN.~~ With the VLAN dropped, nothing blocks this, but each look is a hand-built Shortcut and there's no on/off/brightness tile. |
| **Home Assistant + HomeKit Bridge** | Not researched in depth | Official WLED integration | A whole extra platform. Doesn't fit the HOOBS setup. |

## 4. Recommendation: homebridge-wled-ws

Why:
1. **The most actively maintained.** 8 releases in 2026, the latest on 2026-11-06. The owner answers issues, outside contributors' fixes get merged, and it has explicit Homebridge 2 work ([#477](https://github.com/smhex/homebridge-wled-ws/pull/477)).
2. **Homebridge verified**, and the only plugin whose README claims testing on WLED 16.x.
3. **Presets are plain switches**, so they work in scenes and automations without the TV-input uncertainty.
4. **One light for both strings:** on/off and brightness are global.
5. **Fixed address, no mDNS**, so it works across VLANs. Local only (no outbound URLs in its code). WebSocket push with heartbeat and reconnect.

Known trade-offs:
- Turning a preset switch *off* turns the candles off. That's sensible, but keep it in mind for automations.
- Presets are matched by name. Issue [#121](https://github.com/smhex/homebridge-wled-ws/issues/121) found that spaces in preset names caused problems; it may be fixed in 0.0.27, but avoiding spaces costs nothing.
- The Home app shows colour controls that affect segment 0 only. Don't use them. (Our looks come from palettes, so a stray colour change doesn't stop the flame effect.)
- **Fallback** if HOOBS can't meet its Node requirement: homebridge-simple-wled (Node ≥18), with the TV-input and colour/`fx:0` caveats above. Or migrate HOOBS to stock Homebridge ([official guide](https://github.com/homebridge/homebridge-raspbian-image/wiki/How-To-Migrate-From-HOOBS-To-Homebridge)).

### Setup steps

**Network**
1. Give the controller a **DHCP reservation** in the router, so the plugin's fixed `address` never goes stale.
   This is simpler than WLED's static-IP fields.
2. ~~Firewall: allow only HOOBS → controller TCP 80; block internet and other VLANs.~~ Dropped (no VLAN).
   Every device on the home network can reach port 80, so the settings PIN and OTA lock (steps 6–7) are the
   protection that's left.
3. ~~Reach the web UI through a temporary rule or a jump host.~~ Not needed: the web UI is reachable directly.

**WLED settings** (behaviour checked in our v16.0.1 source)
4. **Presets** (looks):
   - Save each look at a fixed, stable ID (e.g. 1 Classic, 2 SoftWhite, 3 DeepAmber, 4 Halloween, 5 Christmas).
   - Use names **without spaces**.
   - Leave **"Include brightness" unticked**, so HomeKit stays the master brightness (a design decision). In WLED 16, a preset saved this way stores no `on` or `bri` at all (`serializeState` in `json.cpp`), so loading it never changes brightness or power.
   - Tick **"Save segment bounds"**, because the holiday patterns use different segment layouts and switching between looks must restore them.
5. **Power-up behaviour:** WLED defaults to "Turn LEDs on after power up" = on (`turnOnAtBoot`). Decide whether a power cut should bring the candles back on. If not, untick it, or set a boot preset.
6. **Settings PIN:**
   - It does **not** block what the plugin uses: `/json/state`, `/presets.json` and the WebSocket. So the plugin works with a PIN set.
   - It does block `/json/cfg`, file uploads (`/edit`, uploading `presets.json` or `cfg.json`) and the settings pages.
   - Saving or deleting presets through `/json/state` (`psave`/`pdel`) is **not** PIN-protected. Anyone who can reach port 80 can change or delete looks. Without the VLAN that means any device on the
     home network; there's no firewall to stop it, so keep a copy of `presets.json` (Config → Security & Updates → Backup presets).
7. **OTA lock:** blocks firmware uploads unless the OTA password is given. With a settings PIN set, OTA is also accepted from other subnets once the PIN is entered (the "same subnet only" OTA option only applies when no PIN is set). Settings changes are accepted only from private address ranges (10/8, 172.16/12, 192.168/16). "Lock WiFi settings" (with OTA lock) hides the Wi-Fi page.

**Plugin** (install via HOOBS → Plugins, search `homebridge-wled-ws`)
8. Config (presets are listed by **name**, comma-separated):
   ```json
   {
     "platform": "wled-ws",
     "name": "Homebridge-Wled-WS",
     "controllers": [
       {
         "name": "Candles",
         "address": "<reserved IP>",
         "presets": "Classic,SoftWhite,DeepAmber,Halloween,Christmas",
         "showRealTimeModeButton": false,
         "resetRealTimeModeAfterStream": true
       }
     ],
     "logging": false
   }
   ```
   `address` must match the "Client IP" shown in WLED's Wi-Fi settings (plugin README).
9. Restart, pair or refresh the bridge in the Home app, and put the Candles accessory in its room.
   The light plus its preset switches may appear as one tile; "Show as Separate Tiles" makes the switches easier to use in scenes.

**Dusk + Classic automation** (needs an Apple home hub: Apple TV or HomePod)
10. Create a scene **"Candles – Classic"** with:
    - the **Candles** light: On, brightness as wanted;
    - the **Classic** switch: On.

    Order doesn't matter, because a brightness-free preset never changes power or brightness. If the switch arrives first, WLED loads the look while dark (and the switch briefly shows Off) and the light-on then reveals it. If the light comes on first, the look changes a moment later. WLED ignores a `ps` request for the preset that's already active, which is harmless here.
11. Home app → Automation → **A Time of Day Occurs → Sunset** (with any offset) → run "Candles – Classic". Add a matching "Candles off" scene (Candles light Off) for bedtime.

Repeat steps 10–11 for each seasonal look. Siri works too: "Turn on Classic" turns on that preset switch.

## Open questions

Things I couldn't verify, to check before or during setup:

- **HOOBS version, its Node.js and its Homebridge version.** The public [hoobsd source](https://github.com/hoobs-org/hoobsd) was last pushed 2024-01-15 (latest tag v4.0.110, 2021-10-12; it depends on `homebridge ^1.3.4`). HOOBS's [apt repo](https://github.com/hoobs-org/repo) shows packaged hoobsd **5.1.17** published to its "bleeding" channel on 2026-07-30, but no matching public source. Check HOOBS → Settings/About for the **Node.js** and **Homebridge** versions. homebridge-wled-ws needs Node `^20.19`, `^22.14`, `^24` or `^26`.
- **HOOBS certification** of any of these plugins: the HOOBS plugin page (`plugins.hoobs.org`) renders nothing without JavaScript, and I found no current list of certified plugins. HOOBS's own plugin search should show a "Certified" badge if one applies.
- **"0.16.0 / 0.16.1"** in homebridge-wled-ws's compatibility table: probably WLED 16.0.x, but unconfirmed. The API it uses (`/json/state` with `on`/`bri`/`ps`, `/json/info`, `/presets.json`, `/ws`) is all present in our 16.0.1 source.
- **TV-input selection in Home app scenes:** ~~not confirmed either way~~ **confirmed 2026-11-07**: the Home app's
  automation editor lets you choose a TV-style input (tested with the homebridge-wled-candles look list).
- **On real hardware:** the dusk scene behaviour in step 10, and how the plugin handles preset names after 0.0.27 ([#146](https://github.com/smhex/homebridge-wled-ws/issues/146), [#121](https://github.com/smhex/homebridge-wled-ws/issues/121)). Bench-test with the controller.
