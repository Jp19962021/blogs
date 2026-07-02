import Anthropic from '@anthropic-ai/sdk';
import { fetchProducts, matchProductsToBlog, buildProductBlock, updateProductDescriptions } from './product-integration.js';
import { postToWordPress } from './wordpress-integration.js';
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
    ? `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Partner With PetScript Pharmacy</h3><p style="margin:0 0 12px;color:#374151">Ready to work with a compounding pharmacy built for veterinary practices?</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptpharmacy.com" style="color:#1a56db">www.petscriptpharmacy.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscript.net" style="color:#1a56db">info@petscript.net</a></li></ul></div>`
    : `<div style="background:#EBF4FF;border-left:4px solid #1a56db;padding:20px 24px;margin:32px 0;border-radius:0 8px 8px 0"><h3 style="margin:0 0 8px;color:#1a56db">Get Your Pet's Medication from PetScript Direct</h3><p style="margin:0 0 12px;color:#374151">Custom compounded medications delivered to your door.</p><ul style="margin:0;padding-left:20px;color:#374151"><li>Website: <a href="https://www.petscriptdirect.com" style="color:#1a56db">www.petscriptdirect.com</a></li><li>Phone: <a href="tel:8667846915" style="color:#1a56db">866-784-6915</a></li><li>Email: <a href="mailto:info@petscriptdirect.com" style="color:#1a56db">info@petscriptdirect.com</a></li></ul></div>`;
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
  "sources": [
    {"url": "actual url", "title": "article title", "key_points": ["point 1", "point 2", "point 3"]}
  ],
  "pexels_query": "3 words for warm real pet lifestyle photo"
}`
    : audience === 'vet'
    ? `You are a veterinary content researcher. Search these sources for trending topics relevant to veterinary compounding pharmacy: ${sources}

Find ONE trending topic from the past 30 days that veterinarians are searching for.

AVOID these recently covered topics: ${usedKeywords.slice(-10).join(', ')}
AVOID topics similar to these recent titles: ${recentTitles.join(' | ')}
AVOID any topic that requires medication dosing, treatment protocols, or drug administration details.

Good topic types: pharmacy partnerships, medication availability, regulatory updates, practice efficiency, specific conditions that benefit from compounding (described informatively), client communication, industry trends.

Search for 2-3 real articles on the chosen topic. Read their key points.

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
  
  // Try to parse JSON from response
  try {
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
  } catch (parseErr) {
    console.warn('JSON parse failed, using fallback');
  }

  // Fallback — use the topic override directly with no sources
  if (topicOverride) {
    console.log('Using topic override as fallback research data');
    return {
      keyword: topicOverride,
      topic: topicOverride,
      search_volume: 'medium',
      sources: [],
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
  ).join('\n\n') || 'No sources found — write from general knowledge on the topic.';

  const prompt = `You are a professional SEO copywriter writing for ${storeName}, a veterinary compounding pharmacy.

TASK: Write a fully SEO-optimized blog post based on the source material below.

AUDIENCE: ${audience === 'vet' ? 'Veterinarians, vet techs, and clinic managers — write as a knowledgeable peer' : 'Pet owners who love their animals — warm, friendly, easy to understand'}
PRIMARY KEYWORD: "${researchData.keyword}"
TOPIC: ${researchData.topic}

SOURCE MATERIAL (base facts on this — rewrite in original language):
${sourceMaterial}

SEO REQUIREMENTS (follow these exactly):
1. TITLE: Include primary keyword, use em dash (—) as separator, max 60 chars
2. META: 150-160 chars exactly, include primary keyword, compel the click
3. URL SLUG: short, lowercase, hyphens, includes keyword
4. H1: Exactly one, matches or closely reflects the title
5. H2s: 3-5 subheadings, include secondary keywords naturally
6. KEYWORD DENSITY: Primary keyword appears in first paragraph, at least one H2, and 2-3x in body
7. INTRO: 100-150 words — hook with a surprising stat, bold claim, or relatable scenario
8. BODY: 500-700 words total — short paragraphs (2-4 sentences), active voice
9. INTERNAL LINKS: Include 2 links to ${siteUrl} naturally in the body
10. EXTERNAL LINKS: 1 link to an authoritative source (avma.org, fda.gov, etc.)
11. CTA: Strong closing paragraph with clear action
12. NEVER include dosing amounts, mg/kg values, or administration instructions
13. Answer "People Also Ask" style questions where natural
14. Write for featured snippets — use definition paragraphs and numbered lists where appropriate

Respond with EXACTLY this format — each label at the START of a line:
TITLE: your title here (max 60 chars, keyword included)
META: meta description here (150-160 chars exactly, keyword included)
TAGS: tag1, tag2, tag3, tag4, tag5
PEXELS: 3 words for warm real lifestyle photo (pet or vet scene, NO pills/labs)
BODY: full HTML blog body here (h2, h3, p, ul, li, a tags only — no html/body/head)`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  console.log('Stop reason:', response.stop_reason);
  console.log('Content blocks:', response.content.length);

  const text = response.content.find(b => b.type === 'text')?.text || '';
  console.log('Response length:', text.length);

  if (!text) throw new Error(`Claude returned empty response. Stop reason: ${response.stop_reason}`);

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

// ── Upload base64 image to imgbb for permanent hosting ────────
async function uploadToImgbb(b64) {
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    console.warn('No IMGBB_API_KEY set — skipping image upload');
    return null;
  }
  try {
    console.log('Uploading to imgbb...');
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
    console.warn('imgbb failed:', JSON.stringify(uploadData).slice(0, 200));
    return null;
  } catch (err) {
    console.warn('imgbb error:', err.message);
    return null;
  }
}

