// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { CandlesAccessory } from './accessory.js';
import { LooksPicker } from './picker.js';
import { CandlesController } from './candles/controller.js';
import { parseConfig, PLATFORM_NAME, PLUGIN_NAME, type CandlesConfig } from './settings.js';
import { WledClient, type WledInfo, type WledLogger } from './wled/client.js';

export class CandlesPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  private client?: WledClient;

  constructor(private readonly log: Logging, private readonly config: PlatformConfig, private readonly api: API) {
    api.on('didFinishLaunching', () => {
      try {
        this.setup();
      } catch (e) {
        this.log.error(`Setup failed: ${(e as Error).stack ?? e}`);
      }
    });
    api.on('shutdown', () => this.client?.stop());
  }

  /** Homebridge restores cached accessories through this before didFinishLaunching. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private setup(): void {
    const cfg = parseConfig(this.config);
    if (typeof cfg === 'string') {
      this.log.error(`Not starting: ${cfg}`);
      return;   // keep any cached accessory, so a config typo doesn't delete scenes
    }
    const log = this.logger(cfg);
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${cfg.id}`);
    const pickerUuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${cfg.id}:looks`);
    const wantPicker = cfg.lookControl === 'picker' || cfg.lookControl === 'both';

    // The Candles light, plus the look picker when enabled; anything else cached by this plugin is left over.
    const wanted = new Set([uuid, ...(wantPicker ? [pickerUuid] : [])]);
    const stale = [...this.cached.values()].filter((a) => !wanted.has(a.UUID));
    if (stale.length) {
      this.log.info(`Removing ${stale.length} accessory(ies) no longer in the config`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    let accessory = this.cached.get(uuid);
    const isNew = !accessory;
    if (!accessory) accessory = new this.api.platformAccessory(cfg.name, uuid, this.api.hap.Categories.LIGHTBULB);

    this.client = new WledClient({
      host: cfg.host,
      port: cfg.port,
      pollMs: cfg.pollSeconds * 1000,
      offlineGraceMs: cfg.offlineGraceSeconds * 1000,
      log,
    });
    const ctl = new CandlesController(this.client, cfg, log);
    const handler = new CandlesAccessory(this.api, this.log, accessory, ctl, cfg);
    if (cfg.lookControl === 'combined') new LooksPicker(this.api, this.log, accessory, ctl, cfg, false);
    ctl.on('view', (v: { online: boolean; on: boolean; brightness: number; activeSlot: number }) =>
      log.debug(v.online ? `state: ${v.on ? 'on' : 'off'}, ${v.brightness} %, slot ${v.activeSlot || 'none'}` : 'state: offline'));
    this.client.on('info', (info: WledInfo) => {
      try { handler.updateInfo(info); } catch (e) { log.debug(`info: ${(e as Error).message}`); }
    });
    // Errors inside event handlers must never reach Homebridge.
    this.client.on('error', (e: Error) => log.warn(e.message));

    if (isNew) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    else this.api.updatePlatformAccessories([accessory]);

    if (wantPicker) {
      let picker = this.cached.get(pickerUuid);
      const pickerIsNew = !picker;
      if (!picker) picker = new this.api.platformAccessory(cfg.pickerName, pickerUuid, this.api.hap.Categories.TELEVISION);
      new LooksPicker(this.api, this.log, picker, ctl, cfg);
      if (pickerIsNew) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [picker]);
      else this.api.updatePlatformAccessories([picker]);
    }

    this.describe(cfg);
    this.client.start();
  }

  private describe(cfg: CandlesConfig): void {
    this.log.info(`${cfg.name}: WLED at ${cfg.host}${cfg.port === 80 ? '' : ':' + cfg.port}, slots ${cfg.slots.join(', ')}, `
      + `looks as ${cfg.lookControl}, fade-in ${cfg.fadeInSeconds} s`);
  }

  private logger(cfg: CandlesConfig): WledLogger {
    const log = this.log;
    return {
      debug: (m) => (cfg.debug ? log.info(`[debug] ${m}`) : log.debug(m)),
      info: (m) => log.info(m),
      warn: (m) => log.warn(m),
      error: (m) => log.error(m),
    };
  }
}
