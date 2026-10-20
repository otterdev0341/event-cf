import { readKnowledgeTemplate } from './template';
self.onmessage = async ({ data }: MessageEvent<File>) => {
  try {
    self.postMessage({ rows: await readKnowledgeTemplate(data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ' });
  }
};
