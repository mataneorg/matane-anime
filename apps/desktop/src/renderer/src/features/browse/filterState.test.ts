import type { Filter } from '@matane-anime/extension-sdk';
import { describe, expect, it } from 'vitest';
import {
  appliedItems,
  cleanFilters,
  countActive,
  countIn,
  fieldsOf,
  normalize,
  requestFilters,
  resolve,
  sameFilters,
} from './filterState';

const options = [
  { value: '', label: 'Any' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'done', label: 'Done' },
];

const list: Filter[] = [
  { type: 'header', label: 'Basics' },
  { type: 'text', id: 'studio', label: 'Studio' },
  { type: 'select', id: 'status', label: 'Status', options },
  { type: 'select', id: 'season', label: 'Season', options: options.slice(1), default: 'ongoing' },
  { type: 'checkbox', id: 'dub', label: 'Dub' },
  { type: 'checkbox', id: 'hd', label: 'HD only', default: true },
  { type: 'separator' },
  {
    type: 'sort',
    id: 'sort',
    label: 'Sort',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'year', label: 'Year' },
    ],
  },
  {
    type: 'sort',
    id: 'order',
    label: 'Order',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'year', label: 'Year' },
    ],
    default: { value: 'year', ascending: false },
  },
  {
    type: 'group',
    id: 'genres',
    label: 'Genres',
    filters: [
      { type: 'tristate', id: 'g-a', label: 'A' },
      { type: 'tristate', id: 'g-b', label: 'B' },
      { type: 'group', id: 'inner', label: 'Inner', filters: [{ type: 'checkbox', id: 'g-c', label: 'C' }] },
    ],
  },
];
const field = (id: string) => {
  const found = fieldsOf(list).find((candidate) => candidate.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('fieldsOf', () => {
  it('lists the filters that carry a value, nested groups included, without headers and separators', () => {
    expect(fieldsOf(list).map((f) => f.id)).toEqual([
      'studio',
      'status',
      'season',
      'dub',
      'hd',
      'sort',
      'order',
      'g-a',
      'g-b',
      'g-c',
    ]);
  });
});

describe('resolve', () => {
  it('shows the state, else the declared default, else nothing', () => {
    expect(resolve(field('hd'), {})).toBe(true);
    expect(resolve(field('hd'), { hd: false })).toBe(false);
    expect(resolve(field('dub'), {})).toBe(false);
    expect(resolve(field('season'), {})).toBe('ongoing');
    expect(resolve(field('status'), {})).toBe('');
    expect(resolve(field('sort'), {})).toBeUndefined();
    expect(resolve(field('order'), {})).toEqual({ value: 'year', ascending: false });
    expect(resolve(field('g-a'), {})).toBeUndefined();
  });

  it('ignores a value of the wrong kind (an address edited by hand)', () => {
    expect(resolve(field('hd'), { hd: 'yes' })).toBe(true);
    expect(resolve(field('g-a'), { 'g-a': 'maybe' })).toBeUndefined();
    expect(resolve(field('sort'), { sort: 'title' })).toBeUndefined();
  });
});

describe('cleanFilters', () => {
  it('drops empty text, unchecked boxes and "Any" when there is nothing to compare with', () => {
    expect(cleanFilters({ q: '', dub: false, status: '', ready: true, g: 'exclude' })).toEqual({
      ready: true,
      g: 'exclude',
    });
  });
});

describe('normalize', () => {
  it('drops what equals the baseline and keeps what differs', () => {
    expect(
      normalize(list, {
        studio: '',
        status: '',
        season: 'ongoing',
        dub: false,
        hd: true,
        order: { value: 'year', ascending: false },
        'g-a': 'include',
      }),
    ).toEqual({ 'g-a': 'include' });
  });

  it('keeps an explicit false or "" where the default is something else', () => {
    expect(normalize(list, { hd: false, season: '' })).toEqual({ hd: false, season: '' });
  });

  it('keeps a sort that differs from its default, and any sort when there is no default', () => {
    expect(normalize(list, { order: { value: 'year', ascending: true } })).toEqual({
      order: { value: 'year', ascending: true },
    });
    expect(normalize(list, { sort: { value: 'title', ascending: false } })).toEqual({
      sort: { value: 'title', ascending: false },
    });
  });

  it('drops a value of the wrong kind, and falls back to cleanFilters for undeclared ids', () => {
    expect(normalize(list, { 'g-a': 'maybe', dub: 'yes', old: '', older: 'x' })).toEqual({ older: 'x' });
  });
});

describe('countActive and sameFilters', () => {
  it('do not count a default, but count turning it off', () => {
    expect(countActive(list, { hd: true, season: 'ongoing' })).toBe(0);
    expect(countActive(list, { hd: false, dub: true, studio: 'x' })).toBe(3);
  });

  it('compare what the extension would see', () => {
    expect(sameFilters(list, { dub: false, hd: true }, {})).toBe(true);
    expect(sameFilters(list, { hd: false }, {})).toBe(false);
    expect(sameFilters(list, { 'g-a': 'include' }, { 'g-a': 'exclude' })).toBe(false);
    const sort = (value: string, ascending: boolean) => ({ sort: { value, ascending } });
    expect(sameFilters(list, sort('year', true), sort('year', true))).toBe(true);
    expect(sameFilters(list, sort('year', true), sort('year', false))).toBe(false);
  });
});

describe('countIn', () => {
  it('counts the filters of a group that are on, nested groups included', () => {
    const genres = list.find((f) => f.type === 'group');
    if (genres?.type !== 'group') throw new Error('no group');
    expect(countIn(genres.filters, { 'g-a': 'include', 'g-c': true, dub: true })).toBe(2);
    expect(countIn(genres.filters, { 'g-a': 'maybe', 'g-c': false })).toBe(0);
  });
});

describe('requestFilters', () => {
  it('adds the defaults that are not empty, so a default shown as chosen is sent', () => {
    expect(requestFilters(list, {})).toEqual({
      hd: true,
      season: 'ongoing',
      order: { value: 'year', ascending: false },
    });
  });

  it('sends the explicit off of a default, and the state over a default', () => {
    expect(
      requestFilters(list, { hd: false, season: '', order: { value: 'title', ascending: true }, dub: true }),
    ).toEqual({
      hd: false,
      season: '',
      order: { value: 'title', ascending: true },
      dub: true,
    });
  });
});

describe('appliedItems', () => {
  it('lists the filters that are on with their declarations, in declared order', () => {
    const items = appliedItems(list, { 'g-a': 'exclude', studio: 'Tsuki', hd: true, dub: true });
    expect(items.map((item) => [item.field.id, item.value])).toEqual([
      ['studio', 'Tsuki'],
      ['dub', true],
      ['g-a', 'exclude'],
    ]);
  });
});
