# Homebridge plugin: design (Phase 0)

Status: **approved 2026-11-07; Phase 1 built.** One change after testing in the Home app: the looks are a named
look list (TV-style inputs) in the Candles tile by default, not switches; see §3a. The plugin lives in `homebridge/` (MIT). It presents the candle
controller (WLED 16.0.1 + candle_flame on a QuinLED Dig-Next-2) as one HomeKit accessory and replaces a generic
WLED plugin for this device. It is candle-specific by design; the WLED communication code is a separate module so a
generic WLED plugin could reuse it later.

## 1. Targets and constraints

| | |
|---|---|
| Homebridge | `^1.8.0 \|\| ^2.0.0-beta.0` (tested on 1.8.4; 2.0 when available) |
| Node.js | `^20 \|\| ^22 \|\| ^24`. Homebridge 1.8 runs on Node 20; Homebridge 2.0 needs Node 22.12+ or 24 |
| Platform type | Dynamic platform (`registerPlatform`), one accessory per configured controller |
| Language / format | TypeScript compiled to ES modules, following the official homebridge-plugin-template |
| Settings UI | `config.schema.json` (works in HOOBS and Homebridge UI) |
| APIs | `onGet`/`onSet` handlers, `HapStatusError` for errors, HAP types from `homebridge`. No deprecated or removed APIs (`updateReachability`, `getValue()`, `Characteristic.Units`, ...), no Matter, no 2.0-only APIs |
| Behaviour | Every error is caught and logged; nothing may crash Homebridge. No analytics, no tracking, no outbound traffic except to the controller |
| Publishing | Level 1 (npm + GitHub), not Homebridge Verified |

Package name, to choose (all free on npm as of 2026-11-07): **`homebridge-wled-candles`** (says what it needs and
what it's for; recommended), `homebridge-candle-flame` (matches the firmware's effect name), `homebridge-candles`
(shortest, but vague).

## 2. Code layout

```
homebridge/
  src/wled/        WLED client: HTTP JSON API + WebSocket, reconnection, typed state. No Homebridge imports.
  src/candles/     Candle-specific model: slots, look tracking.
  src/platform.ts  Dynamic platform: restores cached accessories, creates/reconciles the accessory.
  src/accessory.ts HomeKit services and characteristic handlers.
  test/            Unit tests with a mock WLED server (HTTP + WebSocket).
```

## 3. Accessory and services

One accessory, category Lightbulb, named from config (default "Candles"):

| Service | Subtype | Purpose |
|---|---|---|
| AccessoryInformation | | Manufacturer "WLED", model from `/json/info` (`arch`, product), serial = controller MAC, firmware = WLED version |
| **Lightbulb** "Candles" (primary) | `candles` | On, Brightness |
| **Switch** × 5 | `slot-1` … `slot-5` | One per preset slot; linked to the Lightbulb |

