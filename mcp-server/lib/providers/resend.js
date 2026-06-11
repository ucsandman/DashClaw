import { httpJson } from "./http.js";
const BASE = "https://api.resend.com";
const USER_AGENT = "@dashclaw/mcp-server";
function headers(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    };
}
function mapDomain(value) {
    return {
        id: value.id,
        name: value.name,
        status: value.status,
        createdAt: value.created_at,
        region: value.region,
        capabilities: value.capabilities,
        records: Array.isArray(value.records)
            ? value.records.map((record) => ({
                record: record.record,
                name: record.name,
                type: record.type,
                value: record.value,
                status: record.status,
                ttl: record.ttl,
                priority: record.priority,
            }))
            : undefined,
    };
}
export async function listDomains(apiKey, limit = 20) {
    const data = await httpJson(`${BASE}/domains`, {
        headers: headers(apiKey),
        query: { limit: String(limit) },
    });
    return (data.data ?? []).map(mapDomain);
}
export async function createDomain(apiKey, name) {
    const data = await httpJson(`${BASE}/domains`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ name }),
    });
    return mapDomain(data);
}
export async function verifyDomain(apiKey, domainId) {
    const data = await httpJson(`${BASE}/domains/${encodeURIComponent(domainId)}/verify`, {
        method: "POST",
        headers: headers(apiKey),
    });
    return { id: data.id, object: data.object };
}
export async function sendEmail(apiKey, params) {
    const data = await httpJson(`${BASE}/emails`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
            from: params.from,
            to: params.to,
            subject: params.subject,
            html: params.html,
            text: params.text,
            cc: params.cc,
            bcc: params.bcc,
            reply_to: params.replyTo,
        }),
    });
    return { id: data.id };
}
//# sourceMappingURL=resend.js.map