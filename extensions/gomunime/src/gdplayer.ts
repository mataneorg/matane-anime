import '@matane-anime/extension-sdk/globals';
import { unpackPacked } from './packed';

// gdplayer.to wraps another host (always mp4upload so far). Its page hides a few `window.X="…"` values in an
// AAEncoded, then packed, script; they are read statically (nothing is ever evaluated). One POST to its API,
// with those values, answers an AES-256-CBC blob (the key comes from PBKDF2-SHA256) holding `query.host/id`.
// The `sources[].file` it also lists is gdplayer's own proxy, which answers 404; it is not used.

/** The password the player script hardcodes (`dcx`), to which the page's `__ts` and `__nc` are appended. */
const PASSWORD = 'V8xK2mP9qR4wT6yA3bN7cJ5dF1gH0eL';
const ITERATIONS = 10_000;

// ---------------------------------------------------------------- AAEncode

const AA_DIGITS: Record<string, string> = {
  '(oﾟｰﾟo)': 'u',
  '(c^_^o)': '0',
  '(ﾟΘﾟ)': '1',
  '((o^_^o)-(ﾟΘﾟ))': '2',
  '(o^_^o)': '3',
  '(ﾟｰﾟ)': '4',
  '((ﾟｰﾟ)+(ﾟΘﾟ))': '5',
  '((o^_^o)+(o^_^o))': '6',
  '((ﾟｰﾟ)+(o^_^o))': '7',
  '((ﾟｰﾟ)+(ﾟｰﾟ))': '8',
  '((ﾟｰﾟ)+(ﾟｰﾟ)+(ﾟΘﾟ))': '9',
  '(ﾟДﾟ).ﾟωﾟﾉ': 'a',
  '(ﾟДﾟ).ﾟΘﾟﾉ': 'b',
  "(ﾟДﾟ)['c']": 'c',
  '(ﾟДﾟ).ﾟｰﾟﾉ': 'd',
  '(ﾟДﾟ).ﾟДﾟﾉ': 'e',
  '(ﾟДﾟ)[ﾟΘﾟ]': 'f',
};
const AA_SEPARATOR = '(ﾟДﾟ)[ﾟεﾟ]+';

/** Decodes an AAEncoded script to its text without running it: each chunk is the char code of one character. */
export function aaDecode(script: string): string {
  const start = script.indexOf(AA_SEPARATOR);
  if (start < 0) return '';
  let out = '';
  for (const chunk of script.slice(start).replace(/ /g, '').split(AA_SEPARATOR).slice(1)) {
    const text = chunk.trim().replace(/\+$/, '').replace(/;$/, '');
    if (!text) continue;
    // Split on the `+` that are outside brackets.
    const tokens: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of text) {
      if (char === '(' || char === '[') depth++;
      if (char === ')' || char === ']') depth--;
      if (char === '+' && depth === 0) {
        tokens.push(current);
        current = '';
      } else current += char;
    }
    tokens.push(current);
    const digits = tokens.map((token) => AA_DIGITS[token] ?? '?').join('');
    const code = digits.startsWith('u') ? parseInt(digits.slice(1), 16) : parseInt(digits, 8);
    if (Number.isFinite(code)) out += String.fromCharCode(code);
  }
  return out;
}

/** The values the API needs, from the embed page; undefined when the page is not a gdplayer page. */
export function readGdplayerVars(page: string): Record<string, string> | undefined {
  const script = /<script type="text\/javascript">(ﾟωﾟ[\s\S]*?)<\/script>/.exec(page)?.[1];
  if (!script) return undefined;
  const decoded = aaDecode(script);
  const code = unpackPacked(decoded) ?? decoded;
  const vars: Record<string, string> = {};
  for (const match of code.matchAll(/window\.(\w+)="([^"]*)"/g)) vars[match[1] as string] = match[2] as string;
  for (const key of ['apx', 'kaken', '__ts', '__nc', '__sg']) if (!vars[key]) return undefined;
  return vars;
}

// ---------------------------------------------------------------- PBKDF2-HMAC-SHA256 (the sandbox only hashes text)

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** One SHA-256 compression: `state` (8 words) is updated with the 16-word `block`. */
function compress(state: Int32Array, block: Int32Array, w: Int32Array): void {
  for (let i = 0; i < 16; i++) w[i] = block[i] as number;
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15] as number;
    const b = w[i - 2] as number;
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
  }
  let a = state[0] as number;
  let b = state[1] as number;
  let c = state[2] as number;
  let d = state[3] as number;
  let e = state[4] as number;
  let f = state[5] as number;
  let g = state[6] as number;
  let h = state[7] as number;
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = ((state[0] as number) + a) | 0;
  state[1] = ((state[1] as number) + b) | 0;
  state[2] = ((state[2] as number) + c) | 0;
  state[3] = ((state[3] as number) + d) | 0;
  state[4] = ((state[4] as number) + e) | 0;
  state[5] = ((state[5] as number) + f) | 0;
  state[6] = ((state[6] as number) + g) | 0;
  state[7] = ((state[7] as number) + h) | 0;
}

const toWords = (bytes: Uint8Array, length: number): Int32Array => {
  const words = new Int32Array(length);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] as number) | ((bytes[i] as number) << (24 - 8 * (i & 3)));
  }
  return words;
};

