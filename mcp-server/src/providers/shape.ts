import { DashclawError } from "../util.js";

export function objectShape(value: unknown, label: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DashclawError(`${label} response must be a JSON object.`);
  }
  return value as Record<string, any>;
}

export function arrayShape(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) {
    throw new DashclawError(`${label} response must be a JSON array.`);
  }
  return value;
}

export function stringField(value: Record<string, any>, key: string, label: string): string {
  if (typeof value[key] !== "string" || value[key].trim().length === 0) {
    throw new DashclawError(`${label} response is missing string field ${key}.`);
  }
  return value[key];
}

export function optionalStringField(value: Record<string, any>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

export function booleanField(value: Record<string, any>, key: string, label: string): boolean {
  if (typeof value[key] !== "boolean") {
    throw new DashclawError(`${label} response is missing boolean field ${key}.`);
  }
  return value[key];
}

export function numberField(value: Record<string, any>, key: string, label: string): number {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    throw new DashclawError(`${label} response is missing number field ${key}.`);
  }
  return value[key];
}
