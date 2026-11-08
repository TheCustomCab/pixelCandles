// SPDX-License-Identifier: MIT
import type { API } from 'homebridge';
import { CandlesPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, CandlesPlatform);
};
