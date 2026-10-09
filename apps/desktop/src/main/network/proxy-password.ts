import type { ProxyPasswordInfo } from '@matane-anime/shared';

/** The raw settings row (not one of the typed settings: the renderer never sees it). */
export const PROXY_PASSWORD_KEY = 'network.proxyPassword';

/** The slice of Electron's `safeStorage` this needs; injected so the store runs without Electron. */
export interface PasswordCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** The slice of `SettingsRepository` this needs. */
export interface RawSettings {
  getValue<T>(key: string, fallback: T): T;
  setValue(key: string, value: unknown): void;
}

/** What is kept in the row: `encrypted` says how to read `data` (base64 of the cipher text, or the text itself). */
type StoredPassword = { encrypted: boolean; data: string };

const isStored = (value: unknown): value is StoredPassword =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredPassword).encrypted === 'boolean' &&
  typeof (value as StoredPassword).data === 'string';

/**
 * The proxy password: encrypted with the system keyring when there is one, otherwise stored as plain text with
 * `encrypted: false` so the settings page can say so. `get` is for main only; the renderer gets `info`.
 */
export class ProxyPasswordStore {
  constructor(
    private readonly settings: RawSettings,
    private readonly crypto: PasswordCrypto,
  ) {}

  private read(): StoredPassword | null {
    const value = this.settings.getValue<unknown>(PROXY_PASSWORD_KEY, null);
    return isStored(value) ? value : null;
  }

  /** The password; null when none is stored or an encrypted one cannot be decrypted any more (new keyring). */
  get(): string | null {
    const stored = this.read();
    if (!stored) return null;
    if (!stored.encrypted) return stored.data;
    try {
      return this.crypto.decryptString(Buffer.from(stored.data, 'base64'));
    } catch {
      return null;
    }
  }

  /** An empty or null password removes the row. */
  set(password: string | null): ProxyPasswordInfo {
    if (!password) {
      this.settings.setValue(PROXY_PASSWORD_KEY, null);
    } else if (this.crypto.isEncryptionAvailable()) {
      const data = this.crypto.encryptString(password).toString('base64');
      this.settings.setValue(PROXY_PASSWORD_KEY, { encrypted: true, data } satisfies StoredPassword);
    } else {
      this.settings.setValue(PROXY_PASSWORD_KEY, { encrypted: false, data: password } satisfies StoredPassword);
    }
    return this.info();
  }

  /** With nothing stored, `encrypted` says whether a password saved now would be (so the warning shows early). */
  info(): ProxyPasswordInfo {
    const stored = this.read();
    return stored
      ? { stored: true, encrypted: stored.encrypted }
      : { stored: false, encrypted: this.crypto.isEncryptionAvailable() };
  }
}
