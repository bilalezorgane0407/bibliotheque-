import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = (env.SMTP_HOST || '').trim();
  const user = (env.SMTP_USER || '').trim();
  const pass = (env.SMTP_PASS || '').trim();
  const from = (env.SMTP_FROM || user || '').trim();

  if (!host || !from) {
    return null;
  }

  const portRaw = Number(env.SMTP_PORT || '587');
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
  const secure =
    env.SMTP_SECURE === 'true' || (env.SMTP_SECURE !== 'false' && port === 465);

  return { host, port, secure, user, pass, from };
}

export function isSmtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getSmtpConfig(env) !== null;
}

export async function sendEmailViaSmtp(
  params: {
    to: string;
    subject: string;
    text: string;
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const cfg = getSmtpConfig(env);
  if (!cfg) return false;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  await transporter.sendMail({
    from: cfg.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });

  return true;
}

export async function sendEmailViaGmailApi(params: {
  accessToken: string;
  to: string;
  subject: string;
  text: string;
  from?: string;
}): Promise<boolean> {
  const lines = [
    params.from ? `From: ${params.from}` : '',
    `To: ${params.to}`,
    `Subject: =?utf-8?B?${Buffer.from(params.subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.text, 'utf-8').toString('base64'),
  ].filter(Boolean);

  const raw = Buffer.from(lines.join('\r\n'), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('Gmail API send error:', res.status, errorText);
    throw new Error(`Erreur Gmail API (${res.status}): ${errorText}`);
  }

  return true;
}

