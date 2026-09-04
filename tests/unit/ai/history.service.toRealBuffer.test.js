// tests/unit/ai/history.service.toRealBuffer.test.js
//
// اختبار وحدة نقي لدالة toRealBuffer — بلا أي DB. يغطي كل الأشكال
// الأربعة المعروفة فعلياً من MongoDB driver/Mongoose عند القراءة عبر
// .lean() لحقول Buffer داخل subdocuments مصفوفة، بالإضافة لحارس الفشل
// الصريح عند شكل غير متعرَّف عليه (بدل إنتاج Buffer بطول خاطئ بصمت).
const { toRealBuffer } = require('../../../src/services/ai/history.service');

describe('toRealBuffer', () => {
  it('يُعيد القيمة كما هي عندما تكون Buffer حقيقياً بالفعل', () => {
    const buf = Buffer.from('hello', 'utf8');
    expect(toRealBuffer(buf)).toBe(buf);
  });

  it('يحوّل Uint8Array عام إلى Buffer', () => {
    const arr = new Uint8Array([1, 2, 3, 4]);
    const result = toRealBuffer(arr);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect([...result]).toEqual([1, 2, 3, 4]);
  });

  it('يحوّل POJO المُسلسَل {type:"Buffer", data:[]} إلى Buffer', () => {
    const pojo = { type: 'Buffer', data: [10, 20, 30] };
    const result = toRealBuffer(pojo);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect([...result]).toEqual([10, 20, 30]);
  });

  it('يحوّل كائن bson.Binary (الشكل الفعلي بعد .lean() على subdocuments) إلى Buffer صحيح البايتات', () => {
    const originalBytes = Buffer.from('secret-payload', 'utf8');
    const fakeBsonBinary = {
      _bsontype: 'Binary',
      buffer: new Uint8Array(originalBytes),
      sub_type: 0,
      position: originalBytes.length,
    };
    const result = toRealBuffer(fakeBsonBinary);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString('utf8')).toBe('secret-payload');
  });

  it('يرمي TypeError واضحاً يحدد اسم الـ constructor عند شكل غير معروف (بدل فشل صامت لاحقاً)', () => {
    expect(() => toRealBuffer(42)).toThrow(/unrecognized encrypted value shape/);
    expect(() => toRealBuffer({ random: 'object' })).toThrow(TypeError);
    expect(() => toRealBuffer(null)).toThrow(TypeError);
    expect(() => toRealBuffer(undefined)).toThrow(TypeError);
  });
});
