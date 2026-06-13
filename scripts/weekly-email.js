/**
 * PetScript Weekly Blog Recap — Klaviyo Campaign Creator
 * Runs every Friday at 8am CT via GitHub Actions
 * Reads run-log.json, builds recap email, creates Klaviyo draft campaign
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', 'docs', 'run-log.json');

const KLAVIYO_API_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const LIST_ID = 'RurBJH'; // Email List

// ── Read this week's blog runs ───────────────────────────────
function getThisWeeksRuns() {
  try {
    const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return log.filter(r =>
      r.status === 'success' &&
      new Date(r.date) >= oneWeekAgo
    );
  } catch (err) {
    console.error('Could not read run log:', err.message);
    return [];
  }
}

// ── Generate email HTML via Claude ───────────────────────────
async function generateEmailHTML(runs) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const vetRuns = runs.filter(r => r.audience === 'vet');
  const petRuns = runs.filter(r => r.audience === 'petowner');

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  const blogSummary = runs.map(r => `
- Title: ${r.title}
- Audience: ${r.audience === 'vet' ? 'Veterinary professionals' : 'Pet owners'}
- Keyword: ${r.keyword}
- Angle: ${r.angle}
- Trending reason: ${r.trending_reason}
- Blog URL: https://www.petscriptpharmacy.com/blogs/all-about-pets/${r.articleHandle}
`).join('\n');

  const prompt = `Write a professional B2B weekly recap email for PetScript Pharmacy's veterinary professional subscribers.

WEEK: ${weekLabel}
BLOGS PUBLISHED THIS WEEK:
${blogSummary}

Write a complete HTML email body (no DOCTYPE/html/head/body tags — just the inner content wrapped in a table).

Requirements:
- Professional, warm tone for veterinary professionals
- Dark blue header (#1a56db) with "PetScript Pharmacy — Weekly Veterinary Insights" and the week date
- Greeting: "Hi {{ first_name|default:'Doctor' }},"
- Brief 2-sentence intro about this week's topics
- One card per blog post with: category label, title, 3-4 bullet points summarizing key takeaways, blue "Read the full post →" button linking to the blog URL
- Blue CTA block at bottom: "Questions? Call 866-784-6915 or email info@petscript.net" with buttons for website and phone
- Dark footer with unsubscribe: {{ unsubscribe_url }}
- Include petscriptpharmacy.com links throughout
- Clean table-based email HTML, inline styles only, max-width 620px
- No placeholder text — write real compelling copy based on the actual blog topics above`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find(b => b.type === 'text')?.text || '';
}

// ── Klaviyo API helpers ──────────────────────────────────────
async function klaviyoRequest(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://a.klaviyo.com/api/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
      'Content-Type': 'application/json',
      'revision': '2024-10-15',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Klaviyo ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function createEmailTemplate(name, html) {
  const result = await klaviyoRequest('templates/', 'POST', {
    data: {
      type: 'template',
      attributes: {
        name,
        editor_type: 'CODE',
        html,
      },
    },
  });
  return result.data.id;
}

async function createCampaign(name, subjectLine, previewText) {
  const sendDate = new Date();
  sendDate.setHours(sendDate.getHours() + 1);

  const result = await klaviyoRequest('campaigns/', 'POST', {
    data: {
      type: 'campaign',
      attributes: {
        name,
        audiences: {
          included: [LIST_ID],
        },
        send_strategy: {
          method: 'static',
          options_static: {
            datetime: sendDate.toISOString(),
          },
        },
        tracking_options: {
          is_tracking_opens: true,
          is_tracking_clicks: true,
        },
      },
    },
  });

  const campaignId = result.data.id;
  const messageId = result.data.relationships?.['campaign-messages']?.data?.[0]?.id;

  // Update message with subject and preview
  if (messageId) {
    await klaviyoRequest(`campaign-messages/${messageId}/`, 'PATCH', {
      data: {
        type: 'campaign-message',
        id: messageId,
        attributes: {
          content: {
            subject: subjectLine,
            preview_text: previewText,
            from_email: 'info@petscript.net',
            from_label: 'PetScript Pharmacy',
          },
        },
      },
    });
  }

  return { campaignId, messageId };
}

async function assignTemplateToMessage(messageId, templateId) {
  await klaviyoRequest(`campaign-messages/${messageId}/relationships/template/`, 'POST', {
    data: {
      type: 'template',
      id: templateId,
    },
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('\n📧 PetScript Weekly Email Generator');
  console.log(`📅 ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full' })}\n`);

  const runs = getThisWeeksRuns();
  console.log(`Found ${runs.length} blog posts this week`);

  if (runs.length === 0) {
    console.log('No blog posts this week — skipping email.');
    process.exit(0);
  }

  runs.forEach(r => console.log(`  - ${r.title} (${r.audience})`));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  // Build subject from top keywords
  const keywords = runs.slice(0, 2).map(r => r.keyword).join(' + ');
  const subjectLine = `This week in veterinary pharmacy: ${keywords}`;
  const previewText = `${runs.length} new posts from PetScript Pharmacy — read the weekly recap.`;

  console.log('\n✍️  Generating email HTML...');
  const emailHTML = await generateEmailHTML(runs);
  console.log(`Email HTML length: ${emailHTML.length} chars`);

  console.log('\n📤 Creating Klaviyo template...');
  const templateId = await createEmailTemplate(
    `PetScript Weekly Recap — ${weekLabel}`,
    emailHTML
  );
  console.log(`Template created: ${templateId}`);

  console.log('📤 Creating Klaviyo campaign draft...');
  const { campaignId, messageId } = await createCampaign(
    `PetScript Weekly Blog Recap — ${weekLabel}`,
    subjectLine,
    previewText
  );
  console.log(`Campaign created: ${campaignId}`);

  if (messageId && templateId) {
    await assignTemplateToMessage(messageId, templateId);
    console.log('Template assigned to campaign message');
  }

  console.log(`\n✅ Done! Review your campaign draft in Klaviyo:`);
  console.log(`   https://www.klaviyo.com/campaign/${campaignId}/wizard`);
  console.log('\nSubject line:', subjectLine);
  console.log('Send to: Email List (RurBJH)');
  console.log('Status: DRAFT — review and schedule before sending');
}

main().catch(err => {
  console.error('❌ Weekly email failed:', err.message);
  process.exit(1);
});
