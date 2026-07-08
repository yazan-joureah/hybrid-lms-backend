/**
 * Unit tests for the pure MIME-building logic in emailService.js.
 * Deliberately does NOT touch Gmail, network, or env vars — isolates the
 * one function in this file that is pure and therefore fully testable
 * without mocking anything.
 */
const { createMimeMessage } = require('../../src/services/emailService');

describe('createMimeMessage', () => {
  it('produces a Base64URL string with no +, /, or padding = characters', () => {
    const encoded = createMimeMessage({
      to: 'student@example.com',
      subject: 'Verify your Hybrid LMS account',
      html: '<p>Hello</p>',
    });

    expect(encoded).not.toMatch(/\+/);
    expect(encoded).not.toMatch(/\//);
    expect(encoded).not.toMatch(/=$/);
  });

  it('decodes back to a MIME message containing the correct recipient and body', () => {
    const encoded = createMimeMessage({
      to: 'student@example.com',
      subject: 'Plain ASCII Subject',
      html: '<p>This is the verification link.</p>',
    });

    // Reverse the URL-safe substitution to get back standard Base64 before decoding.
    const standardBase64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standardBase64, 'base64').toString('utf-8');

    expect(decoded).toContain('To: student@example.com');
    expect(decoded).toContain('This is the verification link.');
    expect(decoded).toContain('Content-Type: text/html; charset=utf-8');
  });

  it('correctly encodes a non-ASCII subject using RFC 2047 (=?utf-8?B?...?=)', () => {
    const encoded = createMimeMessage({
      to: 'student@example.com',
      subject: 'تحقق من بريدك',
      html: '<p>مرحباً</p>',
    });

    const standardBase64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standardBase64, 'base64').toString('utf-8');

    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?/);
  });
});
