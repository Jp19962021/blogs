/**
 * PetScript Weekly Email — Klaviyo Campaign Creator
 * - Grabs last 2 published blog posts from Shopify
 * - Pulls top selling products from Shopify
 * - Pulls any new products added this week
 * - Builds recap email and creates Klaviyo draft campaign
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

const KLAVIYO_API_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const VET_LIST_ID = 'RurBJH';

// ── Shopify helpers ──────────────────────────────────────────
async function getShopifyToken(domain, clientId, clientSecret) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Shopify token failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function shopifyGQL(domain, token, query, variables = {}) {
  const res = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json;
}

// ── Get last 2 published blog posts ─────────────────────────
async function getRecentBlogPosts(domain, token, blogId) {
  const query = `{
    blog(id: "${blogId}") {
      articles(first: 10, reverse: true) {
        edges {
          node {
            id
            title
            handle
            publishedAt
            excerptHtml
            image { url altText }
            isPublished
          }
        }
      }
    }
  }`;
  const res = await shopifyGQL(domain, token, query);
  const articles = res.data?.blog?.articles?.edges?.map(e => e.node) || [];
  // Filter to only published and return last 2
  return articles.filter(a => a.isPublished).slice(0, 2);
}

// ── Get top selling products this week ───────────────────────
async function getTopSellingProducts(domain, token) {
  // Get products sorted by best selling
  const query = `{
    products(first: 5, sortKey: BEST_SELLING, query: "status:active") {
      edges {
        node {
          id
          title
          handle
          description
          featuredImage { url altText }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
        }
      }
    }
  }`;
  const res = await shopifyGQL(domain, token, query);
  return res.data?.products?.edges?.map(e => e.node) || [];
}

// ── Get new products added this week ─────────────────────────
async function getNewProducts(domain, token) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const dateStr = oneWeekAgo.toISOString().split('T')[0];

  const query = `{
    products(first: 10, sortKey: CREATED_AT, reverse: true, query: "status:active created_at:>${dateStr}") {
      edges {
        node {
          id
          title
          handle
          description
          createdAt
          featuredImage { url altText }
        }
      }
    }
  }`;
  const res = await shopifyGQL(domain, token, query);
  return res.data?.products?.edges?.map(e => e.node) || [];
}

// ── Generate email HTML via Claude ───────────────────────────
async function generateEmailHTML(blogPosts, topProducts, newProducts, storeDomain) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const isVet = storeDomain.includes('pet-script-texas');
  const storeUrl = isVet ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';
  const storeName = isVet ? 'PetScript Pharmacy' : 'PetScript Direct';
  const contactEmail = isVet ? 'info@petscript.net' : 'info@petscriptdirect.com';
  const audience = isVet ? 'veterinary professionals' : 'pet owners';

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  const blogSection = blogPosts.map(b => `
BLOG: ${b.title}
URL: ${storeUrl}/blogs/all-about-pets/${b.handle}
EXCERPT: ${b.excerptHtml?.replace(/<[^>]*>/g, '').slice(0, 100) || 'Click to read the full post'}
`).join('\n');

  const topProductSection = topProducts.map(p => `
PRODUCT: ${p.title}
URL: ${storeUrl}/products/${p.handle}
DESCRIPTION: ${p.description?.slice(0, 100) || ''}
`).join('\n');

  const newProductSection = newProducts.length > 0 ? newProducts.map(p => `
NEW PRODUCT: ${p.title}
URL: ${storeUrl}/products/${p.handle}
`).join('\n') : 'No new products this week';

  const prompt = `Write a professional weekly recap email for ${storeName} targeting ${audience}.

WEEK: ${weekLabel}
STORE URL: ${storeUrl}
CONTACT EMAIL: ${contactEmail}
PHONE: 866-784-6915

THIS WEEK'S BLOG POSTS (feature these prominently — just 2):
${blogSection}

TOP SELLING COMPOUNDED MEDICATIONS THIS WEEK:
${topProductSection}

NEW PRODUCTS ADDED THIS WEEK:
${newProductSection}

Write a complete HTML email (table-based, inline styles, max-width 620px) with:
1. Dark blue header (#003767) with "${storeName} — Weekly Update" and the week date
2. Warm greeting: "Hi {{ first_name|default:'${isVet ? 'Doctor' : 'Friend'}' }},"
3. Brief 1-sentence intro
4. FEATURED POSTS section — 2 blog post cards side by side, each with title, 1-line excerpt, blue "Read More →" button linking to the blog URL
5. TOP COMPOUNDS THIS WEEK section — list the top 5 selling products with name and link
6. NEW THIS WEEK section — only show if new products exist, list them with links
7. CTA block: "Questions? Call 866-784-6915 or email ${contactEmail}" with buttons
8. Dark footer with unsubscribe: {{ unsubscribe_url }}

Keep it concise and scannable. ${isVet ? 'Professional B2B tone.' : 'Friendly pet owner tone.'}
Return ONLY the HTML — no explanation, no markdown.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find(b => b.type === 'text')?.text || '';
}

// ── Klaviyo API ──────────────────────────────────────────────
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
      attributes: { name, editor_type: 'CODE', html },
    },
  });
  return result.data.id;
}

async function createCampaignDraft(name, subjectLine, previewText, templateId, listId) {
  // Create campaign with message inline
  const result = await klaviyoRequest('campaigns/', 'POST', {
    data: {
      type: 'campaign',
      attributes: {
        name,
        audiences: { included: [listId], excluded: [] },
        send_strategy: {
          method: 'static',
          options_static: {
            datetime: new Date(Date.now() + 3600000).toISOString(),
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
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`Message ID: ${messageId}`);

  // Update message with subject, preview, from details
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
    console.log('Message updated with subject and sender');

    // Assign template to message
    if (templateId) {
      await klaviyoRequest(`campaign-messages/${messageId}/relationships/template/`, 'POST', {
        data: { type: 'template', id: templateId },
      });
      console.log('Template assigned to message');
    }
  }

  return { campaignId, messageId };
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('\n📧 PetScript Weekly Email Generator');
  console.log(`📅 ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full' })}\n`);

  // Get Shopify token for vet store
  const domain = process.env.SHOPIFY_PHARMACY_STORE;
  const clientId = process.env.SHOPIFY_PHARMACY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_PHARMACY_CLIENT_SECRET;
  const blogId = 'gid://shopify/Blog/101500682495';

  console.log('Getting Shopify token...');
  const token = await getShopifyToken(domain, clientId, clientSecret);

  // Fetch data in parallel
  console.log('Fetching blog posts, top products, and new products...');
  const [blogPosts, topProducts, newProducts] = await Promise.all([
    getRecentBlogPosts(domain, token, blogId),
    getTopSellingProducts(domain, token),
    getNewProducts(domain, token),
  ]);

  console.log(`✅ Blog posts: ${blogPosts.length}`);
  blogPosts.forEach(b => console.log(`  • ${b.title}`));
  console.log(`✅ Top products: ${topProducts.length}`);
  topProducts.forEach(p => console.log(`  • ${p.title}`));
  console.log(`✅ New products: ${newProducts.length}`);
  newProducts.forEach(p => console.log(`  • ${p.title}`));

  // Generate email
  console.log('\n✍️  Generating email...');
  const emailHTML = await generateEmailHTML(blogPosts, topProducts, newProducts, domain);
  console.log(`Email HTML: ${emailHTML.length} chars`);

  // Build subject line from blog titles
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const subjectLine = blogPosts.length > 0
    ? `This week from PetScript: ${blogPosts[0].title.slice(0, 50)}...`
    : `PetScript Pharmacy Weekly Update — ${weekLabel}`;
  const previewText = `${topProducts.length} top compounds + ${newProducts.length > 0 ? newProducts.length + ' new products + ' : ''}your weekly reads`;

  // Create Klaviyo template
  console.log('\n📤 Creating Klaviyo template...');
  const templateId = await createEmailTemplate(`PetScript Weekly Recap — ${weekLabel}`, emailHTML);
  console.log(`Template created: ${templateId}`);

  // Create campaign draft
  console.log('📤 Creating Klaviyo campaign draft...');
  const { campaignId } = await createCampaignDraft(
    `PetScript Weekly Recap — ${weekLabel}`,
    subjectLine,
    previewText,
    templateId,
    VET_LIST_ID
  );

  console.log(`\n✅ Campaign draft created!`);
  console.log(`   Review at: https://www.klaviyo.com/campaign/${campaignId}/wizard`);
  console.log(`\nSubject: ${subjectLine}`);
  console.log(`Preview: ${previewText}`);
  console.log('\nReview in Klaviyo and click Send when ready!');
}

main().catch(err => {
  console.error('❌ Weekly email failed:', err.message);
  process.exit(1);
});
