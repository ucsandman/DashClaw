import { formEncode, httpJson } from "./http.js";

const BASE = "https://api.twilio.com/2010-04-01";

function headers(accountSid: string, authToken: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function accountPath(accountSid: string, path: string): string {
  return `${BASE}/Accounts/${encodeURIComponent(accountSid)}${path}`;
}

export interface TwilioPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName?: string;
  smsUrl?: string;
  voiceUrl?: string;
  capabilities?: Record<string, boolean>;
}

function mapPhoneNumber(value: Record<string, any>): TwilioPhoneNumber {
  return {
    sid: value.sid,
    phoneNumber: value.phone_number,
    friendlyName: value.friendly_name,
    smsUrl: value.sms_url,
    voiceUrl: value.voice_url,
    capabilities: value.capabilities,
  };
}

export async function listPhoneNumbers(
  accountSid: string,
  authToken: string,
  limit = 20,
): Promise<TwilioPhoneNumber[]> {
  const data = await httpJson<{ incoming_phone_numbers?: Record<string, any>[] }>(
    accountPath(accountSid, "/IncomingPhoneNumbers.json"),
    {
      headers: headers(accountSid, authToken),
      query: { PageSize: String(limit) },
    },
  );
  return (data.incoming_phone_numbers ?? []).map(mapPhoneNumber);
}

export async function updatePhoneNumberWebhooks(
  accountSid: string,
  authToken: string,
  phoneNumberSid: string,
  params: { smsUrl?: string; voiceUrl?: string },
): Promise<TwilioPhoneNumber> {
  const body: Record<string, string | undefined> = {
    SmsUrl: params.smsUrl,
    VoiceUrl: params.voiceUrl,
  };
  const data = await httpJson<Record<string, any>>(
    accountPath(accountSid, `/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`),
    {
      method: "POST",
      headers: headers(accountSid, authToken),
      body: formEncode(body),
    },
  );
  return mapPhoneNumber(data);
}

export interface TwilioMessage {
  sid: string;
  status?: string;
  to?: string;
  from?: string;
}

export async function sendSms(
  accountSid: string,
  authToken: string,
  params: {
    to: string;
    body: string;
    from?: string;
    messagingServiceSid?: string;
    statusCallback?: string;
  },
): Promise<TwilioMessage> {
  const data = await httpJson<Record<string, any>>(accountPath(accountSid, "/Messages.json"), {
    method: "POST",
    headers: headers(accountSid, authToken),
    body: formEncode({
      To: params.to,
      Body: params.body,
      From: params.from,
      MessagingServiceSid: params.messagingServiceSid,
      StatusCallback: params.statusCallback,
    }),
  });
  return { sid: data.sid, status: data.status, to: data.to, from: data.from };
}

export interface TwilioCall {
  sid: string;
  status?: string;
  to?: string;
  from?: string;
}

export async function createCall(
  accountSid: string,
  authToken: string,
  params: { to: string; from: string; url: string; statusCallback?: string },
): Promise<TwilioCall> {
  const data = await httpJson<Record<string, any>>(accountPath(accountSid, "/Calls.json"), {
    method: "POST",
    headers: headers(accountSid, authToken),
    body: formEncode({
      To: params.to,
      From: params.from,
      Url: params.url,
      StatusCallback: params.statusCallback,
    }),
  });
  return { sid: data.sid, status: data.status, to: data.to, from: data.from };
}
