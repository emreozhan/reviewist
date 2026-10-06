import { describe, expect, it } from 'vitest';
import { openCommandFor } from './openBrowser.js';

describe('openCommandFor', () => {
  const url = 'http://127.0.0.1:4317/';

  it('platforma göre işletim sistemi komutunu seçer', () => {
    expect(openCommandFor(url, 'darwin')).toEqual({ command: '/usr/bin/open', args: [url] });
    expect(openCommandFor(url, 'win32', 'C:\\Windows')).toEqual({
      command: 'C:\\Windows\\System32\\rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
    expect(openCommandFor(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] });
  });

  it('http(s) dışındaki adresleri reddeder', () => {
    expect(() => openCommandFor('file:///etc/passwd', 'darwin')).toThrow();
    expect(() => openCommandFor('--help', 'linux')).toThrow();
  });
});
