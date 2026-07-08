export function logEvent(level, event, fields = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields,
    };
    console.error(JSON.stringify(entry));
}
//# sourceMappingURL=logger.js.map