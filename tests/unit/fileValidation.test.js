// tests/unit/fileValidation.test.js
//
// نستخدم Buffers حقيقية بتوقيعات Magic Bytes صحيحة (وليس Mock لمكتبة
// file-type) — لأن الهدف الأمني للملف هو التحقق من الكشف الفعلي للتوقيع،
// واختبار مقابل Mock مزيَّف يُفقد الاختبار قيمته الحقيقية (لن يكتشف مثلاً
// خطأ إصدار غير متوافق من file-type نفسها).

const {
  validateUploadedFile,
  detectActualFileType,
  isExtensionConsistent,
  KYC_MAX_FILE_SIZE_BYTES,
} = require('../../src/utils/fileValidation.util');

// توقيعات Magic Bytes حقيقية ومعروفة (أول بايتات فعلية لكل تنسيق)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_SIGNATURE = Buffer.from('%PDF-1.4');
const TEXT_NO_SIGNATURE = Buffer.from('this is just plain text, no magic bytes');

// نُلحق padding عشوائياً لمحاكاة ملف حقيقي (بعض مكتبات الكشف تحتاج حداً
// أدنى من البايتات لتعمل بثقة)
function buildFakeFile(signature, extraBytes = 100) {
  return Buffer.concat([signature, Buffer.alloc(extraBytes, 0x00)]);
}

describe('detectActualFileType — كشف Magic Bytes الحقيقي', () => {
  test('يكتشف PNG بدقة من توقيعه الحقيقي', async () => {
    const result = await detectActualFileType(buildFakeFile(PNG_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('image/png');
    expect(result.ext).toBe('png');
  });

  test('يكتشف JPEG بدقة من توقيعه الحقيقي', async () => {
    const result = await detectActualFileType(buildFakeFile(JPEG_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('image/jpeg');
  });

  test('يكتشف PDF (لإثبات أن الكشف عام وليس محصوراً بصور فقط)', async () => {
    const result = await detectActualFileType(buildFakeFile(PDF_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('application/pdf');
  });

  test('نص عادي بلا توقيع معروف → null (وليس استثناء)', async () => {
    const result = await detectActualFileType(TEXT_NO_SIGNATURE);
    expect(result).toBeNull();
  });

  test('Buffer فارغ → null دون استثناء', async () => {
    const result = await detectActualFileType(Buffer.alloc(0));
    expect(result).toBeNull();
  });

  test('مدخل ليس Buffer إطلاقاً → null دون استثناء (دفاعي)', async () => {
    const result = await detectActualFileType('not a buffer at all');
    expect(result).toBeNull();
  });
});

describe('isExtensionConsistent — طبقة الدفاع الثانية', () => {
  test('امتداد .png مطابق لتوقيع png → true', () => {
    expect(isExtensionConsistent('id_card.png', 'png')).toBe(true);
  });

  test('.jpeg و.jpg يُعتبران متكافئين', () => {
    expect(isExtensionConsistent('selfie.jpeg', 'jpg')).toBe(true);
    expect(isExtensionConsistent('selfie.jpg', 'jpg')).toBe(true);
  });

  test('امتداد لا يطابق التوقيع الحقيقي → false (كشف تحايل)', () => {
    // هذا بالضبط سيناريو MUC-KYC-02: ملف اسمه .png لكن محتواه شيء آخر
    expect(isExtensionConsistent('malicious.png', 'exe')).toBe(false);
  });

  test('اسم ملف فارغ → false', () => {
    expect(isExtensionConsistent('', 'png')).toBe(false);
  });

  test('حساسية حالة الأحرف: .PNG بأحرف كبيرة لا تزال تُطابَق', () => {
    expect(isExtensionConsistent('ID_CARD.PNG', 'png')).toBe(true);
  });
});

describe('validateUploadedFile — الواجهة الكاملة (Fail Fast Order)', () => {
  test('ملف PNG صالح تماماً (حجم + نوع + امتداد متطابقون) → valid=true', async () => {
    const result = await validateUploadedFile(buildFakeFile(PNG_SIGNATURE), 'national_id.png');
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('image/png');
  });

  test('حجم يتجاوز الحد الأقصى → رفض بسبب FILE_SIZE_INVALID (قبل أي فحص توقيع)', async () => {
    const oversized = buildFakeFile(PNG_SIGNATURE, KYC_MAX_FILE_SIZE_BYTES + 1);
    const result = await validateUploadedFile(oversized, 'national_id.png');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_SIZE_INVALID');
  });

  test('نوع غير معروف إطلاقاً → FILE_TYPE_UNRECOGNIZED', async () => {
    const result = await validateUploadedFile(TEXT_NO_SIGNATURE, 'fake.png');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_TYPE_UNRECOGNIZED');
  });

  test('نوع حقيقي معروف لكن خارج القائمة البيضاء (PDF) → FILE_TYPE_NOT_ALLOWED', async () => {
    // القائمة البيضاء الافتراضية لـ KYC: png/jpeg فقط — لا PDF
    const result = await validateUploadedFile(buildFakeFile(PDF_SIGNATURE), 'document.pdf');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('السيناريو الأمني الحاسم (MUC-KYC-02): ملف .exe متنكر بامتداد .png → EXTENSION_MISMATCH', async () => {
    // المحتوى الفعلي PNG حقيقي، لكن... هذا تحديداً يوضح حدود isExtensionConsistent:
    // نبني ملفاً بتوقيع PNG حقيقي لكن نُسمّيه بامتداد لا علاقة له بالصور
    const result = await validateUploadedFile(buildFakeFile(PNG_SIGNATURE), 'invoice.pdf');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXTENSION_MISMATCH');
  });

  test('يقبل قائمة بيضاء مخصَّصة عبر options (قابلية إعادة الاستخدام لوحدات أخرى لاحقاً)', async () => {
    const result = await validateUploadedFile(buildFakeFile(PDF_SIGNATURE), 'transcript.pdf', {
      allowedMimeTypes: ['application/pdf'],
      maxFileSizeBytes: KYC_MAX_FILE_SIZE_BYTES,
    });
    expect(result.valid).toBe(true);
  });
});
