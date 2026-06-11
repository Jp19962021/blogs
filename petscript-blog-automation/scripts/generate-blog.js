/**
 * PetScript Auto Blog Generator
 * Runs daily via GitHub Actions
 * - Picks next unused SEO keyword
 * - Searches news/trends for a fresh angle
 * - Fetches a real photo from Unsplash
 * - Writes full blog post via Claude API
 * - Posts as draft to Shopify
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'config');

// ── Load store config based on env ──────────────────────────
const audience = process.env.STORE_AUDIENCE; // 'vet' or 'petowner'
if (!audience) throw new Error('STORE_AUDIENCE env var required (vet or petowner)');

const { VET_CONFIG, PETOWNER_CONFIG } = await import('../config/store-config.js');
const CONFIG = audience === 'vet' ? VET_CONFIG : PETOWNER_CONFIG;

// ── Keyword rotation (tracks used keywords per store) ────────
const usedKeywordsFile = path.join(CONFIG_DIR, `used-keywords-${audience}.json`);

function getUsedKeywords() {
  try {
    if (fs.existsSync(usedKeywordsFile)) {
      return JSON.parse(fs.readFileSync(usedKeywordsFile, 'utf8'));
    }
  } catch {}
  return [];
}

function pickNextKeyword() {
  const used = getUsedKeywords();
  const available = CONFIG.keywords.filter(k => !used.includes(k));
  // If all keywords have been used, start fresh (full rotation complete)
  const pool = available.length > 0 ? available : CONFIG.keywords;
  return pool[Math.floor(Math.random() * pool.length)];
}

function markKeywordUsed(keyword) {
  const used = getUsedKeywords();
  // Keep a rolling window of last 20 used keywords
  const updated = [...used.filter(k => k !== keyword), keyword].slice(-20);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(usedKeywordsFile, JSON.stringify(updated, null, 2));
}

// ── Trend research via web search ───────────────────────────
async function researchTrend(keyword) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const searchPrompt = audience === 'vet'
    ? `Search for recent news and developments (2025-2026) related to: "${keyword}" in the context of veterinary medicine, compounding pharmacies, and animal health. 
       Also check wedgewoodpharmacy.com, mixlab.com, covetrus.com, and avma.org for relevant content.
       Return a JSON object with: { "angle": "one specific timely angle for a blog post", "facts": ["fact1", "fact2", "fact3"], "sources": ["source1"] }`
    : `Search for recent news and pet owner concerns (2025-2026) related to: "${keyword}" — what are pet owners asking about this topic on Reddit, pet forums, and general news?
       Return a JSON object with: { "angle": "one relatable angle for a pet owner blog post", "facts": ["fact1", "fact2", "fact3"], "sources": ["source1"] }`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }],
    });

    // Extract text content from response
    const textContent = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Try to parse JSON from the response
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    // Fallback: return the raw text as the angle
    return { angle: textContent.slice(0, 200), facts: [], sources: [] };
  } catch (err) {
    console.warn('Trend research failed, continuing with keyword only:', err.message);
    return { angle: `A practical guide to ${keyword} for ${audience === 'vet' ? 'veterinary professionals' : 'pet owners'}`, facts: [], sources: [] };
  }
}

// ── Generate blog post via Claude ────────────────────────────
async function generateBlogPost(keyword, trendData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Write a blog post for the following:

PRIMARY SEO KEYWORD: "${keyword}"
TOPIC ANGLE: ${trendData.angle}
${trendData.facts.length > 0 ? `RESEARCH NOTES: ${trendData.facts.join('; ')}` : ''}

Requirements:
1. Title: 60 chars or less, naturally includes the keyword. Return as: TITLE: [title]
2. Meta description: 150-160 chars, includes keyword. Return as: META: [meta]  
3. Tags: 4-6 SEO tags as comma-separated list. Return as: TAGS: [tag1, tag2, ...]
4. Unsplash search query: 2-4 words describing a REAL PHOTO that would work as header (warm, real, no AI look — e.g. "happy dog owner" or "cat at vet"). Return as: IMAGE_QUERY: [query]
5. Blog body: Full HTML (h2/h3, paragraphs, no <html>/<body> tags). Return as: BODY: [html content]

Format your response EXACTLY with those 5 labeled sections in order.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: CONFIG.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';

  // Parse the labeled sections
  const extract = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:TITLE|META|TAGS|IMAGE_QUERY|BODY):|$)`));
    return match ? match[1].trim() : '';
  };

  return {
    title: extract('TITLE'),
    meta: extract('META'),
    tags: extract('TAGS').split(',').map(t => t.trim()).filter(Boolean),
    imageQuery: extract('IMAGE_QUERY'),
    body: extract('BODY'),
  };
}

// ── Fetch image from Unsplash ────────────────────────────────
async function fetchUnsplashImage(query, fallbackQueries) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  // Try the AI-suggested query first, then fallbacks from config
  const queriesToTry = [query, ...fallbackQueries].slice(0, 5);

  for (const q of queriesToTry) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=landscape&content_filter=high&per_page=10`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        // Pick a random result from the top 5 to add variety
        const pick = data.results[Math.floor(Math.random() * Math.min(5, data.results.length))];

        // Trigger download tracking as required by Unsplash API guidelines
        await fetch(pick.links.download_location, {
          headers: { 'Authorization': `Client-ID ${accessKey}` },
        }).catch(() => {}); // non-blocking

        return {
          url: pick.urls.regular, // 1080px wide jpg
          altText: pick.alt_description || pick.description || q,
          credit: `Photo by ${pick.user.name} on Unsplash`,
          photographerUrl: pick.user.links.html,
        };
      }
    } catch (err) {
      console.warn(`Unsplash search failed for "${q}":`, err.message);
    }
  }

  // Last resort fallback — generic pet photo
  return {
    url: 'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=1080&q=80',
    altText: 'A happy dog',
    credit: 'Photo on Unsplash',
    photographerUrl: 'https://unsplash.com',
  };
}

// ── Get blog ID from Shopify ─────────────────────────────────
async function getShopifyBlogId(storeDomain, token) {
  // If hardcoded in config, use it
  if (CONFIG.blogId) return CONFIG.blogId;

  // Otherwise fetch the first blog
  const query = `{ blogs(first: 5) { edges { node { id title } } } }`;
  const res = await shopifyGraphQL(storeDomain, token, query);
  const blogs = res.data?.blogs?.edges;
  if (!blogs || blogs.length === 0) throw new Error('No blogs found on store');
  console.log('Found blogs:', blogs.map(b => `${b.node.title} (${b.node.id})`).join(', '));
  return blogs[0].node.id;
}

// ── Shopify GraphQL helper ───────────────────────────────────
async function shopifyGraphQL(storeDomain, token, query, variables = {}) {
  const url = `https://${storeDomain}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json;
}

// ── Create Shopify draft article ─────────────────────────────
async function createShopifyDraft({ storeDomain, token, blogId, title, body, summary, tags, image, authorName }) {
  const mutation = `
    mutation articleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article {
          id
          title
          handle
          onlineStoreUrl
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    article: {
      blogId,
      title,
      body,
      summary,
      tags,
      isPublished: false,
      author: { name: authorName },
      image: image ? { url: image.url, altText: image.altText } : undefined,
    },
  };

  const result = await shopifyGraphQL(storeDomain, token, mutation, variables);
  const { article, userErrors } = result.data.articleCreate;

  if (userErrors && userErrors.length > 0) {
    throw new Error(`Shopify article errors: ${JSON.stringify(userErrors)}`);
  }

  return article;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Starting blog generation for: ${audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)'}`);
  console.log(`📅 Date: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`);

  // 1. Pick keyword
  const keyword = pickNextKeyword();
  console.log(`\n🔑 Target keyword: "${keyword}"`);

  // 2. Research trend
  console.log('🔍 Researching trends...');
  const trendData = await researchTrend(keyword);
  console.log(`📌 Angle: ${trendData.angle}`);

  // 3. Generate blog post
  console.log('✍️  Generating blog post...');
  const post = await generateBlogPost(keyword, trendData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  // 4. Fetch Unsplash image
  console.log(`🖼️  Fetching image for query: "${post.imageQuery}"...`);
  const image = await fetchUnsplashImage(post.imageQuery, CONFIG.unsplashQueries);
  console.log(`📷 Image: ${image.url}`);
  console.log(`   ${image.credit}`);

  // Append photographer credit to body
  const bodyWithCredit = post.body + `\n<p><small><em>${image.credit} | <a href="${image.photographerUrl}" target="_blank" rel="noopener">View on Unsplash</a></em></small></p>`;

  // 5. Get blog ID
  const blogId = await getShopifyBlogId(CONFIG.storeDomain, CONFIG.shopifyToken);

  // 6. Post to Shopify as draft
  console.log('📤 Creating Shopify draft...');
  const article = await createShopifyDraft({
    storeDomain: CONFIG.storeDomain,
    token: CONFIG.shopifyToken,
    blogId,
    title: post.title,
    body: bodyWithCredit,
    summary: post.meta,
    tags: post.tags,
    image,
    authorName: CONFIG.authorName,
  });

  console.log(`✅ Draft created: ${article.title}`);
  console.log(`   ID: ${article.id}`);
  console.log(`   Handle: ${article.handle}`);

  // 7. Mark keyword as used
  markKeywordUsed(keyword);

  console.log('\n🎉 Done! Check Shopify > Online Store > Blog Posts to review and publish.');
}

main().catch(err => {
  console.error('❌ Blog generation failed:', err);
  process.exit(1);
});
