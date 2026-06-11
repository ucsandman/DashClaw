import { describe, it, expect } from 'vitest';
import { validateAgainstSchema, validateSchemaDefinition } from '@/lib/work-orders/schema-validate';

const SCHEMA = {
  type: 'object',
  required: ['topic'],
  properties: {
    topic: { type: 'string', minLength: 3 },
    depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
    max_sources: { type: 'integer', minimum: 1, maximum: 50 },
    constraints: { type: 'array', items: { type: 'string' } },
  },
};

describe('validateAgainstSchema', () => {
  it('passes a valid payload', () => {
    expect(validateAgainstSchema(SCHEMA, { topic: 'agent payments', depth: 'quick' })).toEqual([]);
  });
  it('reports missing required field with path', () => {
    const errors = validateAgainstSchema(SCHEMA, {});
    expect(errors).toEqual([{ field: 'topic', message: 'required field missing', code: 'required' }]);
  });
  it('reports type, enum, and bounds violations with field paths', () => {
    const errors = validateAgainstSchema(SCHEMA, { topic: 'ok', depth: 'wild', max_sources: 99, constraints: [7] });
    const fields = errors.map((e) => e.field);
    expect(fields).toContain('depth');
    expect(fields).toContain('max_sources');
    expect(fields).toContain('constraints[0]');
  });
  it('reports minLength', () => {
    expect(validateAgainstSchema(SCHEMA, { topic: 'ab' })[0]!.code).toBe('min_length');
  });
});

describe('validateSchemaDefinition', () => {
  it('accepts an object schema', () => {
    expect(validateSchemaDefinition(SCHEMA)).toEqual([]);
  });
  it('rejects non-object roots and unknown types', () => {
    expect(validateSchemaDefinition({ type: 'string' }).length).toBeGreaterThan(0);
    expect(validateSchemaDefinition({ type: 'object', properties: { a: { type: 'wat' } } }).length).toBeGreaterThan(0);
  });
});
