# Changelog

## 0.1.1 (2026-11-07)

- Settings screen simplified so it opens in HOOBS (it showed a blank page): no grouped sections; the look slot
  numbers (`slots`) are set in config.json only.

## 0.1.0 (2026-11-07)

First release.


- Candles light (on/off, brightness) with a configurable fade-in, fade-out and brightness transition.
- Looks (presets 1–5) as a named list (TV-style inputs) in the Candles tile, in slot order, names from WLED;
  optional separate look-list tile or switches (`lookControl`).
- Live sync over WLED's WebSocket, with heartbeat, reconnection with backoff, and polling while disconnected.
- No Response (and StatusFault) when the controller is unreachable; optional "online" contact sensor.
- Commands arriving together (Home app scenes) are sent as one, so a scene fades in smoothly.
- The current look survives brightness and on/off changes (WLED itself forgets the active preset).
- Optional: look list usable while the candles are off (`lookListAlwaysOn`, off by default because the Home app then
  shows the tile as On). Defaults: fade-in 10 s, fade-out 5 s, brightness transition 0.5 s.
