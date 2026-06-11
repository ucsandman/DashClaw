import { DashclawError } from "../util.js";
export declare function namecheapBaseUrl(): string;
export declare function mapNamecheapError(number: string, message: string): DashclawError;
export interface DomainCheckResult {
    domain: string;
    available: boolean;
    premium: boolean;
    premiumRegistrationPrice?: string;
    premiumRenewalPrice?: string;
    icannFee?: string;
    eapFee?: string;
    description?: string;
}
export declare function checkDomains(apiKey: string, domains: string[]): Promise<DomainCheckResult[]>;
export interface NamecheapDomain {
    id: string;
    name: string;
    created?: string;
    expires?: string;
    isExpired: boolean;
    isLocked: boolean;
    autoRenew: boolean;
    whoisGuard?: string;
    isPremium: boolean;
}
export declare function listDomains(apiKey: string, params?: {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
}): Promise<NamecheapDomain[]>;
export interface RegistrantContact {
    firstName: string;
    lastName: string;
    address1: string;
    address2?: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
    /** Format +NNN.NNNNNNNNNN, e.g. +1.5551234567. */
    phone: string;
    emailAddress: string;
    organization?: string;
}
export interface DomainCreateResult {
    domain: string;
    registered: boolean;
    chargedAmount?: string;
    domainId?: string;
    orderId?: string;
    transactionId?: string;
}
export declare function createDomain(apiKey: string, params: {
    domain: string;
    years?: number;
    registrant: RegistrantContact;
}): Promise<DomainCreateResult>;
export interface DnsHostRecord {
    hostId?: string;
    name: string;
    type: string;
    address: string;
    mxPref?: number;
    ttl?: number;
}
export declare function getDnsHosts(apiKey: string, domain: string): Promise<{
    domain: string;
    isUsingOurDNS: boolean;
    emailType?: string;
    records: DnsHostRecord[];
}>;
export interface DnsRecordInput {
    name: string;
    type: string;
    address: string;
    ttl?: number;
    mxPref?: number;
}
/**
 * WARNING: namecheap.domains.dns.setHosts REPLACES ALL host records for the domain.
 * It also resets the domain's email service unless EmailType is re-sent — pass the
 * value from getDnsHosts to preserve e.g. email forwarding (FWD).
 */
export declare function setDnsHosts(apiKey: string, domain: string, records: DnsRecordInput[], emailType?: string): Promise<{
    domain: string;
    isSuccess: boolean;
}>;
