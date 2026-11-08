// SPDX-License-Identifier: MIT
// HomeKit mapping, tested with Homebridge's own PlatformAccessory and HAP-NodeJS classes against the mock WLED:
// service layout, names, characteristic reads/writes, radio switches, No Response while offline.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as hap from 'hap-nodejs';
// Homebridge 1.8 has no "exports" map, so its PlatformAccessory class can be loaded directly for tests.
import { PlatformAccessory } from 'homebridge/lib/platformAccessory.js';
import { MockWled } from './mock-wled.js';
import { WledClient } from '../src/wled/client.js';
import { CandlesController } from '../src/candles/controller.js';
import { CandlesAccessory } from '../src/accessory.js';
import { LooksPicker, OTHER_ID } from '../src/picker.js';
import { parseConfig, type CandlesConfig } from '../src/settings.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const log = Object.assign(() => {}, quiet, { log() {}, success() {}, prefix: 'test' });
async function until(cond: () => boolean, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
}

const { Service: S, Characteristic: C } = hap;

describe('HomeKit accessory', () => {
  let wled: MockWled;
  let client: WledClient;
  let acc: InstanceType<typeof PlatformAccessory>;
  let tvAcc: InstanceType<typeof PlatformAccessory>;
  let cfg: CandlesConfig;

  before(async () => {
    wled = new MockWled();
    wled.state = { on: true, bri: 128, ps: 1, seg: [{ id: 0, fx: 142, pal: 254 }] };
    await wled.start();
    cfg = parseConfig({ platform: 'WledCandles', host: '127.0.0.1', port: wled.port, lookControl: 'both', lookListAlwaysOn: true }) as CandlesConfig;
    client = new WledClient({ host: '127.0.0.1', port: wled.port, requestTimeoutMs: 500, pollMs: 200,
      heartbeatMs: 100, deadAfterMs: 400, backoffMinMs: 50, backoffMaxMs: 300, presetCheckMs: 150,
      offlineGraceMs: 400, log: quiet });
    const ctl = new CandlesController(client, { ...cfg, coalesceMs: 30 }, quiet);
    acc = new PlatformAccessory('Candles', hap.uuid.generate('test:candles'));
    // a leftover service from an older config, which should be removed
    acc.addService(S.Switch, 'Old slot', 'slot-9');
    new CandlesAccessory({ hap } as never, log as never, acc, ctl, cfg);
    tvAcc = new PlatformAccessory('Candles Looks', hap.uuid.generate('test:looks'));
    new LooksPicker({ hap } as never, log as never, tvAcc, ctl, cfg);
    client.start();
    await once(client, 'online');
    await until(() => client.presets.size > 0 && client.state !== undefined);
  });
  after(async () => { client.stop(); await wled.stop(); });

  const light = () => acc.getServiceById(S.Lightbulb, 'candles')!;
  const slot = (n: number) => acc.getServiceById(S.Switch, `slot-${n}`)!;

  it('has one primary light and five linked slot switches named from WLED', async () => {
    assert.ok(light().isPrimaryService);
    assert.equal(acc.getServiceById(S.Switch, 'slot-9'), undefined, 'stale service removed');
    for (let n = 1; n <= 5; n++) assert.ok(light().linkedServices.includes(slot(n)), `slot ${n} linked`);
    await until(() => slot(2).getCharacteristic(C.ConfiguredName).value === 'Halloween', 2000, 'slot names');
    assert.equal(slot(5).getCharacteristic(C.ConfiguredName).value, 'Special');
  });

  it('reads the live state', async () => {
    assert.equal(await light().getCharacteristic(C.On).handleGetRequest(), true);
    assert.equal(await light().getCharacteristic(C.Brightness).handleGetRequest(), 50);
    assert.equal(await slot(1).getCharacteristic(C.On).handleGetRequest(), true);
    assert.equal(await slot(2).getCharacteristic(C.On).handleGetRequest(), false);
  });

  it('a slot switch applies its preset and the others follow', async () => {
    wled.posts = [];
    await slot(3).getCharacteristic(C.On).handleSetRequest(true);
    assert.deepEqual(wled.posts, [{ ps: 3 }]);
    await until(() => slot(3).getCharacteristic(C.On).value === true && slot(1).getCharacteristic(C.On).value === false,
      2000, 'radio update');
  });

  it('turning the active slot off flips it back on without touching WLED', async () => {
    wled.posts = [];
    await slot(3).getCharacteristic(C.On).handleSetRequest(false);
    await sleep(450);
    assert.deepEqual(wled.posts, []);
    assert.equal(slot(3).getCharacteristic(C.On).value, true);
  });

  it('changes made elsewhere show up in HomeKit', async () => {
    wled.external({ on: false });
    await until(() => light().getCharacteristic(C.On).value === false, 2000, 'light off');
    assert.equal(slot(3).getCharacteristic(C.On).value, false, 'slots off while the candles are off');
  });

  it('turning on from HomeKit fades in', async () => {
    wled.posts = [];
    await light().getCharacteristic(C.On).handleSetRequest(true);
    assert.deepEqual(wled.posts, [{ on: true, tt: 100 }]);
  });

  it('look picker: named inputs, follows the live look, chooses a slot', async () => {
    const tv = tvAcc.getServiceById(S.Television, 'looks')!;
    const input = (n: number) => tvAcc.getServiceById(S.InputSource, `input-${n}`)!;
    assert.ok(tv.isPrimaryService);
    await until(() => input(2).getCharacteristic(C.ConfiguredName).value === 'Halloween', 2000, 'input names');
    assert.equal(input(2).getCharacteristic(C.Identifier).value, 2);
    assert.ok(tv.linkedServices.includes(input(5)));
    // candles are on (previous test) showing slot 3
    await until(() => tv.getCharacteristic(C.ActiveIdentifier).value === 3, 2000, 'picker follows slot');
    assert.equal(tv.getCharacteristic(C.Active).value, C.Active.ACTIVE);
    wled.posts = [];
    await tv.getCharacteristic(C.ActiveIdentifier).handleSetRequest(2);
    assert.deepEqual(wled.posts, [{ ps: 2 }]);
    await until(() => slot(2).getCharacteristic(C.On).value === true, 2000, 'switch follows picker');
    // a look that matches no slot: "Other look" is shown and selected
    wled.external({ ps: -1, seg: [{ id: 0, fx: 142, pal: 200 }] });   // a look being edited
    const other = tvAcc.getServiceById(S.InputSource, 'input-other')!;
    await until(() => tv.getCharacteristic(C.ActiveIdentifier).value === OTHER_ID, 2000, 'other look');
    assert.equal(other.getCharacteristic(C.CurrentVisibilityState).value, C.CurrentVisibilityState.SHOWN);
    // the look list stays available while off; its power button toggles the candles
    wled.posts = [];
    await tv.getCharacteristic(C.Active).handleSetRequest(C.Active.INACTIVE);
    assert.deepEqual(wled.posts, [{ on: false, tt: 50 }]);
    await until(() => light().getCharacteristic(C.On).value === false, 2000, 'light off');
    await sleep(350);
    assert.equal(tv.getCharacteristic(C.Active).value, C.Active.ACTIVE, 'look list still available');
    assert.equal(other.getCharacteristic(C.CurrentVisibilityState).value, C.CurrentVisibilityState.HIDDEN);
    wled.posts = [];
    await tv.getCharacteristic(C.ActiveIdentifier).handleSetRequest(4);   // choose a look while off
    assert.deepEqual(wled.posts, [{ ps: 4, on: true, tt: 100 }]);
    await until(() => light().getCharacteristic(C.On).value === true, 2000, 'on with the look');
    wled.posts = [];
    await tv.getCharacteristic(C.Active).handleSetRequest(C.Active.INACTIVE);   // toggle off
    await until(() => light().getCharacteristic(C.On).value === false, 2000, 'toggled off');
    await sleep(100);
    await tv.getCharacteristic(C.Active).handleSetRequest(C.Active.INACTIVE);   // toggle on again
    assert.deepEqual(wled.posts, [{ on: false, tt: 50 }, { on: true, tt: 100 }]);
    wled.external({ ps: 3, seg: [{ id: 0, fx: 142, pal: 252 }] });
  });

  it('shows No Response while the controller is unreachable, and recovers', async () => {
    await wled.stop();
    await once(client, 'offline');
    await assert.rejects(light().getCharacteristic(C.On).handleGetRequest(), (e: unknown) =>
      (e as { hapStatus?: number }).hapStatus === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE || String(e).includes('-70402'));
    assert.equal(light().getCharacteristic(C.StatusFault).value, C.StatusFault.GENERAL_FAULT);
    await wled.start();
    await once(client, 'online');
    await until(() => light().getCharacteristic(C.StatusFault).value === C.StatusFault.NO_FAULT, 2000, 'fault cleared');
    assert.equal(await light().getCharacteristic(C.On).handleGetRequest(), true);
  });
});

