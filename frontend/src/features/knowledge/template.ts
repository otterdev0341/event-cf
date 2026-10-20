import { unzipSync } from 'fflate';
import { knowledgeImportSchema } from '../../shared/contracts/events';
import type { z } from 'zod';
export type KnowledgeImport = z.infer<typeof knowledgeImportSchema>;
const headers = ['event_code', 'category', 'question', 'answer'];
export async function downloadKnowledgeTemplate(code: string, categories: string[], revision: number) {
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  const faq = book.addWorksheet('FAQ');
  faq.addRow(headers);
  faq.addRow([code, categories[0] ?? '', '', '']);
  const master = book.addWorksheet('Categories');
  master.addRow(['category']);
  categories.forEach((c) => master.addRow([c]));
  const meta = book.addWorksheet('Event');
  meta.addRow(['event_code', 'category_revision']);
  meta.addRow([code, String(revision)]);
  book.worksheets.forEach((sheet) =>
    sheet.columns.forEach((column) => {
      column.width = 30;
      column.numFmt = '@';
    }),
  );
  if (categories.length)
    for (let row = 2; row <= 1001; row++)
      faq.getCell(`B${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`Categories!$A$2:$A$${categories.length + 1}`],
        showErrorMessage: true,
        error: 'เลือก category จากรายการล่าสุด',
      };
  const blob = new Blob([(await book.xlsx.writeBuffer()) as BlobPart]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${code}-knowledge-template.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readKnowledgeTemplate(file: File): Promise<KnowledgeImport> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024)
    throw new Error('ใช้ XLSX ขนาดไม่เกิน 5 MiB');
  const data = new Uint8Array(await file.arrayBuffer());
  let expanded = 0;
  unzipSync(data, {
    filter: (entry) => {
      expanded += entry.originalSize;
      if (expanded > 25 * 1024 * 1024 || /vbaProject|externalLinks/.test(entry.name))
        throw new Error('ไฟล์ขยายใหญ่เกินกำหนด หรือมี macro/external links');
      return false;
    },
  });
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  await book.xlsx.load(data as never);
  const faq = book.getWorksheet('FAQ');
  const meta = book.getWorksheet('Event');
  if (!faq || !meta || book.worksheets.length !== 3 || !book.getWorksheet('Categories'))
    throw new Error('ใช้ template ที่ดาวน์โหลดจาก Event นี้');
  if (
    faq.rowCount > 1001 ||
    faq.columnCount > 4 ||
    book.worksheets.some((s) => s.rowCount > 1001 || s.columnCount > 4)
  )
    throw new Error('ไม่เกิน 1,000 FAQ ต่อไฟล์');
  book.worksheets.forEach((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value !== null && typeof cell.value === 'object')
          throw new Error('ใช้ข้อความเท่านั้น ไม่รองรับ formula/date cell');
      }),
    ),
  );
  if (headers.some((h, i) => faq.getRow(1).getCell(i + 1).text !== h))
    throw new Error('คอลัมน์ FAQ ไม่ตรง template');
  const eventCode = meta.getCell('A2').text;
  const categoryRevision = Number(meta.getCell('B2').text);
  const rows: KnowledgeImport['rows'] = [];
  faq.eachRow((row, index) => {
    if (index === 1) return;
    const [code, category, question, answer] = headers.map((_, i) => row.getCell(i + 1).text.trim());
    if (!question && !answer) return;
    if (code !== eventCode) throw new Error(`แถว ${index}: event_code ไม่ตรง`);
    rows.push({ category, question, answer });
  });
  return knowledgeImportSchema.parse({ eventCode, categoryRevision, rows });
}