// ── Generate image via OpenAI gpt-image-1 ────────────────────
async function generateAIImage(blogTitle, blogKeyword, pexelsQuery) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const topicLower = `${blogTitle} ${blogKeyword}`.toLowerCase();

  // Unique seed per blog title to ensure different image every time
  const seed = blogTitle.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (arr) => arr[seed % arr.length];

  // Pet breeds for variety
  const dogs = ['golden retriever', 'Labrador retriever', 'Border Collie', 'French Bulldog', 'Beagle', 'Australian Shepherd', 'Corgi', 'German Shepherd'];
  const cats = ['orange tabby cat', 'black and white cat', 'fluffy Persian cat', 'grey striped cat', 'Siamese cat', 'Maine Coon cat'];
  const vetDescriptions = ['smiling female veterinarian', 'friendly male veterinarian', 'caring veterinarian with brown hair', 'young professional veterinarian'];

  const dog = rand(dogs);
  const cat = rand(cats);
  const vet = rand(vetDescriptions);

  let scenePrompt;

  if (topicLower.includes('fip') || topicLower.includes('feline infectious')) {
    scenePrompt = `A ${vet} gently holding a ${cat} on a clinic table, both looking comfortable and relaxed, bright warm clinic background, the cat looks healthy and content`;
  } else if (topicLower.includes('anxiety') || topicLower.includes('behavioral') || topicLower.includes('separation')) {
    scenePrompt = `A happy ${dog} sitting close to its smiling owner on a sunny park bench outdoors, tail wagging, warm afternoon sunlight`;
  } else if (topicLower.includes('kidney') || topicLower.includes('renal') || topicLower.includes('senior')) {
    scenePrompt = `An elderly pet owner lovingly stroking a senior ${cat} on their lap at home, warm indoor lighting, peaceful and tender moment`;
  } else if (topicLower.includes('pain') || topicLower.includes('arthritis') || topicLower.includes('mobility')) {
    scenePrompt = `A ${vet} gently examining the leg of a senior ${dog} on a clinic table, the dog looks relaxed and trusting, warm clinic lighting`;
  } else if (topicLower.includes('merger') || topicLower.includes('consolidation') || topicLower.includes('industry') || topicLower.includes('distribution')) {
    scenePrompt = `A ${vet} and a smiling pet owner shaking hands in a bright veterinary clinic reception area, a ${dog} sitting happily beside them`;
  } else if (topicLower.includes('compounding') || topicLower.includes('pharmacy') || topicLower.includes('medication') || topicLower.includes('prescription')) {
    scenePrompt = `A ${vet} kneeling down and smiling at a happy ${dog} in a bright modern clinic waiting room, the dog is sitting and looking up adoringly`;
  } else if (topicLower.includes('cat') || topicLower.includes('feline') || topicLower.includes('kitten')) {
    scenePrompt = `A young woman laughing while a playful ${cat} climbs on her shoulder at home, warm natural window light, joyful candid moment`;
  } else if (topicLower.includes('dog') || topicLower.includes('canine') || topicLower.includes('puppy')) {
    scenePrompt = `A ${dog} running joyfully through a sunny park, tongue out, motion blur on legs showing energy and happiness, golden hour lighting`;
  } else if (topicLower.includes('integration') || topicLower.includes('workflow') || topicLower.includes('pims') || topicLower.includes('software')) {
    scenePrompt = `A ${vet} at a modern computer in a bright clinic, smiling while looking at the screen, a ${cat} sitting on the desk beside them`;
  } else if (topicLower.includes('regulation') || topicLower.includes('compliance') || topicLower.includes('fda') || topicLower.includes('accreditation')) {
    scenePrompt = `A confident ${vet} in a white coat standing in a bright modern clinic hallway, smiling professionally, a ${dog} walking beside them on a leash`;
  } else {
    // Generic warm lifestyle — always pets, never medications
    const scenes = [
      `A ${vet} giving a treat to a happy ${dog} after a checkup, both looking delighted, bright clinic background`,
      `A pet owner cuddling their ${cat} on a comfortable clinic chair while waiting, the cat is purring and relaxed`,
      `A ${dog} and ${cat} sitting together looking at the camera in a sunny living room, natural light, cozy home setting`,
      `A child hugging a ${dog} in a backyard, warm sunshine, pure joy and happiness`,
      `A ${vet} listening to the heartbeat of a calm ${dog} with a stethoscope, the dog is sitting patiently, warm clinic light`,
    ];
    scenePrompt = scenes[seed % scenes.length];
  }

  const fullPrompt = `${scenePrompt}. Photorealistic lifestyle photography style, warm inviting lighting, no text overlays, no medication bottles or pills visible, no syringes or clinical equipment in focus. Shot like a professional pet lifestyle photograph. High quality, emotionally warm.`;

  try {
    console.log('🎨 Generating AI image...');
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
      console.warn('OpenAI image error:', res.status, (await res.text()).slice(0, 200));
      return null;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    const tempUrl = data.data?.[0]?.url;

    console.log('OpenAI response — has b64:', !!b64, '| has url:', !!tempUrl);

    let finalB64 = b64;

    // If we got a URL instead of b64, download it
    if (!finalB64 && tempUrl) {
      console.log('Downloading from temp URL...');
      try {
        const imgRes = await fetch(tempUrl);
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          finalB64 = Buffer.from(buf).toString('base64');
          console.log('Downloaded successfully, size:', finalB64.length);
        } else {
          console.warn('Download failed:', imgRes.status);
        }
      } catch (e) {
        console.warn('Download error:', e.message);
      }
    }

    if (!finalB64) {
      console.warn('No image data from OpenAI');
      return null;
    }

    // Upload to imgbb for permanent hosting
    const hostedUrl = await uploadToImgbb(finalB64);
    if (!hostedUrl) return null;

    return {
      url: hostedUrl,
      altText: `${blogTitle} - PetScript`,
      credit: 'AI generated image for PetScript',
      creditUrl: audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com',
    };
  } catch (err) {
    console.warn('AI image generation failed:', err.message);
    return null;
  }
}

