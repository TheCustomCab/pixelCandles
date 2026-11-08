# Hardware: controller

The firmware targets the **QuinLED Dig-Next-2** (ESP32-PICO-V3-02, 8 MB flash, 2 MB PSRAM). Notes from setting
one up; QuinLED's own documentation at [quinled.info](https://quinled.info/) is the reference for pinouts and
power ratings. LED strings, power supply and enclosure are up to you and not covered here yet.

## Pins used by the build

| Function | GPIO |
|---|---|
| LED output 1 (data) | 2 |
| LED output 2 (data) | 4 |
| Switchable power outputs (PowerManager usermod): External Relay, 5A_1, 10A_1, 5A_2 | 5, 20, 21, 22 |
| Buttons | 34, 35 |
| Onboard PDM microphone (unused; the audioreactive usermod isn't built) | 7, 8 |

## Stock firmware (as shipped)

- WLED 0.15.3 with QuinLED's MultiRelay usermod, relays on GPIO 5/20/21/22, none marked "external".
- A brightness limiter of 850 mA. This build compiles in 2000 mA; set the limit to suit your power supply.
- The stock image uses the 4 MB partition layout; this build uses the 8 MB layout, so going back to stock is a full
  restore from a flash backup, not an OTA update (see [firmware/BUILD.md](../firmware/BUILD.md#stock-firmware-backup)).
- In `cfg.json`, the MultiRelay/PowerManager key `"active-high": false` is misleading: it stores the *invert* flag,
  so `false` means active-high (not inverted).

## USB and flashing

- The USB-serial chip is a **CH340**. It has proved unreliable at 460800 and 921600 baud: flash at 115200
  (about 95 seconds for a full image), and use a good cable.
- Every esptool command ends with a reset, so WLED boots between commands and may rewrite a few NVS bytes; use
  `--after no-reset` when a read must match the chip exactly.
- Check the security fuses (`espefuse summary`) before the first flash: `FLASH_CRYPT_CNT`, `ABS_DONE_0` and
  `ABS_DONE_1` should all be 0.

## Power outputs

The PowerManager usermod can switch the board's power outputs per segment. With its **take-over relays** option
on, outputs that aren't linked to a segment stay unpowered, so the strings stay dark even though WLED is running.
Link each output to its segment before turning take-over on.

Licence: CC BY 4.0 (see [LICENSE](LICENSE)).
