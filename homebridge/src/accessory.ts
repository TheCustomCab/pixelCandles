// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Maps the candles controller onto HomeKit: a primary Lightbulb plus one Switch per look slot, linked so the Home
// app shows them in one tile. Service subtypes are stable ('candles', 'slot-<n>', 'online'); names shown in the
// Home app come from ConfiguredName, so renaming a slot never changes a service's identity.

import type { API, Characteristic, CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge';
import type { CandlesController, CandlesView } from './candles/controller.js';
import type { WledInfo } from './wled/client.js';
import type { CandlesConfig } from './settings.js';

const LIGHT = 'candles';
const SENSOR = 'online';
const slotSubtype = (n: number) => `slot-${n}`;

export class CandlesAccessory {
  private readonly light: Service;
  private readonly switches = new Map<number, Service>();
  private readonly sensor?: Service;

  constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory,
    private readonly ctl: CandlesController,
    private readonly cfg: CandlesConfig,
  ) {
    const { Service: S, Characteristic: C } = api.hap;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'WLED')
      .setCharacteristic(C.Model, 'pixelCandles')
      .setCharacteristic(C.SerialNumber, cfg.id);

    // Primary light
    this.light = accessory.getServiceById(S.Lightbulb, LIGHT) ?? accessory.addService(S.Lightbulb, cfg.name, LIGHT);
    this.light.setPrimaryService(true);
    this.setConfiguredName(this.light, cfg.name);
    this.light.getCharacteristic(C.On)
      .onGet(() => this.read((v) => v.on))
      .onSet((value) => this.write(() => ctl.setOn(Boolean(value))));
    this.light.getCharacteristic(C.Brightness)
      .onGet(() => this.read((v) => v.brightness))
      .onSet((value) => this.write(() => ctl.setBrightness(Number(value))));
    if (!this.light.testCharacteristic(C.StatusFault)) this.light.addOptionalCharacteristic(C.StatusFault);

    // Slot switches
    const names = ctl.slotNames();
    const switchSlots = cfg.lookControl === 'switches' || cfg.lookControl === 'both' ? cfg.slots : [];
    for (const n of switchSlots) {
      const name = names.get(n) ?? `Slot ${n}`;
      const sw = accessory.getServiceById(S.Switch, slotSubtype(n)) ?? accessory.addService(S.Switch, name, slotSubtype(n));
      this.setConfiguredName(sw, name);
      sw.getCharacteristic(C.On)
        .onGet(() => this.read((v) => v.activeSlot === n))
        .onSet((value) => this.write(async () => {
          const reassert = await ctl.setSlot(n, Boolean(value));
          if (reassert) setTimeout(() => sw.updateCharacteristic(C.On, true), 300);
        }));
      if (!this.light.linkedServices.includes(sw)) this.light.addLinkedService(sw);
      this.switches.set(n, sw);
    }

    // Optional "online" sensor
    if (cfg.offlineSensor) {
      this.sensor = accessory.getServiceById(S.ContactSensor, SENSOR)
        ?? accessory.addService(S.ContactSensor, `${cfg.name} online`, SENSOR);
      this.sensor.getCharacteristic(C.ContactSensorState).onGet(() =>
        ctl.view().online ? C.ContactSensorState.CONTACT_DETECTED : C.ContactSensorState.CONTACT_NOT_DETECTED);
    }

    // Remove services the current settings don't want (e.g. fewer slots, sensor turned off).
    for (const svc of [...accessory.services]) {
      const keep = svc.UUID === S.AccessoryInformation.UUID
        || (svc.UUID === S.Lightbulb.UUID && svc.subtype === LIGHT)
        || (svc.UUID === S.Switch.UUID && [...this.switches.values()].includes(svc))
        || (svc === this.sensor)
        // "combined": the look picker's TV/input services share this accessory
        || (cfg.lookControl === 'combined' && (svc.UUID === S.Television.UUID || svc.UUID === S.InputSource.UUID));
      if (!keep) {
        this.log.info(`Removing unused service ${svc.displayName} (${svc.subtype ?? 'no subtype'})`);
        accessory.removeService(svc);
      }
    }

    ctl.on('view', (v: CandlesView) => this.push(v));
    ctl.on('names', (n: Map<number, string>) => this.rename(n));
  }

  /** Called with WLED's /json/info. */
  updateInfo(info: WledInfo): void {
    const { Service: S, Characteristic: C } = this.api.hap;
    const svc = this.accessory.getService(S.AccessoryInformation);
    if (!svc) return;
    if (info.ver) svc.updateCharacteristic(C.FirmwareRevision, String(info.ver).replace(/[^0-9.]/g, '') || '0');
    if (info.mac) svc.updateCharacteristic(C.SerialNumber, String(info.mac).toUpperCase());
  }

  private setConfiguredName(svc: Service, name: string): void {
    const C = this.api.hap.Characteristic;
    if (!svc.testCharacteristic(C.ConfiguredName)) svc.addOptionalCharacteristic(C.ConfiguredName);
    svc.setCharacteristic(C.ConfiguredName, name);
    // The Home app may take a service's label from Name rather than ConfiguredName (seen when pairing):
    // keep both the same.
    svc.setCharacteristic(C.Name, name);
  }

  private rename(names: Map<number, string>): void {
    for (const [n, sw] of this.switches) {
      const name = names.get(n);
      if (!name) continue;
      const C = this.api.hap.Characteristic;
      if (sw.getCharacteristic(C.ConfiguredName).value !== name) {
        this.log.info(`Slot ${n} is now "${name}"`);
        sw.updateCharacteristic(C.ConfiguredName, name);
        sw.updateCharacteristic(C.Name, name);
      }
    }
  }

  private read<T extends CharacteristicValue>(pick: (v: CandlesView) => T): T {
    const v = this.ctl.view();
    if (!v.online) throw this.noResponse();
    return pick(v);
  }

  private async write(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (e) {
      this.log.warn(`Couldn't change the candles: ${(e as Error).message}`);
      throw this.noResponse();
    }
  }

  private noResponse() {
    const { HapStatusError, HAPStatus } = this.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private push(v: CandlesView): void {
    const C = this.api.hap.Characteristic;
    const fault = v.online ? C.StatusFault.NO_FAULT : C.StatusFault.GENERAL_FAULT;
    this.light.updateCharacteristic(C.StatusFault, fault);
    this.sensor?.updateCharacteristic(C.ContactSensorState,
      v.online ? C.ContactSensorState.CONTACT_DETECTED : C.ContactSensorState.CONTACT_NOT_DETECTED);
    if (!v.online) {
      const err = this.noResponse();
      this.light.updateCharacteristic(C.On, err);
      this.light.updateCharacteristic(C.Brightness, err);
      for (const sw of this.switches.values()) sw.updateCharacteristic(C.On, err);
      return;
    }
    this.update(this.light, C.On, v.on);
    this.update(this.light, C.Brightness, v.brightness);
    for (const [n, sw] of this.switches) this.update(sw, C.On, v.activeSlot === n);
  }

  private update(svc: Service, char: typeof Characteristic.On | typeof Characteristic.Brightness, value: CharacteristicValue): void {
    if (svc.getCharacteristic(char).value !== value) svc.updateCharacteristic(char, value);
  }
}
