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
export declare function listDomains(apiKey: string, limit?: number): Promise<ResendDomain[]>;
export declare function createDomain(apiKey: string, name: string): Promise<ResendDomain>;
export declare function verifyDomain(apiKey: string, domainId: string): Promise<{
    id: string;
    object?: string;
}>;
export interface ResendEmail {
    id: string;
}
export declare function sendEmail(apiKey: string, params: {
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
}): Promise<ResendEmail>;
