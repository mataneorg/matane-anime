// Dean Edwards' packer, read without running it.

/** Index of the `"` or `'` that closes a JS string starting right after `start`, or -1. */
function closingQuote(source: string, start: number, quote: string): number {
  for (let at = start; at < source.length; at++) {
    const char = source[at];
    if (char === '\\') at++;
    else if (char === quote) return at;
  }
  return -1;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Unpacks Dean Edwards' `eval(function(p,a,c,k,e,d){…}('payload',radix,count,'dict'.split('|')))` without
 * running it: the payload is plain text with words replaced by dictionary entries. Returns null when the
 * page has no such script. Scans by hand instead of with one big regex, because the payload is tens of KB.
 */
export function unpackPacked(source: string): string | null {
  const start = source.indexOf('eval(function(p,a,c,k,e,d)');
  if (start < 0) return null;
  const args = source.indexOf("}('", start);
  if (args < 0) return null;
  const payloadEnd = closingQuote(source, args + 3, "'");
  if (payloadEnd < 0) return null;
  const numbers = /^,(\d+),(\d+),'/.exec(source.slice(payloadEnd + 1, payloadEnd + 40));
  if (!numbers) return null;
  const dictStart = payloadEnd + 1 + numbers[0].length;
  const dictEnd = closingQuote(source, dictStart, "'");
  if (dictEnd < 0 || !source.startsWith(".split('|')", dictEnd + 1)) return null;

  const payload = source
    .slice(args + 3, payloadEnd)
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
  const radix = Number(numbers[1]);
  const count = Number(numbers[2]);
  const dictionary = source.slice(dictStart, dictEnd).split('|');
  if (radix < 2 || radix > DIGITS.length) return null;

  const encode = (n: number): string => (n < radix ? '' : encode(Math.floor(n / radix))) + DIGITS[n % radix];
  const words = new Map<string, string>();
  for (let i = 0; i < count; i++) words.set(encode(i), dictionary[i] || encode(i));
  return payload.replace(/\b\w+\b/g, (word) => words.get(word) ?? word);
}
