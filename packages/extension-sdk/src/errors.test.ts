import { describe, expect, it } from 'vitest';
import {
  CloudflareError,
  EXTENSION_ERROR_NAMES,
  HttpError,
  NetworkError,
  NotFoundError,
  ParseError,
  RateLimitedError,
  isExtensionErrorName,
} from './errors';

describe('typed errors', () => {
  it('carry their own name, which is what crosses the sandbox', () => {
    const errors = [
      new NetworkError('x'),
      new HttpError(503),
      new CloudflareError('x'),
      new RateLimitedError('x'),
      new NotFoundError('x'),
      new ParseError('x'),
    ];
    expect(errors.map((error) => error.name)).toEqual([...EXTENSION_ERROR_NAMES]);
    for (const error of errors) expect(error).toBeInstanceOf(Error);
  });

  it('HttpError keeps the status and has a default message', () => {
    const error = new HttpError(403);
    expect(error.status).toBe(403);
    expect(error.message).toBe('HTTP 403');
    expect(new HttpError(500, 'boom').message).toBe('boom');
  });

  it('recognizes only the six names', () => {
    expect(isExtensionErrorName('ParseError')).toBe(true);
    expect(isExtensionErrorName('TypeError')).toBe(false);
    expect(isExtensionErrorName(undefined)).toBe(false);
  });
});
