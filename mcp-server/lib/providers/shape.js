import { DashclawError } from "../util.js";
export function objectShape(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new DashclawError(`${label} response must be a JSON object.`);
    }
    return value;
}
export function arrayShape(value, label) {
    if (!Array.isArray(value)) {
        throw new DashclawError(`${label} response must be a JSON array.`);
    }
    return value;
}
export function stringField(value, key, label) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) {
        throw new DashclawError(`${label} response is missing string field ${key}.`);
    }
    return value[key];
}
export function optionalStringField(value, key) {
    return typeof value[key] === "string" ? value[key] : undefined;
}
export function booleanField(value, key, label) {
    if (typeof value[key] !== "boolean") {
        throw new DashclawError(`${label} response is missing boolean field ${key}.`);
    }
    return value[key];
}
//# sourceMappingURL=shape.js.map