/**
 * PetScript Google Sheets Topic Manager
 * Reads topics from Google Sheet, marks used topics with date
 * Sheet ID: 1zVsQKbnL9-95-tBXIyKwTtaWWj8KKI3an0i-a_6dY7Q
 * Sheet 1 (Pharmacy) = vet B2B topics
 * Sheet 2 (Direct) = pet owner B2C topics
 * Columns: A=topic, B=status, C=date used
 */

import fetch from 'node-fetch';

const SHEET_ID = '1zVsQKbnL9-95-tBXIyKwTtaWWj8KKI3an0i-a_6dY7Q';
const SHEET_NAMES = { vet: 'Pharmacy', petowner: 'Direct' };

// ── Get Google OAuth token from service account ──────────────
async function getGoogleToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(credentials.private_key, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Read all topics from sheet ───────────────────────────────
async function readTopics(token, audience) {
  const sheetName = SHEET_NAMES[audience];
  const range = `${sheetName}!A:C`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

// ── Get next unused topic ────────────────────────────────────
export async function getNextTopic(audience) {
  try {
    console.log(`📋 Reading topics from Google Sheet (${SHEET_NAMES[audience]})...`);
    const token = await getGoogleToken();
    const rows = await readTopics(token, audience);

    // Find first row where column B is empty (unused)
    // rows[0] might be a header row — skip if it says "topic" or "status"
    const startRow = rows[0]?.[0]?.toLowerCase() === 'topic' ? 1 : 0;

    for (let i = startRow; i < rows.length; i++) {
      const topic = rows[i][0]?.trim();
      const status = rows[i][1]?.trim();

      if (topic && (!status || status === '')) {
        console.log(`✅ Found unused topic at row ${i + 1}: "${topic}"`);
        return { topic, rowIndex: i + 1 }; // 1-indexed for Sheets API
      }
    }

    console.warn('⚠️  No unused topics found in sheet — using fallback');
    return null;
  } catch (err) {
    console.warn('Google Sheets read failed:', err.message);
    return null;
  }
}

// ── Mark topic as used with today's date ─────────────────────
export async function markTopicUsed(audience, rowIndex) {
  try {
    const token = await getGoogleToken();
    const sheetName = SHEET_NAMES[audience];
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/Chicago',
      month: '2-digit', day: '2-digit', year: 'numeric'
    });

    const range = `${sheetName}!B${rowIndex}:C${rowIndex}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [['used', today]] }),
    });

    if (!res.ok) {
      console.warn('Sheets write failed:', res.status, await res.text());
    } else {
      console.log(`✅ Marked row ${rowIndex} as used in Google Sheet`);
    }
  } catch (err) {
    console.warn('Google Sheets write failed:', err.message);
  }
}

// ── Prettify raw topic into SEO title with em dash ───────────
export async function prettifyTopic(rawTopic) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Convert this raw blog topic idea into a professional SEO-optimized blog title.

Rules:
- Use Title Case (capitalize all major words)
- Use em dash (—) as separator instead of colon when the title has two parts
- Keep it under 60 characters if possible
- Make it clear, specific, and compelling
- Don't add words that weren't implied — just clean up and format
- For question topics, keep them as natural questions
- For comparison topics use "vs." format
- For medication topics include the medication name exactly as written

Examples:
"gs441524 for fip what every vet needs to know" → "GS-441524 for FIP — What Every Veterinarian Needs to Know"
"dogs vs cats who has better sense of smell" → "Dogs vs. Cats — Which Animal Has the Better Sense of Smell?"
"why does my dog run after he poops" → "Why Does My Dog Run Around After Pooping?"
"compounded pimobendan dosing small vs giant breeds" → "Compounded Pimobendan — Dosing Flexibility for Small and Giant Breeds"
"methimazole transdermal vs oral for hyperthyroid cats" → "Methimazole Transdermal vs. Oral — Which Is Better for Hyperthyroid Cats?"

Raw topic: "${rawTopic}"

Return ONLY the prettified title, nothing else.`
    }],
  });

  return response.content.find(b => b.type === 'text')?.text?.trim() || rawTopic;
}
