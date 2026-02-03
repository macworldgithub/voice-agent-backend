// api/summary.js
import cors from 'cors';
import axios from 'axios';

const corsMiddleware = cors({
  origin: [
    'https://voice-agent-frontend-alpha.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  maxAge: 86400
});

async function callXAIChat(payload) {
  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) throw new Error('XAI_API_KEY is not set');

  const url = 'https://api.x.ai/v1/chat/completions';
  const headers = {
    Authorization: `Bearer ${XAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const resp = await axios.post(url, payload, { headers, timeout: 30000 });
  return resp.data;
}

export default async function handler(req, res) {
  // Apply CORS
  await new Promise((resolve) => corsMiddleware(req, res, resolve));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const transcript = req.body.transcript || '';
    if (!transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required and cannot be empty' });
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a concise summarizer for mortgage-related conversations. Produce a short structured summary (bullets) including: intent, key facts collected, next steps / follow-up questions.'
      },
      { role: 'user', content: transcript },
    ];

    const payload = {
      model: 'grok-3-beta',
      messages,
      max_tokens: 250,
      temperature: 0.2,
    };

    const data = await callXAIChat(payload);
    const summary = data?.choices?.[0]?.message?.content ?? '';

    return res.status(200).json({
      summary,
      raw: data,
    });
  } catch (err) {
    console.error('summary error:', err);
    const status = err?.response?.status || 500;
    const errorMsg = err?.response?.data?.error?.message || err.message || 'Internal Server Error';
    return res.status(status).json({ error: errorMsg });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};