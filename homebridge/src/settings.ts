// SPDX-License-Identifier: MIT
import type { PlatformConfig } from 'homebridge';
import { MAX_TRANSITION_S } from './candles/controller.js';

export const PLUGIN_NAME = 'homebridge-wled-candles';
export const PLATFORM_NAME = 'WledCandles';

export interface CandlesConfig {
  name: string;
  id: string;
  host: string;
  port: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  brightnessTransitionSeconds: number;
  slotTurnsOn: boolean;
  slots: number[];
  pollSeconds: number;
  offlineGraceSeconds: number;
  offlineSensor: boolean;
  /**
   * How the looks appear in HomeKit:
   *   combined  one tile: the dimmable light plus a named look list (TV-style inputs) on the same accessory (default)
   *   picker    the look list as a separate TV-type accessory next to the light
   *   switches  one switch per look, inside the light's tile (the Home app shows them without labels in the tile)
   *   both      picker and switches
   */
  lookControl: 'combined' | 'picker' | 'switches' | 'both';
  pickerName: string;
  /** Keep the look list usable while the candles are off (its power button then toggles the candles). */
  lookListAlwaysOn: boolean;
  debug: boolean;
}

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/** Read the platform block with defaults; returns an error message instead when it can't be used. */
export function parseConfig(c: PlatformConfig): CandlesConfig | string {
  const host = typeof c.host === 'string' ? c.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
  if (!host) return 'no "host" set: add the controller\'s IP address or hostname to the plugin settings';
  const slots = Array.isArray(c.slots)
    ? [...new Set(c.slots.map((x: unknown) => Math.round(Number(x))).filter((x: number) => x >= 1 && x <= 250))]
    : [1, 2, 3, 4, 5];
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Candles';
  const lookControl = ['picker', 'switches', 'both'].includes(c.lookControl) ? c.lookControl : 'combined';
  return {
    name,
    id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : 'candles',
    host,
    port: num(c.port, 80, 1, 65535),
    fadeInSeconds: num(c.fadeInSeconds, 10, 0, MAX_TRANSITION_S),
    fadeOutSeconds: num(c.fadeOutSeconds, 5, 0, MAX_TRANSITION_S),
    brightnessTransitionSeconds: num(c.brightnessTransitionSeconds, 0.5, 0, MAX_TRANSITION_S),
    slotTurnsOn: c.slotTurnsOn !== false,
    slots: slots.length ? slots : [1, 2, 3, 4, 5],
    pollSeconds: num(c.pollSeconds, 10, 2, 300),
    offlineGraceSeconds: num(c.offlineGraceSeconds, 30, 5, 600),
    offlineSensor: c.offlineSensor === true,
    lookControl,
    pickerName: typeof c.pickerName === 'string' && c.pickerName.trim() ? c.pickerName.trim() : `${name} Looks`,
    // Off by default: with it on, the Home app shows the tile as On even while the candles are off.
    lookListAlwaysOn: c.lookListAlwaysOn === true,
    debug: c.debug === true,
  };
}
