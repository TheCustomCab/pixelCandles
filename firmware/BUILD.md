# Building and flashing

Run the commands below from this `firmware/` folder. They work on Linux, macOS and Windows; where the shells
differ, both forms are shown.

Placeholders such as `<CONTROLLER_IP>` and `<SERIAL_PORT>` stand for your own values. Commands use `$CONTROLLER`
for the controller's address: `export CONTROLLER=<CONTROLLER_IP>` (bash/zsh) or `$env:CONTROLLER="<CONTROLLER_IP>"`
(PowerShell). Your serial port is something like `/dev/ttyUSB0` (Linux), `/dev/cu.usbserial-…` (macOS) or `COM3`
(Windows).

## One-time setup

You need git, Python 3, Node.js (LTS) and:

- **PlatformIO Core** builds the firmware: `pip install platformio` (or the PlatformIO extension for VS Code).
- **Node.js** is needed because WLED's build compiles its web UI.
- **esptool** is for the fuse check and flashing: `pip install esptool`.

On macOS, `brew install platformio node esptool git` installs everything. The Dig-Next-2's USB chip is a CH340;
Windows and older macOS versions may need its driver.

## Build

WLED is not included in this repository. The build uses a pinned WLED release cloned into `firmware/WLED/`
(gitignored), with our build environment and usermod copied in:

```
git clone --depth 1 --branch v16.0.1 https://github.com/wled/WLED.git
cp platformio_override.ini WLED/
cp -r usermods/candle_flame WLED/usermods/
cd WLED
pio run -e dig-next-2-candles
```

(PowerShell: `Copy-Item platformio_override.ini WLED/` and `Copy-Item -Recurse usermods/candle_flame WLED/usermods/`.)
Copy the usermod again after every change to it: the build uses the copy.

The first build downloads the ESP32 toolchain and libraries and takes several minutes. Output:

- `build_output/release/WLED_16.0.1_Dig-Next-2_Candles.bin`, the app image (for OTA updates)
- `.pio/build/dig-next-2-candles/`, which holds `bootloader.bin`, `partitions.bin` and `firmware.bin`

To make a single factory image for a fresh install:

```
B=~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin   # Windows: %USERPROFILE%\.platformio\...
cd .pio/build/dig-next-2-candles
esptool --chip esp32 merge-bin -o factory.bin --flash-mode dio --flash-size 8MB \
  0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 $B 0x10000 firmware.bin
```

## First flash (erase + factory image)

Plug the Dig-Next-2 into USB-C and find its serial port (`ls /dev/ttyUSB* /dev/cu.*` on Linux/macOS, Device
Manager → Ports on Windows).

