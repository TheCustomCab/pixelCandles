# Setup after flashing

Placeholders such as `<CONTROLLER_IP>` stand for your own values (see `site.example.md` in the repository root).

## WLED settings

**LED Preferences** (defaults are compiled in, but check them):
- Output 1: GPIO 2, SK6812 RGBW. Output 2: GPIO 4, SK6812 RGBW. Set the pixel counts of your strings
  (the compiled defaults are 12 and 11).
- Colour order: check it with solid red, green, blue and white before building looks. Pixels sold as
  "WS2811 RGBW" often work as SK6812 RGBW with colour order RGB.
- **Auto-calculate white channel: None.** The effect sets W itself; any auto-white mode would override it.

**Usermods → CandleFlame:**
- `whiteKelvin`: colour temperature of the pixels' white LED (3000 for typical warm-white RGBW pixels).
- `whiteGainPct`: trim if the W channel looks too bright or dim next to RGB (100 = nominal).

**Usermods → PowerManager:** link each string's power output to its segment, so turning a string off cuts its
power. While outputs aren't linked, leave **take-over relays** off: with it on, unlinked outputs stay unpowered
and the strings stay dark even though WLED is running.

**Config → LED Preferences → Defaults:** boot preset 1, and turn off "Turn LEDs on after power up" if HomeKit
should decide when the candles come on.

**Config → WiFi Setup:** an mDNS name (e.g. `candles`) makes the page reachable at `http://<name>.local/`; WLED
also uses it as its DHCP hostname. Give the controller a DHCP reservation in your router.

**Config → Security & Updates:** set a settings PIN and an OTA lock. Note that the PIN doesn't protect
`/json/state`, `/presets.json`, `/ws` or saving presets: anything on your network can still change looks.

## Candles page

Upload the page as described in [firmware/BUILD.md](../firmware/BUILD.md#candles-page), then open
`http://<CONTROLLER_HOSTNAME>.local/` or `http://<CONTROLLER_IP>/`.

## HomeKit

Presets 1–5 are the HomeKit slots. With a Homebridge WLED plugin, show only presets 1–5 and keep looks in the
library (presets 10 and up). See [HOMEKIT.md](HOMEKIT.md) for the plugin research and [REVISION2.md](REVISION2.md)
for the plan for a dedicated plugin.
