import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsFromStored, settingsPatchSchema } from './settings';
import {
  DEFAULT_BROWSE_SETTINGS,
  DEFAULT_GLOBAL_SEARCH_SETTINGS,
  DEFAULT_LIBRARY_SETTINGS,
  browseSettingsSchema,
  globalSearchSettingsSchema,
  librarySettingsSchema,
} from './view-settings';

const stored = (entries: Record<string, unknown>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));

describe('view settings defaults', () => {
  it('are what an empty profile (or one from before these settings) gets', () => {
    const settings = settingsFromStored(stored({ theme: 'latte' }));
    expect(settings.library).toEqual(DEFAULT_LIBRARY_SETTINGS);
    expect(settings.browse).toEqual(DEFAULT_BROWSE_SETTINGS);
    expect(settings.globalSearch).toEqual(DEFAULT_GLOBAL_SEARCH_SETTINGS);
    expect(DEFAULT_SETTINGS.library).toEqual(DEFAULT_LIBRARY_SETTINGS);
  });

  it('parse from nothing at all, so a partial object is filled in', () => {
    expect(librarySettingsSchema.parse({})).toEqual(DEFAULT_LIBRARY_SETTINGS);
    expect(browseSettingsSchema.parse({})).toEqual(DEFAULT_BROWSE_SETTINGS);
    expect(globalSearchSettingsSchema.parse({})).toEqual(DEFAULT_GLOBAL_SEARCH_SETTINGS);
  });
});

describe('library settings', () => {
  it('keep valid values', () => {
    const library = {
      display: 'list',
      coverSize: 220,
      sort: 'title',
      descending: true,
      unwatchedOnly: true,
      startedOnly: false,
      downloadedOnly: true,
      status: ['ongoing', 'hiatus'],
      sourceIds: ['example/en'],
    };
    expect(settingsFromStored(stored({ library })).library).toEqual(library);
  });

  it('fall back field by field, so one bad value keeps the rest', () => {
    const result = librarySettingsSchema.parse({
      display: 'masonry',
      coverSize: 50,
      sort: 'title',
      descending: 'yes',
      status: ['ongoing', 'sleeping'],
      sourceIds: 'example/en',
      downloadedOnly: true,
    });
    expect(result).toEqual({
      ...DEFAULT_LIBRARY_SETTINGS,
      sort: 'title',
      downloadedOnly: true,
    });
  });

  it('bound the cover size to 100–280 whole pixels', () => {
    expect(librarySettingsSchema.parse({ coverSize: 100 }).coverSize).toBe(100);
    expect(librarySettingsSchema.parse({ coverSize: 280 }).coverSize).toBe(280);
    expect(librarySettingsSchema.parse({ coverSize: 281 }).coverSize).toBe(DEFAULT_LIBRARY_SETTINGS.coverSize);
    expect(librarySettingsSchema.parse({ coverSize: 150.5 }).coverSize).toBe(DEFAULT_LIBRARY_SETTINGS.coverSize);
  });

  it('use the defaults when the stored value is not an object', () => {
    expect(settingsFromStored(stored({ library: 'list' })).library).toEqual(DEFAULT_LIBRARY_SETTINGS);
    expect(settingsFromStored(new Map([['library', '{oops']])).library).toEqual(DEFAULT_LIBRARY_SETTINGS);
  });
});

describe('browse and global search settings', () => {
  it('keep valid values and repair invalid ones', () => {
    expect(browseSettingsSchema.parse({ display: 'cover', coverSize: 240 })).toEqual({
      display: 'cover',
      coverSize: 240,
    });
    expect(browseSettingsSchema.parse({ display: 'nope', coverSize: 'big' })).toEqual(DEFAULT_BROWSE_SETTINGS);
    expect(globalSearchSettingsSchema.parse({ sourceIds: ['a/b'], onlyWithResults: true })).toEqual({
      sourceIds: ['a/b'],
      onlyWithResults: true,
    });
    expect(globalSearchSettingsSchema.parse({ sourceIds: 7, onlyWithResults: 'yes' })).toEqual(
      DEFAULT_GLOBAL_SEARCH_SETTINGS,
    );
  });

  it('tell "every source" (null) from "none picked" (an empty list)', () => {
    expect(globalSearchSettingsSchema.parse({ sourceIds: [] }).sourceIds).toEqual([]);
    expect(globalSearchSettingsSchema.parse({ sourceIds: null }).sourceIds).toBeNull();
  });
});

describe('settings patch', () => {
  it('accepts a whole view block as one key', () => {
    const patch = settingsPatchSchema.parse({ browse: { display: 'compact', coverSize: 120 } });
    expect(patch).toEqual({ browse: { display: 'compact', coverSize: 120 } });
  });
});
