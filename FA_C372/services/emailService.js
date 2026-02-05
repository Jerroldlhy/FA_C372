const nodemailer = require("nodemailer");

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpSecure = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser;
const appUrl = process.env.APP_URL || "http://localhost:3000";

const transporter =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })
    : null;

const sendVerificationEmail = async (email, token, name) => {
  if (!transporter) {
    console.warn("SMTP transporter not configured; skipping verification email.");
    return;
  }
  const verificationUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: "Verify your EduSphere account",
      html: `
        <p>Hi ${name || "Learner"},</p>
        <p>Thanks for signing up. Confirm your email to unlock the student dashboard.</p>
        <p><a href="${verificationUrl}">Verify your email</a></p>
        <p>If you did not sign up for EduSphere, just ignore this message.</p>
      `,
    });
  } catch (mailErr) {
    console.error("Failed to send verification email:", mailErr);
  }
};

const sendPasswordResetEmail = async (email, token, name) => {
  if (!transporter) {
    console.warn("SMTP transporter not configured; skipping password reset email.");
    return;
  }
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: "Reset your EduSphere password",
      html: `
        <p>Hi ${name || "Learner"},</p>
        <p>We received a request to reset your password.</p>
        <p><a href="${resetUrl}">Reset password</a></p>
        <p>This link expires in 30 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `,
    });
  } catch (mailErr) {
    console.error("Failed to send password reset email:", mailErr);
  }
};

const sendMail = async ({ to, subject, text, html, from, attachments }) => {
  if (!transporter) {
    throw new Error("SMTP transporter not configured.");
  }
  return transporter.sendMail({
    from: from || smtpFrom,
    to,
    subject: subject || "EduSphere notification",
    text,
    html,
    attachments: attachments || undefined,
  });
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMail,
};