1. **Back up the stock configuration.** In the WLED web UI, download `cfg.json` and `presets.json`.
2. **Check the security fuses.** Run `espefuse --port <SERIAL_PORT> summary`. `FLASH_CRYPT_CNT`, `ABS_DONE_0` and `ABS_DONE_1` should all be 0.
3. **Keep a copy of the stock firmware.** Run `esptool --port <SERIAL_PORT> read-flash 0 0x800000 stock.bin` (8MB).
4. **Erase the chip.** Run `esptool --port <SERIAL_PORT> erase-flash`.
5. **Write the factory image.** Run `esptool --port <SERIAL_PORT> --baud 921600 write-flash 0x0 factory.bin`.
   The board's CH340 USB chip has failed at 921600 and 460800 baud (seen on macOS); `--baud 115200` is reliable
   (about 95 seconds).
   Read the full 8MB backup in chunks; see [Stock firmware backup](#stock-firmware-backup) below.

After the first flash, update over Wi-Fi by uploading the app `.bin` in Config → Security & Updates → Manual OTA.

## Candles page

The Candles page is the controller's front page (`http://<CONTROLLER_HOSTNAME>.local/`), and WLED's own UI moves to
`/wled.htm` (the page's **WLED ↗** button). Both live on the controller's filesystem and survive firmware
updates. Upload the page under both names (the second keeps old `/candles.htm` links working):

```
curl -F "data=@web/candles.htm;filename=/index.htm" http://$CONTROLLER/upload
```

```
curl -F "data=@web/candles.htm;filename=/candles.htm" http://$CONTROLLER/upload
```

WLED's own UI at `/wled.htm` is the firmware's built-in UI with one patch (see `tools/wled_ui.py`). Regenerate
and upload it **after every firmware build that changes WLED's UI** (e.g. a WLED version update), so it matches
the firmware:

```
python3 tools/wled_ui.py
```

```
curl -F "data=@WLED/build_output/wled.htm.gz;filename=/wled.htm.gz" http://$CONTROLLER/upload
```

With a settings PIN set, uploads are refused until the PIN is entered; use WLED's file editor at `/edit` instead.
To get WLED's UI back at `/`, delete `/index.htm` in `/edit`. To try page changes without uploading, open the
local file with `?host=<CONTROLLER_IP>`.

## First boot

1. Join the **QuinLED-AP** Wi-Fi network (password `wled1234`; the name comes from `WLED_BRAND`) and open
   http://4.3.2.1 to connect the controller to your network.
2. Work through [docs/setup.md](../docs/setup.md) (WLED settings after flashing).
3. Security settings (Config → Security & Updates):
   - Set a settings PIN.
   - Enable the OTA lock and set a password.
   - Disable "Allow WiFi AP" fallback once it's on your network, if you prefer.
4. Give the controller a DHCP reservation in your router, so its address never changes. (An IoT VLAN was
   considered and dropped as impractical on a home mesh router; the controller lives on the main network.)

## Stock firmware backup

Our record of backing up a stock QuinLED Dig-Next-2 before the first flash (2026-11-06). Keep the dump in the
repository's `Backups/` folder, which is gitignored: **a flash dump contains your Wi-Fi password** (in NVS and in `wsec.json` on the
filesystem) and any OTA/AP passwords. Never share or commit it.

How it was made and checked:

- `esptool read-flash` at 115200 baud, in 32 chunks of 256KB, each checked by esptool's MD5. The board's CH340
  USB link dropped bytes and once disconnected on a marginal cable; a second cable read cleanly.
- WLED boots between chunk reads and rewrites a few bytes of Wi-Fi data in NVS (0xc025–0xc33b). Re-read the first
  chunk with `--after no-reset` (chip held in the bootloader), so the file is one consistent snapshot.
- `esptool verify-flash 0x0 stock.bin` (the chip computes the MD5 of its own flash) should report a digest match.
- Bootloader (0x1000) and app0 (0x10000) pass `esptool image-info` (checksum and SHA-256 valid).

What the stock image contains:

- App in app0: WLED **0.15.3**, QuinLED Dig-Next-2 build with MultiRelay (ESP-IDF v4.4.4). app1 is empty;
  otadata selects app0.
- Filesystem: `cfg.json`, `bkp.cfg.json`, `presets.json`, `wsec.json`, `version-info.json`.
- Stock partition table is the **4MB** layout (only the first 4MB of flash are used; everything above is 0xFF):

  | Name | Type | Offset | Size |
  |---|---|---|---|
  | nvs | data/nvs | 0x9000 | 20K |
  | otadata | data/ota | 0xe000 | 8K |
  | app0 | app/ota_0 | 0x10000 | 1536K |
  | app1 | app/ota_1 | 0x190000 | 1536K |
  | spiffs | data/spiffs | 0x310000 | 960K |

  Our build uses the 8MB layout (WLED_ESP32_8MB.csv), so going back to stock means a full restore, not an OTA.

Restoring stock (brings back the stock firmware, settings and Wi-Fi credentials exactly as they were):

```
esptool --port <SERIAL_PORT> erase-flash
esptool --port <SERIAL_PORT> write-flash 0x0 ../Backups/stock.bin
```

## Host tests (optional)

```
cd test
g++ -std=c++17 -O2 -I../usermods/candle_flame sim_test.cpp -o sim_test && ./sim_test
```

Any C++17 compiler works (g++, clang++; on Windows, MSVC `cl /std:c++17 /EHsc /I..\usermods\candle_flame
sim_test.cpp` or MinGW).
