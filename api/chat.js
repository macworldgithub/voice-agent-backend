// api/chat.js
import cors from 'cors';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    const clientMessages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const model = req.body.model || 'grok-3-beta';

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...clientMessages,
    ];

    const payload = {
      model,
      messages,
      temperature: typeof req.body.temperature === 'number' ? req.body.temperature : 0.7,
      max_tokens: typeof req.body.max_tokens === 'number' ? req.body.max_tokens : 300,
    };

    const data = await callXAIChat(payload);
    const assistantText = data?.choices?.[0]?.message?.content ?? '';

    return res.status(200).json({
      assistant: assistantText,
      raw: data,
    });
  } catch (err) {
    console.error('chat error:', err);
    const status = err?.response?.status || 500;
    const errorMsg = err?.response?.data || err.message || 'Internal Server Error';
    return res.status(status).json({ error: errorMsg });
  }
}

// Optional: needed for Vercel to recognize this as an API route with body parsing
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};