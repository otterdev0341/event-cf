import { botnoiFetchBlob } from "./client";

/**
 * Export conversation logs to CSV file
 * POST /logs/log/export
 */
export async function exportLogsCsv(fileKeys: string[]): Promise<Blob> {
  return botnoiFetchBlob("/logs/log/export", {
    method: "POST",
    body: { file_keys: fileKeys },
  });
}

/**
 * Export conversation logs to PDF report
 * POST /logs/log/export/pdf
 */
export async function exportLogsPdf(fileKeys: string[]): Promise<Blob> {
  return botnoiFetchBlob("/logs/log/export/pdf", {
    method: "POST",
    body: { file_keys: fileKeys },
  });
}

/**
 * Trigger client-side browser file download from Blob.
 * Automatically prepends UTF-8 BOM (0xEF, 0xBB, 0xBF) to CSV files
 * so Microsoft Excel on Windows directly renders Thai text without garbled characters.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const triggerDownload = (targetBlob: Blob) => {
    const url = URL.createObjectURL(targetBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // If CSV file, ensure UTF-8 BOM (\uFEFF) is present for Microsoft Excel on Windows
  if (filename.toLowerCase().endsWith(".csv")) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const uint8 = new Uint8Array(buffer);
        const hasBom =
          uint8.length >= 3 &&
          uint8[0] === 0xef &&
          uint8[1] === 0xbb &&
          uint8[2] === 0xbf;

        if (!hasBom) {
          const withBomBlob = new Blob(
            [new Uint8Array([0xef, 0xbb, 0xbf]), blob],
            { type: "text/csv;charset=utf-8" },
          );
          triggerDownload(withBomBlob);
        } else {
          triggerDownload(blob);
        }
      })
      .catch(() => {
        triggerDownload(blob);
      });
  } else {
    triggerDownload(blob);
  }
}
