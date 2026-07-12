/**
 * Email delivery service — Gmail HTTP REST API via OAuth2 (NOT SMTP).
 *
 * Architectural decision (supersedes the earlier generic-SMTP version):
 * We authenticate to Gmail using the OAuth2 client defined in
 * `../config/googleOAuth.js`, which itself relies on a Refresh Token scoped
 * ONLY to `gmail.send` (least privilege — RFC 9700 §2.1).
 * * By using the Gmail REST API (googleapis) instead of SMTP (Nodemailer),
 * we avoid the '535 Bad Credentials' error, as Google's SMTP servers strictly
 * require the full mail scope, whereas the REST API perfectly accepts the
 * restricted 'gmail.send' scope.
 *
 * Dev/CI fallback: if Gmail credentials are not configured (e.g. a
 * teammate running locally without Google Cloud setup yet, or the CI
 * pipeline — which must NEVER send real email, see ci.yml discussion),
 * emails are logged to the console instead. This keeps the full
 * registration/guardian flow testable without any real or paid service
 * (principle #7/#8).
 */
const { google } = require('googleapis');
const env = require('../config/env');
const logger = require('../utils/logger');
const { oauth2Client } = require('../config/googleOAuth');

/**
 * Initialize the Gmail API client using the centralized OAuth2 client.
 * The OAuth2 client automatically handles token expiration and refreshing.
 */
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

/**
 * Returns true only when all four Gmail OAuth2 values are present.
 * Used to decide dev-mode vs real sending — a single, explicit switch
 * instead of scattering `if (env.gmail.clientId)` checks everywhere.
 */
function isGmailConfigured() {
  return Boolean(
    env.gmail.clientId && env.gmail.clientSecret && env.gmail.refreshToken && env.gmail.senderEmail
  );
}

/**
 * Builds a Base64URL-encoded MIME message.
 * The Gmail REST API requires the raw email content to be encoded this way.
 */
function createMimeMessage({ to, subject, html }) {
  // Ensure non-ASCII characters in the subject are encoded correctly
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

  const messageParts = [
    `From: "Hybrid LMS" <${env.gmail.senderEmail}>`,
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '', // Empty line separates headers from body
    html,
  ];

  const message = messageParts.join('\n');

  // Encode to Base64URL (safe for web requests, removes +, /, and padding =)
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Core function to send emails.
 */
async function sendMail({ to, subject, html }) {
  if (!isGmailConfigured()) {
    logger.info('[DEV EMAIL — not sent, Gmail OAuth2 not configured]', { to, subject });
    // eslint-disable-next-line no-console -- intentional dev-only visibility for email content
    console.log(
      `\n--- DEV EMAIL ---\nTo: ${to}\nSubject: ${subject}\n${html}\n-----------------\n`
    );
    return { devMode: true };
  }

  try {
    const rawMessage = createMimeMessage({ to, subject, html });

    const response = await gmail.users.messages.send({
      userId: 'me', // 'me' refers to the authenticated user (env.gmail.senderEmail)
      requestBody: {
        raw: rawMessage,
      },
    });

    return response.data;
  } catch (err) {
    logger.error('Failed to send email via Gmail REST API', {
      error: err.message,
      response: err.response?.data,
      stack: err.stack,
    });

    throw err;
  }
}

async function sendVerificationEmail(to, verifyUrl) {
  return sendMail({
    to,
    subject: 'Verify your Hybrid LMS account',
    html: `<p>Welcome! Please verify your email by visiting:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
  });
}

async function sendGuardianApprovalEmail(to, approveUrl, studentName) {
  return sendMail({
    to,
    subject: `Guardian approval needed for ${studentName}`,
    html: `<p><strong>${studentName}</strong> has created an account on Hybrid LMS and needs your approval.</p><p><a href="${approveUrl}">${approveUrl}</a></p><p>This link expires in 48 hours.</p>`,
  });
}

async function sendGuardianWaitingEmail(to, manageUrl) {
  return sendMail({
    to,
    subject: 'Your account is waiting for guardian approval',
    html: `<p>We also sent a request to your guardian. If you need to resend it or fix the email address, use this link:</p><p><a href="${manageUrl}">${manageUrl}</a></p>`,
  });
}

async function sendGuardianDeclinedNotice(to) {
  return sendMail({
    to,
    subject: 'Your guardian declined the approval request',
    html: `<p>Your guardian did not approve your Hybrid LMS account request.</p><p>If you entered the wrong email address, please use the "update guardian email" link we sent you when you registered.</p>`,
  });
}

async function sendPasswordResetEmail(to, resetUrl) {
  return sendMail({
    to,
    subject: 'Reset your Hybrid LMS password',
    html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>`,
  });
}
async function sendGoogleAccountLinkedNotice(to) {
  return sendMail({
    to,
    subject: 'Your Google account has been linked',
    html: `<p>Your Hybrid LMS account is now linked to your Google account. You can sign in using either method going forward.</p>`,
  });
}

module.exports = {
  sendVerificationEmail,
  sendGuardianApprovalEmail,
  sendGuardianWaitingEmail,
  sendGuardianDeclinedNotice,
  sendPasswordResetEmail,
  createMimeMessage,
  sendGoogleAccountLinkedNotice,
};
