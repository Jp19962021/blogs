/**
 * PetScript WordPress Integration
 * Posts blog drafts to WordPress via REST API
 * Links to WooCommerce products
 * Sets Yoast/RankMath SEO meta
 */

import fetch from 'node-fetch';

// ── WordPress REST API helper ────────────────────────────────
async function wpRequest(baseUrl, username, appPassword, endpoint, method = 'GET', body = null) {
  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const url = `${baseUrl}/wp-json/wp/v2/${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WordPress API ${res.status}: ${err.slice(0, 200)}`);
  }

  return res.json();
}

// ── WooCommerce REST API helper ──────────────────────────────
async function wcRequest(baseUrl, consumerKey, consumerSecret, endpoint) {
  const url = `${baseUrl}/wp-json/wc/v3/${endpoint}`;
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const res = await fetch(url, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WooCommerce API ${res.status}: ${err.slice(0, 200)}`);
  }

  return res.json();
}

// ── Get or create blog category ──────────────────────────────
async function getOrCreateCategory(baseUrl, username, appPassword, name) {
  try {
    // Check if category exists
    const categories = await wpRequest(baseUrl, username, appPassword, `categories?search=${encodeURIComponent(name)}`);
    if (categories.length > 0) return categories[0].id;

    // Create it
    const newCat = await wpRequest(baseUrl, username, appPassword, 'categories', 'POST', { name });
    return newCat.id;
  } catch (err) {
    console.warn('Category setup failed:', err.message);
    return null;
  }
}

// ── Upload featured image to WordPress ───────────────────────
async function uploadImageToWordPress(baseUrl, username, appPassword, imageUrl, altText) {
  try {
    console.log('Downloading image for WordPress...');
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`);

    const buffer = await imgRes.arrayBuffer();
    const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

    const uploadRes = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Disposition': `attachment; filename="petscript-${Date.now()}.jpg"`,
        'Content-Type': 'image/jpeg',
      },
      body: Buffer.from(buffer),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Media upload failed: ${err.slice(0, 200)}`);
    }

    const media = await uploadRes.json();

    // Set alt text
    await wpRequest(baseUrl, username, appPassword, `media/${media.id}`, 'POST', {
      alt_text: altText,
    });

    console.log(`✅ Image uploaded to WordPress: ${media.id}`);
    return media.id;
  } catch (err) {
    console.warn('WordPress image upload failed:', err.message);
    return null;
  }
}

// ── Match WooCommerce products to blog topic ─────────────────
async function matchWooProducts(baseUrl, consumerKey, consumerSecret, blogTitle, blogKeyword) {
  try {
    const products = await wcRequest(baseUrl, consumerKey, consumerSecret, 'products?per_page=50&status=publish');

    const text = `${blogTitle} ${blogKeyword}`.toLowerCase();

    // Keyword map same as Shopify version
    const VET_KEYWORD_MAP = {
      'fip': ['gs-441524', 'molnupiravir', 'antiviral', 'fip'],
      'anxiety': ['trazodone', 'gabapentin', 'clomipramine', 'fluoxetine', 'paroxetine', 'melatonin'],
      'pain': ['gabapentin', 'tramadol', 'meloxicam'],
      'kidney': ['amlodipine', 'benazepril', 'spironolactone', 'furosemide', 'potassium citrate'],
      'thyroid': ['methimazole'],
      'seizure': ['phenobarbital', 'potassium bromide', 'levetiracetam'],
      'cardiac': ['atenolol', 'digoxin', 'furosemide', 'pimobendan'],
      'compounding': ['suspension', 'transdermal', 'flavored', 'chewable'],
    };

    const relevantTerms = new Set();
    for (const [trigger, terms] of Object.entries(VET_KEYWORD_MAP)) {
      if (text.includes(trigger)) terms.forEach(t => relevantTerms.add(t));
    }

    const matched = products.filter(p => {
      const productText = `${p.name} ${p.description}`.toLowerCase();
      return Array.from(relevantTerms).some(term => productText.includes(term));
    }).slice(0, 3);

    return matched.map(p => ({
      id: p.id,
      title: p.name,
      url: p.permalink,
    }));
  } catch (err) {
    console.warn('WooCommerce product match failed:', err.message);
    return [];
  }
}

// ── Build product block for WordPress ───────────────────────
function buildWpProductBlock(matchedProducts, storeUrl, audience) {
  if (!matchedProducts || matchedProducts.length === 0) {
    return `<div style="background:#E0E8F2;border-left:4px solid #003767;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0">
  <h3 style="margin:0 0 8px;color:#003767">Browse Our Formulary</h3>
  <p style="margin:0 0 12px;color:#374151">We compound hundreds of veterinary medications in flavored, transdermal, and injectable formulations.</p>
  <a href="${storeUrl}/shop" style="display:inline-block;background:#003767;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Browse All Medications →</a>
