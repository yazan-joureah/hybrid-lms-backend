// tests/unit/csv.util.test.js
const { buildCsv, escapeCsvValue } = require('../../src/utils/csv.util');

describe('escapeCsvValue', () => {
  it('يُعيد سلسلة فارغة عند null', () => {
    expect(escapeCsvValue(null)).toBe('');
  });

  it('يُعيد سلسلة فارغة عند undefined', () => {
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('يُعيد القيمة كما هي عند نص بلا فاصلة/اقتباس/سطر جديد', () => {
    expect(escapeCsvValue('normal value')).toBe('normal value');
  });

  it('يُحوِّل الأرقام إلى نص بلا اقتباس إضافي', () => {
    expect(escapeCsvValue(42)).toBe('42');
  });

  it('يقتبس القيمة عند وجود فاصلة', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
  });

  it('يقتبس ويُضاعِف علامات الاقتباس الداخلية', () => {
    expect(escapeCsvValue('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('يقتبس عند وجود سطر جديد', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('يبني CSV صحيحاً بترويسة وصفوف متعددة', () => {
    const headers = ['name', 'note'];
    const rows = [
      { name: 'Ahmad', note: 'ok' },
      { name: 'Sara, Tester', note: 'has "quotes"' },
    ];
    const csv = buildCsv(headers, rows);
    expect(csv).toBe('name,note\r\nAhmad,ok\r\n"Sara, Tester","has ""quotes"""');
  });

  it('يبني ترويسة فقط عند مصفوفة صفوف فارغة', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('a,b');
  });

  it('يتعامل مع حقول مفقودة في صف (undefined) كخلية فارغة', () => {
    const csv = buildCsv(['name', 'note'], [{ name: 'Ahmad' }]);
    expect(csv).toBe('name,note\r\nAhmad,');
  });
});
