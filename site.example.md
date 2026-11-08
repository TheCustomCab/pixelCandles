# Site details (template)

Copy this file to `site.local.md` and fill in your own values. `site.local.md` is gitignored: it holds the
details of one installation (addresses, network names, equipment) that must never be committed. The docs use the
placeholders below instead; your own notes and tools can read the real values from `site.local.md`.

## Network

| Placeholder | Meaning | Value |
|---|---|---|
| `<CONTROLLER_IP>` | Candle controller's IP address (give it a DHCP reservation in your router) | |
| `<CONTROLLER_HOSTNAME>` | Controller's mDNS name, set in WLED (Config → WiFi Setup → mDNS address), reached as `<CONTROLLER_HOSTNAME>.local` | |
| `<CONTROLLER_MAC>` | Controller's MAC address (WLED Info page) | |
| `<DEVICE_ID>` | Last 6 hex digits of the MAC; WLED's default name is `wled-<DEVICE_ID>` | |
| `<HOOBS_IP>` | IP address of the HOOBS / Homebridge host | |
| Wi-Fi network | Network the controller joins | |
| Router | Make and model (for DHCP reservation steps) | |

## Equipment

| Item | Value |
|---|---|
| HOOBS / Homebridge host (hardware) | |
| HOOBS version | |
| Homebridge version | |
| Node.js version | |
| `<SERIAL_PORT>`: controller's USB serial port on the build machine (`ls /dev/cu.*`) | |

## Installation

| Item | Value |
|---|---|
| Room | |
| Strings (pixels per output) | |

## Local files

| Item | Value |
|---|---|
| Stock flash dump (`Backups/stock.bin`, contains Wi-Fi credentials) | location and SHA-256 |
| Other local design references | |

## Leak guard values

The pre-commit hook (`scripts/leak-guard.sh`) blocks any commit containing one of these strings (case-insensitive),
in addition to private IP addresses and MAC addresses. One per line; blank lines and lines starting with `#` are
ignored. Put every real value from above here.

```leakguard
# 192.0.2.10
# my-wifi-name
```
