import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { get: vi.fn() }, Capacitor: { getPlatform: () => 'web' } }));
const { privateV4, assertPublicHost } = await import('./api');

describe('native fetch guard', () => {
  it('knows private IPv4 ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) expect(privateV4(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '100.63.0.1']) expect(privateV4(ip)).toBe(false);
  });
  it('refuses private literals, local names and odd schemes without any request', async () => {
    for (const u of ['http://127.0.0.1:8000/private.png', 'http://192.168.0.1/', 'http://localhost/x', 'http://router.local/x', 'http://intranet/x', 'http://[::1]/x', 'ftp://example.com/x', 'http://user:pw@example.com/'])
      await expect(assertPublicHost(u)).rejects.toThrow();
  });
  it('accepts a public literal', async () => {
    await expect(assertPublicHost('https://93.184.216.34/a.jpg')).resolves.toBeInstanceOf(URL);
  });
});
