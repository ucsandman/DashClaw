import { formEncode, httpJson } from "./http.js";
const BASE = "https://api.twilio.com/2010-04-01";
function headers(accountSid, authToken) {
    return {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
    };
}
function accountPath(accountSid, path) {
    return `${BASE}/Accounts/${encodeURIComponent(accountSid)}${path}`;
}
function mapPhoneNumber(value) {
    return {
        sid: value.sid,
        phoneNumber: value.phone_number,
        friendlyName: value.friendly_name,
        smsUrl: value.sms_url,
        voiceUrl: value.voice_url,
        capabilities: value.capabilities,
    };
}
export async function listPhoneNumbers(accountSid, authToken, limit = 20) {
    const data = await httpJson(accountPath(accountSid, "/IncomingPhoneNumbers.json"), {
        headers: headers(accountSid, authToken),
        query: { PageSize: String(limit) },
    });
    return (data.incoming_phone_numbers ?? []).map(mapPhoneNumber);
}
export async function updatePhoneNumberWebhooks(accountSid, authToken, phoneNumberSid, params) {
    const body = {
        SmsUrl: params.smsUrl,
        VoiceUrl: params.voiceUrl,
    };
    const data = await httpJson(accountPath(accountSid, `/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`), {
        method: "POST",
        headers: headers(accountSid, authToken),
        body: formEncode(body),
    });
    return mapPhoneNumber(data);
}
export async function sendSms(accountSid, authToken, params) {
    const data = await httpJson(accountPath(accountSid, "/Messages.json"), {
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
export async function createCall(accountSid, authToken, params) {
    const data = await httpJson(accountPath(accountSid, "/Calls.json"), {
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
//# sourceMappingURL=twilio.js.map