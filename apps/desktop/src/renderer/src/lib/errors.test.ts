import { AppError, MAIN_ERROR_KEYS } from '@matane-anime/shared';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
import id from '../i18n/locales/id.json';
import { describeError } from './errors';

async function translator(language: 'en' | 'id') {
  const i18n = createInstance();
  await i18n.init({
    resources: { en: { translation: en }, id: { translation: id } },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n.t;
}

describe('describeError with a key from main', () => {
  it('says it in the language of the app, with the params filled in', async () => {
    const error = new AppError('unsupported', 'English message', {
      key: 'apiTooNew',
      params: { name: 'Alpha', required: 2, supported: 1 },
    });
    expect(describeError(error, await translator('en'))).toBe(
      '"Alpha" needs extension API 2; this app supports up to 1. Update the app to install it.',
    );
    expect(describeError(error, await translator('id'))).toContain('API extension 2');
  });

  it('wins over the code-based text, so a cancelled request is described by its own key', async () => {
    const error = new AppError('cancelled', 'The request was cancelled', { key: 'requestCancelled' });
    expect(describeError(error, await translator('id'))).toBe('Permintaan dibatalkan.');
  });

  it('names a stock subject in the language, and an extension by its quoted name', async () => {
    const t = await translator('id');
    const index = new AppError('network', 'x', { key: 'serverStatus', params: { subject: 'index', status: 500 } });
    expect(describeError(index, t)).toBe('Server menjawab 500 untuk indeks repositori.');
    const named = new AppError('network', 'x', { key: 'notFound404', params: { name: 'Alpha' } });
    expect(describeError(named, t)).toBe('"Alpha" tidak ditemukan (server menjawab 404).');
  });

  it('falls back to the English message for a key it does not know', async () => {
    const error = new AppError('invalid_input', 'The English message', { key: 'fromTheFuture' as never });
    expect(describeError(error, await translator('id'))).toBe('The English message');
  });

  it('is unchanged for an error without a key', async () => {
    const t = await translator('en');
    expect(describeError(new AppError('invalid_input', 'Plain message'), t)).toBe('Plain message');
    expect(describeError(new AppError('offline', 'You are offline'), t)).toBe('You are offline.');
  });
});

describe('the main error catalogs', () => {
  it('have a text for every key main can send, in both languages', () => {
    for (const catalog of [en, id]) {
      const texts = catalog.errors.main as Record<string, string>;
      for (const key of MAIN_ERROR_KEYS) expect(texts[key], key).toBeTruthy();
      expect(Object.keys(texts).sort()).toEqual([...MAIN_ERROR_KEYS].sort());
    }
  });
});
