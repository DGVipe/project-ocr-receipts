export interface ExportableReceipt {
  _id: string;
  _creationTime: number;
  storeName: string | null;
  totalAmount: number | null;
  currency: string | null;
  purchaseDate: string | null;
}

export interface ExportHeaders {
  store: string;
  date: string;
  total: string;
  currency: string;
  scanned: string;
}

/** Builds an Excel workbook (.xlsx) with one row per receipt. Unknown fields stay empty. */
export async function receiptsToXlsx(receipts: ExportableReceipt[], headers: ExportHeaders): Promise<Blob> {
  // Loaded on demand so the library only downloads when someone exports.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = [headers.store, headers.date, headers.total, headers.currency, headers.scanned].map(
    (value) => ({ value, fontWeight: "bold" as const }),
  );
  const rows = receipts.map((r) => [
    r.storeName ? { value: r.storeName } : null,
    r.purchaseDate ? { value: r.purchaseDate } : null,
    r.totalAmount !== null ? { value: r.totalAmount } : null,
    r.currency ? { value: r.currency } : null,
    { value: new Date(r._creationTime), format: "yyyy-mm-dd hh:mm" },
  ]);
  return writeXlsxFile([head, ...rows], {
    columns: [{ width: 28 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 18 }],
  }).toBlob();
}
