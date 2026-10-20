import { readImport } from './file-reader';
self.onmessage = async (message: MessageEvent<File>) => {
  try {
    self.postMessage({ rows: await readImport(message.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ' });
  }
};