- **One tile.** Services of one accessory appear as one tile in the Home app (unless the user turns on "Show as
  Separate Tiles"). Each Switch is added with `lightbulb.addLinkedService(switch)`, and the Lightbulb is marked
  primary, so the light is the tile's main control and the switches are listed under it.
- **Names.** Each switch's `Name` is fixed at creation; the label shown comes from **`ConfiguredName`**, set from the
  slot preset's name in WLED (Everyday, Halloween, ...). Slots can be renamed on the Candles page; the plugin picks
  up the new name (see §6) and updates `ConfiguredName`. The Home app lets the user rename a switch too; a name
  edited in the Home app wins in Home until the next rename in WLED.
- **No colour.** Hue/Saturation/ColorTemperature are not exposed: the looks are palette-based, and a colour change
  from HomeKit would replace the Candle Flame effect.

## 3a. Change after testing: a named look list (default)

Testing on iOS showed that switches inside a grouped tile are drawn as **unlabelled icons** in the tile's detail
view (their names only appear in the accessory list, scenes and Siri). HomeKit offers a named list only on a
**Television** service, so the default (`lookControl: "combined"`) adds a Television service with one
**InputSource** per slot to the Candles accessory, next to the Lightbulb (which stays primary). The Home app then
shows one tile with the brightness slider, a power button and a scrolling list of the looks by name.

| Service | Subtype | Purpose |
|---|---|---|
| Television | `looks` | Power (mirrors the light's On) and the active look (`ActiveIdentifier` = preset number) |
| InputSource × 5 | `input-1` … `input-5` | One per slot: `Identifier` = preset number, `ConfiguredName`/`Name` = slot name |
| InputSource | `input-other` | "Other look", shown only while the live look matches no slot |

- Inputs are typed **HDMI**: typed OTHER, the Home app didn't list them (a working WLED plugin uses HDMI).
- `DisplayOrder` lists the inputs in slot order; without it the Home app orders them arbitrarily.
- Choosing a look applies the preset (and turns the candles on with the fade if they're off, `slotTurnsOn`).
  Choosing "Other look" does nothing.
- **Brightness and looks:** WLED forgets the active preset (ps = -1) on any change, brightness and on/off included.
  Looks never store brightness, so the plugin remembers the last preset WLED reported with a fingerprint of its
  segments; while they match, that look is still the one showing.
- **Look list while off:** the Home app greys out a TV's input list while the TV is off. `lookListAlwaysOn` makes
  the Television service always report Active, so a look can be chosen while the candles are off (it turns them on
  with the fade; the power button toggles). Tested 2026-11-07: the Home app then shows the tile as On even while
  the candles are off, so it's **off by default** (accurate status; turn the candles on, then choose a look).
  Scenes, automations and Siri can still set a look while the candles are off.
- **Automations:** confirmed 2026-11-07 on iOS: the automation editor offers the light (on/off, brightness) and the
  look (input) of the one accessory, so "sunset: Candles on at 40 % with Halloween" is a single accessory action.
- **Home app sliders:** dragging the slider of an off light makes the Home app send On + Brightness, so the light
  turns on; "brightness while off" is kept for scenes, automations and Siri that set brightness alone.
- The tile's power button and the light both switch the candles; the Home app labels the tile "All On" when both
  services are on. The Home app decides the detail layout (slider above the TV controls); a plugin can't arrange it.
- Other modes: `picker` (the look list as a separate TV-type tile), `switches` (§3/§4 below), `both`. Apple shows
  only one TV-type accessory per bridge properly, which matters only if another plugin on the same bridge also
  creates one.
- A thermostat-style dial with a mode menu was considered and rejected: the dial is a temperature to HomeKit and
  Siri, and the menu only offers HomeKit's fixed modes (Off, Heat, Cool, Auto), which can't be renamed.

## 4. Behaviour

### Light
- **On** → `{"on":true,"tt":<fade × 10>}`: WLED's one-off transition (`tt`, in 100 ms units) gives the fade-in.
  Default fade 10 s (30 s felt slow in testing); WLED holds transition times in a 16-bit millisecond value, so the
  maximum is 65 s. Turning off while a fade is still running is immediate: WLED jumps to the end rather than starting
  a new fade. The fade
  applies only when turning on from off, not to brightness changes (those use a short configurable transition,
  default 1 s).
- **Off** → `{"on":false}` (optional fade-out, default 0 s).
- **Brightness** (HomeKit 1–100 % ↔ WLED 1–255). While the candles are off, a brightness change is sent as
  `{"on":false,"bri":x}`, which WLED stores for the next turn-on without switching on. While on, `{"bri":x}`.
- Looks never store brightness (the slots are saved without it), so HomeKit owns brightness.

### Slot switches (radio behaviour; `lookControl: switches`)
- **A switch is On when the candles are on and showing that slot's preset** (`state.on && state.ps == n`). All
  switches are Off when the candles are off, or when the live look doesn't match a slot (`ps == -1`, e.g. while a
  look is being edited on the Candles page).
- **Turning a slot On** applies the preset (`{"ps":n}`); the other switches go Off as the state update arrives.
  If the candles are off, it also turns them on with the fade-in (`{"on":true,"ps":n,"tt":…}`), so "Candles on +
  Halloween" in a scene is a single action either way. Configurable: `slotTurnsOn` (default true).
- **Turning the active slot Off does nothing to the candles**: the look stays and the switch returns to On after a
  moment. Rationale: "off" has no meaning for a look (the light's own On/Off controls power), and scenes that set
  every other slot to Off must not blank the display. The plugin logs it at debug level.
- **Turning an inactive slot Off** is a no-op (it already is).
- If two slot switches are set in one scene, the last one wins; the Home app applies scene values in no fixed
  order, so scenes should turn on exactly one slot.

### Live sync
- The plugin keeps a WebSocket open to `ws://<host>/ws`. WLED sends the full state when the socket opens and after
  every change, so changes made on the Candles page, in WLED's own UI or by another HomeKit plugin show up in
  HomeKit within about a second (`updateCharacteristic`, so no HomeKit write loops back to WLED).
- Commands go over HTTP (`POST /json/state`), which returns a result to check; the following WebSocket push is the
  confirmation used to update HomeKit.
- **Polling fallback:** while the WebSocket is down, `GET /json/state` every 10 s (configurable).
- **Preset names:** `/json/info` reports `fs.pmt`, the time presets last changed. The plugin reads it every 15 s
  and refetches `/presets.json` when it changes (also at start-up and after every reconnect), then updates the
  switches' `ConfiguredName`. `/candle-slots.json` is read for logging/diagnostics only; the plugin never writes
  to the controller's files.

## 5. Connection and recovery

| Situation | What happens |
|---|---|
| Normal | WebSocket open. Heartbeat: WLED's own `p` → `pong` every 15 s (WLED doesn't answer WebSocket-level pings). No message for 45 s → treat as dead and reconnect. |
| Controller reboot / OTA / power cut | Socket closes → reconnect with exponential backoff (1, 2, 4, … s, max 60 s, ±20 % jitter). On reconnect: WLED sends full state; presets are refetched. After a power cut the candles come up off (boot preset 1, LEDs off at power-up), which HomeKit then shows. |
| Wi-Fi loss | Same as reboot; HTTP commands time out after 3 s. |
| Controller closes all sockets (WLED does this when it runs short of memory; it also keeps at most 8 WebSocket clients and drops the oldest) | Treated as a disconnect; backoff reconnect. |
| Homebridge restart | Cached accessory restored immediately (same UUID); characteristics show the last known values until the first state arrives. If the controller can't be reached within the offline grace period, the accessory shows No Response. |
| Command while offline | Rejected with `SERVICE_COMMUNICATION_FAILURE` (HomeKit shows the failure) rather than queued, so an automation can't fire a stale command minutes later. |

### Offline indication (proposal)
Three options were considered:
1. **No Response** (recommended): after the controller has been unreachable for an offline grace period (default
   30 s, so a reboot doesn't flicker), `onGet` handlers throw `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` and
   the characteristics are updated with that error. The Home app shows the tile as "No Response", which is the
   standard, expected signal, with no extra tiles.
2. **StatusFault** on the Lightbulb: set to General Fault while offline. The Apple Home app mostly ignores it;
   Eve and Controller for HomeKit show it. Added as well, at no cost.
3. **A sensor** (e.g. a Contact Sensor "Candles online"): visible and usable for Home app notifications, but adds
   a tile/accessory and clutters the room. Offered as an option (`offlineSensor`, default off).

## 6. Avoiding HomeKit cache problems
- **Stable identity:** the accessory UUID is generated from a config `id` (default `candles`), not from the host
  or IP, so a new address or a DHCP change never creates a new accessory (which would break scenes).
- **Stable subtypes:** service subtypes (`candles`, `slot-1` … `slot-5`, and later e.g. `character`) never change
  once released. Names live in `ConfiguredName`, so renaming a slot never touches the service identity.
- **Reconcile on start-up:** for a cached accessory, add any missing services and remove services the current
  config doesn't want (e.g. the optional offline sensor turned off). Removal is logged.
- **Adding services later** (Phase 3) is compatible: existing services and their scenes stay; the Home app may need
  to be closed and reopened to show the new ones.
- **One accessory per controller;** a config with several controllers (unlikely) gets one accessory each, keyed by
  their `id`.

## 7. Configuration (`config.schema.json`)

| Key | Default | Meaning |
|---|---|---|
| `name` | `Candles` | Accessory and light name |
| `id` | `candles` | Stable identity (only change it to deliberately create a new accessory) |
| `host` | (required) | Controller IP address or hostname (`<CONTROLLER_IP>`, or `<CONTROLLER_HOSTNAME>.local` if mDNS works on the Homebridge host) |
| `port` | 80 | |
| `fadeInSeconds` | 10 | Fade when turning on (0–65) |
| `fadeOutSeconds` | 5 | Fade when turning off (0–65) |
| `brightnessTransitionSeconds` | 0.5 | Transition for brightness changes |
| `lookControl` | `combined` | `combined` (one tile: dimmer + look list), `picker` (separate look-list tile), `switches`, `both` |
| `lookListAlwaysOn` | false | Keep the look list usable while the candles are off (choosing a look turns them on; the power button toggles). The Home app then shows the tile as On even while the candles are off |
| `pickerName` | `<name> Looks` | Name of the separate look-list tile (`picker`/`both`) |
| `slotTurnsOn` | true | Choosing a look also turns the candles on |
| `slots` | `[1,2,3,4,5]` | Preset numbers offered as looks (normally the five slots) |
| `pollSeconds` | 10 | Polling interval while the WebSocket is down |
| `offlineGraceSeconds` | 30 | How long unreachable before No Response |
| `offlineSensor` | false | Extra "online" contact sensor |
| `debug` | false | Verbose logging (state changes, reconnects) |

## 7a. Seasons: dropped (2026-11-07)

Choosing a look by date inside the plugin was built and then removed. Date-based looks are better handled by
Home app automations that are enabled only at certain times of year (the same way other seasonal decorations are
run), which keeps looks managed in two places (the Candles page and the Home app) instead of three. The plugin
therefore has no date logic; an automation sets the look (TV input) and brightness of the Candles accessory.

## 8. Candle character controls: dropped (2026-11-07)

Not built. Option C below would only be visible in Eve or Controller for HomeKit (a third place to manage the
candles), options A and B show unlabelled or misleading controls in the Home app, and a slider change would last only
until the next look loads. The split stays: **HomeKit does on/off, brightness and look; the flame itself is tuned on
the Candles page**, and a calmer evening is a look in a slot that an automation selects. The original proposal is
kept below for reference.


Goal: adjust the flame (flicker depth, softness, speed, gusts, randomness) from a HomeKit app without breaking
the Home app's lighting behaviour.

| Option | Pros | Cons |
|---|---|---|
| **A. Extra Lightbulb services** ("Flicker" as a dimmable light) | Visible in Apple Home; Siri ("set Flicker to 40 %"); usable in Apple Home scenes and automations | Counted as lights ("2 lights on"), switched off by "turn off all the lights" and by room light controls, bulb icons, and an On/Off that means nothing for a slider. The gotcha this proposal must avoid. |
| **B. Fan services with RotationSpeed** ("Flicker" as a fan speed) | Visible in Apple Home; not a light, so not caught by "lights off"; slider in Apple Home scenes/automations | Fan icon and wording; "turn off all fans" affects it; Active On/Off still needs a meaning; one tile per control or clutter in the candles tile |
| **C. Custom characteristics on the Lightbulb** (vendor UUIDs with names, 0–100 %) | Not lights, not fans, no extra tiles; invisible to "all lights off"; shown and editable in **Eve** and **Controller for HomeKit**, which can also use them in their own scenes/automations | Not visible in Apple Home; no Siri; Apple Home automations can't set them |

**Recommendation: C**, custom characteristics on the Lightbulb: Flicker depth, Softness, Speed, Gusts and
Randomness as percentages (0–100 % mapped to the effect's ranges; Gusts 0–31). Reasons: it keeps the Home app clean
and correct (lights stay lights), and fine-tuning a flame is an occasional, deliberate act that suits Eve or
Controller for HomeKit. For changes that should happen automatically ("calmer after 10 PM"), the better tool is a
**look**: save a calmer version in a slot (e.g. Evening) and have an Apple Home automation select that slot. That
works in Apple Home, with Siri and in scenes, and keeps the full look (colours and flame) consistent.

Whether a slider change is **temporary** (until the next look loads) or **saved into the active slot** is decided
in Phase 3; default **temporary**. (Phase 3 was dropped; see above.)

## 9. Testing workflow

- **Local only:** Homebridge is a dev dependency of `homebridge/`, run from the project with its own storage
  directory (`-U ./.homebridge-test`), its own port and bridge name (e.g. "Candles Dev"), so nothing on the system
  changes and the household Homebridge (HOOBS) is untouched. The test bridge is paired with the Home app only when
  the owner asks.
- **Never touch HOOBS** from the development machine: no connections, logins or changes. Installing there is the
  owner's step after a phase is approved.
- **Testing against the real controller** is fine; another WLED plugin on HOOBS will stay connected at the same
  time, so both will show the same state changes (the controller allows up to 8 WebSocket clients).
- **Unit tests** (Phase 1): a mock WLED server (HTTP + WebSocket) covering connect, disconnect/reconnect with
  backoff, offline → No Response → recovery, slot radio behaviour, external state changes, preset renames.
- **Installing on HOOBS before npm:** to be confirmed in Phase 1 (a packed tarball, `npm pack`, is the standard
  route for Homebridge; whether the HOOBS UI accepts one, or needs a terminal install, will be checked against
  HOOBS documentation, not by touching the HOOBS host).
- A **manual test checklist** per phase: Home app tile grouping, switch behaviour, unplug-and-recover, Homebridge
  restart, a sunset automation.

## 10. Cutover from a generic WLED plugin (document only)

Switching plugins creates a new accessory, so Home app scenes and automations that use the candles must be
rebuilt. Steps (detailed in docs/homebridge-testing.md):
1. Note every scene and automation that uses the candles (Home app → each scene → Edit).
2. Install this plugin and confirm the new Candles accessory works (on/off, brightness, slots).
3. Remove the controller from the old plugin's config (or uninstall it) and restart Homebridge; remove any leftover
   "No Response" accessory from the Home app.
4. Put the new accessory in its room, then rebuild the scenes and automations: light On (brightness) + the look.
