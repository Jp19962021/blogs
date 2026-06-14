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

// ── Veterinary keyword map for smarter product matching ──────
const VET_KEYWORD_MAP = {
  // FIP
  'fip': ['gs-441524', 'gs441524', 'molnupiravir', 'remdesivir', 'antiviral', 'fip'],
  'feline infectious peritonitis': ['gs-441524', 'gs441524', 'molnupiravir', 'fip'],
  'gs-441524': ['gs-441524', 'gs441524', 'fip'],
  'antiviral': ['gs-441524', 'molnupiravir', 'antiviral', 'fip'],

  // Anxiety / behavioral
  'anxiety': ['trazodone', 'gabapentin', 'clomipramine', 'fluoxetine', 'paroxetine', 'melatonin', 'alprazolam', 'anxiety', 'behavioral'],
  'separation anxiety': ['trazodone', 'clomipramine', 'fluoxetine', 'paroxetine', 'anxiety'],
  'noise anxiety': ['trazodone', 'gabapentin', 'alprazolam', 'melatonin', 'anxiety'],
  'behavioral': ['trazodone', 'fluoxetine', 'clomipramine', 'paroxetine', 'behavioral'],

  // Pain / neurological
  'pain': ['gabapentin', 'tramadol', 'meloxicam', 'pain', 'analgesic'],
  'arthritis': ['meloxicam', 'gabapentin', 'tramadol', 'arthritis'],
  'seizure': ['phenobarbital', 'potassium bromide', 'levetiracetam', 'seizure', 'epilepsy'],
  'epilepsy': ['phenobarbital', 'potassium bromide', 'levetiracetam', 'epilepsy'],

  // Kidney / urinary
  'kidney': ['amlodipine', 'benazepril', 'enalapril', 'spironolactone', 'furosemide', 'potassium citrate', 'kidney', 'renal'],
  'renal': ['amlodipine', 'benazepril', 'enalapril', 'spironolactone', 'kidney', 'renal'],
  'urinary': ['prazosin', 'phenoxybenzamine', 'potassium citrate', 'urinary'],
  'hypertension': ['amlodipine', 'atenolol', 'benazepril', 'hypertension', 'blood pressure'],

  // Thyroid / hormonal
  'thyroid': ['methimazole', 'thyroid', 'hyperthyroid'],
  'hyperthyroid': ['methimazole', 'hyperthyroid', 'thyroid'],
  'diabetes': ['insulin', 'glipizide', 'diabetes'],
  'cushings': ['trilostane', 'mitotane', 'cushings', 'adrenal'],
  'addisons': ['fludrocortisone', 'desoxycorticosterone', 'addisons', 'adrenal'],
  'hormone': ['methimazole', 'trilostane', 'fludrocortisone', 'hormone'],

  // Skin / dermatology
  'dermatology': ['cyclosporine', 'prednisolone', 'dexamethasone', 'skin', 'dermatitis'],
  'skin': ['cyclosporine', 'prednisolone', 'mupirocin', 'skin', 'dermatitis'],
  'allergy': ['cyclosporine', 'prednisolone', 'cetirizine', 'allergy'],
  'itch': ['cyclosporine', 'prednisolone', 'itch', 'pruritus'],

  // Cardiac
  'cardiac': ['atenolol', 'digoxin', 'furosemide', 'spironolactone', 'cardiac', 'heart'],
  'heart': ['atenolol', 'digoxin', 'furosemide', 'amlodipine', 'cardiac', 'heart'],

  // GI
  'gastrointestinal': ['metronidazole', 'sucralfate', 'omeprazole', 'ondansetron', 'gi', 'gastrointestinal'],
  'nausea': ['ondansetron', 'metoclopramide', 'maropitant', 'nausea'],
  'vomiting': ['ondansetron', 'metoclopramide', 'maropitant', 'vomiting'],

  // Compounding general
  'compounding': ['compounded', 'suspension', 'transdermal', 'flavored', 'chewable'],
  'transdermal': ['transdermal', 'gel', 'topical'],
  'flavored': ['flavored', 'suspension', 'chewable', 'oral'],
};

function getRelevantKeywords(blogTitle, blogKeyword, blogExcerpt) {
  const text = `${blogTitle} ${blogKeyword} ${blogExcerpt}`.toLowerCase();
  const relevantTerms = new Set();
  
  for (const [trigger, terms] of Object.entries(VET_KEYWORD_MAP)) {
    if (text.includes(trigger.toLowerCase())) {
      terms.forEach(t => relevantTerms.add(t.toLowerCase()));
    }
  }
  
  return Array.from(relevantTerms);
}

// ── Match products to blog topic ─────────────────────────────
export async function matchProductsToBlog(products, blogTitle, blogKeyword, blogBody) {
  const blogExcerpt = blogBody.replace(/<[^>]*>/g, '').slice(0, 500);
  const relevantTerms = getRelevantKeywords(blogTitle, blogKeyword, blogExcerpt);
  
  console.log(`Matching terms: ${relevantTerms.slice(0, 8).join(', ')}`);

  // First pass — keyword matching against product titles/descriptions
  const keywordMatched = products.filter(p => {
    const productText = `${p.title} ${p.description || ''} ${p.tags?.join(' ') || ''}`.toLowerCase();
    return relevantTerms.some(term => productText.includes(term));
  });

  console.log(`Keyword matched ${keywordMatched.length} products`);

  // If we found matches via keywords, use Claude to pick the best 2-3
  if (keywordMatched.length > 0) {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const productList = keywordMatched.map(p =>
      `ID: ${p.id}\nTitle: ${p.title}\nHandle: ${p.handle}`
    ).join('\n---\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Blog topic: "${blogTitle}" (keyword: "${blogKeyword}")

These products were pre-filtered as potentially relevant. Pick the best 2-3 for a veterinarian reading this blog. Be inclusive — if it could be relevant, include it.

PRODUCTS:
${productList}

Return ONLY valid JSON array (use exact IDs from above):
[{"id": "gid://shopify/Product/...", "title": "product name", "handle": "product-handle"}]`
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '[]';
    try {
      const match = text.match(/\[\s*\]/);
      if (match) return []; // empty array
      const arrMatch = text.match(/\[[\s\S]*\]/);
      return arrMatch ? JSON.parse(arrMatch[0]) : keywordMatched.slice(0, 3).map(p => ({ id: p.id, title: p.title, handle: p.handle }));
    } catch {
      // Fallback to first 3 keyword matches if Claude parsing fails
      return keywordMatched.slice(0, 3).map(p => ({ id: p.id, title: p.title, handle: p.handle }));
    }
  }

  // No keyword matches — fall back to Claude with full product list
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const productList = products.slice(0, 30).map(p =>
    `ID: ${p.id}\nTitle: ${p.title}\nHandle: ${p.handle}`
  ).join('\n---\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Blog topic: "${blogTitle}" (keyword: "${blogKeyword}")
Blog excerpt: "${blogExcerpt.slice(0, 200)}"

Pick 1-3 relevant compounded medications from this list for a vet reading this blog. These are all veterinary compounded medications.

PRODUCTS:
${productList}

Return ONLY valid JSON array:
[{"id": "gid://shopify/Product/...", "title": "product name", "handle": "product-handle"}]
Return [] if truly nothing is relevant.`
    }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '[]';
  try {
    const arrMatch = text.match(/\[[\s\S]*\]/);
    return arrMatch ? JSON.parse(arrMatch[0]) : [];
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
