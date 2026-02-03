// api/email.js
import multer from 'multer';
import nodemailer from 'nodemailer';

const upload = multer({ storage: multer.memoryStorage() });

export const config = {
  api: {
    bodyParser: false, // Important: disable built-in body parser → let multer handle multipart/form-data
  },
};

function escapeHtml(unsafe = '') {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const runMiddleware = (req, res, fn) =>
  new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Parse multipart form-data (includes file + fields)
    await runMiddleware(req, res, upload.single('recording'));

    const transcript = req.body.transcript || '';
    const summary = req.body.summary || '';
    const file = req.file; // may be undefined

    // ── SMTP config ────────────────────────────────────────────────
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpSecure = process.env.SMTP_SECURE !== 'false';
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const emailFrom = process.env.EMAIL_FROM;
    const emailTo = process.env.EMAIL_TO;

    if (!smtpHost || !smtpUser || !smtpPass || !emailFrom || !emailTo) {
      return res.status(500).json({
        error: 'Missing SMTP environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO)',
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false }, // ← often needed for self-signed certs / dev
    });

    // Build HTML body
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; line-height:1.5; color:#111;">
        <h1>Mortgage Inquiry — Call Summary</h1>
        <p style="color:#666;">Summary, transcript${file ? ' and recording' : ''} attached.</p>

        <h2>Summary</h2>
        <div style="background:#f8f9fa; padding:12px; border-radius:6px; white-space:pre-wrap;">
          ${escapeHtml(summary) || 'No summary provided.'}
        </div>

        <h2>Full Transcript</h2>
        <div style="background:#f8f9fa; padding:12px; border-radius:6px; max-height:500px; overflow:auto; white-space:pre-wrap;">
          ${escapeHtml(transcript) || 'No transcript provided.'}
        </div>

        <p style="margin-top:1.5rem; color:#666; font-size:0.9em;">
          Sent from Omni Mortgage Voice Agent
        </p>
      </div>
    `;

    const attachments = [
      {
        filename: 'summary.txt',
        content: summary || 'No summary provided.',
      },
      {
        filename: 'transcript.txt',
        content: transcript || 'No transcript provided.',
      },
    ];

    if (file?.buffer) {
      attachments.unshift({
        filename: file.originalname || 'recording.webm',
        content: file.buffer,
        contentType: file.mimetype || 'audio/webm',
      });
    }

    const mailOptions = {
      from: emailFrom,
      to: emailTo,
      subject: 'Omni Mortgage — Call Summary & Recording',
      html: htmlBody,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    return res.status(200).json({
      ok: true,
      messageId: info.messageId,
    });
  } catch (err) {
    console.error('email endpoint error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to send email',
    });
  }
}