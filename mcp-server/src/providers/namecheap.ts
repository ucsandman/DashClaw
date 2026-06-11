import { XMLParser } from "fast-xml-parser";
import { httpJson } from "./http.js";
import { OfflocalError } from "../util.js";

/**
 * Namecheap API adapter. XML-over-GET; every call carries the global params
 * ApiUser, ApiKey, UserName, ClientIp, Command.
 *
 * Hosts: api.namecheap.com (production) / api.sandbox.namecheap.com (sandbox),
 * switched by NAMECHEAP_SANDBOX=true. The ApiKey travels as a query param, so
 * all thrown errors go through providers/http.ts, which redacts key-like query
 * params from URLs in error messages.
 */
const PROD_BASE = "https://api.namecheap.com/xml.response";
const SANDBOX_BASE = "https://api.sandbox.namecheap.com/xml.response";

export function namecheapBaseUrl(): string {
  return (process.env.NAMECHEAP_SANDBOX ?? "").trim().toLowerCase() === "true" ? SANDBOX_BASE : PROD_BASE;
}

function globalParams(apiKey: string): Record<string, string> {
  const apiUser = process.env.NAMECHEAP_API_USER?.trim();
  if (!apiUser) {
    throw new OfflocalError(
      "NAMECHEAP_API_USER is not set. Set it to your Namecheap account username (it is also sent as UserName).",
    );
  }
  const clientIp = process.env.NAMECHEAP_CLIENT_IP?.trim();
  if (!clientIp) {
    throw new OfflocalError(
      "NAMECHEAP_CLIENT_IP is not set. Namecheap requires the caller's CURRENT public IP " +
        "(find it with `curl ifconfig.me`) and the same IP must be whitelisted in " +
        "Namecheap → Profile → Tools → API Access.",
    );
  }
  return { ApiUser: apiUser, ApiKey: apiKey, UserName: apiUser, ClientIp: clientIp };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function bool(value: unknown): boolean {
  return String(value).trim().toLowerCase() === "true";
}

export function mapNamecheapError(number: string, message: string): OfflocalError {
  if (number === "1011102") {
    return new OfflocalError(
      "Namecheap error 1011102: the API rejected this request — usually because the caller's IP " +
        "is not whitelisted. Re-whitelist your CURRENT public IP (find it with `curl ifconfig.me`) " +
        "in Namecheap → Profile → Tools → API Access, set NAMECHEAP_CLIENT_IP to the same value, and retry. " +
        `(${message})`,
    );
  }
  return new OfflocalError(`Namecheap error ${number}: ${message}`);
}

async function apiCall(
  apiKey: string,
  command: string,
  params: Record<string, string | undefined>,
): Promise<any> {
  const text = await httpJson<string>(namecheapBaseUrl(), {
    query: { ...globalParams(apiKey), Command: command, ...params },
  });
  let parsed: any;
  try {
    parsed = parser.parse(String(text));
  } catch {
    throw new OfflocalError(`Unexpected non-XML response from Namecheap (${command}).`);
  }
  const api = parsed?.ApiResponse;
  if (!api) {
    throw new OfflocalError(`Unexpected Namecheap response shape (${command}): missing ApiResponse.`);
  }
  if (String(api["@_Status"]).toUpperCase() !== "OK") {
    const first = toArray<any>(api.Errors?.Error)[0];
    const number = String(first?.["@_Number"] ?? "unknown");
    const message = String(first?.["#text"] ?? first ?? "Unknown Namecheap error");
    throw mapNamecheapError(number, message);
  }
  return api.CommandResponse;
}

/** Split "example.com" / "example.co.uk" into SLD + TLD (first label vs rest). */
function splitDomain(domain: string): { sld: string; tld: string } {
  const trimmed = domain.trim().toLowerCase();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    throw new OfflocalError(`Invalid domain "${domain}"; expected something like example.com.`);
  }
  return { sld: trimmed.slice(0, dot), tld: trimmed.slice(dot + 1) };
}

// --- domains.check -----------------------------------------------------------

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

export async function checkDomains(apiKey: string, domains: string[]): Promise<DomainCheckResult[]> {
  const cr = await apiCall(apiKey, "namecheap.domains.check", { DomainList: domains.join(",") });
  return toArray<any>(cr?.DomainCheckResult).map((r) => ({
    domain: String(r["@_Domain"]),
    available: bool(r["@_Available"]),
    premium: bool(r["@_IsPremiumName"]),
    premiumRegistrationPrice: r["@_PremiumRegistrationPrice"],
    premiumRenewalPrice: r["@_PremiumRenewalPrice"],
    icannFee: r["@_IcannFee"],
    eapFee: r["@_EapFee"],
    description: r["@_Description"] ? String(r["@_Description"]) : undefined,
  }));
}

// --- domains.getList ---------------------------------------------------------

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