describe('Look control setting', () => {
  it('combined is the default; picker, switches and combined build the right services', async () => {
    const wled = new MockWled();
    await wled.start();
    const client = new WledClient({ host: '127.0.0.1', port: wled.port, offlineGraceMs: 400, log: quiet });
    const ctl = new CandlesController(client, { fadeInSeconds: 30, fadeOutSeconds: 0, brightnessTransitionSeconds: 1,
      slotTurnsOn: true, slots: [1, 2, 3, 4, 5] }, quiet);
    try {
      assert.equal((parseConfig({ platform: 'WledCandles', host: 'x' }) as CandlesConfig).lookControl, 'combined');
      assert.equal((parseConfig({ platform: 'WledCandles', host: 'x' }) as CandlesConfig).lookListAlwaysOn, false);
      const pickerCfg = parseConfig({ platform: 'WledCandles', host: 'x', lookControl: 'picker' }) as CandlesConfig;
      assert.equal(pickerCfg.pickerName, 'Candles Looks');
      const acc = new PlatformAccessory('Candles', hap.uuid.generate('test:candles2'));
      acc.addService(S.Switch, 'Slot 1', 'slot-1');   // switches from an earlier "switches" setup are removed
      new CandlesAccessory({ hap } as never, log as never, acc, ctl, pickerCfg);
      assert.equal(acc.services.filter((s: { UUID: string }) => s.UUID === S.Switch.UUID).length, 0);
      const swCfg = parseConfig({ platform: 'WledCandles', host: 'x', lookControl: 'switches' }) as CandlesConfig;
      const acc2 = new PlatformAccessory('Candles', hap.uuid.generate('test:candles3'));
      new CandlesAccessory({ hap } as never, log as never, acc2, ctl, swCfg);
      assert.equal(acc2.services.filter((s: { UUID: string }) => s.UUID === S.Switch.UUID).length, 5);
      // combined: light and look list on one accessory, light primary, no switches
      const combCfg = parseConfig({ platform: 'WledCandles', host: 'x' }) as CandlesConfig;
      const acc3 = new PlatformAccessory('Candles', hap.uuid.generate('test:candles4'));
      new CandlesAccessory({ hap } as never, log as never, acc3, ctl, combCfg);
      new LooksPicker({ hap } as never, log as never, acc3, ctl, combCfg, false);
      const kinds = acc3.services.map((s: { UUID: string }) => s.UUID);
      assert.ok(kinds.includes(S.Lightbulb.UUID) && kinds.includes(S.Television.UUID));
      assert.equal(kinds.filter((u: string) => u === S.InputSource.UUID).length, 6);
      assert.equal(kinds.filter((u: string) => u === S.Switch.UUID).length, 0);
      assert.ok(acc3.getServiceById(S.Lightbulb, 'candles')!.isPrimaryService);
      assert.ok(!acc3.getServiceById(S.Television, 'looks')!.isPrimaryService);
      // a second construction (Homebridge restart with the cached accessory) keeps everything
      new CandlesAccessory({ hap } as never, log as never, acc3, ctl, combCfg);
      new LooksPicker({ hap } as never, log as never, acc3, ctl, combCfg, false);
      assert.equal(acc3.services.length, kinds.length);
    } finally {
      client.stop();
      await wled.stop();
    }
  });
});

