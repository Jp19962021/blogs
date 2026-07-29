import Anthropic from '@anthropic-ai/sdk';
import { postToWordPress } from './wordpress-integration.js';
import { generateAndSavePodcastScript } from './podcast-generator.js';
import { getNextTopic, markTopicUsed, prettifyTopic } from './google-sheets.js';
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
    ? `<div style="background:#EBF4FF;border-left:4px solid #003767;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#003767">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptpharmacy.com" style="color:#003767">www.petscriptpharmacy.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#003767">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#003767">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #003767;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#003767">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptdirect.com" style="color:#003767">www.petscriptdirect.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#003767">866-784-6915</a></li><li>Email: <a href="mailto:info@petscriptdirect.com" style="color:#003767">info@petscriptdirect.com</a></li></ul></div>`;
}

function buildStaticCTABlock(aud) {
  const isVet = aud === 'vet';
  const browseUrl = isVet ? 'https://www.petscriptpharmacy.com/collections/all' : 'https://www.petscriptdirect.com/collections/all';
  const phone = '866-784-6915';
  const title = isVet ? 'PetScript Pharmacy Compounded Medications' : 'PetScript Direct Compounded Medications';
  const desc = isVet
    ? 'We compound thousands of medications in flavored, chewable, transdermal, and liquid formulations — made specifically for your patients. Browse or contact us for a specific medication.'
    : 'We compound thousands of medications in flavored, chewable, transdermal, and liquid formulations — made specifically for your pet. Browse or contact us for a specific medication.';
  return `<div style="background:#EBF4FF;border-radius:8px;padding:20px 24px;margin:32px 0">
  <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#003767">🐾 ${title}</p>
  <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">${desc}</p>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <a href="${browseUrl}" style="display:inline-block;background:#003767;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:700">Browse Our Formulary →</a>
    <a href="tel:${phone}" style="display:inline-block;background:#ffffff;color:#003767;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:700;border:2px solid #003767">Call ${phone}</a>
  </div>
</div>`;
}

async function researchTopicAndArticles(topicOverride = null) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const usedKeywords = getUsedKeywords();
  const recentTitles = getRecentTitles();
  const sources = audience === 'vet'
    ? 'avma.org, wedgewoodpharmacy.com, mixlab.com, covetrus.com, veterinarypracticenews.com, dvm360.com'
    : 'akc.org, petmd.com, catvills.com, preventivevet.com, thesprucepets.com';

  const prompt = topicOverride
    ? `You are a veterinary content researcher. Search for 2-3 real articles about this specific topic: "${topicOverride}"
Search sources like: ${sources}
Return ONLY valid JSON:
{
  "keyword": "${topicOverride}",
  "topic": "${topicOverride}",
  "search_volume": "high",
  "sources": [{"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2"]}],
  "pexels_query": "3 words for warm real pet lifestyle photo"
}`
    : audience === 'vet'
    ? `You are a veterinary content researcher. Search these sources for trending topics relevant to veterinary compounding pharmacy: ${sources}
Find ONE trending topic from the past 30 days that veterinarians are searching for.
AVOID these recently covered topics: ${usedKeywords.slice(-10).join(', ')}
AVOID topics similar to these recent titles: ${recentTitles.join(' | ')}
AVOID any topic that requires medication dosing, treatment protocols, or drug administration details.
Return ONLY valid JSON:
{
  "keyword": "primary SEO keyword phrase",
  "topic": "specific topic angle",
  "search_volume": "high/medium/low",
  "sources": [{"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2"]}],
  "pexels_query": "3 words for warm real photo e.g. veterinarian with dog"
}`
    : `Search these pet owner sources for trending pet health topics: ${sources}
Find ONE topic pet owners are searching for right now.
AVOID: ${recentTitles.join(' | ')}
Return ONLY valid JSON:
{
  "keyword": "primary SEO keyword phrase",
  "topic": "specific angle for pet owners",
  "search_volume": "high/medium/low",
  "sources": [{"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2"]}],
  "pexels_query": "3 words warm pet lifestyle photo"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log(`Keyword: ${parsed.keyword}`);
      console.log(`Topic: ${parsed.topic}`);
      console.log(`Sources found: ${parsed.sources?.length || 0}`);
      parsed.sources?.forEach(s => console.log(`  • ${s.title}`));
      return parsed;
    }
  } catch (e) {
    console.warn('JSON parse failed, using fallback');
  }

  if (topicOverride) {
    return {
      keyword: topicOverride, topic: topicOverride, search_volume: 'medium', sources: [],
      pexels_query: audience === 'vet' ? 'veterinarian dog clinic' : 'happy pet owner dog',
    };
  }
  throw new Error('Could not parse topic research response');
}

async function generateBlogPost(researchData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const siteUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';
  const storeName = audience === 'vet' ? 'PetScript Pharmacy' : 'PetScript Direct';

  const sourceMaterial = researchData.sources?.map(s =>
    `SOURCE: ${s.title} (${s.url})\nKEY POINTS:\n${s.key_points?.map(p => `- ${p}`).join('\n')}`
  ).join('\n\n') || 'No sources — write from general knowledge on this topic.';

  const prompt = `You are a professional SEO copywriter writing for ${storeName}, a veterinary compounding pharmacy.

