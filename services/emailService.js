const nodemailer = require('nodemailer');

// Create reusable transporter
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  return transporter;
};

// Verify email configuration
const verifyEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email server is ready to send messages');
    return true;
  } catch (error) {
    console.error('Email configuration error:', error);
    return false;
  }
};

// Send password reset email
const sendPasswordResetEmail = async (email, resetToken, userName = 'User') => {
  try {
    const transporter = createTransporter();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'StyleStore'}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request - StyleStore',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 20px 0; text-align: center; background-color: #2563eb;">
                <h1 style="margin: 0; color: #ffffff; font-size: 28px;">
                  Style<span style="color: #ffffff;">Store</span>
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 40px 20px; background-color: #ffffff;">
                <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto;">
                  <tr>
                    <td>
                      <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">
                        Password Reset Request
                      </h2>
                      <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Hello ${userName},
                      </p>
                      <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        We received a request to reset your password for your StyleStore account. Click the button below to reset your password:
                      </p>
                      <table role="presentation" style="width: 100%; margin: 30px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="${resetUrl}" 
                               style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                              Reset Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="color: #2563eb; font-size: 14px; word-break: break-all; margin: 10px 0;">
                        ${resetUrl}
                      </p>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                        This link will expire in 10 minutes for security reasons.
                      </p>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                        If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px; text-align: center; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  © ${new Date().getFullYear()} StyleStore. All rights reserved.
                </p>
                <p style="color: #9ca3af; font-size: 12px; margin: 10px 0 0 0;">
                  This is an automated email, please do not reply.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
        Password Reset Request - StyleStore
        
        Hello ${userName},
        
        We received a request to reset your password for your StyleStore account.
        
        Click the following link to reset your password:
        ${resetUrl}
        
        This link will expire in 10 minutes for security reasons.
        
        If you didn't request a password reset, please ignore this email or contact support if you have concerns.
        
        © ${new Date().getFullYear()} StyleStore. All rights reserved.
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
};

const sendOtpEmail = async (email, otp) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'StyleStore'}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your Registration OTP - StyleStore',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your OTP Code</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 20px 0; text-align: center; background-color: #2563eb;">
                <h1 style="margin: 0; color: #ffffff; font-size: 28px;">
                  Style<span style="color: #ffffff;">Store</span>
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 40px 20px; background-color: #ffffff;">
                <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto;">
                  <tr>
                    <td>
                      <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">
                        Your Verification Code
                      </h2>
                      <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Hello,
                      </p>
                      <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Please use the following OTP to complete your registration process:
                      </p>
                      <table role="presentation" style="width: 100%; margin: 30px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <span style="display: inline-block; padding: 14px 32px; background-color: #f3f4f6; color: #111827; border-radius: 8px; font-weight: bold; font-size: 24px; letter-spacing: 4px;">
                              ${otp}
                            </span>
                          </td>
                        </tr>
                      </table>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                        This code will expire in 10 minutes.
                      </p>
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                        If you didn't request this, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px; text-align: center; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  © ${new Date().getFullYear()} StyleStore. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw new Error('Failed to send OTP email');
  }
};

module.exports = {
  createTransporter,
  verifyEmailConfig,
  sendPasswordResetEmail,
  sendOtpEmail,
  // Generic helper: sendEmail({ to, subject, html, text })
  sendEmail: async ({ to, subject, html, text }) => {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'StyleStore'}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || ''
    });
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  }
};

