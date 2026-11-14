import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FocusResult } from './focusTypes';
import { OUTPUT_LEANS, OUTPUT_RAISED, OUTPUT_STRONG, sigmoid } from './preprocess';
import { ViewStrip, viewNames, viewWord } from './ViewStrip';

type Views = NonNullable<FocusResult['views']>;
const view = (label: Views[number]['label'], x: number, y: number, logit = 0): Views[number] => (
  { label, logit, crop: { x, y, width: 384, height: 384 } }
);
const landscape: Views = [view('end', 200, 10, -9), view('center', 100, 10, 0), view('start', 0, 10, 9.81)];

describe('viewWord', () => {
  it.each([
    [OUTPUT_RAISED, 'camera-like', 'raised'],
    [OUTPUT_LEANS, 'raised', 'AI-like'],
    [OUTPUT_STRONG, 'AI-like', 'very AI-like'],
  ] as const)('uses the inclusive output boundary at %s', (threshold, below, at) => {
    let boundary = Math.log(threshold / (1 - threshold));
    // The inverse sigmoid can round just below the threshold; reach the first representable boundary.
    while (sigmoid(boundary) < threshold) boundary += Number.EPSILON * Math.max(1, Math.abs(boundary));
    expect(sigmoid(boundary)).toBeCloseTo(threshold, 15);
    expect(sigmoid(boundary)).toBeGreaterThanOrEqual(threshold);
    expect(viewWord(boundary - 1e-8)).toBe(below);
    expect(viewWord(boundary)).toBe(at);
    expect(viewWord(boundary + 1e-8)).toBe(at);
  });

  it('handles extreme finite logits without overflow and rejects unavailable output', () => {
    expect(viewWord(-Number.MAX_VALUE)).toBe('camera-like');
    expect(viewWord(Number.MAX_VALUE)).toBe('very AI-like');
    for (const logit of [NaN, Infinity, -Infinity]) expect(() => viewWord(logit)).toThrow('non-finite');
  });
});

describe('viewNames', () => {
  it('names landscape views in spatial order without reordering the input', () => {
    expect(viewNames(landscape)).toEqual(['Left', 'Middle', 'Right']);
    expect(landscape.map((v) => v.label)).toEqual(['end', 'center', 'start']);
  });

  it('names portrait views from y geometry rather than crop aspect ratio', () => {
    expect(viewNames([view('center', 10, 100), view('end', 10, 200), view('start', 10, 0)]))
      .toEqual(['Top', 'Middle', 'Bottom']);
  });

  it('names a single view Centre crop', () => {
    expect(viewNames([view('center', 100, 0)])).toEqual(['Centre crop']);
  });

  it('handles missing views and coincident crops', () => {
    expect(viewNames([])).toEqual([]);
    expect(viewNames([view('end', 200, 0), view('start', 0, 0)])).toEqual(['Left', 'Right']);
    expect(viewNames([view('end', 0, 0), view('center', 0, 0)])).toEqual(['Centre crop', 'Centre crop']);
  });
});

describe('ViewStrip markup', () => {
  it.each([false, true])('renders readable names, words and tracks (compact: %s)', (compact) => {
    const markup = renderToStaticMarkup(createElement(ViewStrip, { views: landscape, compact }));
    const visible = markup.replace(/\s+title="[^"]*"/g, '').replace(/<[^>]*>/g, '');
    expect(markup).toContain('<figure');
    expect(markup).toContain('<figcaption');
    expect(visible).toContain('Detector output by part of the photo');
    expect(visible).toContain('Left: very AI-like');
    expect(visible).toContain('Middle: AI-like');
    expect(visible).toContain('Right: camera-like');
    expect(visible.indexOf('Left:')).toBeLessThan(visible.indexOf('Middle:'));
    expect(visible.indexOf('Middle:')).toBeLessThan(visible.indexOf('Right:'));
    // One view word each, plus the camera-like / AI-like scale: under every row, or once when compact.
    expect(markup.match(/>camera-like<\/span>/g)).toHaveLength(compact ? 2 : 4);
    expect(markup.match(/>AI-like<\/span>/g)).toHaveLength(compact ? 2 : 4);
    expect(markup).toContain('title="raw output 9.81"');
    expect(markup).toContain('title="raw output -9.00"');
    expect(markup).not.toContain('%');
    // Numeric CSS sizing/positioning is not visible UI; raw outputs occur only in titles.
    expect(visible).not.toMatch(/\d/);
    expect(markup.replace(/title="[^"]*"/g, '')).not.toContain('9.81');
    expect(markup).not.toMatch(/\b(real|fake|authentic|genuine|forged|tampered)\b/i);
    expect(markup).toContain('#e5383b');
    expect(markup).toContain('#ffb000');
    expect(markup).toContain('bg-fit');
    expect(markup).toContain('text-fit');
  });

  it('shows raised explicitly and uses its lighter amber', () => {
    const markup = renderToStaticMarkup(createElement(ViewStrip, { views: [view('center', 0, 0, -1)] }));
    expect(markup.replace(/<[^>]*>/g, '')).toContain('Centre crop: raised');
    expect(markup).toContain('#f5c451');
  });

  it('clamps saturated positions to the ends of the track', () => {
    const markup = renderToStaticMarkup(createElement(ViewStrip, {
      views: [view('start', 0, 0, -1000), view('end', 200, 0, 1000)],
    }));
    expect(markup).toContain('flex-grow:0');
    expect(markup).toContain('flex-grow:1');
    expect(markup).not.toMatch(/NaN|Infinity|%/);
  });
});