/** SHA-256 of `message` after one already-compressed 64-byte block (HMAC's ipad/opad), as 8 words. */
function finish(prefix: Int32Array, message: Uint8Array, w: Int32Array, prefixLength = 64): Int32Array {
  const state = prefix.slice();
  const total = prefixLength + message.length;
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const bits = total * 8;
  for (let i = 0; i < 4; i++) padded[padded.length - 1 - i] = (bits >>> (8 * i)) & 0xff;
  const words = toWords(padded, padded.length / 4);
  for (let at = 0; at < words.length; at += 16) compress(state, words.subarray(at, at + 16), w);
  return state;
}

/** PBKDF2-HMAC-SHA256. Yields to the event loop now and then so that the sandbox's 2 s limit is never hit. */
export async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Promise<Uint8Array> {
  const w = new Int32Array(64);
  const key = new Uint8Array(64);
  // A key longer than the block is replaced by its hash (ours is 32 + 10 + 32 bytes).
  key.set(password.length > 64 ? toBytes(finish(Int32Array.from(INITIAL), password, w, 0)) : password);
  const pad = (byte: number): Int32Array => {
    const block = new Uint8Array(64);
    for (let i = 0; i < 64; i++) block[i] = (key[i] as number) ^ byte;
    const state = Int32Array.from(INITIAL);
    compress(state, toWords(block, 16), w);
    return state;
  };
  const inner = pad(0x36);
  const outer = pad(0x5c);

  const out = new Uint8Array(Math.ceil(length / 32) * 32);
  const message = new Uint8Array(32);
  const block1 = new Int32Array(16);
  const block2 = new Int32Array(16);
  const hmacWords = (words: Int32Array, from: Int32Array): Int32Array => {
    // inner hash: 32-byte message + padding, in a single block after the pad block
    block1.fill(0);
    for (let i = 0; i < 8; i++) block1[i] = words[i] as number;
    block1[8] = 0x80000000 | 0;
    block1[15] = (64 + 32) * 8;
    const s1 = from.slice();
    compress(s1, block1, w);
    block2.fill(0);
    for (let i = 0; i < 8; i++) block2[i] = s1[i] as number;
    block2[8] = 0x80000000 | 0;
    block2[15] = (64 + 32) * 8;
    const s2 = outer.slice();
    compress(s2, block2, w);
    return s2;
  };

  for (let index = 1; index <= out.length / 32; index++) {
    const seed = new Uint8Array(salt.length + 4);
    seed.set(salt);
    seed[salt.length + 3] = index;
    // U1 = HMAC(password, salt || INT(index))
    const first = finish(outer, toBytes(finish(inner, seed, w)), w);
    let u: Int32Array = first;
    const acc = first.slice();
    for (let n = 1; n < iterations; n++) {
      u = hmacWords(u, inner);
      for (let i = 0; i < 8; i++) acc[i] = (acc[i] as number) ^ (u[i] as number);
      if (n % 1000 === 0) await timers.sleep(0);
    }
    message.set(toBytes(acc));
    out.set(message, (index - 1) * 32);
  }
  return out.slice(0, length);
}

const toBytes = (words: Int32Array): Uint8Array => {
  const bytes = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as number;
    bytes[i * 4] = (word >>> 24) & 0xff;
    bytes[i * 4 + 1] = (word >>> 16) & 0xff;
    bytes[i * 4 + 2] = (word >>> 8) & 0xff;
    bytes[i * 4 + 3] = word & 0xff;
  }
  return bytes;
};

// ---------------------------------------------------------------- the API

/** Decrypts the API answer: plain JSON when it starts with `{`, else `salt(16) || AES-256-CBC` in base64. */
export async function decryptAnswer(answer: string, ts: string, nc: string): Promise<string> {
  const text = answer.trim();
  if (text.startsWith('{')) return text;
  const raw = base64.decodeBytes(text);
  if (raw.length < 32) throw new Error('The gdplayer answer is too short');
  const derived = await pbkdf2Sha256(utf8.encode(PASSWORD + ts + nc), raw.slice(0, 16), ITERATIONS, 48);
  const plain = crypto.aesDecrypt(raw.slice(16), derived.slice(0, 32), { mode: 'cbc', iv: derived.slice(32, 48) });
  return utf8.decode(plain);
}

export interface GdplayerSource {
  host: string;
  id: string;
}

/** The host and file id behind a gdplayer embed page. Tokens are tied to the page, so nothing is cached. */
export async function resolveGdplayer(embedUrl: string, referer: string, timeoutMs: number): Promise<GdplayerSource> {
  const page = await http.get(embedUrl, { headers: { Referer: referer }, timeoutMs, throwOnError: true });
  const vars = readGdplayerVars(page.text);
  if (!vars) throw new Error('The gdplayer page has no player values');
  const api = base64.decode(vars['apx'] as string).replace('-config', '');
  const response = await http.post(api, vars['kaken'] as string, {
    headers: {
      'content-type': 'text/plain',
      'X-Ts': vars['__ts'] as string,
      'X-Nc': vars['__nc'] as string,
      'X-Sg': vars['__sg'] as string,
      Referer: embedUrl,
    },
    timeoutMs,
    throwOnError: true,
  });
  const json = JSON.parse(await decryptAnswer(response.text, vars['__ts'] as string, vars['__nc'] as string)) as {
    query?: { host?: string; id?: string };
    status?: string;
  };
  const { host, id } = json.query ?? {};
  if (!host || !id || !/^[\w-]+$/.test(id))
    throw new Error(`gdplayer gave no file (${json.status ?? 'unknown status'})`);
  return { host: host.toLowerCase(), id };
}
