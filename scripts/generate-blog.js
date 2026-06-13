/**
 * PetScript Auto Blog Generator v5
 * - Google Trends keyword research
 * - Pexels real lifestyle photos
 * - Contact info in every post
 * - Duplicate prevention
 * - Run log for dashboard
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

// ── Google Trends research ───────────────────────────────────
async function researchTrendingKeyword() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const usedKeywords = getUsedKeywords();
  const recentTitles = getRecentTitles();

  const prompt = audience === 'vet'
    ? `You are a veterinary SEO expert. Search Google Trends, AVMA news, veterinary forums, and industry news to find what veterinarians and veterinary clinic managers are actively searching for RIGHT NOW in June 2026.

Focus on: veterinary compounding pharmacy, pet medication sourcing, pharmacy compliance, FDA regulations, animal medication formulations, conditions requiring compounding (FIP, kidney disease, etc.)

AVOID these recently used keywords: ${usedKeywords.slice(-10).join(', ')}
AVOID blogs similar to: ${recentTitles.join(' | ')}

Return ONLY valid JSON:
{
  "keyword": "the primary SEO keyword phrase",
  "angle": "specific timely blog angle",
  "trending_reason": "why this is being searched right now",
  "search_volume": "high/medium/low",
  "facts": ["fact1", "fact2", "fact3"],
  "sources": ["source1"],
  "pexels_query": "2-3 words for a warm lifestyle photo — e.g. veterinarian dog or happy cat owner — NO pills bottles labs"
}`
    : `Search for what pet owners are actively searching RIGHT NOW in June 2026 related to pet health and medications.
AVOID recent titles: ${recentTitles.join(' | ')}
Return ONLY valid JSON:
{
  "keyword": "primary SEO keyword",
  "angle": "relatable pet owner angle",
  "trending_reason": "why trending now",
  "search_volume": "high/medium/low",
  "facts": ["fact1", "fact2"],
  "sources": ["source1"],
  "pexels_query": "2-3 words for warm lifestyle pet photo — e.g. happy dog family or cuddling cat"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log(`🔑 Keyword: ${parsed.keyword}`);
      console.log(`📈 Trending: ${parsed.trending_reason}`);
      console.log(`📊 Volume: ${parsed.search_volume}`);
      if (parsed.facts?.length) parsed.facts.forEach(f => console.log(`   • ${f}`));
      return parsed;
    }
  } catch (err) {
    console.warn('Trend research failed:', err.message);
  }
  return {
    keyword: audience === 'vet' ? 'veterinary compounding pharmacy' : 'compounding pharmacy for pets',
    angle: 'A practical guide for ' + (audience === 'vet' ? 'veterinary practices' : 'pet owners'),
    trending_reason: 'Evergreen topic — fallback',
    search_volume: 'medium',
    facts: [],
    sources: [],
    pexels_query: audience === 'vet' ? 'veterinarian dog' : 'happy dog owner',
  };
}

// ── Pexels image fetch ───────────────────────────────────────
async function fetchPexelsImage(query, fallbackQueries) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn('No PEXELS_API_KEY set');
    return null;
  }

  const queriesToTry = [query, ...fallbackQueries].slice(0, 5);

  for (const q of queriesToTry) {
    try {
      console.log(`🖼  Searching Pexels: "${q}"`);
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=15`,
        { headers: { Authorization: apiKey } }
      );
      if (!res.ok) { console.warn(`Pexels ${res.status}`); continue; }
      const data = await res.json();
      if (data.photos?.length) {
        const pick = data.photos[Math.floor(Math.random() * Math.min(8, data.photos.length))];
        console.log(`📷 Photo by ${pick.photographer} on Pexels`);
        return {
          url: pick.src.large2x || pick.src.large,
          altText: pick.alt || q,
          credit: `Photo by ${pick.photographer} on Pexels`,
          creditUrl: pick.photographer_url,
        };
      }
    } catch (err) {
      console.warn(`Pexels failed for "${q}":`, err.message);
    }
  }
  console.warn('All Pexels queries failed');
  return null;
}

// ── Generate blog post ───────────────────────────────────────
async function generateBlogPost(keyword, trendData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  const contactBlock = audience === 'vet'
    ? `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li>🌐 <a href="https://www.petscriptpharmacy.com" style="color:#1a56db">www.petscriptpharmacy.com</a></li><li>📞 <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>✉️ <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li>🌐 <a href="https://www.petscriptdirect.com" style="color:#1a56db">www.petscriptdirect.com</a></li><li>📞 <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>✉️ <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`;

  const userPrompt = `Write a blog post for ${audience === 'vet' ? 'veterinary professionals' : 'pet owners'}.

PRIMARY SEO KEYWORD: "${keyword}"
TOPIC ANGLE: ${trendData.angle}
TRENDING REASON: ${trendData.trending_reason}
${trendData.facts?.length ? `KEY FACTS: ${trendData.facts.join('; ')}` : ''}

STRICT REQUIREMENTS:
- Keyword naturally in title, at least one H2, and 2-3x in body
- Link to ${siteUrl} at least once in body
- NEVER include dosing guidelines or dosage amounts
- Strong CTA at end
- Append this contact block at the very end of BODY: ${contactBlock}

Return EXACTLY these 5 sections:
TITLE: [max 60 chars, includes keyword]
META: [150-160 char meta description]
TAGS: [4-6 comma-separated SEO tags]
PEXELS_QUERY: [2-3 words for warm lifestyle photo — vet with animal or happy pet owner — NO pills/labs/bottles]
BODY: [full HTML — h2/h3, paragraphs, contact block at end]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2500,
    system: CONFIG.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  
  console.log('\n--- RAW RESPONSE PREVIEW ---');
  console.log(text.slice(0, 400));
  console.log('--- END PREVIEW ---\n');

  // Split on labeled section headers
  const sections = {};
  const lines = text.split('\n');
  let currentLabel = null;
  let currentLines = [];
  const LABELS = ['TITLE', 'META', 'TAGS', 'PEXELS_QUERY', 'BODY'];

  for (const line of lines) {
    const headerMatch = line.match(/^(TITLE|META|TAGS|PEXELS_QUERY|BODY):\s*(.*)/);
    if (headerMatch) {
      if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();
      currentLabel = headerMatch[1];
      currentLines = headerMatch[2] ? [headerMatch[2]] : [];
    } else if (currentLabel) {
      currentLines.push(line);
    }
  }
  if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();

  const title = sections['TITLE'] || '';
  const meta = sections['META'] || '';
  const tagsRaw = sections['TAGS'] || '';
  const pexelsQuery = sections['PEXELS_QUERY'] || '';
  const body = sections['BODY'] || '';

  console.log('Parsed sections:', Object.keys(sections));

  if (!title) {
    console.error('Could not parse title. Sections found:', JSON.stringify(sections).slice(0, 500));
    throw new Error('Could not parse blog post title from Claude response');
  }

  return {
    title,
    meta,
    tags: tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
    pexelsQuery,
    body,
  };
}

// ── Shopify helpers ──────────────────────────────────────────
async function getShopifyToken(storeDomain, clientId, clientSecret) {
  const res = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
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
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json;
}

async function getShopifyBlogId(storeDomain, token) {
  if (CONFIG.blogId) return CONFIG.blogId;
  const res = await shopifyGraphQL(storeDomain, token, `{ blogs(first:5){ edges{ node{ id title } } } }`);
  const blogs = res.data?.blogs?.edges;
  if (!blogs?.length) throw new Error('No blogs found');
  console.log(`Blog: ${blogs[0].node.title}`);
  return blogs[0].node.id;
}

async function createShopifyDraft({ storeDomain, token, blogId, title, body, summary, tags, image, authorName }) {
  const mutation = `
    mutation articleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id title handle }
        userErrors { field message }
      }
    }`;
  const articleInput = { blogId, title, body, summary, tags, isPublished: false, author: { name: authorName } };
  if (image) articleInput.image = { url: image.url, altText: image.altText };
  const result = await shopifyGraphQL(storeDomain, token, mutation, { article: articleInput });
  const { article, userErrors } = result.data.articleCreate;
  if (userErrors?.length) throw new Error(`Shopify errors: ${JSON.stringify(userErrors)}`);
  return article;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const startTime = new Date();
  console.log(`\n🚀 ${audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)'}`);
  console.log(`📅 ${startTime.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}\n`);

  const clientId = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_ID : process.env.SHOPIFY_DIRECT_CLIENT_ID;
  const clientSecret = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_SECRET : process.env.SHOPIFY_DIRECT_CLIENT_SECRET;
  const shopifyToken = await getShopifyToken(CONFIG.storeDomain, clientId, clientSecret);

  console.log('🔍 Researching Google Trends...');
  const trendData = await researchTrendingKeyword();

  console.log('\n✍️  Writing blog post...');
  const post = await generateBlogPost(trendData.keyword, trendData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  const pexelsQuery = post.pexelsQuery || trendData.pexels_query || CONFIG.unsplashQueries[0];
  const image = await fetchPexelsImage(pexelsQuery, CONFIG.unsplashQueries);

  let finalBody = post.body;
  if (image) {
    finalBody += `\n<p><small><em>${image.credit} | <a href="${image.creditUrl}" target="_blank" rel="noopener">View on Pexels</a></em></small></p>`;
  }

  const blogId = await getShopifyBlogId(CONFIG.storeDomain, shopifyToken);

  console.log('\n📤 Creating Shopify draft...');
  const article = await createShopifyDraft({
    storeDomain: CONFIG.storeDomain,
    token: shopifyToken,
    blogId,
    title: post.title,
    body: finalBody,
    summary: post.meta,
    tags: post.tags,
    image,
    authorName: CONFIG.authorName,
  });

  console.log(`✅ Draft created: "${article.title}"`);
  console.log(`   ID: ${article.id}`);

  markKeywordUsed(trendData.keyword);

  saveRunLog({
    date: startTime.toISOString(),
    audience,
    store: CONFIG.storeDomain,
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
    hasImage: !!image,
    status: 'success',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  saveRunLog({ date: new Date().toISOString(), audience, store: CONFIG?.storeDomain || 'unknown', status: 'failed', error: err.message });
  process.exit(1);
});
