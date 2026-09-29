import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Outbound email.
 *
 * Configured entirely from the environment, so the transport is not tied to
 * Gmail. Any SMTP provider works by changing SMTP_HOST/PORT/USER/PASS -- which
 * matters because Gmail App Passwords are fragile (they require 2-Step
 * Verification and are silently revoked when the account password changes),
 * and a transactional provider can be swapped in without touching code.
 *
 * Nothing here throws. Sending mail is a side effect of creating an employee,
 * not part of it: a provider outage or a bad credential must not roll back a
 * record that was otherwise created correctly. Callers receive a result object
 * and decide what to tell the user.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null = null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const port = parseInt(
      this.configService.get<string>('SMTP_PORT', '587'),
      10,
    );
    const secure =
      this.configService.get<string>('SMTP_SECURE', 'false') === 'true';

    this.from = this.configService.get<string>('SMTP_FROM') || user || '';

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS). ' +
          'Emails will not be sent; generated passwords will be returned to the ' +
          'administrator instead.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    this.logger.log(`SMTP configured: ${host}:${port} as ${user}`);
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Verify the transport without sending anything.
   *
   * Exposed so a misconfigured deployment is detectable on demand rather than
   * discovered when the first employee fails to receive their password.
   */
  async verify(): Promise<SendResult> {
    if (!this.transporter) {
      return { sent: false, error: 'SMTP is not configured' };
    }
    try {
      await this.transporter.verify();
      return { sent: true };
    } catch (error) {
      return { sent: false, error: (error as Error).message };
    }
  }

  async send(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<SendResult> {
    if (!this.transporter) {
      return {
        sent: false,
        error:
          'Email delivery is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS.',
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });

      this.logger.log(
        `Sent "${params.subject}" to ${params.to} (${info.messageId})`,
      );
      return { sent: true, messageId: info.messageId };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(
        `Failed to send "${params.subject}" to ${params.to}: ${message}`,
      );
      return { sent: false, error: message };
    }
  }

  /**
   * Welcome message carrying the employee's first password.
   *
   * Written for the employee who receives it, not for an administrator: plain
   * language, what to do next, and the one thing that matters -- that the
   * password is temporary.
   */
  async sendEmployeeCredentials(params: {
    to: string;
    fullName: string;
    temporaryPassword: string;
  }): Promise<SendResult> {
    const checkInUrl =
      this.configService.get<string>('APP_CHECKIN_URL') || '';

    const signInLine = checkInUrl
      ? `Open this link on your phone: ${checkInUrl}`
      : 'Open the attendance link your administrator gave you, on your phone.';

    const text = [
      `Hello ${params.fullName},`,
      ``,
      `An account has been created for you in the Klassic Field Attendance System.`,
      ``,
      `    Email:    ${params.to}`,
      `    Password: ${params.temporaryPassword}`,
      ``,
      signInLine,
      ``,
      `Sign in with the details above. When you arrive at your work site, the page`,
      `will ask for your location and your camera so it can confirm you are on`,
      `site and record your time in and time out.`,
      ``,
      `Please keep this password private. If you lose it, ask your administrator to`,
      `issue a new one.`,
      ``,
      `-- Klassic Field Attendance System`,
    ].join('\n');

    const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1c1c;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e5e4;border-radius:8px;padding:28px;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#285709;">Klassic Field Attendance</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#858585;">Your account is ready</p>

      <p style="font-size:14px;line-height:1.6;">Hello ${escapeHtml(params.fullName)},</p>
      <p style="font-size:14px;line-height:1.6;">
        An account has been created for you. Sign in with these details:
      </p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr>
          <td style="padding:10px 12px;background:#f2f7ec;border:1px solid #e3eeda;width:34%;"><strong>Email</strong></td>
          <td style="padding:10px 12px;background:#ffffff;border:1px solid #e3eeda;word-break:break-all;">${escapeHtml(params.to)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f2f7ec;border:1px solid #e3eeda;"><strong>Password</strong></td>
          <td style="padding:10px 12px;background:#ffffff;border:1px solid #e3eeda;font-family:Consolas,monospace;font-size:15px;letter-spacing:0.5px;">${escapeHtml(params.temporaryPassword)}</td>
        </tr>
      </table>

      ${
        checkInUrl
          ? `<p style="font-size:14px;line-height:1.6;">
               <a href="${escapeHtml(checkInUrl)}" style="color:#285709;font-weight:bold;">Open the check-in page on your phone</a>
             </p>`
          : ''
      }

      <p style="font-size:14px;line-height:1.6;">
        When you arrive at your work site, the page will ask for your location and
        your camera so it can confirm you are on site and record your time in and
        time out.
      </p>

      <p style="font-size:13px;line-height:1.6;color:#858585;border-top:1px solid #e6e5e4;padding-top:16px;margin-top:24px;">
        Keep this password private. If you lose it, ask your administrator to issue
        a new one.
      </p>
    </div>
  </body>
</html>`.trim();

    return this.send({
      to: params.to,
      subject: 'Your Klassic attendance account',
      text,
      html,
    });
  }
}

/**
 * Minimal HTML escaping for values interpolated into the email body.
 *
 * A name or email address containing `<` would otherwise be parsed as markup.
 * Nothing here is trusted input -- the employee's own name is administrator-
 * supplied and the address comes from the request.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
