/**
 * PetScript Auto Blog Generator
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'config');

const audience = process.env.STORE_AUDIENCE;
if (!audience) throw new Error('STORE_AUDIENCE env var required (vet or petowner)');

const { VET_CONFIG, PETOWNER_CONFIG } = await import('../config/store-config.js');
const CONFIG = audience === 'vet' ? VET_CONFIG : PETOWNER_CONFIG;

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
  const pool = available.length > 0 ? available : CONFIG.keywords;
  return pool[Math.floor(Math.random() * pool.length)];
}

function markKeywordUsed(keyword) {
  const used = getUsedKeywords();
  const updated = [...used.filter(k => k !== keyword), keyword].slice(-20);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(usedKeywordsFile, JSON.stringify(updated, null, 2));
}

async function researchTrend(keyword) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const searchPrompt = audience === 'vet'
    ? `Search for recent news (2025-2026) related to: "${keyword}" in veterinary medicine and compounding pharmacies. Return JSON: { "angle": "one specific blog angle", "facts": ["fact1", "fact2"], "sources": ["source1"] }`
    : `Search for recent pet owner concerns (2025-2026) about: "${keyword}". Return JSON: { "angle": "one relatable blog angle", "facts": ["fact1", "fact2"], "sources": ["source1"] }`;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: searchPrompt }],
    });
    const textContent = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return { angle: textContent.slice(0, 200), facts: [], sources: [] };
  } catch (err) {
    console.warn('Trend research failed, continuing:', err.message);
    return { angle: `A practical guide to ${keyword}`, facts: [], sources: [] };
  }
}

async function generateBlogPost(keyword, trendData) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userPrompt = `Write a blog post for the following:

PRIMARY SEO KEYWORD: "${keyword}"
TOPIC ANGLE: ${trendData.angle}
${trendData.facts.length > 0 ? `RESEARCH NOTES: ${trendData.facts.join('; ')}` : ''}

Return EXACTLY these 5 labeled sections:
TITLE: [60 chars or less, includes keyword]
META: [150-160 char meta description]
TAGS: [4-6 comma-separated SEO tags]
IMAGE_QUERY: [2-4 words for a real Unsplash photo e.g. "happy dog owner"]
BODY: [full HTML blog body, h2/h3 subheadings, no html/body tags]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: CONFIG.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '';
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

async function fetchUnsplashImage(query, fallbackQueries) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  const queriesToTry = [query, ...fallbackQueries].slice(0, 5);
  for (const q of queriesToTry) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=landscape&content_filter=high&per_page=10`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const pick = data.results[Math.floor(Math.random() * Math.min(5, data.results.length))];
        await fetch(pick.links.download_location, {
          headers: { 'Authorization': `Client-ID ${accessKey}` },
        }).catch(() => {});
        return {
          url: pick.urls.regular,
          altText: pick.alt_description || q,
          credit: `Photo by ${pick.user.name} on Unsplash`,
          photographerUrl: pick.user.links.html,
        };
      }
    } catch (err) {
      console.warn(`Unsplash failed for "${q}":`, err.message);
    }
  }
  return {
    url: 'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=1080&q=80',
    altText: 'A happy dog',
    credit: 'Photo on Unsplash',
    photographerUrl: 'https://unsplash.com',
  };
}

async function shopifyGraphQL(storeDomain, token, query, variables = {}) {
  const url = `https://${storeDomain}/admin/api/2026-04/graphql.json`;
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

async function getShopifyBlogId(storeDomain, token) {
  if (CONFIG.blogId) return CONFIG.blogId;
  const query = `{ blogs(first: 5) { edges { node { id title } } } }`;
  const res = await shopifyGraphQL(storeDomain, token, query);
  const blogs = res.data?.blogs?.edges;
  if (!blogs || blogs.length === 0) throw new Error('No blogs found on store');
  console.log('Found blogs:', blogs.map(b => `${b.node.title} (${b.node.id})`).join(', '));
  return blogs[0].node.id;
}

async function createShopifyDraft({ storeDomain, token, blogId, title, body, summary, tags, image, authorName }) {
  const mutation = `
    mutation articleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id title handle }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    article: {
      blogId, title, body, summary, tags,
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

async function main() {
  console.log(`\n🚀 Starting blog generation for: ${audience === 'vet' ? 'PetScript Pharmacy (Vet)' : 'PetScript Direct (Pet Owner)'}`);
  console.log(`📅 Date: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`);

  const keyword = pickNextKeyword();
  console.log(`\n🔑 Target keyword: "${keyword}"`);

  console.log('🔍 Researching trends...');
  const trendData = await researchTrend(keyword);
  console.log(`📌 Angle: ${trendData.angle}`);

  console.log('✍️  Generating blog post...');
  const post = await generateBlogPost(keyword, trendData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  console.log(`🖼️  Fetching image for: "${post.imageQuery}"...`);
  const image = await fetchUnsplashImage(post.imageQuery, CONFIG.unsplashQueries);
  console.log(`📷 ${image.credit}`);

  const bodyWithCredit = post.body + `\n<p><small><em>${image.credit} | <a href="${image.photographerUrl}" target="_blank" rel="noopener">View on Unsplash</a></em></small></p>`;

  const blogId = await getShopifyBlogId(CONFIG.storeDomain, CONFIG.shopifyToken);

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
  markKeywordUsed(keyword);
  console.log('\n🎉 Done! Check Shopify > Online Store > Blog Posts to review and publish.');
}

main().catch(err => {
  console.error('❌ Blog generation failed:', err);
  process.exit(1);
});
