import { Resend } from 'resend';
import { config } from '../config/index.js';

// Initialize Resend client (will be null if no API key configured)
const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!resend) {
    console.warn('Email not configured (RESEND_API_KEY missing). Would have sent:', options.subject, 'to', options.to);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: config.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('Failed to send email:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Email service error:', err);
    return false;
  }
}

// ─── Email Templates ────────────────────────────────────────

export function passwordResetEmail(resetUrl: string, userName?: string): SendEmailOptions {
  const greeting = userName ? `Hi ${userName}` : 'Hi there';
  return {
    to: '', // filled by caller
    subject: 'Reset your StockClerk password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 48px; height: 48px; background: #8B7355; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 24px;">&#9673;</div>
          <h2 style="margin: 16px 0 0; color: #1a1a1a; font-size: 20px;">StockClerk</h2>
        </div>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">${greeting},</p>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #8B7355; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px; line-height: 1.5;">If you didn't request this, you can safely ignore this email. Your password won't be changed.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">StockClerk - AI-Powered Inventory Sync</p>
      </div>
    `,
    text: `${greeting},\n\nWe received a request to reset your password. Visit this link to choose a new one (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.\n\n- StockClerk`,
  };
}

export function welcomeEmail(userName?: string, loginUrl?: string): SendEmailOptions {
  const greeting = userName ? `Welcome, ${userName}!` : 'Welcome!';
  const url = loginUrl || `${config.FRONTEND_URL}/login`;
  return {
    to: '', // filled by caller
    subject: 'Welcome to StockClerk!',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 48px; height: 48px; background: #8B7355; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 24px;">&#9673;</div>
          <h2 style="margin: 16px 0 0; color: #1a1a1a; font-size: 20px;">StockClerk</h2>
        </div>
        <h1 style="color: #1a1a1a; font-size: 24px; text-align: center;">${greeting}</h1>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">Your StockClerk account is ready. You can now connect your POS system and online channels to keep inventory perfectly synchronized.</p>
        <p style="color: #333; font-size: 16px; line-height: 1.5;">Here's what you can do next:</p>
        <ul style="color: #333; font-size: 16px; line-height: 2;">
          <li>Connect your EposNow POS system</li>
          <li>Link your Wix online store</li>
          <li>Add your Deliveroo channel</li>
          <li>Set up stock buffer levels</li>
        </ul>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${url}" style="display: inline-block; background: #8B7355; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Go to Dashboard</a>
        </div>
        <p style="color: #666; font-size: 14px;">Your 14-day free trial has started. Need help? Just reply to this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">StockClerk - AI-Powered Inventory Sync</p>
      </div>
    `,
    text: `${greeting}\n\nYour StockClerk account is ready. You can now connect your POS system and online channels to keep inventory perfectly synchronized.\n\nGo to your dashboard: ${url}\n\nYour 14-day free trial has started.\n\n- StockClerk`,
  };
}

export function lowStockAlertEmail(productName: string, currentStock: number, threshold: number, dashboardUrl?: string): SendEmailOptions {
  const url = dashboardUrl || `${config.FRONTEND_URL}/products`;
  return {
    to: '', // filled by caller
    subject: `Low Stock Alert: ${productName} (${currentStock} remaining)`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 48px; height: 48px; background: #8B7355; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 24px;">&#9673;</div>
        </div>
        <div style="background: #FFF3CD; border: 1px solid #FFEEBA; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="margin: 0; color: #856404; font-weight: 600;">Low Stock Warning</p>
        </div>
        <p style="color: #333; font-size: 16px; line-height: 1.5;"><strong>${productName}</strong> has dropped to <strong>${currentStock} units</strong>, which is below your threshold of ${threshold}.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${url}" style="display: inline-block; background: #8B7355; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Products</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">StockClerk - AI-Powered Inventory Sync</p>
      </div>
    `,
    text: `Low Stock Alert: ${productName} has dropped to ${currentStock} units (threshold: ${threshold}).\n\nView products: ${url}\n\n- StockClerk`,
  };
}
