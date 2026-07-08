export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  console.error(JSON.stringify(entry));
}
