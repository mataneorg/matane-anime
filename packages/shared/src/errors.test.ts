import { describe, expect, it } from 'vitest';
import { AppError, decodeIpcError, encodeIpcError } from './errors';

describe('IPC errors', () => {
  it('survives the trip through the message of an Error', () => {
    const wire = encodeIpcError(new AppError('not_found', 'Unknown spike fixture: nope'));
    const decoded = decodeIpcError(wire);
    expect(decoded).toBeInstanceOf(AppError);
    expect(decoded.code).toBe('not_found');
    expect(decoded.message).toBe('Unknown spike fixture: nope');
  });

  it('carries the detail the UI acts on', () => {
    const wire = encodeIpcError(new AppError('extension', 'challenge', { kind: 'CloudflareError', status: 503 }));
    const decoded = decodeIpcError(wire);
    expect([decoded.code, decoded.detail]).toEqual(['extension', { kind: 'CloudflareError', status: 503 }]);
    expect(decodeIpcError(encodeIpcError(new AppError('offline', 'x'))).detail).toEqual({});
  });

  it('treats an ordinary error as internal', () => {
    const decoded = decodeIpcError(encodeIpcError(new Error('boom')));
    expect(decoded.code).toBe('internal');
    expect(decoded.message).toBe('boom');
  });

  it('decodes an error that Electron wrapped in its own prefix', () => {
    const wire = encodeIpcError(new AppError('disabled', 'off'));
    const wrapped = new Error(`Error invoking remote method 'spike.start': ${wire.message}`);
    expect(decodeIpcError(wrapped).code).toBe('disabled');
  });

  it('falls back to internal for garbage and unknown codes', () => {
    expect(decodeIpcError('plain text').code).toBe('internal');
    expect(decodeIpcError(new Error('@@appError:{not json')).code).toBe('internal');
    expect(decodeIpcError(new Error('@@appError:{"code":"weird","message":"x"}')).code).toBe('internal');
  });
});
