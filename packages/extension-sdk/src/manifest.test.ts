import { describe, expect, it } from 'vitest';
import { API_VERSION, manifestSchema } from './manifest';

const valid = {
  id: 'example',
  name: 'Example',
  version: '1.2.3',
  apiVersion: API_VERSION,
  type: 'anime',
  sources: [{ key: 'id', lang: 'id', name: 'Example (ID)' }],
};

describe('manifestSchema', () => {
  it('accepts a minimal manifest and fills in the defaults', () => {
    const parsed = manifestSchema.parse(valid);
    expect(parsed.nsfw).toBe(false);
    expect(parsed.rateLimit).toBeUndefined();
  });

  it('refuses an extension for another app', () => {
    const result = manifestSchema.safeParse({ ...valid, type: 'manga' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/type "anime"/);
    expect(manifestSchema.safeParse({ ...valid, type: undefined }).success).toBe(false);
  });

  it('keeps the id free of language and punctuation', () => {
    for (const id of ['Example', '1example', 'example_id', 'example.id', '']) {
      expect(manifestSchema.safeParse({ ...valid, id }).success, id).toBe(false);
    }
    expect(manifestSchema.safeParse({ ...valid, id: 'my-site2' }).success).toBe(true);
  });

  it('needs semver and at least one source with unique keys', () => {
    expect(manifestSchema.safeParse({ ...valid, version: '1.0' }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...valid, sources: [] }).success).toBe(false);
    const twice = [valid.sources[0], { ...valid.sources[0]!, name: 'Again' }];
    expect(manifestSchema.safeParse({ ...valid, sources: twice }).success).toBe(false);
  });

  it('checks the source language', () => {
    for (const lang of ['id', 'en', 'pt-BR', 'multi']) {
      const sources = [{ key: 'a', lang, name: 'A' }];
      expect(manifestSchema.safeParse({ ...valid, sources }).success, lang).toBe(true);
    }
    expect(manifestSchema.safeParse({ ...valid, sources: [{ key: 'a', lang: 'Indonesian', name: 'A' }] }).success).toBe(
      false,
    );
  });

  it('bounds the rate limit', () => {
    expect(manifestSchema.safeParse({ ...valid, rateLimit: { perSecond: 5 } }).success).toBe(true);
    expect(manifestSchema.safeParse({ ...valid, rateLimit: { perSecond: 0 } }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...valid, rateLimit: { perSecond: 1000 } }).success).toBe(false);
  });
});
