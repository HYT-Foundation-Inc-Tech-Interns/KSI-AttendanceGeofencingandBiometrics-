/*
 * Check the SMTP configuration in backend/.env.
 *
 * Run this after changing SMTP settings, and before blaming the application
 * when an employee does not receive their password. It reports whether the
 * server is reachable and the credentials are accepted, then optionally sends
 * a real message.
 *
 * Usage, from the backend/ directory:
 *   node scripts/check-smtp.mjs                       # verify only, sends nothing
 *   node scripts/check-smtp.mjs you@example.com       # also send a test message
 *
 * The password is never printed -- only its length and whether it contains
 * whitespace, which is the most common copy-paste mistake (Google displays App
 * Passwords in four space-separated groups; the spaces are not part of it).
 */

import 'dotenv/config';
import nodemailer from 'nodemailer';

const recipient = process.argv[2];

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || user;

console.log('SMTP configuration');
console.log('  host  :', host || '(not set)');
console.log('  port  :', port, secure ? '(implicit TLS)' : '(STARTTLS if offered)');
console.log('  from  :', from || '(not set)');
console.log('  user  :', user || '(not set)');
console.log(
  '  pass  :',
  pass
    ? `${pass.length} chars, contains whitespace: ${/\s/.test(pass)}`
    : '(not set)',
);

const missing = [];
if (!host) missing.push('SMTP_HOST');
if (!user) missing.push('SMTP_USER');
if (!pass) missing.push('SMTP_PASS');
if (missing.length) {
  console.error(`\nMissing: ${missing.join(', ')}`);
  console.error('Set these in backend/.env, then run this again.');
  process.exit(1);
}

if (/\s/.test(pass)) {
  console.warn(
    '\nWarning: the password contains whitespace. Gmail shows App Passwords as\n' +
      'four groups of four characters; the spaces are formatting only. Remove them.',
  );
}

if (pass.length === 16 && /^[a-z]{16}$/i.test(pass)) {
  console.log('\nLooks like a Google App Password (16 letters).');
}

const transport = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

console.log('\nConnecting...');
try {
  await transport.verify();
  console.log('  OK: server reachable and credentials accepted.');
} catch (error) {
  console.error('  FAILED:', error.message);
  console.error('  code   :', error.code);
  console.error('  command:', error.command);

  if (error.code === 'EAUTH') {
    console.error('\nGmail returns 535 for both a wrong password and a wrong');
    console.error('username, so check all of these:');
    console.error('  1. The address is the exact account (not a similar one).');
    console.error('  2. 2-Step Verification is ON for that account. App');
    console.error('     Passwords do not exist without it.');
    console.error('  3. The App Password was created AFTER 2FA was enabled.');
    console.error('  4. The account password has not changed since -- changing');
    console.error('     it revokes every App Password.');
    console.error('  5. For a Google Workspace account, an admin may have');
    console.error('     disabled App Passwords for the organisation.');
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET' || error.code === 'ECONNECTION') {
    console.error('\nThe server could not be reached. Ports 587 and 465 are');
    console.error('commonly blocked by hosts and networks; port 25 is blocked by');
    console.error('most cloud providers outright.');
  }
  process.exit(1);
}

if (!recipient) {
  console.log('\nNo recipient given, so no message was sent.');
  console.log('Re-run with an address to send a test message.');
  process.exit(0);
}

console.log(`\nSending a test message to ${recipient}...`);
try {
  const info = await transport.sendMail({
    from,
    to: recipient,
    subject: 'Klassic Attendance -- email test',
    text:
      'This is a test message from the Klassic Field Attendance System.\n\n' +
      'If you are reading this, outbound email works and new employees will\n' +
      'receive their login details.\n\n' +
      `Sent at ${new Date().toISOString()}\n`,
  });

  console.log('  Accepted by the server.');
  console.log('  messageId:', info.messageId);
  console.log('  response :', info.response);
  console.log('  accepted :', info.accepted);
  console.log('  rejected :', info.rejected);
  console.log(
    '\nAccepted means the SMTP server took responsibility for delivery. It does',
  );
  console.log('not prove it reached the inbox -- check the mailbox, and the spam');
  console.log('folder on the first send.');
} catch (error) {
  console.error('  FAILED:', error.message);
  process.exit(1);
}
