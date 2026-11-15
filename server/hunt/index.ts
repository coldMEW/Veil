import type { HuntImage, HuntOptions, HuntResult, Transport } from './types';
import { PartialHuntError } from './shared';
import { yandex } from './yandex';
import { bing, bingByUrl } from './bing';
import { lens } from './lens';
import { web } from './web';
export type * from './types';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function bounded(t: Transport, deadline: number): Transport {
  const check = () => {
    if (performance.now() >= deadline) throw Error('timeout');
  };
  return {
    async get(url, headers) {
      check();
      const response = await t.get(url, headers);
      check();
      return response;
    },
    async postMultipart(url, fields, file, headers) {
      check();
      const response = await t.postMultipart(url, fields, file, headers);
      check();
      return response;
    },
  };
}
async function run(
  image: HuntImage | undefined,
  imageUrl: string | undefined,
  t: Transport,
  opts: HuntOptions,
): Promise<HuntResult[]> {
  if (image && (!TYPES.has(image.type) || image.bytes.length < 1 || image.bytes.length > 8 * 1024 * 1024))
    throw Error('invalid-image');
  const names = opts.names ?? [],
    engines = [
      ...new Set(
        opts.engines ?? [
          'yandex',
          'bing',
          ...(imageUrl && opts.serpApiKey ? ['lens'] : []),
          ...(names.length ? ['web'] : []),
        ],
      ),
    ];
  return Promise.all(
    engines.map(async (engine) => {
      const start = performance.now(),
        budget = Math.min(20000, Math.max(1, opts.timeoutMs ?? 20000)),
        transport = bounded(t.withDeadline?.(start + budget) ?? t, start + budget);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        let action: () => Promise<HuntResult['hits']>;
        if (engine === 'yandex' && image) action = () => yandex(image, transport);
        else if (engine === 'bing' && image) action = () => bing(image, transport);
        else if (engine === 'bing' && imageUrl) action = () => bingByUrl(imageUrl, transport);
        else if (engine === 'lens') {
          if (!imageUrl) throw Error('image-url-required');
          if (!opts.serpApiKey) throw Error('api-key-required');
          action = () => lens(imageUrl, opts.serpApiKey!, transport);
        } else if (engine === 'web') {
          if (!names.length) throw Error('names-required');
          action = () => web(names, transport);
        } else throw Error('unsupported-engine');
        const hits = await Promise.race([
          action(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error('timeout')), budget);
          }),
        ]);
        return { engine, ok: true, hits, ms: Math.round(performance.now() - start) };
      } catch (error) {
        const message =
          error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'timeout'
            : error instanceof Error
              ? error.message
              : '';
        return {
          engine,
          ok: false,
          hits: error instanceof PartialHuntError ? error.hits : [],
          error:
            /^(captcha|http-\d+|parse-error|timeout|api-key-required|image-url-required|invalid-image-url|unsupported-engine|names-required|provider-error|provider-redirect-blocked|provider-response-too-large|too-many-provider-redirects)$/.test(
              message,
            )
              ? message
              : 'network-error',
          ms: Math.round(performance.now() - start),
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}
/** Uploads to selected third-party engines. Call only after explicit user action/consent. */
export function hunt(image: HuntImage, t: Transport, opts: HuntOptions = {}): Promise<HuntResult[]> {
  return run(image, undefined, t, opts);
}
/** SerpApi Lens accepts a public image URL, never an upload; no hosting is performed here. */
export function huntByUrl(imageUrl: string, t: Transport, opts: HuntOptions = {}): Promise<HuntResult[]> {
  return run(undefined, imageUrl, t, {
    ...opts,
    engines: opts.engines ?? [
      'bing',
      ...(opts.serpApiKey ? ['lens'] : []),
      ...(opts.names?.length ? ['web'] : []),
    ],
  });
}
