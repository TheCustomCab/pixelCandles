// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import type { API } from 'homebridge';
import { CandlesPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, CandlesPlatform);
};
