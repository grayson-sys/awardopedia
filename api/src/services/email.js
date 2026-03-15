import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendMagicLink(email, token) {
  const url = `${process.env.APP_URL || 'https://awardopedia.com'}/credits?token=${token}`;

  const msg = {
    to: email,
    from: process.env.FROM_EMAIL || 'login@awardopedia.com',
    subject: 'Your Awardopedia Login Link',
    text: `Sign in to Awardopedia:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1B3A6B; font-weight: 500; margin-bottom: 16px;">Sign in to Awardopedia</h2>
        <p style="color: #6B7280; line-height: 1.5; margin-bottom: 24px;">
          Click the button below to sign in to your account. This link expires in 15 minutes.
        </p>
        <a href="${url}" style="display: inline-block; background: #1B3A6B; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">
          Sign In
        </a>
        <p style="color: #9CA3AF; font-size: 13px; margin-top: 32px; line-height: 1.5;">
          If you didn't request this email, you can safely ignore it.
        </p>
      </div>
    `,
  };

  await sgMail.send(msg);
}
