import { describe, expect, it } from 'vitest';
import {
  deserializeExecutionError,
  serializeExecutionError,
} from '../src/libs/error-serialization';

describe('serializeExecutionError', () => {
  it('serializes a plain Error', () => {
    const err = new Error('something failed');
    const result = serializeExecutionError(err);
    expect(result.message).toBe('something failed');
    expect(result.name).toBe('Error');
  });

  it('serializes a named Error subclass', () => {
    const err = new TypeError('bad type');
    const result = serializeExecutionError(err);
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('bad type');
  });

  it('includes code when present', () => {
    const err = Object.assign(new Error('with code'), { code: 'ENOENT' });
    const result = serializeExecutionError(err);
    expect(result.code).toBe('ENOENT');
  });

  it('serializes non-Error values as string message', () => {
    expect(serializeExecutionError('oops').message).toBe('oops');
    expect(serializeExecutionError(42).message).toBe('42');
    expect(serializeExecutionError(null).message).toBe('null');
  });
});

describe('deserializeExecutionError', () => {
  it('returns the Error as-is when given an Error instance', () => {
    const err = new Error('original');
    expect(deserializeExecutionError(err)).toBe(err);
  });

  it('reconstructs an Error from a plain object', () => {
    const payload = { message: 'from payload', name: 'CustomError', code: 'E42' };
    const err = deserializeExecutionError(payload);
    expect(err.message).toBe('from payload');
    expect(err.name).toBe('CustomError');
    expect((err as Error & { code?: string }).code).toBe('E42');
  });

  it('falls back to "Unknown job error" when message is missing', () => {
    const err = deserializeExecutionError({});
    expect(err.message).toBe('Unknown job error');
  });

  it('converts non-object values to an Error', () => {
    const err = deserializeExecutionError('plain string');
    expect(err.message).toBe('plain string');
  });

  it('round-trips through serialize → deserialize', () => {
    const original = Object.assign(new RangeError('out of bounds'), { code: 'OOB' });
    const serialized = serializeExecutionError(original);
    const restored = deserializeExecutionError(serialized);
    expect(restored.message).toBe('out of bounds');
    expect(restored.name).toBe('RangeError');
    expect((restored as Error & { code?: string }).code).toBe('OOB');
  });
});
