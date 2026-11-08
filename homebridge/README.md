# homebridge-wled-candles

HomeKit control for [WLED](https://github.com/wled/WLED) candles: one tile in the Home app with a
dimmable light, gentle fades and a named list of looks. Built for the
[pixelCandles project](https://github.com/TheCustomCab/pixelCandles) (WLED with the `candle_flame` usermod),
and works with any WLED controller whose looks are saved as presets.

## What you get

One **Candles** accessory, one tile:

- **Light:** on/off and brightness. Turning on fades in (default 10 s), turning off fades out (default 5 s).
- **Looks:** WLED presets 1–5 by name (e.g. Everyday, Halloween, Christmas, Evening, Special), in slot order, in the
  same tile. Choosing a look loads it; choosing one in a scene or automation while the candles are off turns them
  on with the fade.
- **Scenes and automations** can set the light, its brightness and the look together; the plugin sends them as one
  change, so a scene fades in straight into its look.
- **Live sync:** changes made elsewhere (WLED's own page, another app) show up in HomeKit within a second or two.
  The current look stays selected through brightness and on/off changes.
- **No Response** in the Home app when the controller can't be reached; the plugin reconnects by itself.

What it deliberately leaves out: colour control (a HomeKit colour would replace the flame effect) and effect
settings. Looks are designed in WLED; HomeKit chooses between them. For seasonal looks, use Home app automations
that are enabled only at certain times of year.

## Requirements

- Homebridge 1.8 or later (Homebridge 2.0 supported), or HOOBS. Node.js 20, 22, 24 or 26.
- A WLED controller (tested with WLED 16.0.1) with a fixed address: a DHCP reservation in your router, or its
  `.local` hostname.
- Your looks saved as WLED presets 1–5, **without** "Include brightness" (HomeKit keeps the brightness).

## Installation

Search for **WLED Candles** in the Homebridge (or HOOBS) plugin screen and install it, or from a terminal:

```
npm install -g homebridge-wled-candles
```

Then set the controller's address in the plugin settings and restart Homebridge. The Candles accessory appears in
the Home app under the Homebridge bridge.

## Configuration

The settings screen covers everything below. Minimal `config.json` entry:

```json
{
  "platform": "WledCandles",
  "name": "Candles",
  "host": "192.0.2.10"
}
```

| Setting | Default | |
|---|---|---|
| `host` | (required) | Controller IP address or hostname |
| `port` | 80 | Controller HTTP port |
| `name` | `Candles` | Accessory and light name |
| `fadeInSeconds` | 10 | Fade when turning on (0–65) |
| `fadeOutSeconds` | 5 | Fade when turning off (0–65) |
| `brightnessTransitionSeconds` | 0.5 | Transition for brightness changes |
| `slots` | `[1,2,3,4,5]` | Preset numbers offered as looks (config.json only, not in the settings screen) |
| `slotTurnsOn` | true | Choosing a look also turns the candles on |
| `lookControl` | `combined` | `combined`: one tile with the dimmer and the look list. `picker`: the look list as its own tile. `switches`: one switch per look in the tile (the Home app shows them unlabelled there). `both`: picker and switches |
| `lookListAlwaysOn` | false | Keep the look list usable while the candles are off. The Home app then shows the tile as On even while the candles are off |
| `pickerName` | `<name> Looks` | Name of the separate look-list tile (`picker`, `both`) |
| `pollSeconds` | 10 | Polling interval while the live connection is down |
| `offlineGraceSeconds` | 30 | How long the controller may be unreachable before No Response |
| `offlineSensor` | false | Add an "online" contact sensor, for Home app notifications |
| `id` | `candles` | Accessory identity. Changing it creates a new accessory (scenes must be rebuilt) |
| `debug` | false | Verbose logging |

## Notes

- **Turning off during a fade-in** is immediate: WLED cancels the fade.
- **Renaming a look** in WLED shows up in HomeKit within about 15 seconds; the Home app may need reopening to
  redraw.
- **No Response** appears the next time the Home app reads the accessory (open the app or the room), not instantly.
- **Switching from another WLED plugin** creates a new accessory, so scenes and automations that used the old one
  must be rebuilt. Write them down first, install this plugin, check it, then remove the controller from the old
  plugin.
- **"Other look"** in the list means the candles are showing something that matches none of the slots, for
  example while a look is being edited in WLED.

## Development

```
npm install
npm test          # unit and HomeKit-mapping tests against a mock WLED controller
npm run dev       # a separate local test bridge; see docs/homebridge-testing.md in the repository
```

Design notes: [docs/homebridge-design.md](https://github.com/TheCustomCab/pixelCandles/blob/main/docs/homebridge-design.md).
Release steps: [docs/homebridge-release.md](https://github.com/TheCustomCab/pixelCandles/blob/main/docs/homebridge-release.md).

## Licence

PolyForm Noncommercial 1.0.0, see [LICENSE](LICENSE): free for personal and other non-commercial use.
Commercial use needs a licence from the author: see [COMMERCIAL.md](https://github.com/TheCustomCab/pixelCandles/blob/main/COMMERCIAL.md).
