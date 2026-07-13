// src/services/kyc/ageDiscrepancy.service.js
//
// تنفيذ EXT-KYC-01. يُعيد استخدام calculateAge من ageCalculator.js لحساب
// السنوات الكاملة (لا تكرار)، لكنه يضيف حساباً كسرياً دقيقاً خاصاً به
// (calculatePreciseFractionalYears) للتصنيف الأمني الحدّي — لأن Floor
// وحدها غير كافية عند حدود مثل "1 سنة و11 شهراً" (راجع سجل الإصلاح: كان
// يُصنَّف خطأً كـ"أخضر" بدل "أصفر" قبل هذا التعديل).
//
// المرجع: FR-48, FR-48b | القرار المُغلَق:
//   فارق ≤ 1 سنة  → أخضر
//   فارق 1–2 سنة  → أصفر (يُعرض بالأشهر)
//   فارق > 2 سنة  → أحمر (تعليق تلقائي)

const { calculateAge } = require('../../utils/ageCalculator');

const GREEN_THRESHOLD_YEARS = 1;
const YELLOW_THRESHOLD_YEARS = 2;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function addFullYears(date, years) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function calculateYearsDifference(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (Number.isNaN(a.getTime())) throw new Error('AGE_DISCREPANCY_INVALID_ACCOUNT_DATE');
  if (Number.isNaN(b.getTime())) throw new Error('AGE_DISCREPANCY_INVALID_DOCUMENT_DATE');
  const [earlier, later] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  return calculateAge(earlier, later);
}

/**
 * دقة كسرية حقيقية (وليس Floor) — للاستخدام الداخلي في evaluateAgeDiscrepancy
 * فقط، حيث الدقة عند الحدود حاسمة أمنياً.
 */
function calculatePreciseFractionalYears(earlier, later) {
  const fullYears = calculateAge(earlier, later);
  const anniversaryDate = addFullYears(earlier, fullYears);
  const nextAnniversaryDate = addFullYears(earlier, fullYears + 1);

  const extraDays = (later.getTime() - anniversaryDate.getTime()) / MILLISECONDS_PER_DAY;
  const daysInThisYearPeriod =
    (nextAnniversaryDate.getTime() - anniversaryDate.getTime()) / MILLISECONDS_PER_DAY;

  return fullYears + extraDays / daysInThisYearPeriod;
}

function classifyDiscrepancy(discrepancyYears) {
  if (discrepancyYears <= GREEN_THRESHOLD_YEARS) return 'green';
  if (discrepancyYears <= YELLOW_THRESHOLD_YEARS) return 'yellow';
  return 'red';
}

/**
 * للعرض فقط، لا يدخل إطلاقاً في التصنيف الأمني.
 */
function calculateExtraMonths(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const [earlier, later] = a.getTime() <= b.getTime() ? [a, b] : [b, a];

  const fullYears = calculateAge(earlier, later);
  const afterFullYears = addFullYears(earlier, fullYears);

  let months =
    (later.getFullYear() - afterFullYears.getFullYear()) * 12 +
    (later.getMonth() - afterFullYears.getMonth());
  if (later.getDate() < afterFullYears.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * الواجهة المصدَّرة الرئيسية — دالة نقية بالكامل، تمنع أي تجاوز يدوي
 * للتصنيف من طرف Admin (منع MUC-KYC-03).
 */
function evaluateAgeDiscrepancy(accountBirthDate, documentBirthDate) {
  const a = new Date(accountBirthDate);
  const b = new Date(documentBirthDate);
  if (Number.isNaN(a.getTime())) throw new Error('AGE_DISCREPANCY_INVALID_ACCOUNT_DATE');
  if (Number.isNaN(b.getTime())) throw new Error('AGE_DISCREPANCY_INVALID_DOCUMENT_DATE');
  const [earlier, later] = a.getTime() <= b.getTime() ? [a, b] : [b, a];

  const discrepancyYears = calculatePreciseFractionalYears(earlier, later);
  const tier = classifyDiscrepancy(discrepancyYears);

  const result = {
    tier,
    discrepancyYears: Math.round(discrepancyYears * 100) / 100,
    requiresAutoSuspension: tier === 'red',
  };

  if (tier === 'yellow') {
    result.extraMonths = calculateExtraMonths(accountBirthDate, documentBirthDate);
  }

  return result;
}

module.exports = {
  evaluateAgeDiscrepancy,
  calculateYearsDifference,
  classifyDiscrepancy,
  calculateExtraMonths,
};
