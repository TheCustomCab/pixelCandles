// SPDX-License-Identifier: MIT
// Look picker: the slots as a named input list. HomeKit only offers a named picker on a Television service. By default
// (lookControl "combined") the Television service sits on the Candles accessory itself, so the Home app shows one tile
// with the brightness slider, a power button and the look list; with "picker" it is its own TV-type accessory.
// Its power button mirrors the candles' on/off. Inputs are typed HDMI: the Home app didn't list them as OTHER.
// Each slot is an InputSource (Identifier = preset number); a hidden "Other look" input is shown while the live
// look matches no slot (e.g. while a look is being edited on the Candles page).

import type { API, CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge';
import type { CandlesController, CandlesView } from './candles/controller.js';
import type { CandlesConfig } from './settings.js';

const TV = 'looks';
export const OTHER_ID = 1000;
const inputSubtype = (n: number) => `input-${n}`;

export class LooksPicker {
  private readonly tv: Service;
  private readonly inputs = new Map<number, Service>();
  private readonly other: Service;
  /** Last slot shown, kept while the candles are off so the tile still names the look. */
  private lastSlot: number;

  constructor(
    private readonly api: API,
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory,
    private readonly ctl: CandlesController,
    private readonly cfg: CandlesConfig,
    /** false when the picker shares the Candles accessory (lookControl "combined"): the light stays primary. */
    standalone = true,
  ) {
    const { Service: S, Characteristic: C } = api.hap;
    this.lastSlot = cfg.slots[0];

    if (standalone) {
      accessory.getService(S.AccessoryInformation)!
        .setCharacteristic(C.Manufacturer, 'WLED')
        .setCharacteristic(C.Model, 'pixelCandles looks')
        .setCharacteristic(C.SerialNumber, `${cfg.id}-looks`);
    }

    this.tv = accessory.getServiceById(S.Television, TV) ?? accessory.addService(S.Television, cfg.pickerName, TV);
    if (standalone) this.tv.setPrimaryService(true);
    this.tv.setCharacteristic(C.ConfiguredName, cfg.pickerName);
    this.tv.setCharacteristic(C.SleepDiscoveryMode, C.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    // The Home app greys out a TV's look list while the TV is off. With lookListAlwaysOn the TV side always reports
    // Active, so a look can be chosen while the candles are off (it turns them on); its power button toggles them.
    this.tv.getCharacteristic(C.Active)
      .onGet(() => this.read((v) => this.activeValue(v)))
      .onSet((value) => this.write(async () => {
        if (!cfg.lookListAlwaysOn) return ctl.setOn(value === C.Active.ACTIVE);
        const want = value === C.Active.ACTIVE ? true : !ctl.view().on;   // "off" from an always-on button = toggle
        setTimeout(() => this.tv.updateCharacteristic(C.Active, C.Active.ACTIVE), 300);
        return ctl.setOn(want);
      }));
    this.tv.getCharacteristic(C.ActiveIdentifier)
      .onGet(() => this.read((v) => this.identifier(v)))
      .onSet((value) => this.write(async () => {
        const id = Number(value);
        if (cfg.slots.includes(id)) await ctl.setSlot(id, true);
        else setTimeout(() => this.push(ctl.view()), 300);   // "Other look" can't be chosen
      }));
    // Required by HomeKit for a TV; the candles have no remote functions.
    this.tv.getCharacteristic(C.RemoteKey).onSet(() => undefined);

    const names = ctl.slotNames();
    for (const n of cfg.slots) this.inputs.set(n, this.input(inputSubtype(n), n, names.get(n) ?? `Slot ${n}`));
    this.other = this.input('input-other', OTHER_ID, 'Other look');
    this.other.setCharacteristic(C.CurrentVisibilityState, C.CurrentVisibilityState.HIDDEN);
    this.setDisplayOrder();

    // Remove inputs for slots no longer configured (only TV/input services: in "combined" mode the light lives here too).
    const keep = new Set<Service>([this.tv, this.other, ...this.inputs.values()]);
    for (const svc of [...accessory.services]) {
      if (svc.UUID !== S.InputSource.UUID && svc.UUID !== S.Television.UUID) continue;
      if (keep.has(svc)) continue;
      this.log.info(`Removing unused service ${svc.displayName} (${svc.subtype ?? 'no subtype'})`);
      accessory.removeService(svc);
    }

    ctl.on('view', (v: CandlesView) => this.push(v));
    ctl.on('names', (n: Map<number, string>) => this.rename(n));
    this.push(ctl.view());
  }

  /** Show the inputs in slot order (the Home app otherwise orders them as it likes). TLV8: 0x01 len 4 id, 0x00 0x00 between. */
  private setDisplayOrder(): void {
    const C = this.api.hap.Characteristic;
    const bytes: number[] = [];
    [...this.cfg.slots, OTHER_ID].forEach((id, i) => {
      if (i) bytes.push(0x00, 0x00);
      bytes.push(0x01, 0x04, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, (id >>> 24) & 0xff);
    });
    if (!this.tv.testCharacteristic(C.DisplayOrder)) this.tv.addOptionalCharacteristic(C.DisplayOrder);
    this.tv.setCharacteristic(C.DisplayOrder, Buffer.from(bytes).toString('base64'));
  }

  private input(subtype: string, id: number, name: string): Service {
    const { Service: S, Characteristic: C } = this.api.hap;
    const svc = this.accessory.getServiceById(S.InputSource, subtype) ?? this.accessory.addService(S.InputSource, name, subtype);
    svc.setCharacteristic(C.Identifier, id)
      .setCharacteristic(C.ConfiguredName, name)
      .setCharacteristic(C.Name, name)
      .setCharacteristic(C.IsConfigured, C.IsConfigured.CONFIGURED)
      .setCharacteristic(C.InputSourceType, C.InputSourceType.HDMI)   // the Home app may not list OTHER; HDMI is what working plugins use
      .setCharacteristic(C.CurrentVisibilityState, C.CurrentVisibilityState.SHOWN);
    // The Home app lets the user hide inputs; accept that without fighting it.
    svc.getCharacteristic(C.TargetVisibilityState).onSet((value) => {
      svc.updateCharacteristic(C.CurrentVisibilityState, value as CharacteristicValue);
    });
    if (!this.tv.linkedServices.includes(svc)) this.tv.addLinkedService(svc);
    return svc;
  }

  private activeValue(v: CandlesView): number {
    const C = this.api.hap.Characteristic;
    return v.on || this.cfg.lookListAlwaysOn ? C.Active.ACTIVE : C.Active.INACTIVE;
  }

  private identifier(v: CandlesView): number {
    if (v.activeSlot) return v.activeSlot;
    return v.on ? OTHER_ID : this.lastSlot;
  }

  private rename(names: Map<number, string>): void {
    const C = this.api.hap.Characteristic;
    for (const [n, svc] of this.inputs) {
      const name = names.get(n);
      if (name && svc.getCharacteristic(C.ConfiguredName).value !== name) {
        this.log.info(`Look ${n} is now "${name}"`);
        svc.updateCharacteristic(C.ConfiguredName, name);
        svc.updateCharacteristic(C.Name, name);
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
    if (!v.online) {
      const err = this.noResponse();
      this.tv.updateCharacteristic(C.Active, err);
      this.tv.updateCharacteristic(C.ActiveIdentifier, err);
      return;
    }
    if (v.activeSlot) this.lastSlot = v.activeSlot;
    const otherShown = v.on && !v.activeSlot;
    this.other.updateCharacteristic(C.CurrentVisibilityState,
      otherShown ? C.CurrentVisibilityState.SHOWN : C.CurrentVisibilityState.HIDDEN);
    const active = this.activeValue(v);
    if (this.tv.getCharacteristic(C.Active).value !== active) this.tv.updateCharacteristic(C.Active, active);
    const id = this.identifier(v);
    if (this.tv.getCharacteristic(C.ActiveIdentifier).value !== id) this.tv.updateCharacteristic(C.ActiveIdentifier, id);
  }
}