// ── Generate image via Higgsfield Nano Banana ────────────────
async function generateHiggsImage(blogTitle, blogKeyword) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) { console.warn('No FAL_API_KEY'); return null; }

  const t = `${blogTitle} ${blogKeyword}`.toLowerCase();
  let prompt;

  if (t.includes('gs-441524') || t.includes('gs441524') || t.includes('fip') || t.includes('feline infectious')) {
    prompt = 'Medium shot, eye-level, of a female veterinarian in her thirties in a crisp white coat gently cradling a sleepy orange tabby cat. The vet is looking down at the cat with a warm smile, not at camera. Soft diffused window light from the left, warm tungsten fill from overhead. Modern veterinary clinic interior visible in background — clean whites, soft bokeh. Filmic editorial finish: subtle grain, lifted blacks, soft highlight rolloff. Mood: calm expertise, deep trust. Photorealistic.';
  } else if (t.includes('pimobendan') || t.includes('cardiac') || t.includes('heart')) {
    prompt = 'Candid documentary shot of a veterinarian using a stethoscope to listen to the heartbeat of a Cavalier King Charles Spaniel on an exam table. Vet is focused on the dog, not camera. Warm clinic lighting, soft depth of field. The dog looks relaxed and comfortable. Filmic editorial finish, muted palette, photorealistic.';
  } else if (t.includes('anxiety') || t.includes('separation') || t.includes('behavioral')) {
    prompt = 'Lifestyle editorial shot of a calm golden retriever lying on a sunny hardwood floor, warm afternoon light streaming through large windows. Dog is relaxed, head resting on paws, eyes soft. Owner hand gently resting on the dog back, owner not in frame. Warm neutral home interior. Shallow depth of field, photorealistic lifestyle photography.';
  } else if (t.includes('kidney') || t.includes('renal')) {
    prompt = 'Intimate candid shot of an elderly woman hands gently stroking a senior grey cat curled in her lap. Neither looking at camera. Warm window light, cozy home setting, soft wool blanket. Close medium shot. Filmic finish, warm muted palette, photorealistic.';
  } else if (t.includes('pain') || t.includes('arthritis') || t.includes('gabapentin')) {
    prompt = 'Candid low-angle shot of a veterinarian kneeling at floor level beside a senior Labrador retriever. Vet is gently examining the dog leg, both focused on each other not camera. Warm modern clinic floor, soft ambient light. Photorealistic, shallow depth of field.';
  } else if (t.includes('methimazole') || t.includes('hyperthyroid') || t.includes('thyroid')) {
    prompt = 'Editorial close-up of a grey and white cat sitting on a sunny windowsill, looking out the window peacefully. Warm natural backlight creates a gentle rim light on the cat fur. Interior home setting softly visible in background. Photorealistic, filmic finish.';
  } else if (t.includes('seizure') || t.includes('epilepsy') || t.includes('phenobarbital')) {
    prompt = 'Warm candid shot of a Border Collie resting peacefully on a soft dog bed in a cozy living room. Dog is sleeping, relaxed. Warm afternoon light, blurred home interior background. Photorealistic lifestyle photography.';
  } else if (t.includes('cat') || t.includes('feline') || t.includes('kitten')) {
    prompt = 'Candid lifestyle shot of a tabby kitten playing with a toy on a bright white linen bed. Natural window light, airy bedroom setting. Kitten is mid-motion, not looking at camera. Shallow depth of field, soft warm tones. Photorealistic.';
  } else if (t.includes('dog') || t.includes('canine') || t.includes('puppy')) {
    prompt = 'Lifestyle editorial shot of a happy golden retriever running through a sunny green park, tongue out, caught mid-stride. Owner blurred in background watching. Golden hour light, warm tones. Shallow depth of field. Photorealistic action photography.';
  } else if (t.includes('compounding') || t.includes('pharmacy') || t.includes('formulary')) {
    prompt = 'Candid shot of a confident female veterinarian reviewing a patient chart at a modern clinic desk. She is focused on the chart, not camera. Clean white clinic interior, warm overhead lighting, medical equipment softly visible in background. Photorealistic editorial photography.';
  } else {
    prompt = 'Warm lifestyle editorial shot of a happy mixed-breed dog sitting in a sunny backyard, looking up at something off-camera with an alert happy expression. Lush green background, golden afternoon light. Shallow depth of field. Photorealistic photography.';
  }

  try {
    console.log('🎨 Generating Nano Banana image via fal.ai...');

    // Use fal.ai API for Nano Banana 2
    const { fal } = await import('@fal-ai/client');
    fal.config({ credentials: apiKey });

    const result = await fal.subscribe('fal-ai/nano-banana-2', {
      input: {
        prompt,
        aspect_ratio: '16:9',
        resolution: '2K',
        num_images: 1,
        safety_tolerance: '4',
        output_format: 'jpeg',
      },
      logs: false,
    });

    const imageUrl = result?.data?.images?.[0]?.url;
    if (imageUrl) {
      console.log('✅ Nano Banana image ready:', imageUrl.slice(0, 80));
      return { url: imageUrl, altText: blogTitle, credit: '', creditUrl: '' };
    }
    console.warn('No image URL in fal.ai response:', JSON.stringify(result?.data).slice(0, 200));
    return null;
  } catch (err) {
    console.warn('Higgsfield error:', err.message);
    return null;
  }
}

