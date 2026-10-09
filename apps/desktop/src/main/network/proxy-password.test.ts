import { describe, expect, it } from 'vitest';
import { PROXY_PASSWORD_KEY, type PasswordCrypto, ProxyPasswordStore, type RawSettings } from './proxy-password';

function memorySettings(): RawSettings & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    getValue: <T>(key: string, fallback: T) => (rows.has(key) ? (rows.get(key) as T) : fallback),
    setValue: (key, value) => void rows.set(key, value),
  };
}

/** A reversible fake: "encrypted" bytes are the text reversed, so a test can tell it is not the plain text. */
function fakeCrypto(available: boolean): PasswordCrypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from([...plain].reverse().join('')),
    decryptString: (encrypted) => {
      const text = encrypted.toString();
      if (text.startsWith('!')) throw new Error('wrong keyring');
      return [...text].reverse().join('');
    },
  };
}

describe('ProxyPasswordStore', () => {
  it('encrypts when the keyring is there, and reads it back', () => {
    const settings = memorySettings();
    const store = new ProxyPasswordStore(settings, fakeCrypto(true));
    expect(store.set('s3cret')).toEqual({ stored: true, encrypted: true });
    expect(JSON.stringify(settings.rows.get(PROXY_PASSWORD_KEY))).not.toContain('s3cret');
    expect(store.get()).toBe('s3cret');
    expect(store.info()).toEqual({ stored: true, encrypted: true });
  });

  it('keeps plain text with a marker when there is no keyring', () => {
    const settings = memorySettings();
    const store = new ProxyPasswordStore(settings, fakeCrypto(false));
    expect(store.set('s3cret')).toEqual({ stored: true, encrypted: false });
    expect(settings.rows.get(PROXY_PASSWORD_KEY)).toEqual({ encrypted: false, data: 's3cret' });
    expect(store.get()).toBe('s3cret');
  });

  it('reads a password written under the other mode (the keyring came or went)', () => {
    const settings = memorySettings();
    new ProxyPasswordStore(settings, fakeCrypto(true)).set('abc');
    const withoutKeyring = new ProxyPasswordStore(settings, fakeCrypto(false));
    expect(withoutKeyring.info()).toEqual({ stored: true, encrypted: true });
    settings.rows.set(PROXY_PASSWORD_KEY, { encrypted: false, data: 'plain' });
    expect(new ProxyPasswordStore(settings, fakeCrypto(true)).get()).toBe('plain');
  });

  it('removes the password with null or an empty string', () => {
    const settings = memorySettings();
    const store = new ProxyPasswordStore(settings, fakeCrypto(true));
    store.set('abc');
    expect(store.set(null)).toEqual({ stored: false, encrypted: true });
    expect(store.get()).toBeNull();
    store.set('abc');
    store.set('');
    expect(store.info().stored).toBe(false);
  });

  it('reports what a new password would get when nothing is stored', () => {
    expect(new ProxyPasswordStore(memorySettings(), fakeCrypto(false)).info()).toEqual({
      stored: false,
      encrypted: false,
    });
    expect(new ProxyPasswordStore(memorySettings(), fakeCrypto(true)).info()).toEqual({
      stored: false,
      encrypted: true,
    });
  });

  it('gives null, not an error, for a cipher text it cannot decrypt or a damaged row', () => {
    const settings = memorySettings();
    const store = new ProxyPasswordStore(settings, fakeCrypto(true));
    settings.rows.set(PROXY_PASSWORD_KEY, { encrypted: true, data: Buffer.from('!x').toString('base64') });
    expect(store.get()).toBeNull();
    settings.rows.set(PROXY_PASSWORD_KEY, 'garbage');
    expect(store.get()).toBeNull();
    expect(store.info().stored).toBe(false);
  });
});
