import { sendEmail } from './emailService';

const PLATFORM_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
  : 'https://brikvest.replit.app';

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  construction: { label: 'Construction Update', color: '#1d4ed8', bg: '#dbeafe' },
  sales:        { label: 'Sales Update',        color: '#15803d', bg: '#dcfce7' },
  financial:    { label: 'Financial Update',    color: '#7e22ce', bg: '#f3e8ff' },
  delay:        { label: 'Delay or Risk',       color: '#b91c1c', bg: '#fee2e2' },
  general:      { label: 'Announcement',        color: '#475569', bg: '#e2e8f0' },
};

function emailWrapper(content: string): string {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%); padding: 24px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">BRIKVEST</h1>
        <p style="color: #93c5fd; margin: 4px 0 0; font-size: 13px;">Project Update from Your Developer</p>
      </div>
      <div style="padding: 32px;">
        ${content}
      </div>
      <div style="background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">
          You received this because you have a confirmed investment in this Brikvest project.
        </p>
        <p style="margin: 8px 0 0;">
          <a href="${PLATFORM_URL}/dashboard" style="color: #2563eb; font-size: 12px; text-decoration: none;">View Dashboard</a>
        </p>
      </div>
    </div>
  `;
}

function badge(type: string): string {
  const meta = TYPE_META[type] || TYPE_META.general;
  return `<span style="display: inline-block; background: ${meta.bg}; color: ${meta.color}; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;">${meta.label}</span>`;
}

export async function sendProjectUpdateToInvestor(params: {
  investorEmail: string;
  investorName: string;
  propertyName: string;
  developerCompany: string;
  type: string;
  subject: string;
  body: string;
  imageUrl?: string | null;
}): Promise<boolean> {
  const { investorEmail, investorName, propertyName, developerCompany, type, subject, body, imageUrl } = params;
  return await sendEmail({
    to: investorEmail,
    subject: `${propertyName} — ${subject}`,
    html: emailWrapper(`
      <div style="margin-bottom: 12px;">${badge(type)}</div>
      <h2 style="color: #0f172a; margin: 0 0 8px; font-size: 22px;">${subject}</h2>
      <p style="color: #64748b; margin: 0 0 20px; font-size: 14px;">${propertyName} · from ${developerCompany}</p>
      ${imageUrl ? `<img src="${imageUrl}" alt="" style="width: 100%; max-height: 320px; object-fit: cover; border-radius: 8px; margin: 0 0 20px;" />` : ''}
      <p style="color: #475569; margin: 0 0 16px;">Hi ${investorName},</p>
      <div style="color: #334155; line-height: 1.7; font-size: 15px;">${body}</div>
      <div style="text-align: center; margin: 28px 0 8px;">
        <a href="${PLATFORM_URL}/dashboard" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Open Dashboard
        </a>
      </div>
    `),
  });
}
