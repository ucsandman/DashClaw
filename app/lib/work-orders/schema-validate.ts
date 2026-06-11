// Minimal JSON-Schema-subset validator for work order contracts.
// Supported keywords: type, required, properties, items, enum, minimum,
// maximum, minLength, maxLength. Unknown keywords are ignored by design.

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

type Schema = Record<string, unknown>;

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, value: unknown): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

export function validateAgainstSchema(schema: Schema, value: unknown, path = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  const at = (suffix: string) => (path ? `${path}${suffix.startsWith('[') ? '' : '.'}${suffix}` : suffix);

  const expected = typeof schema.type === 'string' ? schema.type : null;
  if (expected && !typeMatches(expected, value)) {
    errors.push({ field: path || '(root)', message: `expected ${expected}, got ${typeOf(value)}`, code: 'type' });
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === value)) {
    errors.push({ field: path || '(root)', message: `must be one of: ${schema.enum.join(', ')}`, code: 'enum' });
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ field: path || '(root)', message: `must be at least ${schema.minLength} characters`, code: 'min_length' });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ field: path || '(root)', message: `must be at most ${schema.maxLength} characters`, code: 'max_length' });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ field: path || '(root)', message: `must be >= ${schema.minimum}`, code: 'minimum' });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ field: path || '(root)', message: `must be <= ${schema.maximum}`, code: 'maximum' });
    }
  }

  if (expected === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string' && !(key in obj)) {
        errors.push({ field: at(key), message: 'required field missing', code: 'required' });
      }
    }
    const props = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, Schema>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj && propSchema && typeof propSchema === 'object') {
        errors.push(...validateAgainstSchema(propSchema, obj[key], at(key)));
      }
    }
  }

  if (expected === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(schema.items as Schema, item, `${path}[${i}]`));
    });
  }

  return errors;
}

export function validateSchemaDefinition(schema: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [{ field: '(root)', message: 'schema must be an object', code: 'schema_invalid' }];
  }
  const root = schema as Schema;
  if (root.type !== 'object') {
    errors.push({ field: 'type', message: "root schema type must be 'object'", code: 'schema_root_type' });
  }
  const walk = (node: Schema, path: string) => {
    if (typeof node.type === 'string' && !TYPES.has(node.type)) {
      errors.push({ field: path || 'type', message: `unsupported type '${node.type}'`, code: 'schema_unknown_type' });
    }
    const props = (node.properties && typeof node.properties === 'object' ? node.properties : {}) as Record<string, Schema>;
    for (const [key, child] of Object.entries(props)) {
      if (child && typeof child === 'object') walk(child, path ? `${path}.${key}` : key);
    }
    if (node.items && typeof node.items === 'object') walk(node.items as Schema, `${path}[]`);
  };
  walk(root, '');
  return errors;
}
