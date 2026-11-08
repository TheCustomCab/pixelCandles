# Homebridge plugin: release checklist

How to publish `homebridge-wled-candles` to npm and install it on HOOBS. Publishing is a manual step; nothing here
runs automatically.

Status (2026-11-07): the npm name `homebridge-wled-candles` is free. `package.json` points `repository`, `bugs` and
`homepage` at `https://github.com/TheCustomCab/pixelCandles`, which must exist (public) before the first publish,
or those fields must be changed to the real address.

## One-time setup

1. **GitHub:** push the public repository to `https://github.com/TheCustomCab/pixelCandles` (or change the three
   URLs in `homebridge/package.json` and `homebridge/README.md` to match).
2. **npm account:** create one at npmjs.com (e.g. the same name, TheCustomCab), turn on two-factor authentication,
   then sign in from a terminal:
   ```
   npm login
   npm whoami
   ```
3. Publish from the **public** repository's `homebridge/` folder, so the package is built from exactly what is
   public.

## Each release

1. **Version:** set `version` in `homebridge/package.json` (`0.1.0-beta.1`, then `0.1.0`, then semantic versioning:
   fixes 0.1.1, features 0.2.0). Run `npm install` so `package-lock.json` matches.
2. **Changelog:** move the "unreleased" heading in `CHANGELOG.md` to the version and date, e.g.
   `## 0.1.0 (2026-11-20)`.
3. **Tests**, on the oldest and newest supported Node versions:
   ```
   npm ci
   npm test
   npx -y node@20 --test build-test/test/
   ```
4. **Package contents:** check exactly what will be uploaded (should be `dist/`, `config.schema.json`, `README.md`,
   `LICENSE`, `CHANGELOG.md`, `package.json`; no tests, no `.homebridge-test`, no site details):
   ```
   npm pack --dry-run
   ```
5. **Publish.** `prepublishOnly` runs the tests again and `prepack` builds `dist/`.
   - Trial (pre-release; regular installs don't get it):
     ```
     npm publish --tag beta
     ```
   - Release:
     ```
     npm publish
     ```
6. **Install on HOOBS:** HOOBS → Plugins → search **homebridge-wled-candles** → install. For a beta, choose the
   version if the screen offers a version list; if it doesn't, publish the trial as a normal release instead (it is
   the only user's install either way). Then:
   - set the controller address in the plugin settings, restart the bridge;
   - run the manual checklist in `docs/homebridge-testing.md` on the phone;
   - do the cutover from the old WLED plugin (same file, "Cutover").
7. **Tag** the release in the public repository and push the tag, e.g. `homebridge-v0.1.0`, and create a GitHub
   release with the changelog entry.

## Later: Homebridge verification (optional)

Verified plugins get a badge and appear more readily in the Homebridge UI. Requirements (Homebridge's
verified-plugins rules, to recheck when applying): a settings screen (`config.schema.json`, done), a public GitHub
repository with issues enabled and releases, no post-install scripts, no analytics, does not crash or
need restarting when settings are missing or wrong (it logs "Not starting" and keeps the cached accessory, done),
supports the current Node LTS versions and Homebridge 1.x and 2.0 (engines, done). Apply by opening an issue on
the `homebridge/plugins` repository. HOOBS certification is separate and not needed to install from npm.
