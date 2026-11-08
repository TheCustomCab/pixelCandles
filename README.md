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
| [`homebridge/`](homebridge/README.md) | Homebridge plugin for HomeKit (in development) | MIT |
| [`hardware/`](hardware/README.md) | Controller notes (QuinLED Dig-Next-2) | CC BY 4.0 |
| [`docs/`](docs/) | Setup guide, design notes, HomeKit research and plugin plan | CC BY 4.0 |
| `scripts/` | Repository tooling (leak guard) | MIT |

Third-party components and their licences: [NOTICE](NOTICE).

## Getting started

1. Build and flash the firmware: [firmware/BUILD.md](firmware/BUILD.md).
2. Configure WLED and upload the Candles page: [docs/setup.md](docs/setup.md).
3. Open the Candles page on the controller and build your looks.

## Your site details and the leak guard

The docs use placeholders such as `<CONTROLLER_IP>`, `<CONTROLLER_HOSTNAME>`, `<HOOBS_IP>` and `<SERIAL_PORT>`.
Keep your real values in **`site.local.md`**: copy `site.example.md` to `site.local.md` and fill it in. It's
gitignored (as are `*.local.*` files and the `Backups/` folder, where flash dumps and WLED config downloads go:
those contain Wi-Fi details), so it never leaves your machine.

The **leak guard** blocks commits that contain private IP addresses (10.x, 172.16–31.x, 192.168.x), MAC
addresses, or any value listed in the `leakguard` block of your `site.local.md`. Install it once after cloning:

```
git config core.hooksPath .githooks
```

From then on every `git commit` runs `scripts/leak-guard.sh` on the staged files. Run it by hand on the whole
repository (e.g. before publishing) with:

```
scripts/leak-guard.sh --all
```

The guard is a bash script: on Windows, run it from Git Bash (installed with Git for Windows), which is also what
Git uses for hooks. A line containing `leak-guard: allow` is skipped, for deliberate examples. Without a
`site.local.md` the guard still checks IP and MAC addresses.
