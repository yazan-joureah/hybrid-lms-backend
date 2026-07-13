// tests/unit/ageDiscrepancy.test.js
//
// اختبار EXT-KYC-01 — يغطي الحدود الثلاثة (أخضر/أصفر/أحمر) عند نقاط
// الانكسار بالضبط (0، 1، 2 سنة) لأن الأخطاء الأمنية الحقيقية تحدث عادة
// عند الحدود (Boundary Conditions)، وليس في منتصف النطاق.

const {
  evaluateAgeDiscrepancy,
  calculateYearsDifference,
  classifyDiscrepancy,
  calculateExtraMonths,
} = require('../../src/services/kyc/ageDiscrepancy.service');

describe('classifyDiscrepancy — حدود التصنيف الثلاثة', () => {
  test('فارق 0 سنة → أخضر', () => {
    expect(classifyDiscrepancy(0)).toBe('green');
  });

  test('فارق 1 سنة بالضبط → أخضر (الحد شامل من الأعلى)', () => {
    expect(classifyDiscrepancy(1)).toBe('green');
  });

  test('فارق 1.5 سنة → أصفر', () => {
    // ملاحظة: calculateYearsDifference تُعيد أعداداً صحيحة فعلياً (نتيجة
    // إعادة استخدام calculateAge)، لكن الدالة نفسها تقبل أي رقم — نختبر
    // هنا سلوكها العام بمعزل عن مصدر الرقم
    expect(classifyDiscrepancy(1.5)).toBe('yellow');
  });

  test('فارق 2 سنة بالضبط → أصفر (الحد شامل من الأعلى)', () => {
    expect(classifyDiscrepancy(2)).toBe('yellow');
  });

  test('فارق 2.01 سنة → أحمر', () => {
    expect(classifyDiscrepancy(2.01)).toBe('red');
  });

  test('فارق 10 سنوات → أحمر', () => {
    expect(classifyDiscrepancy(10)).toBe('red');
  });
});

describe('calculateYearsDifference — إعادة استخدام calculateAge', () => {
  test('نفس التاريخ بالضبط → فارق 0', () => {
    expect(calculateYearsDifference('2000-01-01', '2000-01-01')).toBe(0);
  });

  test('فارق سنة كاملة ويوم واحد إضافي → لا يُحتسب كسنتين', () => {
    // 2000-01-01 إلى 2001-01-02 = سنة واحدة كاملة + يوم، ليس سنتين
    expect(calculateYearsDifference('2000-01-01', '2001-01-02')).toBe(1);
  });

  test('ترتيب المعاملات لا يؤثر على النتيجة (فارق مطلق)', () => {
    const forward = calculateYearsDifference('2000-01-01', '2010-06-15');
    const backward = calculateYearsDifference('2010-06-15', '2000-01-01');
    expect(forward).toBe(backward);
  });

  test('حالة حدّية حرجة: 31 ديسمبر مقابل 1 يناير للعام التالي = فارق يوم واحد، وليس سنة', () => {
    // هذا الاختبار تحديداً هو سبب رفضنا لحساب 365.25 التقريبي سابقاً
    expect(calculateYearsDifference('1999-12-31', '2000-01-01')).toBe(0);
  });

  test('تاريخ حساب غير صالح → استثناء صريح', () => {
    expect(() => calculateYearsDifference('not-a-date', '2000-01-01')).toThrow(
      'AGE_DISCREPANCY_INVALID_ACCOUNT_DATE'
    );
  });

  test('تاريخ وثيقة غير صالح → استثناء صريح', () => {
    expect(() => calculateYearsDifference('2000-01-01', 'not-a-date')).toThrow(
      'AGE_DISCREPANCY_INVALID_DOCUMENT_DATE'
    );
  });
});

describe('calculateExtraMonths — للعرض فقط، لا يدخل في التصنيف الأمني', () => {
  test('فارق سنة واحدة و6 أشهر بالضبط → 6 أشهر إضافية', () => {
    expect(calculateExtraMonths('2000-01-01', '2001-07-01')).toBe(6);
  });

  test('فارق سنتين بالضبط → 0 أشهر إضافية', () => {
    expect(calculateExtraMonths('2000-01-01', '2002-01-01')).toBe(0);
  });

  test('لا يُعيد قيمة سالبة أبداً', () => {
    expect(calculateExtraMonths('2000-06-15', '2001-01-01')).toBeGreaterThanOrEqual(0);
  });
});

describe('evaluateAgeDiscrepancy — الواجهة الكاملة المستخدَمة فعلياً في kycReview.service.js', () => {
  test('فارق أخضر → requiresAutoSuspension = false، بلا extraMonths', () => {
    const result = evaluateAgeDiscrepancy('2000-01-01', '2000-11-01');
    expect(result.tier).toBe('green');
    expect(result.requiresAutoSuspension).toBe(false);
    expect(result.extraMonths).toBeUndefined();
  });

  test('فارق أصفر → requiresAutoSuspension = false، مع extraMonths محسوباً', () => {
    const result = evaluateAgeDiscrepancy('2000-01-01', '2001-08-01');
    expect(result.tier).toBe('yellow');
    expect(result.requiresAutoSuspension).toBe(false);
    expect(result.extraMonths).toBe(7); // سنة كاملة + 7 أشهر
  });

  test('فارق أحمر → requiresAutoSuspension = true (يُطلق EXT-KYC-01)', () => {
    const result = evaluateAgeDiscrepancy('2000-01-01', '2003-01-01');
    expect(result.tier).toBe('red');
    expect(result.requiresAutoSuspension).toBe(true);
  });

  test('حالة حدّية: فارق 2 سنة بالضبط → أصفر وليس أحمر (تحقّق مباشر من الواجهة الكاملة)', () => {
    const result = evaluateAgeDiscrepancy('2000-01-01', '2002-01-01');
    expect(result.tier).toBe('yellow');
    expect(result.requiresAutoSuspension).toBe(false);
  });
});
