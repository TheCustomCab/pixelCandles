// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Unit tests against a mock WLED controller: connection, reconnection, offline handling, live sync, slot radio
// behaviour, and merging of scene commands. Run: npm test
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MockWled } from './mock-wled.js';
import { WledClient, type WledClientOptions } from '../src/wled/client.js';
import { CandlesController, OfflineError, toWledBri, type CandlesView } from '../src/candles/controller.js';
import { parseConfig } from '../src/settings.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** Wait until cond() is true, or fail after `ms`. */
async function until(cond: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const fast: Partial<WledClientOptions> = {
  requestTimeoutMs: 500, pollMs: 200, heartbeatMs: 100, deadAfterMs: 400,
  backoffMinMs: 50, backoffMaxMs: 400, presetCheckMs: 150, offlineGraceMs: 500, log: quiet,
};
const candleOpts = { fadeInSeconds: 30, fadeOutSeconds: 0, brightnessTransitionSeconds: 1, slotTurnsOn: true,
  slots: [1, 2, 3, 4, 5], coalesceMs: 40 };

describe('WLED client', () => {
  let wled: MockWled;
  let client: WledClient;
  before(async () => { wled = new MockWled(); await wled.start(); });
  after(async () => { await wled.stop(); });
  afterEach(() => client?.stop());

  it('connects, reads state and preset names, reports online', async () => {
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    const online = once(client, 'online');
    client.start();
    await online;
    await until(() => client.state !== undefined, 2000, 'state');
    await until(() => client.presets.get(2) === 'Halloween', 2000, 'presets');
    assert.equal(client.reachability, 'online');
  });

  it('follows changes made elsewhere through the WebSocket', async () => {
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    client.start();
    await once(client, 'online');
    await until(() => client.state !== undefined);
    wled.external({ on: true, ps: 3 });
    await until(() => client.state?.ps === 3 && client.state?.on === true, 2000, 'pushed state');
  });

  it('picks up renamed presets', async () => {
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    client.start();
    await until(() => client.presets.get(4) === 'Evening');
    wled.renamePreset(4, 'Dinner');
    await until(() => client.presets.get(4) === 'Dinner', 2000, 'renamed preset');
    wled.renamePreset(4, 'Evening');
  });

  it('reconnects when WLED drops every socket', async () => {
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    client.start();
    await once(client, 'online');
    wled.dropSockets();
    await sleep(300);
    wled.external({ ps: 5 });
    await until(() => client.state?.ps === 5, 3000, 'state after reconnect');
    assert.equal(client.reachability, 'online');
    wled.external({ ps: 1 });
  });

  it('treats a silent socket as dead and reconnects', async () => {
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast, pollMs: 60_000 });
    client.start();
    await once(client, 'online');
    let reconnects = 0;
    // a reconnect re-reads the presets: count 'presets' events while the socket is silent
    client.on('presets', () => reconnects++);
    wled.silent = true;
    await sleep(700);   // > deadAfterMs
    wled.silent = false;
    await until(() => reconnects > 0, 3000, 'reconnect after a hung socket');
  });
});

describe('Controller going offline and coming back', () => {
  it('goes offline after the grace period, rejects commands, recovers after a reboot', async () => {
    const wled = new MockWled();
    await wled.start();
    const client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    const ctl = new CandlesController(client, candleOpts, quiet);
    const views: CandlesView[] = [];
    ctl.on('view', (v: CandlesView) => views.push(v));
    client.start();
    await once(client, 'online');

    await wled.stop();                         // power cut
    await once(client, 'offline');
    assert.equal(ctl.view().online, false);
    assert.throws(() => ctl.setOn(true), OfflineError);
    assert.ok(views.some((v) => !v.online), 'HomeKit told it is offline');

    wled.state = { on: false, bri: 90, ps: 1 }; // comes back up off (LEDs stay off at power-up)
    await wled.start();                        // same port
    await once(client, 'online');
    await until(() => client.state?.bri === 90, 3000, 'state resync after reboot');
    assert.equal(ctl.view().online, true);
    client.stop();
    await wled.stop();
  });

  it('shows the last known values right after start-up, before the first contact', () => {
    const client = new WledClient({ host: '127.0.0.1', port: 9, ...fast });
    const ctl = new CandlesController(client, candleOpts, quiet);
    assert.equal(client.reachability, 'unknown');
    assert.equal(ctl.view().online, true);
  });
});

