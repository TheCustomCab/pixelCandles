// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Candle behaviour, independent of HomeKit: the light (on/off, brightness, fade-in), the look slots with radio
// behaviour, offline handling, and merging of commands that arrive together (a Home app scene sends On,
// Brightness and a slot switch within milliseconds; sending them separately would cut the fade-in short).

import { EventEmitter } from 'node:events';
import type { PresetNames, WledLogger, WledState } from '../wled/client.js';

/** The part of WledClient the controller uses (lets tests substitute it). */
export interface WledLike extends EventEmitter {
  state?: WledState;
  presets: PresetNames;
  readonly reachability: 'unknown' | 'online' | 'offline';
  setState(patch: Record<string, unknown>): Promise<void>;
}

export interface CandlesOptions {
  fadeInSeconds: number;
  fadeOutSeconds: number;
  brightnessTransitionSeconds: number;
  slotTurnsOn: boolean;
  slots: number[];
  /** Commands arriving within this window are sent as one. */
  coalesceMs?: number;
}

export interface CandlesView {
  online: boolean;
  on: boolean;
  /** HomeKit brightness, 1-100. */
  brightness: number;
  /** Slot preset number showing now, or 0. */
  activeSlot: number;
}

export class OfflineError extends Error {
  constructor() {
    super('controller not responding');
  }
}

type Pending = { on?: boolean; bri?: number; ps?: number };

/** WLED transitions are 16-bit milliseconds: at most 65.5 s. `tt` is in 100 ms units. */
export const MAX_TRANSITION_S = 65;
const tt = (seconds: number) => Math.round(Math.max(0, Math.min(MAX_TRANSITION_S, seconds)) * 10);

export const toWledBri = (pct: number) => Math.max(1, Math.min(255, Math.round((pct * 255) / 100)));
export const toHomeKitBri = (bri: number) => Math.max(1, Math.min(100, Math.round((bri * 100) / 255)));

/**
 * Events: 'view' (CandlesView) when anything HomeKit shows may have changed; 'names' (Map slot -> name).
 */
