/**
 * Provider Factory
 *
 * Creates and configures providers based on environment variables.
 * Supports Telnyx or Twilio for phone, OpenAI for TTS and Realtime STT.
 */

import type { PhoneProvider, TTSProvider, RealtimeSTTProvider, ProviderRegistry } from './types.js';
import type { MessagingProvider } from './messaging-types.js';
import { TelnyxPhoneProvider } from './phone-telnyx.js';
import { TwilioPhoneProvider } from './phone-twilio.js';
import { OpenAITTSProvider } from './tts-openai.js';
import { OpenAIRealtimeSTTProvider } from './stt-openai-realtime.js';
import { TwilioConversationsProvider } from './messaging-twilio-conversations.js';

export * from './types.js';
export * from './messaging-types.js';

export type PhoneProviderType = 'telnyx' | 'twilio';

export interface ProviderConfig {
  // Phone provider selection
  phoneProvider: PhoneProviderType;

  // Phone credentials (interpretation depends on provider)
  // Telnyx: accountSid = Connection ID, authToken = API Key
  // Twilio: accountSid = Account SID, authToken = Auth Token
  phoneAccountSid: string;
  phoneAuthToken: string;
  phoneNumber: string;

  // Telnyx webhook public key (for signature verification)
  // Get from: Mission Control > Account Settings > Keys & Credentials > Public Key
  telnyxPublicKey?: string;

  // OpenAI (TTS + STT)
  openaiApiKey: string;
  ttsVoice?: string;
  sttModel?: string;
  sttSilenceDurationMs?: number;

  // WhatsApp messaging
  whatsappEnabled?: boolean;
  whatsappMode?: 'sandbox' | 'production';
  whatsappPhoneNumber?: string;
  whatsappSandboxCode?: string;
}

export function loadProviderConfig(): ProviderConfig {
  const sttSilenceDurationMs = process.env.CALLME_STT_SILENCE_DURATION_MS
    ? parseInt(process.env.CALLME_STT_SILENCE_DURATION_MS, 10)
    : undefined;

  // Default to telnyx if not specified
  const phoneProvider = (process.env.CALLME_PHONE_PROVIDER || 'telnyx') as PhoneProviderType;

  return {
    phoneProvider,
    phoneAccountSid: process.env.CALLME_PHONE_ACCOUNT_SID || '',
    phoneAuthToken: process.env.CALLME_PHONE_AUTH_TOKEN || '',
    phoneNumber: process.env.CALLME_PHONE_NUMBER || '',
    telnyxPublicKey: process.env.CALLME_TELNYX_PUBLIC_KEY,
    openaiApiKey: process.env.CALLME_OPENAI_API_KEY || '',
    ttsVoice: process.env.CALLME_TTS_VOICE || 'ballad',
    sttModel: process.env.CALLME_STT_MODEL || 'gpt-4o-transcribe',
    sttSilenceDurationMs,
    whatsappEnabled: process.env.CALLME_WHATSAPP_ENABLED === 'true',
    whatsappMode: (process.env.CALLME_WHATSAPP_MODE as 'sandbox' | 'production') || 'sandbox',
    whatsappPhoneNumber: process.env.CALLME_WHATSAPP_PHONE_NUMBER,
    whatsappSandboxCode: process.env.CALLME_WHATSAPP_SANDBOX_CODE,
  };
}

export function createPhoneProvider(config: ProviderConfig): PhoneProvider {
  let provider: PhoneProvider;

  if (config.phoneProvider === 'twilio') {
    provider = new TwilioPhoneProvider();
  } else {
    provider = new TelnyxPhoneProvider();
  }

  provider.initialize({
    accountSid: config.phoneAccountSid,
    authToken: config.phoneAuthToken,
    phoneNumber: config.phoneNumber,
  });

  return provider;
}

export function createTTSProvider(config: ProviderConfig): TTSProvider {
  const provider = new OpenAITTSProvider();
  provider.initialize({
    apiKey: config.openaiApiKey,
    voice: config.ttsVoice,
  });
  return provider;
}

export function createSTTProvider(config: ProviderConfig): RealtimeSTTProvider {
  const provider = new OpenAIRealtimeSTTProvider();
  provider.initialize({
    apiKey: config.openaiApiKey,
    model: config.sttModel,
    silenceDurationMs: config.sttSilenceDurationMs,
  });
  return provider;
}

export function createMessagingProvider(config: ProviderConfig): MessagingProvider | null {
  if (!config.whatsappEnabled) {
    return null;
  }

  if (!config.whatsappPhoneNumber) {
    console.warn('[Messaging] WhatsApp enabled but CALLME_WHATSAPP_PHONE_NUMBER not set');
    return null;
  }

  const provider = new TwilioConversationsProvider();
  provider.initialize({
    accountSid: config.phoneAccountSid,
    authToken: config.phoneAuthToken,
    whatsappPhoneNumber: config.whatsappPhoneNumber,
    whatsappMode: config.whatsappMode || 'sandbox',
    whatsappSandboxCode: config.whatsappSandboxCode,
  });

  return provider;
}

export function createProviders(config: ProviderConfig): ProviderRegistry {
  return {
    phone: createPhoneProvider(config),
    tts: createTTSProvider(config),
    stt: createSTTProvider(config),
  };
}

/**
 * Validate that required config is present
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  // Provider-specific credential descriptions
  const credentialDesc = config.phoneProvider === 'twilio'
    ? { accountSid: 'Twilio Account SID', authToken: 'Twilio Auth Token' }
    : { accountSid: 'Telnyx Connection ID', authToken: 'Telnyx API Key' };

  if (!config.phoneAccountSid) {
    errors.push(`Missing CALLME_PHONE_ACCOUNT_SID (${credentialDesc.accountSid})`);
  }
  if (!config.phoneAuthToken) {
    errors.push(`Missing CALLME_PHONE_AUTH_TOKEN (${credentialDesc.authToken})`);
  }
  if (!config.phoneNumber) {
    errors.push('Missing CALLME_PHONE_NUMBER');
  }
  if (!config.openaiApiKey) {
    errors.push('Missing CALLME_OPENAI_API_KEY');
  }

  // Require Telnyx public key for webhook signature verification
  if (config.phoneProvider === 'telnyx' && !config.telnyxPublicKey) {
    errors.push('Missing CALLME_TELNYX_PUBLIC_KEY (required for webhook signature verification)');
  }

  return errors;
}
