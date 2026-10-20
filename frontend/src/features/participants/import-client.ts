import type { ImportRow } from '../../shared/contracts/calling';
export function parseImport(file: File, signal?: AbortSignal): Promise<ImportRow[]> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('อ่านไฟล์เกินเวลาที่กำหนด กรุณาลดขนาดไฟล์')), 20_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail(new Error('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์'));
    worker.onmessage = ({ data }: MessageEvent<{ rows?: ImportRow[]; error?: string }>) => {
      cleanup();
      if (data.error || !data.rows) reject(new Error(data.error ?? 'ไม่มีข้อมูลในไฟล์'));
      else resolve(data.rows);
    };
    worker.postMessage(file);
  });
}