TASK: Write a fully SEO-optimized blog post based on the source material below.
AUDIENCE: ${audience === 'vet' ? 'Veterinarians, vet techs, and clinic managers — write as a knowledgeable peer' : 'Pet owners who love their animals — warm, friendly, easy to understand'}
PRIMARY KEYWORD: "${researchData.keyword}"
TOPIC: ${researchData.topic}

SOURCE MATERIAL:
${sourceMaterial}

SEO REQUIREMENTS:
1. TITLE: Include primary keyword, use em dash (—) as separator, max 70 chars, must be a complete compelling sentence — NEVER cut off mid-thought. Good examples: "GS-441524 for FIP — What Every Veterinarian Needs to Know", "3D Printing in Veterinary Compounding — What Clinics Need to Know in 2026"
2. META: 150-160 chars exactly, include primary keyword, compel the click
3. H1: Exactly one, matches or closely reflects the title
4. H2s: 3-5 subheadings with secondary keywords
5. KEYWORD DENSITY: Primary keyword in first paragraph, at least one H2, and 2-3x in body
6. INTRO: 100-150 words — hook with a surprising stat or bold claim
7. BODY: 500-700 words total — short paragraphs, active voice
8. INTERNAL LINKS: 2 links to ${siteUrl} naturally in body
9. EXTERNAL LINKS: 1 link to an authoritative source (avma.org, fda.gov, etc.)
10. CTA: Strong closing paragraph with clear action
11. NEVER include dosing amounts or administration instructions

Respond with EXACTLY this format — each label at the START of a line:
TITLE: your title here
META: meta description here
TAGS: tag1, tag2, tag3, tag4, tag5
PEXELS: 3 words for warm real lifestyle photo
BODY: full HTML blog body here`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
  if (!text) throw new Error('Claude returned empty response');

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
  if (!sections['TITLE']) throw new Error('Could not parse TITLE from response');

  return {
    title: sections['TITLE'],
    meta: sections['META'] || '',
    tags: (sections['TAGS'] || '').split(',').map(t => t.trim()).filter(Boolean),
    pexelsQuery: sections['PEXELS'] || researchData.pexels_query || 'veterinarian dog',
    body: sections['BODY'] || '',
  };
}

async function generateImagePrompt(blogTitle, blogBody) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Write a short AI image generation prompt (max 50 words) for a photorealistic pet lifestyle photo based on this blog title: "${blogTitle}". Rules: candid shot, no one looking at camera, warm natural lighting, specific animal breed relevant to topic, no pills/syringes/medicine visible, no text overlays. Return ONLY the prompt.`,
    }],
  });
  return response.content.find(b => b.type === 'text')?.text?.trim() || null;
}

async function generateImage(blogTitle, blogBody) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { console.warn('No OPENAI_API_KEY'); return null; }
  try {
    console.log('\n🎨 Asking Claude to write image prompt...');
    const prompt = await generateImagePrompt(blogTitle, blogBody);
    if (!prompt) { console.warn('No prompt generated'); return null; }
    console.log(`📝 Prompt: ${prompt.slice(0, 100)}...`);
    console.log('🖼  Generating via gpt-image-1...');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1536x1024', quality: 'high', output_format: 'b64_json' }),
    });
    if (!res.ok) { console.warn('OpenAI error:', res.status); return null; }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) { console.warn('No b64 in response'); return null; }
    console.log('✅ Image generated');
    return { b64 };
  } catch (err) {
    console.warn('Image generation failed:', err.message);
    return null;
  }
}