describe('Candles controller', () => {
  let wled: MockWled;
  let client: WledClient;
  let ctl: CandlesController;
  before(async () => { wled = new MockWled(); await wled.start(); });
  after(async () => { await wled.stop(); });
  const fresh = async (state: { on: boolean; bri: number; ps: number }) => {
    client?.stop();
    wled.state = { ...state };
    wled.posts = [];
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    ctl = new CandlesController(client, candleOpts, quiet);
    client.start();
    await once(client, 'online');
    await until(() => client.state !== undefined);
  };
  afterEach(() => client?.stop());

  it('turning on fades in over the configured time', async () => {
    await fresh({ on: false, bri: 128, ps: 1 });
    await ctl.setOn(true);
    assert.deepEqual(wled.posts, [{ on: true, tt: 300 }]);
  });

  it('a scene (on + brightness + slot) becomes one command with the fade', async () => {
    await fresh({ on: false, bri: 128, ps: 1 });
    await Promise.all([ctl.setOn(true), ctl.setBrightness(30), ctl.setSlot(2, true)]);
    assert.equal(wled.posts.length, 1);
    assert.deepEqual(wled.posts[0], { ps: 2, bri: toWledBri(30), on: true, tt: 300 });
  });

  it('brightness while off is remembered without turning on', async () => {
    await fresh({ on: false, bri: 128, ps: 1 });
    await ctl.setBrightness(50);
    assert.deepEqual(wled.posts, [{ bri: toWledBri(50), on: false }]);
    await until(() => client.state?.bri === toWledBri(50));
    assert.equal(client.state?.on, false);
  });

  it('brightness while on uses the short transition', async () => {
    await fresh({ on: true, bri: 128, ps: 1 });
    await ctl.setBrightness(80);
    assert.deepEqual(wled.posts, [{ bri: toWledBri(80), tt: 10 }]);
  });

  it('slot switches are radio buttons and follow the live state', async () => {
    await fresh({ on: true, bri: 128, ps: 1 });
    assert.equal(ctl.view().activeSlot, 1);
    await ctl.setSlot(3, true);
    assert.deepEqual(wled.posts, [{ ps: 3 }]);
    await until(() => ctl.view().activeSlot === 3, 2000, 'slot 3 active');
    wled.external({ ps: -1, seg: [{ id: 0, fx: 142, pal: 200 }] });   // a look being edited elsewhere
    await until(() => ctl.view().activeSlot === 0, 2000, 'no slot active');
  });

  it('a brightness change keeps the look, although WLED forgets the preset', async () => {
    await fresh({ on: true, bri: 128, ps: 1 });
    await ctl.setSlot(2, true);
    await until(() => client.state?.ps === 2, 2000, 'slot 2 loaded');
    await ctl.setBrightness(30);
    await until(() => client.state?.ps === -1, 2000, 'WLED cleared ps');
    assert.equal(ctl.view().activeSlot, 2);
    await ctl.setOn(false);
    await ctl.setOn(true);
    await until(() => client.state?.on === true, 2000, 'back on');
    assert.equal(ctl.view().activeSlot, 2, 'still the same look after off/on');
  });

  it('choosing a slot while off turns the candles on with the fade', async () => {
    await fresh({ on: false, bri: 128, ps: 1 });
    await ctl.setSlot(4, true);
    assert.deepEqual(wled.posts, [{ ps: 4, on: true, tt: 300 }]);
  });

  it('turning the active slot off leaves the candles alone and asks for the switch to flip back', async () => {
    await fresh({ on: true, bri: 128, ps: 2 });
    assert.equal(await ctl.setSlot(2, false), true);
    assert.equal(await ctl.setSlot(3, false), false);
    await sleep(100);
    assert.deepEqual(wled.posts, []);
  });

  it('all slot switches are off while the candles are off', async () => {
    await fresh({ on: false, bri: 128, ps: 2 });
    assert.equal(ctl.view().activeSlot, 0);
  });

  it('turning off with a fade-out', async () => {
    client?.stop();
    wled.state = { on: true, bri: 128, ps: 1 };
    wled.posts = [];
    client = new WledClient({ host: '127.0.0.1', port: wled.port, ...fast });
    ctl = new CandlesController(client, { ...candleOpts, fadeOutSeconds: 5 }, quiet);
    client.start();
    await once(client, 'online');
    await until(() => client.state !== undefined);
    await ctl.setOn(false);
    assert.deepEqual(wled.posts, [{ on: false, tt: 50 }]);
  });

  it('slot names come from the presets, with fallbacks', async () => {
    await fresh({ on: true, bri: 128, ps: 1 });
    await until(() => client.presets.size > 0);
    const names = ctl.slotNames();
    assert.equal(names.get(1), 'Everyday');
    assert.equal(names.get(5), 'Special');
    const c2 = new CandlesController(client, { ...candleOpts, slots: [1, 7] }, quiet);
    assert.equal(c2.slotNames().get(7), 'Slot 7');
  });
});

describe('Settings', () => {
  it('requires a host and fills in defaults', () => {
    assert.equal(typeof parseConfig({ platform: 'WledCandles' }), 'string');
    const c = parseConfig({ platform: 'WledCandles', host: 'http://wled-controller.local/' });
    assert.ok(typeof c !== 'string');
    assert.equal(c.host, 'wled-controller.local');
    assert.equal(c.fadeInSeconds, 10);
    assert.deepEqual(c.slots, [1, 2, 3, 4, 5]);
    assert.equal(c.id, 'candles');
  });
  it('clamps out-of-range values', () => {
    const c = parseConfig({ platform: 'WledCandles', host: 'x', fadeInSeconds: 600, slots: [0, 3, 3, 999] });
    assert.ok(typeof c !== 'string');
    assert.equal(c.fadeInSeconds, 65);
    assert.deepEqual(c.slots, [3]);
  });
});