</div>`;
  }

  const productLinks = matchedProducts.map(p =>
    `<li style="margin-bottom:8px"><a href="${p.url}" style="color:#003767;text-decoration:none;font-weight:500">${p.title}</a></li>`
  ).join('\n');

  const email = audience === 'vet' ? 'info@petscript.net' : 'info@petscriptdirect.com';

  return `<div style="background:#f0f7ff;border:1px solid #99AABB;border-radius:8px;padding:20px 24px;margin:32px 0">
  <h3 style="margin:0 0 10px;color:#003767;font-size:16px">🐾 Related Compounded Medications</h3>
  <p style="margin:0 0 12px;color:#374151;font-size:14px">Available for clinic ordering:</p>
  <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:2">
${productLinks}
  </ul>
  <p style="margin:12px 0 0;font-size:13px;color:#6b7280">Questions? Call <a href="tel:8667846915" style="color:#003767">866-784-6915</a> or email <a href="mailto:${email}" style="color:#003767">${email}</a></p>
</div>`;
}

// ── Create WordPress draft post ──────────────────────────────
export async function postToWordPress({
  baseUrl,
  username,
  appPassword,
  consumerKey,
  consumerSecret,
  title,
  body,
  metaDescription,
  tags,
  imageUrl,
  imageAlt,
  wpMediaId,
  audience,
  blogKeyword,
  storeUrl,
}) {
  console.log(`\n📝 Posting to WordPress: ${baseUrl}`);

  // 1. Get or create category
  const categoryName = audience === 'vet' ? 'Veterinary Insights' : 'Pet Health';
  const categoryId = await getOrCreateCategory(baseUrl, username, appPassword, categoryName);
  console.log(`Category: ${categoryName} (${categoryId})`);

  // 2. Use already-uploaded media ID or upload from URL
  let featuredMediaId = wpMediaId || null;
  if (!featuredMediaId && imageUrl) {
    featuredMediaId = await uploadImageToWordPress(baseUrl, username, appPassword, imageUrl, imageAlt || title);
  }

  // 3. Match WooCommerce products
  let productBlock = '';
  if (consumerKey && consumerSecret) {
    const wooProducts = await matchWooProducts(baseUrl, consumerKey, consumerSecret, title, blogKeyword);
    console.log(`WooCommerce products matched: ${wooProducts.length}`);
    productBlock = buildWpProductBlock(wooProducts, storeUrl, audience);
  }

  // 4. Build contact block
  const contactEmail = audience === 'vet' ? 'info@petscript.net' : 'info@petscriptdirect.com';
  const contactBlock = `<div style="background:#EBF4FF;border-left:4px solid #003767;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0">
  <h3 style="margin:0 0 8px;color:#003767">${audience === 'vet' ? 'Partner With PetScript Pharmacy' : 'Get Your Pet\'s Medication from PetScript Direct'}</h3>
  <ul style="margin:0;padding-left:20px;color:#374151">
    <li>Website: <a href="${storeUrl}" style="color:#003767">${storeUrl.replace('https://', '')}</a></li>
    <li>Phone: <a href="tel:8667846915" style="color:#003767">866-784-6915</a></li>
    <li>Email: <a href="mailto:${contactEmail}" style="color:#003767">${contactEmail}</a></li>
  </ul>
</div>`;

  // 5. Build full post content
  const fullContent = `${body}\n${productBlock}\n${contactBlock}`;

  // 6. Create WordPress tags
  let tagIds = [];
  try {
    for (const tagName of tags.slice(0, 5)) {
      const existing = await wpRequest(baseUrl, username, appPassword, `tags?search=${encodeURIComponent(tagName)}`);
      if (existing.length > 0) {
        tagIds.push(existing[0].id);
      } else {
        const newTag = await wpRequest(baseUrl, username, appPassword, 'tags', 'POST', { name: tagName });
        tagIds.push(newTag.id);
      }
    }
  } catch (err) {
    console.warn('Tag setup failed:', err.message);
  }

  // 7. Create the post as draft
  const postData = {
    title,
    content: fullContent,
    status: 'draft',
    categories: categoryId ? [categoryId] : [],
    tags: tagIds,
    featured_media: featuredMediaId || 0,
    meta: {
      // Yoast SEO
      _yoast_wpseo_metadesc: metaDescription,
      _yoast_wpseo_title: title,
      // RankMath
      rank_math_description: metaDescription,
      rank_math_title: title,
      rank_math_focus_keyword: blogKeyword,
    },
  };

  const post = await wpRequest(baseUrl, username, appPassword, 'posts', 'POST', postData);
  console.log(`✅ WordPress draft created: "${post.title.rendered}"`);
  console.log(`   ID: ${post.id}`);
  console.log(`   Edit: ${baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`);

  return {
    id: post.id,
    title: post.title.rendered,
    editUrl: `${baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
    previewUrl: post.link,
  };
}
