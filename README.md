# pixelCandles

Flickering LED candles driven by WLED: every candle flickers on its own, palettes tuned for RGBW pixels with a
warm-white LED, holiday patterns, a phone-friendly control page, and HomeKit control of power, brightness and
looks.

The firmware is a usermod for [WLED](https://github.com/wled/WLED) 16.0.1 running on a
[QuinLED Dig-Next-2](https://quinled.info/) controller. WLED itself is not included: the build fetches a pinned
WLED release.

## Repository layout

| Folder | What it is | Licence |
|---|---|---|
| [`firmware/`](firmware/README.md) | `candle_flame` WLED usermod (Candle Flame effect, palettes, HomeKit slots), build overlay, the Candles control page, tools and host tests | EUPL-1.2 |
| [`homebridge/`](homebridge/README.md) | Homebridge plugin for HomeKit | MIT |
| [`hardware/`](hardware/README.md) | Controller notes (QuinLED Dig-Next-2) | CC BY 4.0 |
| [`docs/`](docs/) | Setup guide, design notes, HomeKit research and plugin plan | CC BY 4.0 |
| `scripts/` | Repository tooling (see [CONTRIBUTING.md](CONTRIBUTING.md)) | MIT |

Third-party components and their licences: [NOTICE](NOTICE).

## Getting started

1. Build and flash the firmware: [firmware/BUILD.md](firmware/BUILD.md).
2. Configure WLED and upload the Candles page: [docs/setup.md](docs/setup.md).
3. Open the Candles page on the controller and build your looks.

## Contributing

Notes on keeping your own network details out of commits: [CONTRIBUTING.md](CONTRIBUTING.md).
