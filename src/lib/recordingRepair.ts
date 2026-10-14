import type { RecordingRepair } from '../../shared/recording-repair.mjs';

export async function repairRecording(blob: Blob, signal: AbortSignal): Promise<RecordingRepair> {
  if (blob.size > 16 * 1024 * 1024) throw Error('รองรับการปรับเสียงของไฟล์ขนาดไม่เกิน 16 MB');
  const buffer = await blob.arrayBuffer();
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('../workers/recording-repair.worker.ts',import.meta.url),{type:'module'});
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort',abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled','AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(Error('ปรับเสียงใช้เวลานานเกินไป ลองเลือกไฟล์ที่สั้นลง')); },20000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onerror = () => { cleanup(); reject(Error('ปรับเสียงไม่ได้ สามารถเลือกฟังต้นฉบับได้')); };
    worker.onmessage = (event: MessageEvent<RecordingRepair & {ok:boolean;error?:string}>) => {
      cleanup();
      if (!event.data.ok || !(event.data.buffer instanceof ArrayBuffer)) reject(Error(event.data.error || 'ปรับเสียงไม่ได้'));
      else resolve(event.data);
    };
    worker.postMessage({buffer},[buffer]);
  });
}
