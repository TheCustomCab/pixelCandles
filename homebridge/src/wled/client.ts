// SPDX-License-Identifier: MIT
// WLED client: JSON API over HTTP plus the live-state WebSocket, with reconnection.
// No Homebridge dependencies, so it can be reused by other plugins and tested on its own.

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export interface WledState {
  on: boolean;
  bri: number;        // 0-255 (WLED keeps the last brightness while off)
  ps: number;         // active preset, -1 when the live state matches none
  [key: string]: unknown;
}

export interface WledInfo {
  ver?: string;
  name?: string;
  mac?: string;
  arch?: string;
  brand?: string;
  product?: string;
  fs?: { pmt?: number };
  [key: string]: unknown;
}

/** Preset number -> name. */
export type PresetNames = Map<number, string>;

export interface WledLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WledClientOptions {
  host: string;
  port?: number;
  /** HTTP request timeout. */
  requestTimeoutMs?: number;
  /** Poll /json/state this often while the WebSocket is down. */
  pollMs?: number;
  /** Send WLED's application heartbeat ("p" -> "pong") this often. */
  heartbeatMs?: number;
  /** No message for this long on an open socket -> treat it as dead. */
  deadAfterMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** Check /json/info (presets modified time) this often. */
  presetCheckMs?: number;
  /** Unreachable for this long -> 'offline'. */
  offlineGraceMs?: number;
  log?: WledLogger;
}

const silent: WledLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Events:
 *   'state' (WledState)       full state, from the WebSocket or a poll
 *   'info' (WledInfo)
 *   'presets' (PresetNames)   at start, after reconnects, and when presets change
 *   'online' / 'offline'      reachability, with a grace period so a reboot doesn't flap
 */
export class WledClient extends EventEmitter {
  readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly o: Required<Omit<WledClientOptions, 'log'>> & { log: WledLogger };

  private ws?: WebSocket;
  private running = false;
  private backoffMs: number;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private presetTimer?: NodeJS.Timeout;
  private reachTimer?: NodeJS.Timeout;
  private lastMessage = 0;
  private lastContact = 0;
  private startedAt = 0;
  private reach: 'unknown' | 'online' | 'offline' = 'unknown';
  private presetsPmt: number | undefined;

  state?: WledState;
  info?: WledInfo;
  presets: PresetNames = new Map();

  constructor(options: WledClientOptions) {
    super();
    this.o = {
      port: 80,
      requestTimeoutMs: 3000,
      pollMs: 10_000,
      heartbeatMs: 15_000,
      deadAfterMs: 45_000,
      backoffMinMs: 1000,
      backoffMaxMs: 60_000,
      presetCheckMs: 15_000,   // a renamed look reaches HomeKit within ~15 s (one small /json/info request)
      offlineGraceMs: 30_000,
      log: silent,
      ...options,
    } as Required<Omit<WledClientOptions, 'log'>> & { log: WledLogger };
    if (!this.o.log) this.o.log = silent;
    const hostPort = this.o.port === 80 ? this.o.host : `${this.o.host}:${this.o.port}`;
    this.baseUrl = `http://${hostPort}`;
    this.wsUrl = `ws://${hostPort}/ws`;
    this.backoffMs = this.o.backoffMinMs;
  }

  get isOnline(): boolean {
    return this.reach === 'online';
  }

  /** 'unknown' until the first contact or the end of the grace period after start(). */
  get reachability(): 'unknown' | 'online' | 'offline' {
    return this.reach;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.reach = 'unknown';
    this.connect();
    this.startPolling();
    void this.checkPresets(true);
    this.presetTimer = setInterval(() => void this.checkPresets(false), this.o.presetCheckMs);
    this.reachTimer = setInterval(() => this.updateReachability(), Math.min(1000, this.o.offlineGraceMs / 4));
  }

