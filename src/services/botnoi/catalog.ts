import { botnoiFetch } from "./client";
import type { AsrProviderItem, TtsProviderItem } from "./types";

/**
 * List speech-to-text (ASR) providers and supported languages
 * GET /info/asr_providers
 */
export async function getAsrProviders(): Promise<AsrProviderItem[]> {
  return botnoiFetch<AsrProviderItem[]>("/info/asr_providers");
}

/**
 * List text-to-speech (TTS) voice providers and speakers
 * GET /info/get_tts_providers
 */
export async function getTtsProviders(): Promise<TtsProviderItem[]> {
  return botnoiFetch<TtsProviderItem[]>("/info/get_tts_providers");
}
