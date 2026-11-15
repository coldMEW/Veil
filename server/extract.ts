// Pure HTML parsing shared by the server and the Android app (no Node imports).
export const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export function extractImages(html: string, base: string): Array<{ url: string; alt: string | null }> {
  const found = new Map<string, string | null>();
  const add = (src: string | undefined, alt: string | null = null) => {
    if (!src || src.startsWith('data:')) return;
    try {
      const abs = new URL(decode(src.trim()), base);
      if (abs.protocol === 'http:' || abs.protocol === 'https:')
        if (!found.has(abs.href)) found.set(abs.href, alt);
    } catch {
      /* skip malformed */
    }
  };
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi,
  )) {
    add(m[0].match(/content=["']([^"']+)["']/i)?.[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? null;
    const srcset = tag.match(/\b(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    const largest = srcset
      ?.split(',')
      .map((s) => {
        const [url, descriptor] = s.trim().split(/\s+/);
        return { url, size: descriptor ? Number.parseFloat(descriptor) || 1 : 1 };
      })
      .sort((a, b) => b.size - a.size)[0]?.url;
    const source = ['data-src', 'data-original', 'src']
      .map((name) => tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i'))?.[1])
      .find(Boolean);
    add(largest ?? source, alt ? decode(alt) : null);
  }
  for (const m of html.matchAll(/<a\b[^>]+href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi))
    add(m[1]);
  return [...found].slice(0, 80).map(([url, alt]) => ({ url, alt }));
}