async function uploadImageToWordPress(baseUrl, username, appPassword, b64, title) {
  try {
    const buffer = Buffer.from(b64, 'base64');
    const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const filename = `petscript-${Date.now()}.png`;
    const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'image/png',
      },
      body: buffer,
    });
    if (!res.ok) { console.warn('WP upload failed:', res.status); return null; }
    const media = await res.json();
    console.log('✅ Image uploaded to WordPress:', media.source_url?.slice(0, 80));
    return { id: media.id, url: media.source_url };
  } catch (err) {
    console.warn('WP upload error:', err.message);
    return null;
  }
}

function getPexelsQueries(blogTitle, blogKeyword, suggestedQuery) {
  const text = `${blogTitle} ${blogKeyword}`.toLowerCase();
  if (text.includes('fip') || text.includes('feline infectious')) return ['orange tabby cat veterinarian', 'cat clinic', 'cat exam vet'];
  if (text.includes('anxiety') || text.includes('separation')) return ['happy dog owner home', 'calm dog couch', 'dog cuddle owner'];
  if (text.includes('kidney') || text.includes('renal')) return ['senior cat owner lap', 'old cat pet', 'cat senior cuddle'];
  if (text.includes('pain') || text.includes('arthritis')) return ['dog vet exam happy', 'senior dog owner', 'labrador vet'];
  if (text.includes('cat') || text.includes('feline') || text.includes('kitten')) return ['cat owner happy', 'kitten playing', 'cat cuddle'];
  if (text.includes('dog') || text.includes('canine') || text.includes('puppy')) return ['happy dog park', 'puppy owner', 'golden retriever family'];
  if (text.includes('compounding') || text.includes('pharmacy')) return ['veterinarian dog clinic', 'vet exam happy dog', 'dog vet smiling'];
  return [suggestedQuery || 'happy dog owner', 'pet owner smile', 'dog family outdoor'];
}

