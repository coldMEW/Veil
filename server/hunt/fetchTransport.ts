import type { Transport, TransportResponse, UploadFile } from './types';
const HOSTS = new Set([
  'yandex.com',
  'www.yandex.com',
  'yandex.ru',
  'www.yandex.ru',
  'www.bing.com',
  'bing.com',
  'html.duckduckgo.com',
  'serpapi.com',
]);
/** Fetch-based Node transport; Android supplies CapacitorHttp instead. Only fixed provider origins. */
export function createFetchTransport(timeoutMs = 20000, deadline = Infinity): Transport {
  const jar = new Map<string, Map<string, string>>();
  async function request(raw: string, init: RequestInit): Promise<TransportResponse> {
    let url = new URL(raw),
      method = init.method ?? 'GET',
      body = init.body;
    for (let hop = 0; hop < 6; hop++) {
      if (
        url.protocol !== 'https:' ||
        (url.port && url.port !== '443') ||
        !HOSTS.has(url.hostname) ||
        url.username ||
        url.password
      )
        throw Error('provider-redirect-blocked');
      const headers = new Headers(init.headers);
      if (!headers.has('user-agent'))
        headers.set(
          'user-agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        );
      const cookies = jar.get(url.hostname);
      if (cookies?.size) headers.set('cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
      if (performance.now() >= deadline) throw Error('timeout');
      const response = await fetch(url, {
        method,
        body,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(
          Math.max(1, Math.ceil(Math.min(timeoutMs, deadline - performance.now()))),
        ),
      });
      const values = response.headers.getSetCookie?.() ?? [];
      for (const value of values) {
        const pair = value.split(';')[0]!,
          index = pair.indexOf('=');
        if (index > 0) {
          let store = jar.get(url.hostname);
          if (!store) {
            store = new Map();
            jar.set(url.hostname, store);
          }
          store.set(pair.slice(0, index), pair.slice(index + 1));
        }
      }
      const next = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && next) {
        await response.body?.cancel();
        url = new URL(next, url);
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && method === 'POST')
        ) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      const reader = response.body?.getReader(),
        parts: Uint8Array[] = [];
      let total = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 12 * 1024 * 1024) {
            await reader.cancel();
            throw Error('provider-response-too-large');
          }
          parts.push(value);
        }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        data.set(part, offset);
        offset += part.length;
      }
      return {
        status: response.status,
        url: url.href,
        headers: Object.fromEntries(response.headers),
        text: new TextDecoder().decode(data),
      };
    }
    throw Error('too-many-provider-redirects');
  }
  return {
    withDeadline: (until) => createFetchTransport(timeoutMs, Math.min(deadline, until)),
    get: (url, headers) => request(url, { headers }),
    postMultipart: (url, fields, file: UploadFile, headers) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append(file.field, new Blob([new Uint8Array(file.bytes).buffer], { type: file.type }), file.name);
      return request(url, { method: 'POST', headers, body: form });
    },
  };
}
