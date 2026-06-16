import Anthropic from '@anthropic-ai/sdk';
import { fetchProducts, matchProductsToBlog, buildProductBlock, updateProductDescriptions } from './product-integration.js';
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

function getContactBlock() {
  return audience === 'vet'
    ? `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptpharmacy.com" style="color:#1a56db">www.petscriptpharmacy.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptdirect.com" style="color:#1a56db">www.petscriptdirect.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscriptdirect.com" style="color:#1a56db">info@petscriptdirect.com</a></li></ul></div>`;
}

// ── STEP 1: Find a trending topic and real source articles ───
async function researchTopicAndArticles() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const usedKeywords = getUsedKeywords();
  const recentTitles = getRecentTitles();
  const siteUrl = audience === 'vet' ? 'petscriptpharmacy.com' : 'petscriptdirect.com';

  const sources = audience === 'vet'
    ? 'avma.org, wedgewoodpharmacy.com, mixlab.com, covetrus.com, veterinarypracticenews.com, dvm360.com'
    : 'akc.org, petmd.com, catvills.com, preventivevet.com, thesprucepets.com';

  const prompt = audience === 'vet'
    ? `You are a veterinary content researcher. Search these sources for trending topics relevant to veterinary compounding pharmacy: ${sources}

Find ONE trending topic from the past 30 days that veterinarians are searching for. 

AVOID these recently covered topics: ${usedKeywords.slice(-10).join(', ')}
AVOID topics similar to these recent titles: ${recentTitles.join(' | ')}
AVOID any topic that requires medication dosing, treatment protocols, or drug administration details.

Good topic types: pharmacy partnerships, medication availability, regulatory updates, practice efficiency, specific conditions that benefit from compounding (described informatively, not clinically), client communication, industry trends.

Search for 2-3 real articles on the chosen topic from the sources above. Read their key points.

Return ONLY valid JSON:
{
  "keyword": "primary SEO keyword phrase",
  "topic": "specific topic angle",
  "search_volume": "high/medium/low",
  "sources": [
    {"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2", "point 3"]}
  ],
  "pexels_query": "3 words for warm real photo e.g. veterinarian with dog"
}`
    : `Search these pet owner sources for trending pet health topics related to pet medications: ${sources}

Find ONE topic pet owners are searching for right now.
AVOID: ${recentTitles.join(' | ')}
AVOID any dosing or treatment protocol details.

Search for 2-3 real articles. Return ONLY valid JSON:
{
  "keyword": "primary SEO keyword phrase",
  "topic": "specific angle for pet owners",
  "search_volume": "high/medium/low",
  "sources": [
    {"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2", "point 3"]}
  ],
  "pexels_query": "3 words warm pet lifestyle photo"
}`;

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
    console.log(`Keyword: ${parsed.keyword}`);
    console.log(`Topic: ${parsed.topic}`);
    console.log(`Volume: ${parsed.search_volume}`);
    console.log(`Sources found: ${parsed.sources?.length || 0}`);
    parsed.sources?.forEach(s => console.log(`  • ${s.title}`));
    return parsed;
  }
  throw new Error('Could not parse topic research response');
}

