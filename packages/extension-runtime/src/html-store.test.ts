import { describe, expect, it } from 'vitest';
import { HtmlStore } from './html-store';

const rows = (n: number): string => `<ul>${'<li>x</li>'.repeat(n)}</ul>`;

describe('HtmlStore limits', () => {
  it('refuses a selection that would pass the handle limit, and keeps working below it', () => {
    const store = new HtmlStore(10, 1 << 20);
    const doc = store.load(rows(20), {});
    expect(() => store.select(doc, 'li')).toThrow(/more HTML nodes/);
    expect(store.select(doc, 'ul')).toHaveLength(1);
    expect(store.size).toBe(2);
  });

  it('refuses a node added past the handle limit', () => {
    const store = new HtmlStore(2, 1 << 20);
    const doc = store.load(rows(1), {});
    store.selectFirst(doc, 'li');
    expect(() => store.selectFirst(doc, 'li')).toThrow(/more HTML nodes/);
  });

  it('counts the parsed text, and starts over after clear()', () => {
    const store = new HtmlStore(100, 50);
    store.load('<p>0123456789</p>', {});
    store.load('<p>0123456789</p>', {});
    expect(() => store.load('<p>0123456789012345678901234567890</p>', {})).toThrow(/more HTML than/);
    store.clear();
    expect(store.size).toBe(0);
    expect(() => store.load('<p>0123456789</p>', {})).not.toThrow();
  });
});