  stop(): void {
    this.running = false;
    for (const t of [this.reconnectTimer, this.heartbeatTimer, this.pollTimer, this.presetTimer, this.reachTimer]) {
      if (t) clearTimeout(t);
    }
    this.reconnectTimer = this.heartbeatTimer = this.pollTimer = this.presetTimer = this.reachTimer = undefined;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});   // a late error after terminate() must not be unhandled
      this.ws.terminate();
      this.ws = undefined;
    }
  }

  // ---- HTTP -------------------------------------------------------------------------------------------------

  private async request(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.requestTimeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method: init?.method ?? 'GET',
        headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const text = await res.text();
      this.markContact();
      try {
        return JSON.parse(text);
      } catch {
        // WLED can serve a file half-written while it's saving it
        throw new Error(`unreadable JSON from ${path}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async getState(): Promise<WledState> {
    const s = (await this.request('/json/state')) as WledState;
    this.acceptState(s);
    return s;
  }

  async getInfo(): Promise<WledInfo> {
    const i = (await this.request('/json/info')) as WledInfo;
    this.acceptInfo(i);
    return i;
  }

  async getPresetNames(): Promise<PresetNames> {
    const raw = (await this.request('/presets.json')) as Record<string, { n?: string }>;
    const names: PresetNames = new Map();
    for (const [k, v] of Object.entries(raw)) {
      const id = Number(k);
      if (id > 0 && v && typeof v.n === 'string') names.set(id, v.n);
    }
    return names;
  }

  /** Send a state change. Throws on a network error, timeout or a WLED error reply. */
  async setState(patch: Record<string, unknown>): Promise<void> {
    const reply = (await this.request('/json/state', { method: 'POST', body: patch })) as Record<string, unknown>;
    if (reply && typeof reply === 'object' && 'error' in reply) {
      throw new Error(`WLED error ${String(reply.error)}`);
    }
  }

  /** Read a file from the controller's filesystem (e.g. /candle-slots.json). */
  async getJson(path: string): Promise<unknown> {
    return this.request(path);
  }

  // ---- WebSocket --------------------------------------------------------------------------------------------

  private connect(): void {
    if (!this.running) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl, { handshakeTimeout: this.o.requestTimeoutMs });
    } catch (e) {
      this.o.log.debug(`WebSocket: ${(e as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.on('open', () => {
      this.o.log.debug(`WebSocket connected to ${this.wsUrl}`);
      this.backoffMs = this.o.backoffMinMs;
      this.lastMessage = Date.now();
      this.markContact();
      this.stopPolling();
      this.startHeartbeat();
      void this.checkPresets(true);   // names may have changed while we were away
    });
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      this.lastMessage = Date.now();
      this.markContact();
      if (isBinary) return;   // live LED frames, not ours
      const text = data.toString();
      if (text === 'pong') return;
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') {
        const m = msg as { state?: WledState; info?: WledInfo };
        if (m.info) this.acceptInfo(m.info);
        if (m.state) this.acceptState(m.state);
      }
    });
    ws.on('close', () => this.onSocketDown('closed'));
    ws.on('error', (err: Error) => {
      this.o.log.debug(`WebSocket error: ${err.message}`);
      // 'close' follows an error; make sure it does even if the handshake never completed
      try { ws.terminate(); } catch { /* already gone */ }
    });
  }

  private onSocketDown(why: string): void {
    if (this.ws) this.ws.removeAllListeners();
    if (this.ws) this.ws.on('error', () => {});
    this.ws = undefined;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    if (!this.running) return;
    this.o.log.debug(`WebSocket ${why}; retrying in ${Math.round(this.backoffMs / 100) / 10} s`);
    this.startPolling();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const jitter = this.backoffMs * (Math.random() * 0.4 - 0.2);
    const wait = Math.max(0, this.backoffMs + jitter);
    this.backoffMs = Math.min(this.o.backoffMaxMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, wait);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (Date.now() - this.lastMessage > this.o.deadAfterMs) {
        this.o.log.debug('WebSocket silent too long; reconnecting');
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        this.onSocketDown('timed out');
        return;
      }
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send('p');
      } catch { /* the close handler deals with it */ }
    }, this.o.heartbeatMs);
  }

  // ---- Polling, presets, reachability -----------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer || !this.running) return;
    const poll = async () => {
      try {
        await this.getState();
      } catch (e) {
        this.o.log.debug(`poll failed: ${(e as Error).message}`);
      }
    };
    void poll();
    this.pollTimer = setInterval(() => void poll(), this.o.pollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async checkPresets(force: boolean): Promise<void> {
    try {
      const info = await this.getInfo();
      const pmt = info.fs?.pmt;
      if (!force && pmt !== undefined && pmt === this.presetsPmt) return;
      // presets.json can be read mid-write; try a few times
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const names = await this.getPresetNames();
          this.presetsPmt = pmt;
          this.presets = names;
          this.emit('presets', names);
          return;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch (e) {
      this.o.log.debug(`preset check failed: ${(e as Error).message}`);
    }
  }

  private markContact(): void {
    this.lastContact = Date.now();
    if (this.reach !== 'online') this.updateReachability();
  }

  private updateReachability(): void {
    const now = Date.now();
    const reachable = this.lastContact > 0 && now - this.lastContact < this.o.offlineGraceMs;
    if (reachable) {
      if (this.reach !== 'online') {
        this.reach = 'online';
        this.o.log.info(`Connected to WLED at ${this.baseUrl}`);
        this.emit('online');
      }
    } else if (this.reach === 'online' || (this.reach === 'unknown' && now - this.startedAt >= this.o.offlineGraceMs)) {
      this.reach = 'offline';
      this.o.log.warn(`WLED at ${this.baseUrl} is not responding`);
      this.emit('offline');
    }
  }

  private acceptState(s: WledState): void {
    if (!s || typeof s !== 'object' || typeof s.on !== 'boolean') return;
    this.state = s;
    this.emit('state', s);
  }

  private acceptInfo(i: WledInfo): void {
    if (!i || typeof i !== 'object') return;
    this.info = i;
    this.emit('info', i);
  }
}
