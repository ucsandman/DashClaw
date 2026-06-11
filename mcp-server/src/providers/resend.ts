import { httpJson } from "./http.js";

const BASE = "https://api.resend.com";
const USER_AGENT = "@offlocal/mcp";

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

export interface ResendDnsRecord {
  record?: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  ttl?: string | number;
  priority?: number;
}

export interface ResendDomain {
  id: string;
  name: string;
  status?: string;
  createdAt?: string;
  region?: string;
  capabilities?: unknown;
  records?: ResendDnsRecord[];
}

function mapDomain(value: Record<string, any>): ResendDomain {
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    createdAt: value.created_at,
    region: value.region,
    capabilities: value.capabilities,
    records: Array.isArray(value.records)
      ? value.records.map((record: Record<string, any>) => ({
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

export async function listDomains(apiKey: string, limit = 20): Promise<ResendDomain[]> {
  const data = await httpJson<{ data?: Record<string, any>[] }>(`${BASE}/domains`, {
    headers: headers(apiKey),
    query: { limit: String(limit) },
  });
  return (data.data ?? []).map(mapDomain);
}

export async function createDomain(apiKey: string, name: string): Promise<ResendDomain> {
  const data = await httpJson<Record<string, any>>(`${BASE}/domains`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ name }),
  });
  return mapDomain(data);
}

export async function verifyDomain(apiKey: string, domainId: string): Promise<{ id: string; object?: string }> {
  const data = await httpJson<Record<string, any>>(`${BASE}/domains/${encodeURIComponent(domainId)}/verify`, {
    method: "POST",
    headers: headers(apiKey),
  });
  return { id: data.id, object: data.object };
}

export interface ResendEmail {
  id: string;
}

export async function sendEmail(
  apiKey: string,
  params: {
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
  },
): Promise<ResendEmail> {
  const data = await httpJson<Record<string, any>>(`${BASE}/emails`, {
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
