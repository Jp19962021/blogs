import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const LOG_FILE = path.join(__dirname, '..', 'docs', 'run-log.json');

const audience = process.env.STORE_AUDIENCE;
if (!audience) throw new Error('STORE_AUDIENCE env var required');

const { VET_CONFIG, PETOWNER_CONFIG } = await import('../config/store-config.js');
const CONFIG = audience === 'vet' ? VET_CONFIG : PETOWNER_CONFIG;
const usedKeywordsFile = path.join(CONFIG_DIR, `used-keywords-${audience}.json`);

function getUsedKeywords() {
  try { if (fs.existsSync(usedKeywordsFile)) return JSON.parse(fs.readFileSync(usedKeywordsFile, 'utf8')); } catch {}
  return [];
}

function markKeywordUsed(kw) {
  const used = getUsedKeywords();
  const updated = [...used.filter(k => k !== kw), kw].slice(-20);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(usedKeywordsFile, JSON.stringify(updated, null, 2));
}

function getRecentTitles() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
        .filter(r => r.audience === audience && r.status === 'success')
        .slice(0, 8).map(r => r.title);
    }
  } catch {}
  return [];
}

function saveRunLog(entry) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  let log = [];
  try { if (fs.existsSync(LOG_FILE)) log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  log.unshift(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, 90), null, 2));
}

// Contact block appended AFTER Claude writes the post
function getContactBlock() {
  return audience === 'vet'
    ? `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptpharmacy.com" style="color:#1a56db">www.petscriptpharmacy.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptdirect.com" style="color:#1a56db">www.petscriptdirect.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`;
}

async function researchTrendingKeyword() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const usedKeywords = getUsedKeywords();
  const recentTitles = getRecentTitles();
  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  const prompt = audience === 'vet'
    ? `Search for what veterinarians are searching for RIGHT NOW in June 2026 related to: veterinary compounding pharmacy, pet medication sourcing, FDA regulations, animal medication formulations, conditions requiring compounding.

AVOID these recently used keywords: ${usedKeywords.slice(-10).join(', ')}
AVOID blogs similar to: ${recentTitles.join(' | ')}

Return ONLY valid JSON with no extra text:
{"keyword":"primary SEO phrase","angle":"specific blog angle","trending_reason":"why trending now","search_volume":"high/medium/low","facts":["fact1","fact2","fact3"],"pexels_query":"3 words for warm vet lifestyle photo"}`
    : `Search for what pet owners are searching RIGHT NOW in June 2026 about pet health and medications.
AVOID: ${recentTitles.join(' | ')}
Return ONLY valid JSON:
{"keyword":"primary SEO phrase","angle":"relatable angle","trending_reason":"why trending","search_volume":"high/medium/low","facts":["fact1","fact2"],"pexels_query":"3 words warm pet lifestyle photo"}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log(`Keyword: ${parsed.keyword}`);
      console.log(`Trending: ${parsed.trending_reason}`);
      console.log(`Volume: ${parsed.search_volume}`);
      parsed.facts?.forEach(f => console.log(`  • ${f}`));
      return parsed;
    }
  } catch (err) {
    console.warn('Trend research failed:', err.message);
  }
  return { keyword: 'veterinary compounding pharmacy', angle: 'Practical guide', trending_reason: 'Evergreen fallback', search_volume: 'medium', facts: [], pexels_query: 'veterinarian dog' };
}

async function generateBlogPost(trendData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  const prompt = `Write a blog post for ${audience === 'vet' ? 'veterinary professionals' : 'pet owners'}.

KEYWORD: "${trendData.keyword}"
ANGLE: ${trendData.angle}
CONTEXT: ${trendData.trending_reason}
FACTS: ${trendData.facts?.join('; ') || 'none'}

Rules:
- Use keyword in title and at least one H2
- Link to ${siteUrl} naturally in body
- NEVER include dosing amounts or administration instructions
- End body with a call-to-action paragraph
- Write clean HTML for body (h2, h3, p tags only — no html/body/head tags)