// ── Generate AI image and return base64 ─────────────────────
async function generateAIImageBase64(blogTitle, blogKeyword) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const t = `${blogTitle} ${blogKeyword}`.toLowerCase();
  let scene;

  // FIP and GS-441524 — ALWAYS cats, never dogs
  if (t.includes('gs-441524') || t.includes('gs441524') || t.includes('fip') || t.includes('feline infectious peritonitis')) {
    scene = 'A compassionate female veterinarian in a white coat gently cradling a sleepy orange tabby cat in her arms, both looking calm and content. Soft warm clinic lighting, blurred modern clinic background. Close up portrait style.';
  // Cat-specific conditions
  } else if (t.includes('hyperthyroid') || t.includes('methimazole') || t.includes('kidney') && t.includes('cat')) {
    scene = 'A loving pet owner gently stroking a fluffy grey cat sitting on a veterinary exam table, a smiling vet looking on. Warm professional clinic lighting.';
  // Ophthalmic — eye close up with animal
  } else if (t.includes('ophthalm') || t.includes('kcs') || t.includes('tacrolimus') || t.includes('cyclosporine') || t.includes('eye')) {
    scene = 'A veterinarian using an ophthalmoscope to gently examine the eye of a calm golden retriever on an exam table. Bright focused clinic lighting, professional and caring atmosphere.';
  // Cardiac — dog with vet listening to heart
  } else if (t.includes('pimobendan') || t.includes('cardiac') || t.includes('heart') || t.includes('furosemide')) {
    scene = 'A caring veterinarian using a stethoscope to listen to the heartbeat of a calm Cavalier King Charles Spaniel on an exam table. Warm clinic lighting, focused and professional.';
  // Pain and arthritis — senior dog
  } else if (t.includes('pain') || t.includes('arthritis') || t.includes('gabapentin') || t.includes('tramadol')) {
    scene = 'A kind veterinarian kneeling beside a gentle senior Labrador retriever, both at ground level. The dog looks relaxed and trusting. Bright warm clinic flooring, natural light.';
  // Anxiety and behavioral — calm dog with owner
  } else if (t.includes('anxiety') || t.includes('separation') || t.includes('behavioral') || t.includes('trazodone')) {
    scene = 'A smiling woman sitting on a sunny living room floor, her calm golden retriever resting its head in her lap. Warm afternoon sunlight through large windows, cozy home atmosphere.';
  // Seizures — dog with vet
  } else if (t.includes('seizure') || t.includes('epilepsy') || t.includes('phenobarbital') || t.includes('bromide')) {
    scene = 'A reassuring veterinarian placing a gentle hand on a Border Collie lying calmly on an exam table. Soft clinic lighting, caring professional atmosphere.';
  // Cushings / hormonal
  } else if (t.includes('cushings') || t.includes('trilostane') || t.includes('adrenal') || t.includes('hormone')) {
    scene = 'A veterinarian reviewing notes on a tablet while a friendly Poodle sits beside them on an exam table, looking healthy and bright-eyed. Modern clinic setting.';
  // Skin / dermatology
  } else if (t.includes('skin') || t.includes('allergy') || t.includes('dermat') || t.includes('itch')) {
    scene = 'A gentle veterinarian carefully examining the coat and skin of a happy Labrador retriever. Bright clinic lighting, the dog looks relaxed and cooperative.';
  // General cat topics
  } else if (t.includes('cat') || t.includes('feline') || t.includes('kitten')) {
    scene = 'A young woman laughing as a playful tabby kitten nuzzles her cheek. Natural window light, bright airy home. Warm candid joyful moment.';
  // General dog topics  
  } else if (t.includes('dog') || t.includes('canine') || t.includes('puppy')) {
    scene = 'A happy golden retriever looking up adoringly at its smiling owner in a sunny park. Warm afternoon light, shallow depth of field green background.';
  // Pharmacy / compounding / B2B
  } else if (t.includes('compounding') || t.includes('pharmacy') || t.includes('formulary') || t.includes('veterinari')) {
    scene = 'A confident female veterinarian in scrubs smiling warmly at the camera inside a bright modern clinic. A friendly Beagle sits on the exam table beside her, looking healthy and happy.';
  // Industry / business
  } else if (t.includes('merger') || t.includes('industry') || t.includes('consolidation') || t.includes('practice')) {
    scene = 'Two professional veterinarians having a friendly conversation in a bright modern clinic hallway, both smiling. A happy Labrador sits between them looking up.';
  // Default — warm vet scene
  } else {
    scene = 'A caring veterinarian kneeling to greet a happy mixed-breed dog in a bright modern clinic, the dog is wagging its tail enthusiastically. Warm natural lighting, inviting atmosphere.';
  }

  const prompt = `${scene} No text overlays, no logos, no pills or medicine bottles visible. High quality professional pet lifestyle photography for a veterinary brand. Photorealistic.`;

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1536x1024', quality: 'high' }),
    });

    if (!res.ok) {
      console.warn('OpenAI error:', res.status, (await res.text()).slice(0, 100));
      return null;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) { console.warn('No b64 in OpenAI response'); return null; }
    console.log('✅ AI image generated');
    return b64;
  } catch (err) {
    console.warn('OpenAI failed:', err.message);
    return null;
  }
}

