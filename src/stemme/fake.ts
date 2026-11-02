// StemmeClient for dev and tests: no network. Speech-to-text is a canned
// question, text-to-speech is a short quiet beep (valid WAV), and there is no
// live conversation.

import { StemmeError } from './types.ts';
import type { StemmeClient } from './types.ts';

const SAMPLE_RATE = 16000;
const SECONDS = 0.5;
const FREQUENCY = 440;
const AMPLITUDE = 3000; // of 32767: audible, not loud

/** A 16-bit mono PCM WAV: 44-byte RIFF header followed by a sine tone. */
function beepWav(): Uint8Array {
  const samples = Math.round(SAMPLE_RATE * SECONDS);
  const dataLen = samples * 2;
  const bytes = new Uint8Array(44 + dataLen);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  tag(36, 'data');
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(AMPLITUDE * Math.sin((2 * Math.PI * FREQUENCY * i) / SAMPLE_RATE)), true);
  }
  return bytes;
}

export function createFakeStemme(): StemmeClient {
  return {
    mode: 'fake',
    async lyt() {
      return 'Hvad venter på mig i dag?';
    },
    async sig() {
      const wav = beepWav();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(wav);
          controller.close();
        },
      });
      return { body, contentType: 'audio/wav' };
    },
    async samtaleToken() {
      throw new StemmeError('Samtale findes ikke i fake-tilstand', 503);
    },
    async ensureAgent(config) {
      return {
        agentId: 'fake-agent',
        toolIds: Object.fromEntries(config.tools.map((t) => [t.name, 'fake-' + t.name])),
      };
    },
    async ensureVoice(voiceId) {
      return voiceId || 'fake-voice';
    },
  };
}
