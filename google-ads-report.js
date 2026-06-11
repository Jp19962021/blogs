// ============================================================
// CONFIG: PetScript Pharmacy (VET / B2B audience)
// Store: petscriptpharmacy.com
// ============================================================

export const VET_CONFIG = {
  storeDomain: process.env.SHOPIFY_PHARMACY_STORE, // e.g. petscriptpharmacy.myshopify.com
  shopifyToken: process.env.SHOPIFY_PHARMACY_TOKEN,
  blogId: 'gid://shopify/Blog/101500682495', // "All About Pets"
  authorName: 'PetScript Pharmacy',
  audience: 'vet',

  // Unsplash search terms to use for this store (warm, clinical-but-not-AI)
  unsplashQueries: [
    'veterinarian with dog',
    'veterinary clinic',
    'pet examination',
    'vet and cat',
    'animal hospital',
    'veterinarian smiling',
    'pet medication',
    'dog at vet',
    'cat at vet',
    'veterinary practice',
  ],

  systemPrompt: `You are a B2B content writer for PetScript Pharmacy, a veterinary compounding pharmacy. 
Your audience is veterinarians, veterinary technicians, clinic managers, and animal health professionals — NOT pet owners.
Write with authority on veterinary pharmacy topics. Tone: professional, warm, trustworthy, knowledgeable.
NEVER include specific dosing guidelines, dosage amounts, or medication administration instructions.
Always position PetScript Pharmacy as a knowledgeable, reliable B2B partner without being overly salesy.
Include at least one internal link to https://www.petscriptpharmacy.com/ or https://www.petscriptpharmacy.com/blogs/all/what-makes-a-veterinary-compounding-pharmacy-legitimate-a-vets-guide-to-vetting-your-vendor when relevant.
Target length: 500-700 words. Use H2 and H3 subheadings. Write clean HTML body (no <html>/<body> tags).`,

  // SEO keyword rotation list — script tracks used keywords in config/used-keywords-vet.json
  keywords: [
    'what makes a compounding pharmacy legitimate',
    'LegitScript certified veterinary pharmacy',
    'how does compounding work for pet medication',
    'flavored medication for picky cats and dogs',
    'chewable medication for dogs that wont take pills',
    'transdermal medication for cats',
    'how to get FIP medication for cats',
    'compounded medication for cats with kidney disease',
    'how to switch compounding pharmacies',
    'pet medication sourcing for veterinary clinics',
    'veterinary compounding pharmacy near me',
    'pet medication shipping time veterinary pharmacy',
    'best compounding pharmacy for veterinarians',
    'compounded medication formulary for veterinary clinics',
    'veterinary pharmacy 24/7 customer support',
  ],
};

// ============================================================
// CONFIG: PetScript Direct (PET OWNER / B2C audience)
// Store: petscriptdirect.com
// ============================================================

export const PETOWNER_CONFIG = {
  storeDomain: process.env.SHOPIFY_DIRECT_STORE, // e.g. petscriptdirect.myshopify.com
  shopifyToken: process.env.SHOPIFY_DIRECT_TOKEN,
  blogId: null, // set after first run — script will auto-detect the first blog
  authorName: 'PetScript Direct',
  audience: 'petowner',

  unsplashQueries: [
    'happy dog owner',
    'cat cuddling owner',
    'pet and family',
    'dog playing outside',
    'cat sleeping',
    'puppy portrait',
    'kitten close up',
    'person holding cat',
    'dog running on beach',
    'pet portrait',
  ],

  systemPrompt: `You are a friendly, helpful content writer for PetScript Direct, an online pet pharmacy that makes getting custom compounded medications easy for everyday pet owners.
Your audience is pet owners — dog and cat parents, people who love their animals and want the best care for them.
Tone: warm, conversational, empathetic, easy to understand. Avoid jargon. 
NEVER include specific dosing guidelines, dosage amounts, or medication administration instructions.
Write content that helps pet owners understand their options, feel reassured, and trust PetScript Direct as a caring pharmacy partner.
Target length: 450-600 words. Use H2 subheadings. Write clean HTML body (no <html>/<body> tags).`,

  keywords: [
    'how to give cats medication',
    'my dog wont take pills',
    'flavored pet medication',
    'compounding pharmacy for pets',
    'custom pet medication',
    'affordable pet prescriptions online',
    'pet medication for picky eaters',
    'compounded medication for senior dogs',
    'medication for cats that hate pills',
    'online pet pharmacy',
    'pet prescription delivery',
    'transdermal medication for cats at home',
    'FIP treatment for cats',
    'kidney disease medication for cats',
    'pet medication subscription',
    'cheapest pet pharmacy online',
    'is compounding safe for pets',
    'how long does pet medication take to arrive',
  ],
};