async function fetchPexelsImage(query, blogTitle = '', blogKeyword = '') {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const queries = getPexelsQueries(blogTitle, blogKeyword, query);
  for (const q of queries) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=20`, {
        headers: { Authorization: apiKey }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.photos?.length) {
        const pick = data.photos[Math.floor(Math.random() * Math.min(10, data.photos.length))];
        console.log(`📷 Photo by ${pick.photographer} on Pexels`);
        return { url: pick.src.large2x || pick.src.large, altText: pick.alt || q };
      }
    } catch (err) {
      console.warn(`Pexels "${q}" failed:`, err.message);
    }
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
  if (image?.url) articleInput.image = { url: image.url, altText: image.altText };
  const result = await shopifyGQL(domain, token, mutation, { article: articleInput });
  const { article, userErrors } = result.data.articleCreate;
  if (userErrors?.length) throw new Error(`Shopify: ${JSON.stringify(userErrors)}`);
  return article;
}

async function main() {
  const startTime = new Date();
  console.log(`\n🚀 ${audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)'}`);
  console.log(`📅 ${startTime.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`);

  const clientId = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_ID : process.env.SHOPIFY_DIRECT_CLIENT_ID;
  const clientSecret = audience === 'vet' ? process.env.SHOPIFY_PHARMACY_CLIENT_SECRET : process.env.SHOPIFY_DIRECT_CLIENT_SECRET;
  const shopifyToken = await getShopifyToken(CONFIG.storeDomain, clientId, clientSecret);
  console.log('Got Shopify token');

  // ── Get topic from Google Sheet ──────────────────────────────
  console.log('\n📋 Getting topic from Google Sheet...');
  let topicRow = null;
  let rawTopic = null;

  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    const sheetTopic = await getNextTopic(audience);
    if (sheetTopic) {
      rawTopic = sheetTopic.topic;
      topicRow = sheetTopic.rowIndex;
      console.log(`Raw topic: "${rawTopic}"`);
    }
  }

  // If no topic found in sheet — stop. Never auto-pick topics.
  if (!rawTopic) {
    console.log('\n⚠️  No unused topics found in Google Sheet.');
    console.log('Add topics to the Pharmacy or Direct tab in Google Sheets to continue.');
    console.log('\nSheet: https://docs.google.com/spreadsheets/d/1zVsQKbnL9-95-tBXIyKwTtaWWj8KKI3an0i-a_6dY7Q');
    process.exit(0);
  }

  console.log('✨ Prettifying topic title...');
  const prettyTitle = await prettifyTopic(rawTopic);
  console.log(`Pretty title: "${prettyTitle}"`);

  console.log('\n🔍 Researching source articles for topic...');
  const researchData = await researchTopicAndArticles(prettyTitle);

  console.log('\n✍️  Writing blog post from source material...');
  const post = await generateBlogPost(researchData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  // ── Static CTA block ──────────────────────────────────────
  const productBlock = buildStaticCTABlock(audience);

  // ── Generate image → upload to WordPress → use URL everywhere ──
  let image = null;
  const wpUrl = audience === 'vet' ? process.env.WP_PHARMACY_URL : null;
  const wpUser = audience === 'vet' ? process.env.WP_PHARMACY_USERNAME : null;
  const wpPass = audience === 'vet' ? process.env.WP_PHARMACY_APP_PASSWORD : null;

  const generated = await generateImage(post.title, post.body);
  if (generated?.b64) {
    if (wpUrl && wpUser && wpPass) {
      const wpMedia = await uploadImageToWordPress(wpUrl, wpUser, wpPass, generated.b64, post.title);
      if (wpMedia?.url) {
        image = { url: wpMedia.url, altText: post.title, wpMediaId: wpMedia.id };
        console.log('✅ Using WordPress URL for image');
      }
    }
  }
  if (!image) {
    console.log(`\n🖼  Falling back to Pexels: "${post.pexelsQuery}"`);
    try { image = await fetchPexelsImage(post.pexelsQuery, post.title, researchData.keyword); } catch (err) { console.warn('Pexels failed:', err.message); }
  }
  if (!image) console.log('⚠️  Posting without image');

  // ── Build final body ──────────────────────────────────────
  const finalBody = post.body + '\n' + productBlock + '\n' + getContactBlock();

  // ── Post to Shopify ───────────────────────────────────────
  const blogId = await getBlogId(CONFIG.storeDomain, shopifyToken);
  console.log('\n📤 Creating Shopify draft...');
  const article = await createDraft({
    domain: CONFIG.storeDomain, token: shopifyToken, blogId,
    title: post.title, body: finalBody, summary: post.meta,
    tags: post.tags, image,
  });
  console.log(`✅ Draft created: "${article.title}"`);
  console.log(`   ID: ${article.id}`);

  // ── Post to WordPress ─────────────────────────────────────
  const wcKey = audience === 'vet' ? process.env.WP_PHARMACY_WC_KEY : null;
  const wcSecret = audience === 'vet' ? process.env.WP_PHARMACY_WC_SECRET : null;
  const wpStoreUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  if (wpUrl && wpUser && wpPass) {
    try {
      const wpPost = await postToWordPress({
        baseUrl: wpUrl, username: wpUser, appPassword: wpPass,
        consumerKey: wcKey, consumerSecret: wcSecret,
        title: post.title, body: post.body, metaDescription: post.meta,
        tags: post.tags, imageUrl: image?.url || null, imageAlt: post.title,
        wpMediaId: image?.wpMediaId || null, audience,
        blogKeyword: researchData.keyword, storeUrl: wpStoreUrl,
      });
      console.log(`\n✅ WordPress draft: ${wpPost.editUrl}`);
    } catch (wpErr) {
      console.warn('\n⚠️  WordPress posting failed:', wpErr.message);
    }
  } else {
    console.log('\nℹ️  WordPress secrets not set — skipping WordPress post');
  }

  // ── Generate podcast script → save to Google Docs ──────────
  const podcastUrl = await generateAndSavePodcastScript(post.title, post.body, audience);
  if (podcastUrl) console.log(`\n🎙️  Podcast script: ${podcastUrl}`);

  // ── Save and wrap up ──────────────────────────────────────
  markKeywordUsed(researchData.keyword);
  if (topicRow) await markTopicUsed(audience, topicRow, image?.url || '');

  saveRunLog({
    date: startTime.toISOString(), audience, store: CONFIG.storeDomain,
    keyword: researchData.keyword, angle: researchData.topic,
    trending_reason: `Based on sources: ${researchData.sources?.map(s => s.title).join(', ')}`,
    search_volume: researchData.search_volume,
    sources: researchData.sources?.map(s => s.url) || [],
    title: post.title, tags: post.tags,
    articleId: article.id, articleHandle: article.handle,
    hasImage: !!image, status: 'success', podcastUrl: podcastUrl || '',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  saveRunLog({ date: new Date().toISOString(), audience, store: CONFIG?.storeDomain || 'unknown', status: 'failed', error: err.message });
  process.exit(1);
});