describe('Look list status (default)', () => {
  it('the look list is off while the candles are off, so the tile reads Off', async () => {
    const wled = new MockWled();
    wled.state = { on: true, bri: 128, ps: 2, seg: [{ id: 0, fx: 142, pal: 253 }] };
    await wled.start();
    const cfg = parseConfig({ platform: 'WledCandles', host: '127.0.0.1', port: wled.port }) as CandlesConfig;
    const client = new WledClient({ host: '127.0.0.1', port: wled.port, offlineGraceMs: 400, log: quiet });
    const ctl = new CandlesController(client, { ...cfg, coalesceMs: 30 }, quiet);
    const acc = new PlatformAccessory('Candles', hap.uuid.generate('test:status'));
    try {
      new CandlesAccessory({ hap } as never, log as never, acc, ctl, cfg);
      new LooksPicker({ hap } as never, log as never, acc, ctl, cfg, false);
      client.start();
      await once(client, 'online');
      const tv = acc.getServiceById(S.Television, 'looks')!;
      await until(() => tv.getCharacteristic(C.Active).value === C.Active.ACTIVE, 2000, 'on');
      wled.external({ on: false });
      await until(() => tv.getCharacteristic(C.Active).value === C.Active.INACTIVE, 2000, 'off with the candles');
      wled.posts = [];
      await tv.getCharacteristic(C.Active).handleSetRequest(C.Active.ACTIVE);   // power button turns them on
      assert.deepEqual(wled.posts, [{ on: true, tt: 100 }]);
    } finally {
      client.stop();
      await wled.stop();
    }
  });
});
