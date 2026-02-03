// api/summary.js
import axios from 'axios';

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
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
        content: 'You are a concise summarizer for mortgage-related conversations. Produce a short structured summary (bullets) including: intent, key facts collected, next steps / follow-up questions.',
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
    const errorMsg = err?.response?.data || err.message || 'Internal Server Error';
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