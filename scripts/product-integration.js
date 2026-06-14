/**
 * PetScript Product Integration
 * - Matches Shopify products to blog topic
 * - Injects product links into blog body
 * - Updates product descriptions with blog SEO keywords
 * 
 * Called from generate-blog.js after blog post is written
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

// ── Fetch all active products from Shopify ───────────────────
export async function fetchProducts(domain, token) {
  const query = `{
    products(first: 100, query: "status:active") {
      edges {
        node {
          id
          title
          handle
          description
          tags
          onlineStoreUrl
        }
      }
    }
  }`;

  const res = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json.data?.products?.edges?.map(e => e.node) || [];
}

// ── Match products to blog topic using Claude ────────────────
export async function matchProductsToBlog(products, blogTitle, blogKeyword, blogBody) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const productList = products.map(p =>
    `ID: ${p.id}\nTitle: ${p.title}\nHandle: ${p.handle}\nDescription: ${p.description?.slice(0, 100)}`
  ).join('\n---\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Blog post title: "${blogTitle}"
Blog keyword: "${blogKeyword}"
Blog excerpt: "${blogBody.replace(/<[^>]*>/g, '').slice(0, 300)}"

From this product list, pick the 2-3 most relevant products that a veterinarian reading this blog post might want to order. Only pick products genuinely relevant to the topic.

PRODUCTS:
${productList}

Return ONLY valid JSON array:
[{"id": "gid://shopify/Product/...", "title": "product name", "handle": "product-handle", "reason": "why relevant in 5 words"}]

If no products are genuinely relevant, return an empty array: []`
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '[]';
  try {
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return [];
  }
}

// ── Build product block HTML to inject into blog ─────────────
export function buildProductBlock(matchedProducts, storeDomain) {
  if (!matchedProducts || matchedProducts.length === 0) return '';

  const storeUrl = `https://${storeDomain.replace('.myshopify.com', '')}.com`;

  const productLinks = matchedProducts.map(p =>
    `<li><a href="${storeUrl}/products/${p.handle}" style="color:#1a56db;text-decoration:none;font-weight:500">${p.title}</a></li>`
  ).join('\n');

  return `
<div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:32px 0">
  <h3 style="margin:0 0 10px;color:#1a56db;font-size:16px">Related Compounded Medications</h3>
  <p style="margin:0 0 12px;color:#374151;font-size:14px">PetScript Pharmacy compounds these medications for veterinary practices. Available for clinic ordering:</p>
  <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8">
${productLinks}
  </ul>
  <p style="margin:12px 0 0;font-size:13px;color:#6b7280">Questions about formulations or ordering? Call <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a> or email <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></p>
</div>`;
}

// ── Update product descriptions with blog keywords ───────────
export async function updateProductDescriptions(matchedProducts, blogKeyword, blogTitle, domain, token) {
  if (!matchedProducts || matchedProducts.length === 0) return;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const product of matchedProducts) {
    try {
      // Fetch current full description
      const query = `{ product(id: "${product.id}") { id descriptionHtml } }`;
      const res = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      const currentDesc = data.data?.product?.descriptionHtml || '';

      // Ask Claude to enhance description with SEO keywords
      const enhanceResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are an SEO copywriter for PetScript Pharmacy.

Current product description HTML:
${currentDesc}

Blog keyword to naturally weave in: "${blogKeyword}"
Related blog post: "${blogTitle}"

Rewrite the product description to:
1. Keep all existing clinical information accurate
2. Naturally incorporate the keyword phrase once where it fits
3. Add one sentence at the end linking to the blog: e.g. "Learn more about [topic] in our guide: <a href='https://www.petscriptpharmacy.com/blogs/all-about-pets/${product.handle}'>link text</a>"
4. Keep it under 200 words
5. Return ONLY the updated HTML description, no other text
6. NEVER add dosing information or change any medical facts`
        }],
      });

      const newDesc = enhanceResponse.content.find(b => b.type === 'text')?.text || '';
      if (!newDesc || newDesc.length < 50) {
        console.log(`Skipping description update for ${product.title} — no valid response`);
        continue;
      }

      // Update the product
      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }`;

      const updateRes = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({
          query: mutation,
          variables: { input: { id: product.id, descriptionHtml: newDesc } }
        }),
      });

      const updateData = await updateRes.json();
      const errors = updateData.data?.productUpdate?.userErrors;
      if (errors?.length) {
        console.warn(`Product update errors for ${product.title}:`, errors);
      } else {
        console.log(`✅ Updated description for: ${product.title}`);
      }

      // Small delay between updates
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.warn(`Failed to update product ${product.title}:`, err.message);
    }
  }
}