// ── STEP 2: Write blog post based on real source material ────
async function generateBlogPost(researchData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';
  const storeName = audience === 'vet' ? 'PetScript Pharmacy' : 'PetScript Direct';

  // Build source material summary
  const sourceMaterial = researchData.sources?.map(s =>
    `SOURCE: ${s.title} (${s.url})\nKEY POINTS:\n${s.key_points?.map(p => `- ${p}`).join('\n')}`
  ).join('\n\n') || 'No sources found — write from general knowledge on the topic.';

  const prompt = `You are a professional copywriter writing for ${storeName}, a veterinary compounding pharmacy.

TASK: Write a blog post based on the source material below. 
- Use the key points from the sources as your factual foundation
- Rewrite everything in fresh, original language — never copy phrases directly
- Write clearly and specifically (avoid vague marketing speak)
- Use benefits over features — tell the reader what this means for THEM
- Audience: ${audience === 'vet' ? 'veterinarians, vet techs, clinic managers' : 'pet owners who love their animals'}
- Tone: ${audience === 'vet' ? 'professional, warm, knowledgeable peer' : 'friendly, caring, easy to understand'}

PRIMARY KEYWORD: "${researchData.keyword}"
TOPIC ANGLE: ${researchData.topic}

SOURCE MATERIAL TO BASE THE POST ON:
${sourceMaterial}

REQUIREMENTS:
- Use keyword naturally in title, at least one H2, and 2-3x in body
- Link to ${siteUrl} at least once naturally
- NEVER include dosing amounts, mg/kg values, or administration instructions
- End with a strong call-to-action
- 500-700 words
- Clean HTML body only (h2, h3, p, ul, li tags)

Respond with EXACTLY this format — each label at the START of a line:
TITLE: your title here
META: 150-160 char meta description
TAGS: tag1, tag2, tag3, tag4
PEXELS: 3 words for real lifestyle photo
BODY: full HTML blog body here`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  console.log('Stop reason:', response.stop_reason);
  console.log('Content blocks:', response.content.length);

  const text = response.content.find(b => b.type === 'text')?.text || '';
  console.log('Response length:', text.length);

  if (!text) {
    throw new Error(`Claude refused or returned empty response. Stop reason: ${response.stop_reason}`);
  }

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
    console.error('Raw response preview:\n', text.slice(0, 300));
    throw new Error('Could not parse TITLE from response');
  }

  return {
    title: sections['TITLE'],
    meta: sections['META'] || '',
    tags: (sections['TAGS'] || '').split(',').map(t => t.trim()).filter(Boolean),
    pexelsQuery: sections['PEXELS'] || researchData.pexels_query || 'veterinarian dog',
    body: sections['BODY'] || '',
  };
}

async function fetchPexelsImage(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const fallbacks = CONFIG.unsplashQueries || ['veterinarian dog', 'happy pet owner'];
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

// ── Upload image buffer to imgbb ─────────────────────────────
async function uploadToImgbb(b64) {
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) { console.warn('No IMGBB_API_KEY'); return null; }
  try {
    const uploadRes = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `image=${encodeURIComponent(b64)}`,
    });
    const uploadData = await uploadRes.json();
    console.log('imgbb status:', uploadRes.status, '| success:', uploadData?.success);
    if (uploadData?.success) {
      const url = uploadData.data?.url;
      console.log('✅ imgbb URL:', url?.slice(0, 60));
      return url;
    }
    console.warn('imgbb error:', JSON.stringify(uploadData).slice(0, 200));
    return null;
  } catch (err) {
    console.warn('imgbb exception:', err.message);
    return null;
  }
}

