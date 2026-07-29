/**
 * PetScript Podcast Script Generator
 * Writes a Hormozi-style 10-20 min podcast script
 * Saves to Google Docs via Drive API
 * Called after blog post is written
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

// ── Get Google OAuth token ────────────────────────────────────
async function getGoogleToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents',
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

// ── Write podcast script via Claude ──────────────────────────
async function writePodcastScript(blogTitle, blogBody, audience) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const isVet = audience === 'vet';
  const show = isVet ? 'PetScript Pharmacy Podcast' : 'PetScript Direct Podcast';
  const audienceDesc = isVet
    ? 'veterinarians, vet techs, and clinic managers who are busy professionals. They want practical, actionable information they can use in their practice today.'
    : 'pet owners who love their animals and want to understand their health better. They are not medical professionals — keep it warm, clear, and relatable.';
  const cta = isVet
    ? 'Visit petscriptpharmacy.com or call 866-784-6915'
    : 'Visit petscriptdirect.com or call 866-784-6915';

  const prompt = `You are a world-class podcast scriptwriter. Write a complete word-for-word podcast script in the style of Alex Hormozi — punchy, direct, no fluff, high value per sentence.

SHOW: ${show}
TOPIC: ${blogTitle}
BLOG CONTENT TO BASE THIS ON:
${blogBody.replace(/<[^>]*>/g, '').slice(0, 2000)}

AUDIENCE: ${audienceDesc}

HORMOZI STYLE RULES:
- Open with a bold provocative statement or surprising fact — no "welcome to the podcast" fluff
- Short punchy sentences. One idea per sentence. White space is your friend.
- NO filler phrases: "um", "you know", "kind of", "sort of", "basically", "essentially"
- NO weak openers: "Today we're going to talk about..." or "In this episode..."
- Lead with the most interesting thing — don't build up to it
- Use real numbers and specifics — not "many vets" but "8 out of 10 vets"
- Repeat the key insight in different words 2-3 times — repetition = retention
- Every segment should have ONE clear takeaway
- End each segment with a transition that makes them want to keep listening
- Closing CTA: ${cta}
- Target length: 10-20 minutes when read aloud at a natural pace (roughly 1500-2500 words)

STRUCTURE:
[COLD OPEN] — 30 seconds, no intro music cue needed, just start talking, grab attention immediately
[SEGMENT 1] — Set up the problem or context
[SEGMENT 2] — The meat — real information, real value
[SEGMENT 3] — Practical application — what to do with this information
[SEGMENT 4] — The thing most people get wrong
[OUTRO] — Wrap up, single CTA, tease next episode

Format it clearly with segment headers in brackets. Write EXACTLY what the host should say — word for word. No stage directions except [PAUSE] where natural. No music cues.

This should sound like a smart friend who happens to be an expert, not a corporate spokesperson.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find(b => b.type === 'text')?.text?.trim() || '';
}

// ── Save script to Google Doc ─────────────────────────────────
async function saveToGoogleDoc(title, script, audience, token) {
  const folderName = audience === 'vet' ? 'PetScript Pharmacy Podcast Scripts' : 'PetScript Direct Podcast Scripts';

  // Step 1: Find or create the folder
  let folderId = null;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name="${folderName}" and mimeType="application/vnd.google-apps.folder" and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files?.length > 0) {
    folderId = searchData.files[0].id;
    console.log(`📁 Using existing folder: ${folderName}`);
  } else {
    // Create folder
    const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
    });
    const folderData = await folderRes.json();
    folderId = folderData.id;
    console.log(`📁 Created folder: ${folderName}`);
  }

  // Step 2: Create the Google Doc
  const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric' });
  const docTitle = `${date} — ${title}`;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: docTitle,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    }),
  });
  const docData = await createRes.json();
  const docId = docData.id;

  // Step 3: Write content to the doc
  const requests = [
    {
      insertText: {
        location: { index: 1 },
        text: `${title}\n\n${script}`,
      },
    },
    {
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: title.length + 1 },
        paragraphStyle: { namedStyleType: 'HEADING_1' },
        fields: 'namedStyleType',
      },
    },
  ];

  await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });

  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  console.log(`✅ Podcast script saved to Google Docs: ${docUrl}`);
  return docUrl;
}

// ── Main export function ──────────────────────────────────────
export async function generateAndSavePodcastScript(blogTitle, blogBody, audience) {
  try {
    if (!process.env.GOOGLE_SHEETS_CREDENTIALS) {
      console.warn('No GOOGLE_SHEETS_CREDENTIALS — skipping podcast script');
      return null;
    }

    console.log('\n🎙️  Writing podcast script...');
    const script = await writePodcastScript(blogTitle, blogBody, audience);
    if (!script) {
      console.warn('No podcast script generated');
      return null;
    }
    console.log(`📝 Script written: ${script.split(' ').length} words (~${Math.round(script.split(' ').length / 130)} min)`);

    console.log('💾 Saving to Google Docs...');
    const token = await getGoogleToken();
    const docUrl = await saveToGoogleDoc(blogTitle, script, audience, token);

    return docUrl;
  } catch (err) {
    console.warn('Podcast script failed:', err.message);
    return null;
  }
}
