# Homebridge plugin: testing

## Automated tests

```
cd homebridge
npm install
npm test
```

The tests run against a mock WLED controller (HTTP + WebSocket) and need no hardware:

- **WLED client:** connect; follow changes pushed over the WebSocket; preset renames; reconnect after WLED drops
  every socket; a silent (hung) socket is detected and replaced.
- **Offline:** the controller disappears (power cut) → offline after the grace period, commands rejected → it
  comes back (reboot) → state resynchronised; last known values are shown right after start-up.
- **Controller logic:** fade-in on turn-on; a Home app scene (on + brightness + slot) becomes **one** command with
  the fade; brightness while off is stored without turning on; slot switches behave as radio buttons and follow the
  live state; choosing a slot while off turns the candles on; turning the active slot off changes nothing;
  fade-out; slot names from presets.
- **HomeKit mapping** (Homebridge's own PlatformAccessory and HAP-NodeJS): one primary light with five linked
  slot switches named from WLED; stale services removed; reads and writes; the active slot flips back on;
  outside changes reach HomeKit; **No Response** (`SERVICE_COMMUNICATION_FAILURE`) and StatusFault while offline,
  then recovery.

The suite passes on Node 20.5.1 (the oldest supported) as well as current Node. To try an older Node without
installing it: `npx node@20 --test build-test/test/` after `npm run build:test`.

## A local test bridge

Runs a separate Homebridge from the project folder (installed as a dev dependency, nothing global), with its own
storage folder `homebridge/.homebridge-test/` (gitignored), port 51830 and bridge name "Candles Dev", so it never
interferes with another Homebridge or HOOBS on the network:

```
cd homebridge
CANDLES_HOST=<CONTROLLER_IP> npm run dev
```

(Without `CANDLES_HOST`, the address is read from `<CONTROLLER_IP>` in `site.local.md`.) The bridge prints its
setup code; it isn't paired with anything until you add it in the Home app (**+ → Add Accessory → More options**).
Another WLED plugin can stay connected to the same controller meanwhile; both show the same changes. To start the
test bridge from scratch (new identity, unpaired), delete `.homebridge-test/` while it's stopped.

## Installing on HOOBS before the plugin is on npm

HOOBS's plugin screen installs packages from the npm registry; its documentation describes no way to install a
local file or a git address, so treat these as options to try, in order of reliability:

1. **Publish a pre-release to npm** (e.g. `0.1.0-beta.1` with the `beta` dist-tag, `npm publish --tag beta`):
   regular users don't get it, and HOOBS can install it by name and version. This is the dependable route.
2. **HOOBS's built-in terminal**, if your HOOBS version offers one: copy the packed plugin
   (`npm pack` → `homebridge-wled-candles-<version>.tgz`) to the HOOBS host and install it into the bridge's plugin
   folder with `npm install <file>.tgz`. Paths differ between HOOBS versions; not verified.
3. **A second, plain Homebridge** (e.g. on a computer or in Docker) for the trial period, then move to HOOBS once
   the plugin is on npm.

## Manual checklist (Phase 1)

Pair the test bridge (or install on HOOBS) and go through:

| # | Check | Expected |
|---|---|---|
| 1 | Home app: the accessory | **One tile** "Candles". Opening it shows the brightness slider, a power button and the looks by name in slot order (Everyday, Halloween, Christmas, Evening, Special). |
| 2 | Turn on / off from the Home app | On: candles fade up over the fade-in (default 10 s; the slider shows the target level at once). Off: they fade out over 5 s. |
| 3 | Brightness while on | Changes within about a second. |
| 4 | Brightness change keeps the look | After a brightness change (and after off/on), the look list still shows the same look, not "Other look". |
| 5 | Choose another look | That look loads; the list and the Candles page agree. |
| 6 | Power button vs slider | Both turn the candles on (with the fade, back to the last brightness) and off, and stay in step. |
| 7 | Tile status | With the candles off, the tile shows Off (the look list is greyed out until they're on). |
| 8 | Change look on the Candles page | The Home app follows within a couple of seconds. While a look is being edited (no slot matches), the list shows "Other look". |
| 9 | Rename a slot on the Candles page | The look's name changes in the Home app within about 15 s plus however long the Home app takes to redraw (reopen it if needed). |
| 10 | Unplug the controller | After ~30 s the plugin marks it offline; the Home app shows **No Response** the next time it reads the accessory (open the app or the room). Plug it back in → it recovers by itself within seconds of the controller booting (candles come up off, as configured). |
| 11 | Restart Homebridge (HOOBS) | The tile stays (no duplicate, scenes intact) and shows the right state once connected. |
| 12 | Scene "Candles on 40 % + Halloween" (light on, brightness and look set on the one accessory) | One smooth fade-in to Halloween at 40 %. |
| 13 | Automation at sunset running that scene | Same as 12 at sunset; "Turn off all lights" turns the candles off. |

After installing on HOOBS, run the same checklist there (docs/homebridge-release.md, step 6).

## Cutover from a generic WLED plugin

Switching plugins creates a new accessory: Home app scenes and automations that used the old candles accessory must
be rebuilt.

1. **Write down** every scene and automation that uses the candles (Home app → Automation tab, and each scene's
   Edit screen), including brightness and which look/preset each one selects.
2. **Install** this plugin and set the controller address (and the fade time) in its settings. Restart.
3. **Check** the new "Candles" accessory: on/off, brightness, all five slot switches (checklist 1–7).
4. **Remove the old plugin's device:** delete the controller from the old plugin's settings (or uninstall the
   plugin) and restart. In the Home app, remove any leftover "No Response" candles accessory.
5. **Room and name:** move the new accessory into its room and check its name.
6. **Rebuild** each scene and automation from step 1: the Candles light (On, brightness) plus the look. Test each
   once.