// ── Generate image via DALL-E 3 ─────────────────────────────
async function generateDalleImage(blogTitle, blogKeyword, pexelsQuery) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  // Build a specific, on-brand prompt based on the blog topic
  const topicLower = `${blogTitle} ${blogKeyword}`.toLowerCase();
  
  let scenePrompt;
  if (topicLower.includes('fip') || topicLower.includes('cat')) {
    scenePrompt = 'A veterinarian gently examining a healthy orange tabby cat on a clinic table, warm natural lighting, the vet is smiling, bright modern clinic background';
  } else if (topicLower.includes('anxiety') || topicLower.includes('behavioral')) {
    scenePrompt = 'A happy calm golden retriever sitting next to its smiling owner on a couch at home, warm indoor lighting, cozy living room setting';
  } else if (topicLower.includes('kidney') || topicLower.includes('renal')) {
    scenePrompt = 'A caring veterinarian consulting with a pet owner about their senior cat, soft clinic lighting, both looking at the cat warmly';
  } else if (topicLower.includes('pain') || topicLower.includes('arthritis')) {
    scenePrompt = 'A senior Labrador retriever being gently examined by a kind veterinarian, warm clinic lighting, the dog looks relaxed and calm';
  } else if (topicLower.includes('dog') || topicLower.includes('canine')) {
    scenePrompt = 'A happy healthy dog being examined by a smiling veterinarian in a bright modern clinic, warm natural lighting';
  } else if (topicLower.includes('compounding') || topicLower.includes('pharmacy') || topicLower.includes('medication')) {
    scenePrompt = 'A veterinarian and a pharmacist having a friendly professional conversation in a bright modern veterinary clinic, both smiling';
  } else if (topicLower.includes('kitten') || topicLower.includes('feline')) {
    scenePrompt = 'A happy cat owner cuddling a fluffy kitten at home, warm soft lighting, cozy and loving atmosphere';
  } else {
    // Generic warm vet scene
    scenePrompt = `A warm friendly veterinary scene: ${pexelsQuery}, photorealistic, natural lighting, happy pets and caring professionals`;
  }

  const fullPrompt = `${scenePrompt}. Style: photorealistic, warm and professional, bright natural lighting, no text or overlays, no pills or medicine bottles visible. Shot like a professional lifestyle photograph.`;

  try {
    console.log(`🎨 Generating DALL-E 3 image...`);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: fullPrompt,
        n: 1,
        size: '1536x1024',
        quality: 'high',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn('DALL-E error:', err.slice(0, 200));
      return null;
    }

    const data = await res.json();
    // gpt-image-1 returns base64, convert to data URL
    const b64 = data.data?.[0]?.b64_json;
    const imageUrl = data.data?.[0]?.url;
    
    if (!b64 && !imageUrl) return null;

    const finalUrl = imageUrl || `data:image/png;base64,${b64}`;
    console.log('✅ AI image generated');
    return {
      url: finalUrl,
      altText: `${blogTitle} - PetScript Pharmacy`,
      credit: 'Image generated for PetScript Pharmacy',
      creditUrl: 'https://www.petscriptpharmacy.com',
    };
  } catch (err) {
    console.warn('DALL-E generation failed:', err.message);
    return null;
  }
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

  console.log('\n🔍 Finding trending topic and real source articles...');
  const researchData = await researchTopicAndArticles();

  console.log('\n✍️  Writing blog post from source material...');
  const post = await generateBlogPost(researchData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  // ── Product integration ─────────────────────────────────────
  console.log('\n🛍  Matching products to blog topic...');
  const products = await fetchProducts(CONFIG.storeDomain, shopifyToken);
  const matchedProducts = await matchProductsToBlog(products, post.title, researchData.keyword, post.body);
  console.log(`Found ${matchedProducts.length} matching products: ${matchedProducts.map(p => p.title).join(', ') || 'none'}`);

  const productBlock = buildProductBlock(matchedProducts, CONFIG.storeDomain, post.title, researchData.keyword);

  // Try DALL-E 3 first, fall back to Pexels
  let image = null;
  if (process.env.OPENAI_API_KEY) {
    image = await generateDalleImage(post.title, researchData.keyword, post.pexelsQuery);
  }
  if (!image) {
    console.log(`\n🖼  Falling back to Pexels: "${post.pexelsQuery}"`);
    image = await fetchPexelsImage(post.pexelsQuery);
  }

  let finalBody = post.body + '\n' + productBlock + '\n' + getContactBlock();
  if (image) finalBody += `\n<p><small><em>${image.credit} | <a href="${image.creditUrl}" target="_blank" rel="noopener">View on Pexels</a></em></small></p>`;

  const blogId = await getBlogId(CONFIG.storeDomain, shopifyToken);

  console.log('\n📤 Creating Shopify draft...');
  const article = await createDraft({
    domain: CONFIG.storeDomain, token: shopifyToken, blogId,
    title: post.title, body: finalBody, summary: post.meta,
    tags: post.tags, image,
  });

  console.log(`✅ Draft created: "${article.title}"`);

  // Update product descriptions with blog keywords
  if (matchedProducts.length > 0) {
    console.log('\n🏷  Updating product descriptions with SEO keywords...');
    await updateProductDescriptions(matchedProducts, researchData.keyword, post.title, CONFIG.storeDomain, shopifyToken);
  };
  console.log(`   ID: ${article.id}`);

  markKeywordUsed(researchData.keyword);

  saveRunLog({
    date: startTime.toISOString(), audience, store: CONFIG.storeDomain,
    keyword: researchData.keyword, angle: researchData.topic,
    trending_reason: `Based on sources: ${researchData.sources?.map(s => s.title).join(', ')}`,
    search_volume: researchData.search_volume,
    sources: researchData.sources?.map(s => s.url) || [],
    title: post.title, tags: post.tags,
    articleId: article.id, articleHandle: article.handle,
    hasImage: !!image, status: 'success',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  saveRunLog({ date: new Date().toISOString(), audience, store: CONFIG?.storeDomain || 'unknown', status: 'failed', error: err.message });
  process.exit(1);
});
