// SPDX-License-Identifier: MIT
// A small stand-in for a WLED controller: the JSON API and the live-state WebSocket, with switches for
// simulating reboots, dead sockets and changes made by other clients.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

export interface MockState { on: boolean; bri: number; ps: number; [k: string]: unknown }

export class MockWled {
  state: MockState = { on: false, bri: 128, ps: 1, seg: [{ id: 0, fx: 142, pal: 255 }] };
  info = { ver: '16.0.1', name: 'Candles', mac: 'aabbccddeeff', arch: 'esp32', fs: { pmt: 1 } };
  presets: Record<string, { n?: string }> = {
    0: {}, 1: { n: 'Everyday' }, 2: { n: 'Halloween' }, 3: { n: 'Christmas' }, 4: { n: 'Evening' }, 5: { n: 'Special' },
    10: { n: 'Library look' },
  };
  /** Bodies of every POST /json/state, in order. */
  posts: Record<string, unknown>[] = [];
  /** When true the socket stops answering heartbeats and sending anything (a hung connection). */
  silent = false;
  port = 0;
  private server?: http.Server;
  private wss?: WebSocketServer;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ state: this.state, info: this.info }));
      ws.on('message', (data) => {
        if (this.silent) return;
        if (data.toString() === 'p') ws.send('pong');
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(this.port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Like a power cut: everything closes and stops answering. */
  async stop(): Promise<void> {
    for (const c of this.wss?.clients ?? []) c.terminate();
    await new Promise<void>((resolve) => this.wss ? this.wss.close(() => resolve()) : resolve());
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    this.server = undefined;
    this.wss = undefined;
  }

  /** Close every WebSocket (WLED does this when it's short of memory). */
  dropSockets(): void {
    for (const c of this.wss?.clients ?? []) c.terminate();
  }

  /** A change made elsewhere (Candles page, WLED UI, another plugin). */
  external(patch: Partial<MockState>): void {
    Object.assign(this.state, patch);
    this.broadcast();
  }

  renamePreset(id: number, name: string): void {
    this.presets[id] = { ...(this.presets[id] ?? {}), n: name };
    this.info.fs.pmt++;
  }

  private broadcast(): void {
    if (this.silent) return;
    const msg = JSON.stringify({ state: this.state });
    for (const c of this.wss?.clients ?? []) if (c.readyState === WebSocket.OPEN) c.send(msg);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/json/state') return send(200, this.state);
    if (req.method === 'GET' && req.url === '/json/info') return send(200, this.info);
    if (req.method === 'GET' && req.url === '/presets.json') return send(200, this.presets);
    if (req.method === 'POST' && req.url === '/json/state') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let p: Record<string, unknown>;
        try { p = JSON.parse(body); } catch { return send(400, { error: 9 }); }
        this.posts.push(p);
        // WLED: setting bri without "on" turns the light on (on defaults to bri > 0)
        if (typeof p.bri === 'number') this.state.bri = p.bri;
        if (typeof p.on === 'boolean') this.state.on = p.on;
        else if (typeof p.bri === 'number') this.state.on = p.bri > 0;
        // WLED forgets the active preset on any other change (brightness, on/off)
        if (typeof p.ps === 'number') {
          this.state.ps = p.ps;
          this.state.seg = [{ id: 0, fx: 142, pal: 255 - p.ps }];   // each preset is a different look
        } else if ('bri' in p || 'on' in p) this.state.ps = -1;
        send(200, { success: true });
        setTimeout(() => this.broadcast(), 10);
      });
      return;
    }
    send(404, { error: 'not found' });
  }
}
