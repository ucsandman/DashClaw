export interface TwilioPhoneNumber {
    sid: string;
    phoneNumber: string;
    friendlyName?: string;
    smsUrl?: string;
    voiceUrl?: string;
    capabilities?: Record<string, boolean>;
}
export declare function listPhoneNumbers(accountSid: string, authToken: string, limit?: number): Promise<TwilioPhoneNumber[]>;
export declare function updatePhoneNumberWebhooks(accountSid: string, authToken: string, phoneNumberSid: string, params: {
    smsUrl?: string;
    voiceUrl?: string;
}): Promise<TwilioPhoneNumber>;
export interface TwilioMessage {
    sid: string;
    status?: string;
    to?: string;
    from?: string;
}
export declare function sendSms(accountSid: string, authToken: string, params: {
    to: string;
    body: string;
    from?: string;
    messagingServiceSid?: string;
    statusCallback?: string;
}): Promise<TwilioMessage>;
export interface TwilioCall {
    sid: string;
    status?: string;
    to?: string;
    from?: string;
}
export declare function createCall(accountSid: string, authToken: string, params: {
    to: string;
    from: string;
    url: string;
    statusCallback?: string;
}): Promise<TwilioCall>;
