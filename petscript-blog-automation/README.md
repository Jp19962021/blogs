# PetScript Auto Blog Automation

Runs every day at **8:00 AM CT** via GitHub Actions.

Generates one blog draft per store:
- **petscriptpharmacy.com** — B2B content for veterinarians
- **petscriptdirect.com** — B2C content for pet owners

Each run: researches trending angles → picks an unused SEO keyword → writes a full post via Claude → fetches a real Unsplash photo → posts as a **draft** to Shopify for your review.

---

## Setup (do this once)

### Step 1 — Get your API keys

#### Anthropic API Key
1. Go to https://console.anthropic.com
2. Click **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-...`)

#### Unsplash API Key
1. Go to https://unsplash.com/oauth/applications
2. Click **New Application** → fill in app name (e.g. "PetScript Blogs") and description
3. Accept terms → your **Access Key** will be shown on the app page
4. The free demo tier (50 req/hour) is plenty for daily use

#### Shopify Admin API Tokens — do this for BOTH stores

For **petscriptpharmacy.com**:
1. Shopify Admin → **Settings** → **Apps and sales channels**
2. Click **Develop apps** → **Create an app** → name it "Blog Automation"
3. Click **Configure Admin API scopes** → enable:
   - `write_content` ✅
   - `read_content` ✅
4. Click **Save** → **Install app** → copy the **Admin API access token**

Repeat for **petscriptdirect.com**.

#### Shopify Store Domains
These are your `.myshopify.com` domains (NOT the public domains):
- Go to Shopify Admin → Settings → Store details → look for `*.myshopify.com`
- Format: `petscriptpharmacy.myshopify.com` and `petscriptdirect.myshopify.com`

---

### Step 2 — Add GitHub Secrets

In your GitHub repo:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** for each of these:

| Secret Name | Value |
|-------------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic key (`sk-ant-...`) |
| `UNSPLASH_ACCESS_KEY` | Your Unsplash Access Key |
| `SHOPIFY_PHARMACY_TOKEN` | Admin API token for petscriptpharmacy |
| `SHOPIFY_PHARMACY_STORE` | `petscriptpharmacy.myshopify.com` |
| `SHOPIFY_DIRECT_TOKEN` | Admin API token for petscriptdirect |
| `SHOPIFY_DIRECT_STORE` | `petscriptdirect.myshopify.com` |

---

### Step 3 — Push this repo to GitHub

```bash
git init
git add .
git commit -m "Initial blog automation setup"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

---

### Step 4 — Test it manually

Once pushed, go to GitHub → **Actions** → **Daily Blog Posts** → **Run workflow** → click **Run workflow**.

Watch the logs. Within ~2 minutes you should see two new drafts in each Shopify store under **Online Store → Blog Posts**.

---

## Daily workflow

1. GitHub runs automatically at 8 AM CT every day
2. Two drafts appear in your Shopify stores
3. You review, make any edits, and click **Publish**
4. Done ✅

---

## Keyword rotation

Keywords are tracked in `config/used-keywords-vet.json` and `config/used-keywords-petowner.json`.

The script automatically rotates through the full keyword list (defined in `config/store-config.js`) without repeating a keyword for ~20 days. When all keywords are used, it starts the cycle fresh.

To add more keywords: edit the `keywords` arrays in `config/store-config.js` and push the change.

---

## Timing notes

The workflow runs at `0 13 * * *` UTC = **8:00 AM CDT** (summer).

In winter (CST, UTC-6), change it to `0 14 * * *` in `.github/workflows/daily-blogs.yml`.

---

## Google Ads (coming soon)

Once your Google Ads Developer Token is approved:
1. Add secrets: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`
2. A separate `google-ads-report.yml` workflow will run weekly to pull performance data and surface recommendations for your review

---

## Repo structure

```
petscript-blog-automation/
├── .github/
│   └── workflows/
│       └── daily-blogs.yml      ← GitHub Actions schedule
├── scripts/
│   ├── generate-blog.js         ← Main blog generation script
│   └── package.json
├── config/
│   ├── store-config.js          ← Keywords, prompts, store settings
│   ├── used-keywords-vet.json   ← Auto-generated, tracks rotation
│   └── used-keywords-petowner.json
└── README.md
```
