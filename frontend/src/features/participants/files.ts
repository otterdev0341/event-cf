import Papa from 'papaparse';
import { templateHeaders } from '../../shared/contracts/import-validation';
export { parseImport } from './import-client';
export async function downloadTemplate(event: { code: string; date: string }, format: 'csv' | 'xlsx') {
  const sample = ['0812345678', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', event.code, event.date];
  let blob: Blob;
  if (format === 'csv')
    blob = new Blob(['\uFEFF', Papa.unparse([templateHeaders, sample])], { type: 'text/csv;charset=utf-8' });
  else {
    const { Workbook } = await import('exceljs');
    const book = new Workbook();
    const sheet = book.addWorksheet('Participants');
    sheet.addRow(templateHeaders);
    sheet.addRow(sample);
    sheet.columns.forEach((column) => {
      column.numFmt = '@';
      column.width = 22;
    });
    const buffer = await book.xlsx.writeBuffer();
    blob = new Blob([buffer as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.code}-template.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
