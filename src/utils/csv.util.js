/**
 * أداة CSV بسيطة بلا أي اعتمادية خارجية — تكفي لحجم تقارير الحضور المتوقّع.
 * تُطبّق تهريب RFC-4180 الأساسي (اقتباس أي قيمة تحتوي فاصلة/اقتباس/سطر جديد).
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {string[]} headers - أسماء الأعمدة بالترتيب
 * @param {Array<object>} rows - كل عنصر مفاتيحه تطابق headers
 * @returns {string} نص CSV كامل جاهز للتنزيل
 */
function buildCsv(headers, rows) {
  const headerLine = headers.map(escapeCsvValue).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCsvValue(row[h])).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

module.exports = { buildCsv, escapeCsvValue };
