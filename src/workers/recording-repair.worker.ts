import { repairRecordingWav } from '../../shared/recording-repair.mjs';
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const result = repairRecordingWav(event.data.buffer);
    self.postMessage({ ok: true, ...result }, { transfer: [result.buffer] });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'ปรับเสียงไม่ได้' }); }
};
