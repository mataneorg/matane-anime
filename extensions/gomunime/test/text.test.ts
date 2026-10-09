import { describe, expect, it } from 'vitest';
import {
  entityPath,
  episodeSeries,
  labelHeight,
  parseEpisodeDate,
  parseNumber,
  parseStatus,
  parseType,
  parseYear,
  seriesOfEpisode,
} from '../src/text';

describe('text helpers', () => {
  it('turns links into paths without host, query or trailing slash', () => {
    expect(entityPath('https://gomunime.top/one-piece', 'https://gomunime.top')).toBe('/one-piece');
    expect(entityPath('/one-piece/?x=1', 'https://gomunime.top')).toBe('/one-piece');
    expect(entityPath('https://mirror.example/one-piece-episode-3', 'https://gomunime.top')).toBe(
      '/one-piece-episode-3',
    );
  });
  it('finds the series of an episode path', () => {
    expect(seriesOfEpisode('/one-piece-episode-1159')).toBe('/one-piece');
    expect(seriesOfEpisode('/spy-x-family-season-2-episode-0')).toBe('/spy-x-family-season-2');
    expect(seriesOfEpisode('/one-piece')).toBeNull();
  });
  it('finds the series of an episode card path in both forms', () => {
    expect(episodeSeries('/one-piece-episode-1159')).toBe('/one-piece');
    expect(episodeSeries('/sentai-daishikkaku-2nd-season-4')).toBe('/sentai-daishikkaku-2nd-season');
    expect(episodeSeries('/kingdom-season-6-episode-2')).toBe('/kingdom-season-6');
  });
  it('parses status, type, year and numbers', () => {
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseStatus('?')).toBe('unknown');
    expect(parseType('TV')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Whatever')).toBeUndefined();
    expect(parseYear('2025')).toBe(2025);
    expect(parseYear(undefined)).toBeUndefined();
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('x')).toBeUndefined();
  });
  it('parses dd/mm/yy dates', () => {
    expect(parseEpisodeDate('21/09/26')).toBe(Date.UTC(2026, 8, 21));
    expect(parseEpisodeDate('31/02/2025')).toBe(Date.UTC(2025, 2, 3));
    expect(parseEpisodeDate('soon')).toBeUndefined();
    expect(parseEpisodeDate('01/13/26')).toBeUndefined();
  });
  it('reads the height of a server label', () => {
    expect(labelHeight('pdrn 480p')).toBe(480);
    expect(labelHeight('B-TUBE')).toBeUndefined();
  });
});