// ── Upload base64 image to WordPress media library ───────────
async function uploadBase64ToWordPress(baseUrl, username, appPassword, b64, title) {
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

    if (!res.ok) {
      console.warn('WP media upload failed:', res.status, (await res.text()).slice(0, 100));
      return null;
    }

    const media = await res.json();
    return { id: media.id, url: media.source_url };
  } catch (err) {
    console.warn('WP upload error:', err.message);
    return null;
  }
}

// ── Static CTA block ────────────────────────────────────────
function buildStaticCTABlock(audience) {
  const isVet = audience === 'vet';
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

// ── Pexels fallback image ─────────────────────────────────────
// ── Topic-matched Pexels queries ────────────────────────────
function getPexelsQueries(blogTitle, blogKeyword, suggestedQuery) {
  const text = `${blogTitle} ${blogKeyword}`.toLowerCase();

  if (text.includes('fip') || text.includes('feline infectious')) return ['orange tabby cat veterinarian', 'cat clinic', 'cat exam vet'];
  if (text.includes('anxiety') || text.includes('separation') || text.includes('stress')) return ['happy dog owner home', 'calm dog couch', 'dog cuddle owner'];
  if (text.includes('poison') || text.includes('toxic') || text.includes('safety')) return ['pet owner dog home safe', 'dog family living room', 'cat owner home'];
  if (text.includes('kidney') || text.includes('renal')) return ['senior cat owner lap', 'old cat pet', 'cat senior cuddle'];
  if (text.includes('pain') || text.includes('arthritis')) return ['dog vet exam happy', 'senior dog owner', 'labrador vet'];
  if (text.includes('cat') || text.includes('feline') || text.includes('kitten')) return ['cat owner happy', 'kitten playing', 'cat cuddle'];
  if (text.includes('dog') || text.includes('canine') || text.includes('puppy')) return ['happy dog park', 'puppy owner', 'golden retriever family'];
  if (text.includes('compounding') || text.includes('pharmacy') || text.includes('medication')) return ['veterinarian dog clinic', 'vet exam happy dog', 'dog vet smiling'];
  if (text.includes('3d print') || text.includes('technology') || text.includes('innovation')) return ['veterinarian technology clinic', 'vet modern clinic', 'dog vet happy'];
  if (text.includes('merger') || text.includes('industry') || text.includes('consolidation')) return ['veterinarian professional', 'vet clinic team', 'dog vet exam'];

  // Always fall back to warm pet lifestyle — never clinical
  return [suggestedQuery || 'happy dog owner', 'pet owner smile', 'dog family outdoor'];
}

async function fetchPexelsImage(query, blogTitle = '', blogKeyword = '') {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const queries = getPexelsQueries(blogTitle, blogKeyword, query);

  for (const q of queries) {
    try {
      console.log(`Trying Pexels: "${q}"`);
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=landscape&size=large&per_page=20`, {
        headers: { Authorization: apiKey }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.photos?.length) {
        // Pick randomly from top results for variety
        const pick = data.photos[Math.floor(Math.random() * Math.min(10, data.photos.length))];
        console.log(`📷 Photo by ${pick.photographer} on Pexels`);
        return {
          url: pick.src.large2x || pick.src.large,
          altText: pick.alt || q,
          credit: `Photo by ${pick.photographer} on Pexels`,
          creditUrl: pick.photographer_url
        };
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
  if (image?.url) articleInput.image = { url: image.url, altText: image.altText };
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

  // Fall back to web research if no sheet topic
  let researchData;
  if (rawTopic) {
    console.log('✨ Prettifying topic title...');
    const prettyTitle = await prettifyTopic(rawTopic);
    console.log(`Pretty title: "${prettyTitle}"`);

    console.log('\n🔍 Researching source articles for topic...');
    researchData = await researchTopicAndArticles(prettyTitle);
  } else {
    console.log('\n🔍 No sheet topic — finding trending topic...');
    researchData = await researchTopicAndArticles();
  }

  console.log('\n✍️  Writing blog post from source material...');
  const post = await generateBlogPost(researchData);
  console.log(`📝 Title: ${post.title}`);
  console.log(`🏷️  Tags: ${post.tags.join(', ')}`);

  console.log('\n🛍  Matching products to blog topic...');
  const products = await fetchProducts(CONFIG.storeDomain, shopifyToken);
  const matchedProducts = await matchProductsToBlog(products, post.title, researchData.keyword, post.body);
  console.log(`Found ${matchedProducts.length} matching products: ${matchedProducts.map(p => p.title).join(', ') || 'none'}`);
  const productBlock = buildProductBlock(matchedProducts, CONFIG.storeDomain, post.title, researchData.keyword);

  // Try Higgsfield Nano Banana first, fall back to Pexels
  let image = null;
  if (process.env.FAL_API_KEY) {
    try {
      image = await generateHiggsImage(post.title, researchData.keyword);
    } catch (err) {
      console.warn('fal.ai failed:', err.message);
    }
  }
  if (!image) {
    console.log(`\n🖼  Falling back to Pexels: "${post.pexelsQuery}"`);
    try { image = await fetchPexelsImage(post.pexelsQuery, post.title, researchData.keyword); } catch (err) { console.warn('Pexels failed:', err.message); }
  }
  if (!image) console.log('⚠️  Posting without image');

  let finalBody = post.body + '\n' + productBlock + '\n' + getContactBlock();
  // No image credit line added

  const blogId = await getBlogId(CONFIG.storeDomain, shopifyToken);

  console.log('\n📤 Creating Shopify draft...');
  const article = await createDraft({
    domain: CONFIG.storeDomain, token: shopifyToken, blogId,
    title: post.title, body: finalBody, summary: post.meta,
    tags: post.tags, image,
  });

  console.log(`✅ Draft created: "${article.title}"`);
  console.log(`   ID: ${article.id}`);

  // Product description updates removed

  // ── Post to WordPress (vet store only for now) ────────────
  const wpUrl = audience === 'vet' ? process.env.WP_PHARMACY_URL : null;
  const wpUser = audience === 'vet' ? process.env.WP_PHARMACY_USERNAME : null;
  const wpPass = audience === 'vet' ? process.env.WP_PHARMACY_APP_PASSWORD : null;
  const wcKey = audience === 'vet' ? process.env.WP_PHARMACY_WC_KEY : null;
  const wcSecret = audience === 'vet' ? process.env.WP_PHARMACY_WC_SECRET : null;
  const wpStoreUrl = audience === 'vet' ? 'https://www.petscriptpharmacy.com' : 'https://www.petscriptdirect.com';

  if (wpUrl && wpUser && wpPass) {
    try {
      const wpPost = await postToWordPress({
        baseUrl: wpUrl,
        username: wpUser,
        appPassword: wpPass,
        consumerKey: wcKey,
        consumerSecret: wcSecret,
        title: post.title,
        body: post.body,
        metaDescription: post.meta,
        tags: post.tags,
        imageUrl: image?.url || null,
        imageAlt: post.title,
        wpMediaId: image?.wpMediaId || null,
        audience,
        blogKeyword: researchData.keyword,
        storeUrl: wpStoreUrl,
      });
      console.log(`\n✅ WordPress draft: ${wpPost.editUrl}`);
    } catch (wpErr) {
      console.warn('\n⚠️  WordPress posting failed:', wpErr.message);
      console.warn('Blog was still saved to Shopify successfully.');
    }
  } else {
    console.log('\nℹ️  WordPress secrets not set — skipping WordPress post');
  }

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
    hasImage: !!image, status: 'success',
  });

  console.log('\n🎉 Done! Review in Shopify > Online Store > Blog Posts');
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  saveRunLog({ date: new Date().toISOString(), audience, store: CONFIG?.storeDomain || 'unknown', status: 'failed', error: err.message });
  process.exit(1);
});
