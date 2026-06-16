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

  // Pet owner pill-giving blogs — show easy-to-give formats
  'give a dog a pill': ['flavored', 'chewable', 'oral suspension', 'treat'],
  'give a cat a pill': ['flavored', 'chewable', 'oral suspension', 'transdermal'],
  'wont take pills': ['flavored', 'chewable', 'oral suspension', 'treat'],
  'pill pockets': ['flavored', 'chewable', 'oral suspension', 'treat'],
  'medication compliance': ['flavored', 'chewable', 'oral suspension', 'transdermal'],
  'picky': ['flavored', 'chewable', 'oral suspension', 'treat'],
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

// ── Topics that are informational — show formulary link instead ──
const INFORMATIONAL_TOPICS = [
  'e-prescribing', 'eprescribing', 'ncpdp', 'fax', 'workflow', 'compliance',
  'legitimate', 'legitscript', 'accreditation', 'regulation', 'fda guidance',
  'gfi', 'bulk drug', 'switching pharmacy', 'compounding pharmacy partner',
  'practice management', 'telehealth', 'veterinary pharmacy', 'sourcing',
  'supply chain', 'formulary', 'office stock', 'client communication',
  'industry trend', 'screwworm', 'emergency authorization', 'eua',
  'give a dog a pill', 'give a cat a pill', 'wont take pills', 'hiding medication',
  'pill pocket', 'how to medicate'
];

function isInformationalTopic(blogTitle, blogKeyword) {
  const text = `${blogTitle} ${blogKeyword}`.toLowerCase();
  return INFORMATIONAL_TOPICS.some(t => text.includes(t));
}

// ── Store URL map ────────────────────────────────────────────
const STORE_URLS = {
  'pet-script-texas.myshopify.com': 'https://www.petscriptpharmacy.com',
  'd5gnxm-7v.myshopify.com': 'https://www.petscriptdirect.com',
};

// ── Build product block HTML to inject into blog ─────────────
export function buildProductBlock(matchedProducts, storeDomain, blogTitle = '', blogKeyword = '') {
  const storeUrl = STORE_URLS[storeDomain] || `https://${storeDomain.replace('.myshopify.com', '')}.com`;

  // For informational topics or no matches — show formulary browse link
  const isPetOwner = storeDomain.includes('d5gnxm');
  const contactEmail = isPetOwner ? 'info@petscriptdirect.com' : 'info@petscript.net';
  const storeName = isPetOwner ? 'PetScript Direct' : 'PetScript Pharmacy';
  const browseLabel = isPetOwner ? 'Browse Pet Medications →' : 'Browse Our Formulary →';

  if (!matchedProducts || matchedProducts.length === 0 || isInformationalTopic(blogTitle, blogKeyword)) {
    return `
<div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:32px 0">
  <h3 style="margin:0 0 10px;color:#1a56db;font-size:16px">🐾 ${storeName} Compounded Medications</h3>
  <p style="margin:0 0 16px;color:#374151;font-size:14px">We compound hundreds of medications in flavored, chewable, transdermal, and liquid formulations — made specifically for your pet. Browse or contact us for a specific medication.</p>
  <a href="${storeUrl}/collections/all" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;margin-right:10px">${browseLabel}</a>
  <a href="tel:8667846915" style="display:inline-block;border:1px solid #1a56db;color:#1a56db;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Call 866-784-6915</a>
</div>`;
  }

  const storeUrl2 = storeUrl;

  const productLinks = matchedProducts.map(p => {
    // Use search URL format for reliable product linking
    const searchTerm = encodeURIComponent(p.title.split(' ').slice(0, 3).join(' '));
    const productUrl = `${storeUrl2}/search?type=product&q=${searchTerm}`;
    return `<li style="margin-bottom:6px"><a href="${productUrl}" style="color:#1a56db;text-decoration:none;font-weight:500" target="_blank">${p.title}</a></li>`;
  }).join('\n');

  const blockTitle = isPetOwner ? '🐾 Related Pet Medications' : '🐾 Related Compounded Medications';
  const blockDesc = isPetOwner
    ? 'PetScript Direct offers these compounded medications for pets. Click to learn more or order:'
    : 'PetScript Pharmacy compounds these medications for veterinary practices. Click to order or learn more:';

  return `
<div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:32px 0">
  <h3 style="margin:0 0 10px;color:#1a56db;font-size:16px">${blockTitle}</h3>
  <p style="margin:0 0 12px;color:#374151;font-size:14px">${blockDesc}</p>
  <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:2">
${productLinks}
  </ul>
  <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Need a custom formulation or have questions? Call <a href="tel:8667846915" style="color:#1a56db;font-weight:500">866-784-6915</a> or email <a href="mailto:${contactEmail}" style="color:#1a56db">${contactEmail}</a></p>
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