Respond with EXACTLY this format — labels must be at the START of a line:
TITLE: your title here
META: your meta description here
TAGS: tag1, tag2, tag3, tag4
PEXELS: 3 words for warm lifestyle photo
BODY: your full HTML body here`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: CONFIG.systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  console.log('Response length:', text.length);

  // Line-by-line parser
  const sections = {};
  let currentLabel = null;
  let currentLines = [];
  const LABELS = new Set(['TITLE', 'META', 'TAGS', 'PEXELS', 'BODY']);

  for (const line of text.split('\n')) {
    const headerMatch = line.match(/^(TITLE|META|TAGS|PEXELS|BODY):\s*(.*)/);
    if (headerMatch && LABELS.has(headerMatch[1])) {
      if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();
      currentLabel = headerMatch[1];
      currentLines = headerMatch[2] ? [headerMatch[2]] : [];
    } else if (currentLabel) {
      currentLines.push(line);
    }
  }
  if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();

  console.log('Sections parsed:', Object.keys(sections).join(', '));

  if (!sections['TITLE']) {
    console.error('Raw response:\n', text.slice(0, 500));
    throw new Error('Could not parse TITLE from Claude response');
  }

  return {
    title: sections['TITLE'],
    meta: sections['META'] || '',
    tags: (sections['TAGS'] || '').split(',').map(t => t.trim()).filter(Boolean),
    pexelsQuery: sections['PEXELS'] || trendData.pexels_query || 'veterinarian dog',
    body: sections['BODY'] || '',
  };
}

async function fetchPexelsImage(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const fallbacks = CONFIG.unsplashQueries || ['veterinarian dog', 'happy pet owner', 'cat owner smiling'];
  const queries = [query, ...fallbacks].slice(0, 5);
  for (const q of queries) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=15`, {
        headers: { Authorization: apiKey }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.photos?.length) {
        const pick = data.photos[Math.floor(Math.random() * Math.min(8, data.photos.length))];
        console.log(`Photo by ${pick.photographer} on Pexels`);
        return { url: pick.src.large2x || pick.src.large, altText: pick.alt || q, credit: `Photo by ${pick.photographer} on Pexels`, creditUrl: pick.photographer_url };
      }
    } catch (err) { console.warn(`Pexels "${q}" failed:`, err.message); }
  }
  return null;
}

async function getShopifyToken(domain, clientId, clientSecret) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Shopify token failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function shopifyGQL(domain, token, query, variables = {}) {
  const res = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json;
}

async function getBlogId(domain, token) {
  if (CONFIG.blogId) return CONFIG.blogId;
  const res = await shopifyGQL(domain, token, `{ blogs(first:5){ edges{ node{ id title } } } }`);
  const blogs = res.data?.blogs?.edges;
  if (!blogs?.length) throw new Error('No blogs found');
  console.log(`Blog: ${blogs[0].node.title}`);
  return blogs[0].node.id;
}

async function createDraft({ domain, token, blogId, title, body, summary, tags, image }) {
  const mutation = `mutation articleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id title handle }
      userErrors { field message }
    }
  }`;
  const articleInput = { blogId, title, body, summary, tags, isPublished: false, author: { name: CONFIG.authorName } };
  if (image) articleInput.image = { url: image.url, altText: image.altText };
  const result = await shopifyGQL(domain, token, mutation, { article: articleInput });
  const { article, userErrors } = result.data.articleCreate;
  if (userErrors?.length) throw new Error(`Shopify: ${JSON.stringify(userErrors)}`);
  return article;
}

async function main() {
  const startTime = new Date();
  console.log(`\n🚀 ${audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)'}`);
  console.log(`📅 ${startTime.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}\n`);

  const clientId = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_ID : process.env.SHOPIFY_DIRECT_CLIENT_ID;
  const clientSecret = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_SECRET : process.env.SHOPIFY_DIRECT_CLIENT_SECRET;
  const shopifyToken = await getShopifyToken(CONFIG.storeDomain, clientId, clientSecret);
  console.log('Got Shopify token');

  console.log('\n🔍 Researching Google Trends...');
  const trendData = await researchTrendingKeyword();

  console.log('\n✍️  Writing blog post...');
  const post = await generateBlogPost(trendData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  console.log(`\n🖼  Fetching Pexels image: "${post.pexelsQuery}"`);
  const image = await fetchPexelsImage(post.pexelsQuery);

  // Append contact block + photo credit AFTER Claude's content
  let finalBody = post.body + '\n' + getContactBlock();
  if (image) finalBody += `\n<p><small><em>${image.credit} | <a href="${image.creditUrl}" target="_blank" rel="noopener">View on Pexels</a></em></small></p>`;

  const blogId = await getBlogId(CONFIG.storeDomain, shopifyToken);

  console.log('\n📤 Creating Shopify draft...');
  const article = await createDraft({ domain: CONFIG.storeDomain, token: shopifyToken, blogId, title: post.title, body: finalBody, summary: post.meta, tags: post.tags, image });

  console.log(`✅ Draft created: "${article.title}"`);
  console.log(`   ID: ${article.id}`);

  markKeywordUsed(trendData.keyword);

  saveRunLog({
    date: startTime.toISOString(), audience, store: CONFIG.storeDomain,
    keyword: trendData.keyword, angle: trendData.angle,
    trending_reason: trendData.trending_reason, search_volume: trendData.search_volume,
    facts: trendData.facts || [], title: post.title, tags: post.tags,
    articleId: article.id, articleHandle: article.handle, hasImage: !!image, status: 'success',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  saveRunLog({ date: new Date().toISOString(), audience, store: CONFIG?.storeDomain || 'unknown', status: 'failed', error: err.message });
  process.exit(1);
});
