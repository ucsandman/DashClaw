export function logEvent(level, event, fields = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields,
    };
    console.error(JSON.stringify(entry));
}
export function startupLoggingEnabled() {
    return process.env.DASHCLAW_LOG_STARTUP === "true";
}
//# sourceMappingURL=logger.js.map