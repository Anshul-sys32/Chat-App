const nodemailer = require("nodemailer");

const requiredSettings = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];

const getTransporter = () => {
  const missing = requiredSettings.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Email delivery is not configured. Missing: ${missing.join(", ")}`);
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
};

const sendSignupOtp = async (email, code) => {
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: "Your NFaNG verification code",
    text: `Your NFaNG verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your NFaNG verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  });
};

const sendPasswordResetOtp = async (email, code) => {
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: "Your NFaNG password reset code",
    text: `Your NFaNG password reset code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your NFaNG password reset code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  });
};

module.exports = { sendSignupOtp, sendPasswordResetOtp };