export class CandlesController extends EventEmitter {
  private readonly o: Required<CandlesOptions>;
  private state?: WledState;
  private pending: Pending = {};
  private waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly wled: WledLike, options: CandlesOptions, private readonly log: WledLogger) {
    super();
    this.o = { coalesceMs: 60, ...options };
    this.state = wled.state;
    if (wled.state) this.noteLook(wled.state);
    wled.on('state', (s: WledState) => {
      this.state = { ...s };
      this.noteLook(s);
      this.emitView();
    });
    wled.on('online', () => this.emitView());
    wled.on('offline', () => this.emitView());
    wled.on('presets', () => this.emit('names', this.slotNames()));
  }

  get options(): Readonly<Required<CandlesOptions>> {
    return this.o;
  }

  view(): CandlesView {
    const s = this.state;
    const on = !!s?.on;
    return {
      online: this.wled.reachability !== 'offline',   // unknown (just started): show last known values
      on,
      brightness: s ? toHomeKitBri(s.bri) : 100,
      activeSlot: on && s && this.o.slots.includes(this.activePreset(s)) ? this.activePreset(s) : 0,
    };
  }

  // WLED forgets the active preset (ps = -1) on any change, brightness and on/off included. Looks never store
  // brightness, so remember the last preset WLED reported together with a fingerprint of its segments: while the
  // segments still match, that look is still showing.
  private look?: { ps: number; key: string };
  private static readonly LOOK_FIELDS = ['start', 'stop', 'grp', 'spc', 'of', 'fx', 'sx', 'ix', 'c1', 'c2', 'c3',
    'o1', 'o2', 'o3', 'pal', 'col', 'on', 'bri'];
  private lookKey(s: WledState): string {
    const segs = Array.isArray(s.seg) ? (s.seg as Record<string, unknown>[]) : [];
    return JSON.stringify(segs.map((g) => CandlesController.LOOK_FIELDS.map((k) => g[k])));
  }
  private noteLook(s: WledState): void {
    if (s.ps > 0) this.look = { ps: s.ps, key: this.lookKey(s) };
  }
  private activePreset(s: WledState): number {
    if (s.ps > 0) return s.ps;
    if (this.look && this.lookKey(s) === this.look.key) return this.look.ps;
    return -1;
  }

  slotNames(): Map<number, string> {
    const names = new Map<number, string>();
    for (const n of this.o.slots) names.set(n, this.wled.presets.get(n) ?? `Slot ${n}`);
    return names;
  }

  // ---- Commands from HomeKit ----------------------------------------------------------------------------------

  setOn(on: boolean): Promise<void> {
    this.ensureOnline();
    const v = this.view();
    if (on === v.on && this.pending.on === undefined) return Promise.resolve();   // e.g. a scene re-asserting
    return this.queue({ on });
  }

  /** HomeKit brightness 0-100; 0 means off. */
  setBrightness(pct: number): Promise<void> {
    this.ensureOnline();
    if (pct <= 0) return this.queue({ on: false });
    return this.queue({ bri: toWledBri(pct) });
  }

  /**
   * A slot switch was set. Returns true when the switch should flip back On: turning the active slot off
   * doesn't change the candles (the light's On/Off controls power).
   */
  async setSlot(n: number, on: boolean): Promise<boolean> {
    this.ensureOnline();
    if (!on) {
      const active = this.view().activeSlot === n || this.pending.ps === n;
      if (active) this.log.debug(`slot ${n} switched off: ignored (use the light to turn the candles off)`);
      return active;
    }
    await this.queue({ ps: n });
    return false;
  }

  private ensureOnline(): void {
    if (this.wled.reachability === 'offline') throw new OfflineError();
  }

  private queue(p: Pending): Promise<void> {
    Object.assign(this.pending, p);
    // Show the requested values straight away (HomeKit reads them back before WLED's push arrives).
    this.applyOptimistic(p);
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), this.o.coalesceMs);
    });
  }

  /** Build one WLED command from everything queued, choosing the right transition. */
  buildCommand(p: Pending, wasOn: boolean): Record<string, unknown> {
    const cmd: Record<string, unknown> = {};
    let turnOn = p.on === true && !wasOn;
    if (p.ps !== undefined) {
      cmd.ps = p.ps;
      if (p.on === undefined && !wasOn && this.o.slotTurnsOn) turnOn = true;
    }
    if (p.on === false) {
      cmd.on = false;
      if (wasOn) cmd.tt = tt(this.o.fadeOutSeconds);
      if (p.bri !== undefined) cmd.bri = p.bri;
      return cmd;
    }
    if (p.bri !== undefined) cmd.bri = p.bri;
    if (turnOn) {
      cmd.on = true;
      cmd.tt = tt(this.o.fadeInSeconds);
    } else if (p.on === true) {
      cmd.on = true;   // already on: nothing to fade
      if (p.bri !== undefined) cmd.tt = tt(this.o.brightnessTransitionSeconds);
    } else if (p.bri !== undefined) {
      if (wasOn) cmd.tt = tt(this.o.brightnessTransitionSeconds);
      else cmd.on = false;   // remember the brightness for the next turn-on without switching on
    }
    return cmd;
  }

  private async flush(): Promise<void> {
    this.flushTimer = undefined;
    const p = this.pending;
    const waiters = this.waiters;
    this.pending = {};
    this.waiters = [];
    const wasOn = !!this.wled.state?.on;
    const cmd = this.buildCommand(p, wasOn);
    try {
      if (Object.keys(cmd).length) {
        this.log.debug(`-> ${JSON.stringify(cmd)}`);
        await this.wled.setState(cmd);
      }
      for (const w of waiters) w.resolve();
    } catch (e) {
      this.log.warn(`command failed: ${(e as Error).message}`);
      this.state = this.wled.state ? { ...this.wled.state } : this.state;   // drop the optimistic values
      this.emitView();
      for (const w of waiters) w.reject(e as Error);
    }
  }

  private applyOptimistic(p: Pending): void {
    const s: WledState = this.state ? { ...this.state } : { on: false, bri: 128, ps: -1 };
    if (p.bri !== undefined) s.bri = p.bri;
    if (p.ps !== undefined) {
      s.ps = p.ps;
      if (p.on === undefined && !s.on && this.o.slotTurnsOn) s.on = true;
    }
    if (p.on !== undefined) s.on = p.on;
    this.state = s;
    this.emitView();
  }

  private lastView = '';
  private emitView(): void {
    const v = this.view();
    const key = JSON.stringify(v);
    if (key === this.lastView) return;
    this.lastView = key;
    this.emit('view', v);
  }
}
