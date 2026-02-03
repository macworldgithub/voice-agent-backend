// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
// Allow all origins for dev. In production, lock this down.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const XAI_API_KEY = process.env.XAI_API_KEY;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are Jess from Omni Mortgage, a helpful agent assisting with mortgage inquiries. Engage the user in a natural conversation about obtaining a home loan. Ask relevant questions one at a time, such as:
- If they're looking to refinance or get a new loan.
- If they're a first-time buyer.
- Their budget or help figuring it out by asking annual income.
- Savings for down payment.
- Any debts.
- Family situation (e.g., kids).
- Preferred area or neighborhood.
- Preferred property type.
- At the end, offer to set up a meeting with a loan specialist.

Keep responses concise, friendly, and suitable for voice conversation. Respond based on what the user says, and ask the next logical question. Do not repeat questions unnecessarily. If the user wants to end, acknowledge and stop.`;

// --- Helper to call xAI
async function callXAIChat(payload) {
  if (!XAI_API_KEY) throw new Error('XAI_API_KEY not set.');
  const url = 'https://api.x.ai/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${XAI_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const resp = await axios.post(url, payload, { headers, timeout: 30000 });
  return resp.data;
}

// --- Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const clientMessages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const model = req.body.model || 'grok-3-beta';
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...clientMessages];

    const payload = {
      model,
      messages,
      temperature: typeof req.body.temperature === 'number' ? req.body.temperature : 0.7,
      max_tokens: typeof req.body.max_tokens === 'number' ? req.body.max_tokens : 300
    };

    const data = await callXAIChat(payload);
    const assistantText = data?.choices?.[0]?.message?.content ?? '';
    res.json({ assistant: assistantText, raw: data });
  } catch (err) {
    console.error('Error /api/chat:', err?.response?.data || err.message || err);
    res.status(500).json({ error: err?.response?.data || err.message || 'Server error' });
  }
});

// --- Summary endpoint
app.post('/api/summary', async (req, res) => {
  try {
    const transcript = req.body.transcript || '';
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    const messages = [
      { role: 'system', content: 'You are a concise summarizer for mortgage-related conversations. Produce a short structured summary (bullets) including intent, key facts, next steps.' },
      { role: 'user', content: transcript }
    ];

    const payload = {
      model: 'grok-3-beta',
      messages,
      max_tokens: 250,
      temperature: 0.2
    };

    const data = await callXAIChat(payload);
    const summary = data?.choices?.[0]?.message?.content ?? '';
    res.json({ summary, raw: data });
  } catch (err) {
    console.error('Error /api/summary:', err?.response?.data || err.message || err);
    res.status(500).json({ error: err?.response?.data || err.message || 'Server error' });
  }
});

// --- Email endpoint: accepts multipart form-data { recording: file (optional), transcript: text, summary: text }
app.post('/api/email', upload.single('recording'), async (req, res) => {
  try {
    const transcript = req.body.transcript || '';
    const summary = req.body.summary || '';
    // Recording file (optional)
    const file = req.file; // may be undefined

    // SMTP config from env
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpSecure = (process.env.SMTP_SECURE || 'true') === 'true';
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const emailFrom = process.env.EMAIL_FROM;
    const emailTo = process.env.EMAIL_TO;

    if (!smtpHost || !smtpUser || !smtpPass || !emailFrom || !emailTo) {
      return res.status(400).json({ error: 'SMTP environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO) must be set.' });
    }

    // create transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    // Compose HTML email body
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; line-height:1.4; color:#111;">
        <h1 style="margin-bottom:0.2rem;">Mortgage Inquiry — Call Summary</h1>
        <p style="margin-top:0.1rem; color:#666;">This email contains the call summary, full transcript, and the recording (attached).</p>
        <h2>Summary</h2>
        <div style="background:#f7f7f7; padding:10px; border-radius:6px;">
          <pre style="white-space:pre-wrap; font-family:inherit; margin:0;">${escapeHtml(summary)}</pre>
        </div>
        <h2 style="margin-top:1rem;">Full Transcript</h2>
        <div style="background:#fafafa; padding:10px; border-radius:6px; max-height:400px; overflow:auto;">
          <pre style="white-space:pre-wrap; font-family:inherit; margin:0;">${escapeHtml(transcript)}</pre>
        </div>
        <p style="margin-top:1rem; color:#666;">Attachments: recording (if provided), transcript.txt, summary.txt</p>
      </div>
    `;

    // attachments
    const attachments = [
      {   // transcript text
        filename: 'transcript.txt',
        content: transcript || 'No transcript provided.'
      },
      {   // summary text
        filename: 'summary.txt',
        content: summary || 'No summary provided.'
      }
    ];

    if (file && file.buffer) {
      attachments.unshift({
        filename: file.originalname || 'recording.webm',
        content: file.buffer,
        contentType: file.mimetype || 'audio/webm'
      });
    }

    const mailOptions = {
      from: emailFrom,
      to: emailTo,
      subject: 'Omni Mortgage — Call Summary & Recording',
      html: htmlBody,
      attachments
    };

    // send mail
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('Error /api/email:', err?.response || err);
    res.status(500).json({ error: err?.message || 'Failed to send email' });
  }
});

// small helper to escape HTML in transcript/summary for safety
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

app.listen(PORT, () => {
  console.log(`Voice agent backend listening on port ${PORT}`);
});
