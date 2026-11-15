import { describe, expect, it } from 'vitest';
import { classifyText } from './filter';

describe('classifyText street names', () => {
  it('treats a compass prefix and a name as a street even without its suffix', () => {
    for (const t of ['N Lee A', 'SW Oak', 'North Main St', 'E Maple Av']) expect(classifyText(t).category).toBe('address');
  });
  it('keeps garment text and lone words out', () => {
    for (const t of ['Champion', 'NE', 'N', 'Nike', 'E']) expect(classifyText(t).category).not.toBe('address');
  });
});
