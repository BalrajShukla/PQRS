import { downloadBlob, toCsv } from './utils.js';

export function downloadCsv(rows, filename = 'pqrs_results.csv') {
  const csv = toCsv(rows);
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

export function downloadXlsx(rows, filename = 'pqrs_results.xlsx') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PQRS');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