export async function listDomains(
  apiKey: string,
  params: { page?: number; pageSize?: number; searchTerm?: string } = {},
): Promise<NamecheapDomain[]> {
  const cr = await apiCall(apiKey, "namecheap.domains.getList", {
    Page: params.page === undefined ? undefined : String(params.page),
    PageSize: params.pageSize === undefined ? undefined : String(params.pageSize),
    SearchTerm: params.searchTerm,
  });
  return toArray<any>(cr?.DomainGetListResult?.Domain).map((d) => ({
    id: String(d["@_ID"]),
    name: String(d["@_Name"]),
    created: d["@_Created"],
    expires: d["@_Expires"],
    isExpired: bool(d["@_IsExpired"]),
    isLocked: bool(d["@_IsLocked"]),
    autoRenew: bool(d["@_AutoRenew"]),
    whoisGuard: d["@_WhoisGuard"],
    isPremium: bool(d["@_IsPremium"]),
  }));
}

// --- domains.create (purchase) ------------------------------------------------

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

/** Namecheap requires the same contact fields for all four roles. */
function contactParams(contact: RegistrantContact): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    params[`${role}FirstName`] = contact.firstName;
    params[`${role}LastName`] = contact.lastName;
    params[`${role}Address1`] = contact.address1;
    params[`${role}Address2`] = contact.address2;
    params[`${role}City`] = contact.city;
    params[`${role}StateProvince`] = contact.stateProvince;
    params[`${role}PostalCode`] = contact.postalCode;
    params[`${role}Country`] = contact.country;
    params[`${role}Phone`] = contact.phone;
    params[`${role}EmailAddress`] = contact.emailAddress;
    params[`${role}OrganizationName`] = contact.organization;
  }
  return params;
}

export async function createDomain(
  apiKey: string,
  params: { domain: string; years?: number; registrant: RegistrantContact },
): Promise<DomainCreateResult> {
  const cr = await apiCall(apiKey, "namecheap.domains.create", {
    DomainName: params.domain,
    Years: String(params.years ?? 1),
    ...contactParams(params.registrant),
  });
  const r = cr?.DomainCreateResult ?? {};
  return {
    domain: String(r["@_Domain"] ?? params.domain),
    registered: bool(r["@_Registered"]),
    chargedAmount: r["@_ChargedAmount"],
    domainId: r["@_DomainID"],
    orderId: r["@_OrderID"],
    transactionId: r["@_TransactionID"],
  };
}

// --- domains.dns.getHosts / setHosts -------------------------------------------

export interface DnsHostRecord {
  hostId?: string;
  name: string;
  type: string;
  address: string;
  mxPref?: number;
  ttl?: number;
}

export async function getDnsHosts(
  apiKey: string,
  domain: string,
): Promise<{ domain: string; isUsingOurDNS: boolean; records: DnsHostRecord[] }> {
  const { sld, tld } = splitDomain(domain);
  const cr = await apiCall(apiKey, "namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });
  const r = cr?.DomainDNSGetHostsResult ?? {};
  return {
    domain: String(r["@_Domain"] ?? domain),
    isUsingOurDNS: bool(r["@_IsUsingOurDNS"]),
    records: toArray<any>(r.Host).map((h) => ({
      hostId: h["@_HostId"] === undefined ? undefined : String(h["@_HostId"]),
      name: String(h["@_Name"]),
      type: String(h["@_Type"]),
      address: String(h["@_Address"]),
      mxPref: h["@_MXPref"] === undefined ? undefined : Number(h["@_MXPref"]),
      ttl: h["@_TTL"] === undefined ? undefined : Number(h["@_TTL"]),
    })),
  };
}

export interface DnsRecordInput {
  name: string;
  type: string;
  address: string;
  ttl?: number;
  mxPref?: number;
}

/** WARNING: namecheap.domains.dns.setHosts REPLACES ALL host records for the domain. */
export async function setDnsHosts(
  apiKey: string,
  domain: string,
  records: DnsRecordInput[],
): Promise<{ domain: string; isSuccess: boolean }> {
  const { sld, tld } = splitDomain(domain);
  const params: Record<string, string | undefined> = { SLD: sld, TLD: tld };
  records.forEach((record, index) => {
    const n = index + 1;
    params[`HostName${n}`] = record.name;
    params[`RecordType${n}`] = record.type;
    params[`Address${n}`] = record.address;
    if (record.ttl !== undefined) params[`TTL${n}`] = String(record.ttl);
    if (record.mxPref !== undefined) params[`MXPref${n}`] = String(record.mxPref);
  });
  const cr = await apiCall(apiKey, "namecheap.domains.dns.setHosts", params);
  const r = cr?.DomainDNSSetHostsResult ?? {};
  return {
    domain: String(r["@_Domain"] ?? domain),
    isSuccess: bool(r["@_IsSuccess"]),
  };
}
