import { expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { readImport } from '../src/features/participants/file-reader';
import { templateHeaders } from '../src/shared/contracts/import-validation';
async function workbookFile(phone: unknown, formula = false) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Participants');
  sheet.addRow(templateHeaders);
  sheet.addRow([
    phone,
    formula ? { formula: '1+1', result: 2 } : 'Jane',
    'Doe',
    '',
    'EV26',
    '2026-12-12',
    'th',
  ]);
  const data = await workbook.xlsx.writeBuffer();
  return new File([data as BlobPart], 'participants.xlsx');
}
it('XLSX round-trip preserves leading zero in text phone and date', async () => {
  const rows = await readImport(await workbookFile('0812345678'));
  expect(rows[0].phone).toBe('0812345678');
  expect(rows[0].event_date).toBe('2026-12-12');
});
it('rejects numeric phone cells and formulas rather than guessing intent', async () => {
  await expect(readImport(await workbookFile(812345678))).rejects.toThrow('text');
  await expect(readImport(await workbookFile('0812345678', true))).rejects.toThrow('formula');
});
it('rejects wrong CSV headers and oversized uploads', async () => {
  await expect(readImport(new File(['name,phone\nJane,0812345678'], 'bad.csv'))).rejects.toThrow('คอลัมน์');
  await expect(readImport(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.csv'))).rejects.toThrow(
    '5 MiB',
  );
});
