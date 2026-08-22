// tests/unit/fileValidation.test.js
//
// Uses real buffers with actual Magic Byte signatures (not mocking the file-type
// library) — because the security goal is to verify actual signature detection,
// and a mocked test would lose its real value (e.g., it would not catch an
// incompatible file-type version).

const {
  validateUploadedFile,
  detectActualFileType,
  isExtensionConsistent,
} = require('../../src/utils/fileValidation.util');
const { KYC_DOCUMENT_POLICY } = require('../../src/config/uploadPolicies');

const KYC_MAX_FILE_SIZE_BYTES = KYC_DOCUMENT_POLICY.maxFileSizeBytes;

// Real, well‑known Magic Byte signatures (actual first bytes of each format)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_SIGNATURE = Buffer.from('%PDF-1.4');
const TEXT_NO_SIGNATURE = Buffer.from('this is just plain text, no magic bytes');

// Adds random padding to simulate a real file (some detection libraries need
// a minimum number of bytes to work reliably)
function buildFakeFile(signature, extraBytes = 100) {
  return Buffer.concat([signature, Buffer.alloc(extraBytes, 0x00)]);
}

describe('detectActualFileType — real Magic Byte detection', () => {
  test('detects PNG accurately from its real signature', async () => {
    const result = await detectActualFileType(buildFakeFile(PNG_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('image/png');
    expect(result.ext).toBe('png');
  });

  test('detects JPEG accurately from its real signature', async () => {
    const result = await detectActualFileType(buildFakeFile(JPEG_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('image/jpeg');
  });

  test('detects PDF (proves detection is general, not limited to images)', async () => {
    const result = await detectActualFileType(buildFakeFile(PDF_SIGNATURE));
    expect(result).not.toBeNull();
    expect(result.mime).toBe('application/pdf');
  });

  test('plain text with no signature → null (not an exception)', async () => {
    const result = await detectActualFileType(TEXT_NO_SIGNATURE);
    expect(result).toBeNull();
  });

  test('empty Buffer → null without exception', async () => {
    const result = await detectActualFileType(Buffer.alloc(0));
    expect(result).toBeNull();
  });

  test('input that is not a Buffer at all → null without exception (defensive)', async () => {
    const result = await detectActualFileType('not a buffer at all');
    expect(result).toBeNull();
  });
});

describe('isExtensionConsistent — second defence layer', () => {
  test('.png extension matching png signature → true', () => {
    expect(isExtensionConsistent('id_card.png', 'png')).toBe(true);
  });

  test('.jpeg and .jpg are considered equivalent', () => {
    expect(isExtensionConsistent('selfie.jpeg', 'jpg')).toBe(true);
    expect(isExtensionConsistent('selfie.jpg', 'jpg')).toBe(true);
  });

  test('extension does not match real signature → false (detects spoofing)', () => {
    // This is exactly the MUC-KYC‑02 scenario: a file named .png but its content is something else
    expect(isExtensionConsistent('malicious.png', 'exe')).toBe(false);
  });

  test('empty filename → false', () => {
    expect(isExtensionConsistent('', 'png')).toBe(false);
  });

  test('case insensitivity: .PNG in uppercase still matches', () => {
    expect(isExtensionConsistent('ID_CARD.PNG', 'png')).toBe(true);
  });
});

describe('validateUploadedFile — full interface (Fail Fast Order)', () => {
  // The policy is now strictly required (no implicit KYC default) —
  // every test explicitly passes KYC_DOCUMENT_POLICY, exactly as
  // kycDocumentStorage.service.js does in production.
  test('perfectly valid PNG (size + type + extension all match) → valid=true', async () => {
    const result = await validateUploadedFile(
      buildFakeFile(PNG_SIGNATURE),
      'national_id.png',
      KYC_DOCUMENT_POLICY
    );
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('image/png');
  });

  test('size exceeds limit → rejected due to FILE_SIZE_INVALID (before any signature check)', async () => {
    const oversized = buildFakeFile(PNG_SIGNATURE, KYC_MAX_FILE_SIZE_BYTES + 1);
    const result = await validateUploadedFile(oversized, 'national_id.png', KYC_DOCUMENT_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_SIZE_INVALID');
  });

  test('completely unknown type → FILE_TYPE_UNRECOGNIZED', async () => {
    const result = await validateUploadedFile(TEXT_NO_SIGNATURE, 'fake.png', KYC_DOCUMENT_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_TYPE_UNRECOGNIZED');
  });

  test('real known type but outside the whitelist (PDF) → FILE_TYPE_NOT_ALLOWED', async () => {
    // Explicitly passed KYC whitelist: png/jpeg only — no PDF
    const result = await validateUploadedFile(
      buildFakeFile(PDF_SIGNATURE),
      'document.pdf',
      KYC_DOCUMENT_POLICY
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('critical security scenario (MUC-KYC‑02): .exe disguised as .png → EXTENSION_MISMATCH', async () => {
    const result = await validateUploadedFile(
      buildFakeFile(PNG_SIGNATURE),
      'invoice.pdf',
      KYC_DOCUMENT_POLICY
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXTENSION_MISMATCH');
  });

  test('accepts custom whitelist via options (reusable for other modules — COURSE/PEER)', async () => {
    const result = await validateUploadedFile(buildFakeFile(PDF_SIGNATURE), 'transcript.pdf', {
      allowedMimeTypes: ['application/pdf'],
      maxFileSizeBytes: KYC_MAX_FILE_SIZE_BYTES,
    });
    expect(result.valid).toBe(true);
  });

  // New coverage: the security decision to make the policy mandatory with no implicit default —
  // forgetting to pass options must fail loudly and immediately (clear programming error)
  // instead of silently applying strict KYC defaults to an unrelated feature.
  test('called with no options at all → throws an immediate, clear error (no implicit default anymore)', async () => {
    await expect(
      validateUploadedFile(buildFakeFile(PNG_SIGNATURE), 'national_id.png')
    ).rejects.toThrow(/allowedMimeTypes is required/);
  });

  test('called with incomplete options (missing maxFileSizeBytes) → throws immediately', async () => {
    await expect(
      validateUploadedFile(buildFakeFile(PNG_SIGNATURE), 'national_id.png', {
        allowedMimeTypes: ['image/png'],
      })
    ).rejects.toThrow(/maxFileSizeBytes is required/);
  });
});
