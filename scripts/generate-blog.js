/**
 * PetScript Auto Blog Generator v4
 * - Google Trends keyword research via Claude web search
 * - Canva image generation instead of Unsplash
 * - Contact info in every post
 * - Run log for dashboard
 * - Duplicate blog prevention
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const LOG_FILE = path.join(__dirname, '..', 'docs', 'run-log.json');

const audience = process.env.STORE_AUDIENCE;
if (!audience) throw new Error('STORE_AUDIENCE env var required (vet or petowner)');

const { VET_CONFIG, PETOWNER_CONFIG } = await import('../config/store-config.js');
const CONFIG = audience === 'vet' ? VET_CONFIG : PETOWNER_CONFIG;

const usedKeywordsFile = path.join(CONFIG_DIR, `used-keywords-${audience}.json`);

function getUsedKeywords() {
  try {
    if (fs.existsSync(usedKeywordsFile)) return JSON.parse(fs.readFileSync(usedKeywordsFile, 'utf8'));
  } catch {}
  return [];
}

function markKeywordUsed(keyword) {
  const used = getUsedKeywords();
  const updated = [...used.filter(k => k !== keyword), keyword].slice(-20);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(usedKeywordsFile, JSON.stringify(updated, null, 2));
}

function getRecentTitles() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      return log.filter(r => r.audience === audience && r.status === 'success').slice(0, 10).map(r => r.title);
    }
  } catch {}
  return [];
}

function saveRunLog(entry) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  let log = [];
  try {
    if (fs.existsSync(LOG_FILE)) log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {}
  log.unshift(entry);
  log = log.slice(0, 90);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ── Google Trends research via Claude web search ─────────────
async function researchTrendingKeyword() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const usedKeywords = getUsedKeywords();
  const recentTitles = getRecentTitles();

  const prompt = audience === 'vet'
    ? `You are a veterinary SEO expert. Search Google Trends, AVMA news, veterinary forums, and industry news to find what veterinarians and veterinary clinic managers are actively searching for and discussing RIGHT NOW in June 2026.

Focus on topics related to:
- Veterinary compounding pharmacy partnerships
- Pet medication sourcing and supply chain for clinics  
- Pharmacy compliance, FDA regulations, and accreditation
- Veterinary practice efficiency and operations
- Animal medication formulations (transdermal, flavored, compounded)
- Specific conditions requiring compounding (FIP, kidney disease, etc.)

AVOID these recently used keywords: ${usedKeywords.slice(-10).join(', ')}
AVOID creating blogs similar to these recent titles: ${recentTitles.join(' | ')}

Search for what's trending RIGHT NOW and return ONLY valid JSON (no markdown, no backticks):
{
  "keyword": "the primary SEO keyword phrase",
  "angle": "specific timely blog angle based on current trends",
  "trending_reason": "why this topic is being searched right now",
  "search_volume": "high/medium/low estimate",
  "facts": ["specific fact 1", "specific fact 2", "specific fact 3"],
  "sources": ["source url or name 1", "source 2"]
}`
    : `Search for what pet owners are actively searching for RIGHT NOW in June 2026 related to pet health, medications, and pharmacy.
AVOID these recent titles: ${recentTitles.join(' | ')}
Return ONLY valid JSON (no markdown):
{
  "keyword": "primary SEO keyword",
  "angle": "relatable angle for pet owners",
  "trending_reason": "why trending now",
  "search_volume": "high/medium/low",
  "facts": ["fact1", "fact2"],
  "sources": ["source1"]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });
    const textContent = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`\n📊 Trend data:`);
      console.log(`   Keyword: ${parsed.keyword}`);
      console.log(`   Search volume: ${parsed.search_volume || 'unknown'}`);
      console.log(`   Trending because: ${parsed.trending_reason}`);
      if (parsed.facts?.length) parsed.facts.forEach(f => console.log(`   • ${f}`));
      return parsed;
    }
  } catch (err) {
    console.warn('Trend research failed:', err.message);
  }
  return {
    keyword: audience === 'vet' ? 'veterinary compounding pharmacy partner' : 'compounding pharmacy for pets',
    angle: 'A practical guide for ' + (audience === 'vet' ? 'veterinary practices' : 'pet owners'),
    trending_reason: 'Evergreen topic — fallback used',
    search_volume: 'medium',
    facts: [],
    sources: []
  };
}

// ── Generate blog post via Claude ────────────────────────────
async function generateBlogPost(keyword, trendData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contactBlock = audience === 'vet'
    ? `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li><a href="https://www.petscriptpharmacy.com" style="color:#1a56db">www.petscriptpharmacy.com</a></li><li>Call us: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li><a href="https://www.petscriptdirect.com" style="color:#1a56db">www.petscriptdirect.com</a></li><li>Call us: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`;

  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  const userPrompt = `Write a blog post for ${audience === 'vet' ? 'veterinary professionals' : 'pet owners'}.

PRIMARY SEO KEYWORD: "${keyword}"
TOPIC ANGLE: ${trendData.angle}
TRENDING REASON: ${trendData.trending_reason}
${trendData.facts?.length > 0 ? `KEY FACTS TO USE: ${trendData.facts.join('; ')}` : ''}

STRICT REQUIREMENTS:
- Work keyword naturally into title, at least one H2, and 2-3x in body
- Link to ${siteUrl} at least once naturally in the body text
- NEVER include dosing guidelines, dosage amounts, or administration instructions
- End with a strong call-to-action paragraph
- Append this exact HTML contact block at the very end of the BODY: ${contactBlock}

Return EXACTLY these 5 labeled sections with no extra text:
TITLE: [max 60 chars, includes keyword]
META: [150-160 char meta description with keyword]
TAGS: [4-6 comma-separated SEO tags]
CANVA_PROMPT: [describe a professional, warm, NON-pharmacy image for Canva — e.g. "A veterinarian warmly greeting a golden retriever in a bright clinic" or "Happy cat owner cuddling a tabby cat at home" — real lifestyle scene, no pills/bottles/labs]
BODY: [full HTML body only — h2/h3 tags, paragraphs, include contact block at end]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2500,
    system: CONFIG.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  const extract = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:TITLE|META|TAGS|CANVA_PROMPT|BODY):|$)`));
    return match ? match[1].trim() : '';
  };

  return {
    title: extract('TITLE'),
    meta: extract('META'),
    tags: extract('TAGS').split(',').map(t => t.trim()).filter(Boolean),
    canvaPrompt: extract('CANVA_PROMPT'),
    body: extract('BODY'),
  };
}

// ── Generate image via Canva API ─────────────────────────────
async function generateCanvaImage(prompt, title) {
  const canvaToken = process.env.CANVA_API_TOKEN;
  if (!canvaToken) {
    console.warn('No CANVA_API_TOKEN — skipping image');
    return null;
  }

  try {
    console.log(`🎨 Generating Canva image: "${prompt}"`);

    const designType = audience === 'vet' ? 'BLOG_BANNER' : 'BLOG_BANNER';

    const createRes = await fetch('https://api.canva.com/rest/v1/autofills', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${canvaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        brand_template_id: null,
        title: title,
        data: { image_description: prompt }
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.warn('Canva autofill failed:', err);
      return null;
    }

    const job = await createRes.json();
    const jobId = job.job?.id;
    if (!jobId) return null;

    // Poll for completion
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.canva.com/rest/v1/autofills/${jobId}`, {
        headers: { 'Authorization': `Bearer ${canvaToken}` },
      });
      const pollData = await pollRes.json();
      if (pollData.job?.status === 'success') {
        const designId = pollData.job?.result?.design?.id;
        if (designId) {
          const exportUrl = await exportCanvaDesign(designId, canvaToken);
          return exportUrl;
        }
      }
      if (pollData.job?.status === 'failed') break;
    }
    return null;
  } catch (err) {
    console.warn('Canva image generation error:', err.message);
    return null;
  }
}

async function exportCanvaDesign(designId, token) {
  const exportRes = await fetch(`https://api.canva.com/rest/v1/exports`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      design_id: designId,
      format: 'jpg',
      export_quality: 'pro',
    }),
  });
  const exportData = await exportRes.json();
  const exportJobId = exportData.job?.id;
  if (!exportJobId) return null;

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.canva.com/rest/v1/exports/${exportJobId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const pollData = await poll.json();
    if (pollData.job?.status === 'success') {
      return pollData.job?.urls?.[0] || null;
    }
    if (pollData.job?.status === 'failed') break;
  }
  return null;
}

// ── Shopify helpers ──────────────────────────────────────────
async function getShopifyToken(storeDomain, clientId, clientSecret) {
  const url = `https://${storeDomain}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Shopify token failed: ${JSON.stringify(data)}`);
  console.log('Got Shopify token');
  return data.access_token;
}

async function shopifyGraphQL(storeDomain, token, query, variables = {}) {
  const res = await fetch(`https://${storeDomain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json;
}

async function getShopifyBlogId(storeDomain, token) {
  if (CONFIG.blogId) return CONFIG.blogId;
  const res = await shopifyGraphQL(storeDomain, token, `{ blogs(first:5){ edges{ node{ id title } } } }`);
  const blogs = res.data?.blogs?.edges;
  if (!blogs?.length) throw new Error('No blogs found');
  console.log('Blog:', blogs[0].node.title, blogs[0].node.id);
  return blogs[0].node.id;
}

async function createShopifyDraft({ storeDomain, token, blogId, title, body, summary, tags, imageUrl, authorName }) {
  const mutation = `
    mutation articleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id title handle }
        userErrors { field message }
      }
    }`;
  const articleInput = { blogId, title, body, summary, tags, isPublished: false, author: { name: authorName } };
  if (imageUrl) articleInput.image = { url: imageUrl, altText: title };
  const result = await shopifyGraphQL(storeDomain, token, mutation, { article: articleInput });
  const { article, userErrors } = result.data.articleCreate;
  if (userErrors?.length) throw new Error(`Shopify errors: ${JSON.stringify(userErrors)}`);
  return article;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const startTime = new Date();
  const storeLabel = audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)';
  console.log(`\n🚀 ${storeLabel}`);
  console.log(`📅 ${startTime.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`);

  const storeDomain = CONFIG.storeDomain;
  const clientId = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_ID : process.env.SHOPIFY_DIRECT_CLIENT_ID;
  const clientSecret = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_SECRET : process.env.SHOPIFY_DIRECT_CLIENT_SECRET;

  const shopifyToken = await getShopifyToken(storeDomain, clientId, clientSecret);

  console.log('\n🔍 Researching trending keywords via Google Trends...');
  const trendData = await researchTrendingKeyword();

  console.log('\n✍️  Writing blog post...');
  const post = await generateBlogPost(trendData.keyword, trendData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);
  console.log(`🎨 Image prompt: ${post.canvaPrompt}`);

  // Generate Canva image
  let imageUrl = null;
  if (process.env.CANVA_API_TOKEN) {
    imageUrl = await generateCanvaImage(post.canvaPrompt, post.title);
    if (imageUrl) console.log('✅ Canva image generated');
    else console.warn('⚠️  Canva image failed — posting without image');
  } else {
    console.log('ℹ️  No CANVA_API_TOKEN set — skipping image');
  }

  const blogId = await getShopifyBlogId(storeDomain, shopifyToken);

  console.log('\n📤 Creating Shopify draft...');
  const article = await createShopifyDraft({
    storeDomain, token: shopifyToken, blogId,
    title: post.title, body: post.body, summary: post.meta,
    tags: post.tags, imageUrl, authorName: CONFIG.authorName,
  });

  console.log(`✅ Draft created: "${article.title}"`);
  console.log(`   Shopify ID: ${article.id}`);

  markKeywordUsed(trendData.keyword);

  saveRunLog({
    date: startTime.toISOString(),
    audience,
    store: storeDomain,
    keyword: trendData.keyword,
    angle: trendData.angle,
    trending_reason: trendData.trending_reason,
    search_volume: trendData.search_volume || 'unknown',
    facts: trendData.facts || [],
    sources: trendData.sources || [],
    title: post.title,
    tags: post.tags,
    articleId: article.id,
    articleHandle: article.handle,
    hasImage: !!imageUrl,
    status: 'success',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  saveRunLog({
    date: new Date().toISOString(),
    audience,
    store: CONFIG?.storeDomain || 'unknown',
    status: 'failed',
    error: err.message,
  });
  process.exit(1);
});
