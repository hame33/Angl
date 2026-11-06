import test from 'node:test';
import assert from 'node:assert/strict';
import { isIOS } from './device.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

test('an iPhone is iOS, whichever browser it runs', () => {
  assert.equal(isIOS(IPHONE, 5), true);
  assert.equal(isIOS(IPHONE_CHROME, 5), true);
});

test('an iPad that reports itself as a Mac is still iOS', () => {
  assert.equal(isIOS(IPAD_DESKTOP_MODE, 5), true);
});

test('a real Mac, with no touch screen, is not', () => {
  assert.equal(isIOS(IPAD_DESKTOP_MODE, 0), false);
});

test('Android and Windows keep the facade', () => {
  assert.equal(isIOS(ANDROID, 5), false);
  assert.equal(isIOS(WINDOWS, 10), false);
});
