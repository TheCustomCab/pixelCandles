# Contributing

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
