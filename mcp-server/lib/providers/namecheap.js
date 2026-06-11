import { XMLParser } from "fast-xml-parser";
import { httpJson } from "./http.js";
import { DashclawError } from "../util.js";
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
export function namecheapBaseUrl() {
    return (process.env.NAMECHEAP_SANDBOX ?? "").trim().toLowerCase() === "true" ? SANDBOX_BASE : PROD_BASE;
}
function globalParams(apiKey) {
    const apiUser = process.env.NAMECHEAP_API_USER?.trim();
    if (!apiUser) {
        throw new DashclawError("NAMECHEAP_API_USER is not set. Set it to your Namecheap account username (it is also sent as UserName).");
    }
    const clientIp = process.env.NAMECHEAP_CLIENT_IP?.trim();
    if (!clientIp) {
        throw new DashclawError("NAMECHEAP_CLIENT_IP is not set. Namecheap requires the caller's CURRENT public IP " +
            "(find it with `curl ifconfig.me`) and the same IP must be whitelisted in " +
            "Namecheap → Profile → Tools → API Access.");
    }
    return { ApiUser: apiUser, ApiKey: apiKey, UserName: apiUser, ClientIp: clientIp };
}
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
});
function toArray(value) {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function bool(value) {
    return String(value).trim().toLowerCase() === "true";
}
export function mapNamecheapError(number, message) {
    if (number === "1011102") {
        return new DashclawError("Namecheap error 1011102: the API rejected this request — usually because the caller's IP " +
            "is not whitelisted. Re-whitelist your CURRENT public IP (find it with `curl ifconfig.me`) " +
            "in Namecheap → Profile → Tools → API Access, set NAMECHEAP_CLIENT_IP to the same value, and retry. " +
            `(${message})`);
    }
    return new DashclawError(`Namecheap error ${number}: ${message}`);
}
async function apiCall(apiKey, command, params) {
    const text = await httpJson(namecheapBaseUrl(), {
        query: { ...globalParams(apiKey), Command: command, ...params },
    });
    let parsed;
    try {
        parsed = parser.parse(String(text));
    }
    catch {
        throw new DashclawError(`Unexpected non-XML response from Namecheap (${command}).`);
    }
    const api = parsed?.ApiResponse;
    if (!api) {
        throw new DashclawError(`Unexpected Namecheap response shape (${command}): missing ApiResponse.`);
    }
    if (String(api["@_Status"]).toUpperCase() !== "OK") {
        const first = toArray(api.Errors?.Error)[0];
        const number = String(first?.["@_Number"] ?? "unknown");
        const message = String(first?.["#text"] ?? first ?? "Unknown Namecheap error");
        throw mapNamecheapError(number, message);
    }
    return api.CommandResponse;
}
/** Split "example.com" / "example.co.uk" into SLD + TLD (first label vs rest). */
function splitDomain(domain) {
    const trimmed = domain.trim().toLowerCase();
    const dot = trimmed.indexOf(".");
    if (dot <= 0 || dot === trimmed.length - 1) {
        throw new DashclawError(`Invalid domain "${domain}"; expected something like example.com.`);
    }
    return { sld: trimmed.slice(0, dot), tld: trimmed.slice(dot + 1) };
}
export async function checkDomains(apiKey, domains) {
    const cr = await apiCall(apiKey, "namecheap.domains.check", { DomainList: domains.join(",") });
    return toArray(cr?.DomainCheckResult).map((r) => ({
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
export async function listDomains(apiKey, params = {}) {
    const cr = await apiCall(apiKey, "namecheap.domains.getList", {
        Page: params.page === undefined ? undefined : String(params.page),
        PageSize: params.pageSize === undefined ? undefined : String(params.pageSize),
        SearchTerm: params.searchTerm,
    });
    return toArray(cr?.DomainGetListResult?.Domain).map((d) => ({
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
/** Namecheap requires the same contact fields for all four roles. */
function contactParams(contact) {
    const params = {};
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
export async function createDomain(apiKey, params) {
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
export async function getDnsHosts(apiKey, domain) {
    const { sld, tld } = splitDomain(domain);
    const cr = await apiCall(apiKey, "namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });
    const r = cr?.DomainDNSGetHostsResult ?? {};
    return {
        domain: String(r["@_Domain"] ?? domain),
        isUsingOurDNS: bool(r["@_IsUsingOurDNS"]),
        emailType: r["@_EmailType"] === undefined ? undefined : String(r["@_EmailType"]),
        // The live API returns lowercase <host> elements; docs and some fixtures use <Host>.
        records: toArray(r.host ?? r.Host).map((h) => ({
            hostId: h["@_HostId"] === undefined ? undefined : String(h["@_HostId"]),
            name: String(h["@_Name"]),
            type: String(h["@_Type"]),
            address: String(h["@_Address"]),
            mxPref: h["@_MXPref"] === undefined ? undefined : Number(h["@_MXPref"]),
            ttl: h["@_TTL"] === undefined ? undefined : Number(h["@_TTL"]),
        })),
    };
}
/**
 * WARNING: namecheap.domains.dns.setHosts REPLACES ALL host records for the domain.
 * It also resets the domain's email service unless EmailType is re-sent — pass the
 * value from getDnsHosts to preserve e.g. email forwarding (FWD).
 */
export async function setDnsHosts(apiKey, domain, records, emailType) {
    const { sld, tld } = splitDomain(domain);
    const params = { SLD: sld, TLD: tld };
    if (emailType)
        params.EmailType = emailType;
    records.forEach((record, index) => {
        const n = index + 1;
        params[`HostName${n}`] = record.name;
        params[`RecordType${n}`] = record.type;
        params[`Address${n}`] = record.address;
        if (record.ttl !== undefined)
            params[`TTL${n}`] = String(record.ttl);
        if (record.mxPref !== undefined)
            params[`MXPref${n}`] = String(record.mxPref);
    });
    const cr = await apiCall(apiKey, "namecheap.domains.dns.setHosts", params);
    const r = cr?.DomainDNSSetHostsResult ?? {};
    return {
        domain: String(r["@_Domain"] ?? domain),
        isSuccess: bool(r["@_IsSuccess"]),
    };
}
//# sourceMappingURL=namecheap.js.map