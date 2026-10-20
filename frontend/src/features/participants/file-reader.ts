import Papa from 'papaparse';
import { unzipSync } from 'fflate';
import { importRowSchema, type ImportRow } from '../../shared/contracts/calling';
import { templateHeaders } from '../../shared/contracts/import-validation';
const maxBytes = 5 * 1024 * 1024;
export async function readImport(file: File): Promise<ImportRow[]> {
  if (file.size > maxBytes) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 5 MiB');
  let rows: unknown[];
  if (file.name.toLowerCase().endsWith('.csv')) {
    const result = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: true,
    });
    if (result.errors.length) throw new Error(`CSV: ${result.errors[0].message}`);
    checkHeaders(result.meta.fields ?? []);
    rows = result.data;
  } else if (file.name.toLowerCase().endsWith('.xlsx')) {
    const data = new Uint8Array(await file.arrayBuffer());
    let expanded = 0;
    unzipSync(data, {
      filter: (entry) => {
        expanded += entry.originalSize;
        if (expanded > 25 * 1024 * 1024) throw new Error('XLSX expanded size เกิน 25 MiB');
        if (/vbaProject|externalLinks/.test(entry.name)) throw new Error('ไม่รองรับ macro/external links');
        return false;
      },
    });
    const { Workbook } = await import('exceljs');
    const book = new Workbook();
    await book.xlsx.load(data as never);
    if (book.worksheets.length !== 1) throw new Error('ใช้ได้ครั้งละหนึ่ง worksheet');
    const sheet = book.worksheets[0];
    if (sheet.rowCount > 5001 || sheet.columnCount > templateHeaders.length)
      throw new Error('XLSX ต้องมี 7 คอลัมน์ และไม่เกิน 5,000 รายชื่อ');
    const header = templateHeaders.map((_, i) => sheet.getRow(1).getCell(i + 1).text);
    checkHeaders(header);
    rows = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values = header.map((_, index) => {
        const cell = row.getCell(index + 1);
        if (cell.formula || (cell.value !== null && typeof cell.value === 'object'))
          throw new Error(`แถว ${number}: ใช้ข้อความเท่านั้น ไม่รองรับ formula/date cell`);
        if (index === 0 && typeof cell.value === 'number')
          throw new Error(`แถว ${number}: เบอร์โทรต้องเป็น text เพื่อรักษาเลข 0`);
        return cell.text;
      });
      rows.push(Object.fromEntries(header.map((key, index) => [key, values[index]])));
    });
  } else throw new Error('รองรับ CSV และ XLSX เท่านั้น');
  if (rows.length > 5000) throw new Error('ไม่เกิน 5,000 รายชื่อต่อไฟล์');
  return rows.map((row) => importRowSchema.parse(row));
}
function checkHeaders(headers: string[]) {
  if (headers.join(',') !== templateHeaders.join(','))
    throw new Error(`คอลัมน์ต้องเรียงเป็น ${templateHeaders.join(', ')}`);
}
