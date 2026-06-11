/**
 * PetScript Google Ads Weekly Report
 * Pulls campaign performance and generates AI recommendations.
 * Activate once Google Ads Developer Token is approved.
 * 
 * Required secrets:
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

// ── Google Ads OAuth token refresh ──────────────────────────
async function getGoogleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Fetch campaign performance via Google Ads API ────────────
async function fetchCampaignPerformance(accessToken) {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
  const url = `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`;

  // GAQL query — last 7 days performance by campaign
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.cost_micros,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date DURING LAST_7_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads API error ${res.status}: ${text}`);
  }

  const results = await res.json();
  return results;
}

// ── Parse campaign data ──────────────────────────────────────
function parseCampaigns(rawResults) {
  const campaigns = [];
  for (const batch of rawResults) {
    for (const row of (batch.results || [])) {
      const c = row.campaign;
      const m = row.metrics;
      const budget = row.campaignBudget;
      campaigns.push({
        id: c.id,
        name: c.name,
        status: c.status,
        dailyBudget: budget ? (budget.amountMicros / 1_000_000).toFixed(2) : 'N/A',
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        ctr: m.ctr ? (m.ctr * 100).toFixed(2) + '%' : '0%',
        avgCpc: m.averageCpc ? '$' + (m.averageCpc / 1_000_000).toFixed(2) : '$0',
        conversions: m.conversions || 0,
        spend: m.costMicros ? '$' + (m.costMicros / 1_000_000).toFixed(2) : '$0',
        costPerConversion: m.costPerConversion ? '$' + (m.costPerConversion / 1_000_000).toFixed(2) : 'N/A',
      });
    }
  }
  return campaigns;
}

// ── Generate AI recommendations ──────────────────────────────
async function generateRecommendations(campaigns) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const campaignSummary = campaigns.map(c =>
    `- ${c.name} (${c.status}): Budget $${c.dailyBudget}/day | Spend: ${c.spend} | Clicks: ${c.clicks} | CTR: ${c.ctr} | Conversions: ${c.conversions} | Cost/Conv: ${c.costPerConversion}`
  ).join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `You are a Google Ads analyst for PetScript Pharmacy and PetScript Direct — veterinary compounding pharmacy stores. 
Review campaign performance data and provide clear, actionable recommendations. 
Be specific. Flag underperforming campaigns. Identify what's working. 
Format as a brief report Jp (the owner) can read in 2 minutes and act on.
NOTE: You can recommend budget changes but Jp must approve and make them manually.`,
    messages: [{
      role: 'user',
      content: `Here is last 7 days of Google Ads performance:\n\n${campaignSummary}\n\nProvide a brief weekly summary and 3-5 specific recommendations. Flag anything urgent.`
    }],
  });

  return response.content.find(b => b.type === 'text')?.text || '';
}

// ── Output report ────────────────────────────────────────────
function printReport(campaigns, recommendations) {
  const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full' });
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 PETSCRIPT GOOGLE ADS WEEKLY REPORT');
  console.log(`   Week ending: ${date}`);
  console.log('='.repeat(60));

  console.log('\n📋 CAMPAIGN PERFORMANCE (Last 7 Days)\n');
  for (const c of campaigns) {
    console.log(`${c.name}`);
    console.log(`  Status: ${c.status} | Daily Budget: $${c.dailyBudget}`);
    console.log(`  Spend: ${c.spend} | Clicks: ${c.clicks} | CTR: ${c.ctr}`);
    console.log(`  Conversions: ${c.conversions} | Cost/Conv: ${c.costPerConversion}\n`);
  }

  console.log('\n🤖 AI RECOMMENDATIONS\n');
  console.log(recommendations);
  console.log('\n' + '='.repeat(60));
  console.log('⚠️  REMINDER: Review these recommendations and make any');
  console.log('   budget/bid changes manually in Google Ads.');
  console.log('='.repeat(60) + '\n');
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🔄 Fetching Google Ads performance data...');
  
  const accessToken = await getGoogleAccessToken();
  const rawData = await fetchCampaignPerformance(accessToken);
  const campaigns = parseCampaigns(rawData);

  if (campaigns.length === 0) {
    console.log('No active campaigns found.');
    return;
  }

  console.log(`✅ Found ${campaigns.length} campaigns. Generating recommendations...`);
  const recommendations = await generateRecommendations(campaigns);
  
  printReport(campaigns, recommendations);
}

main().catch(err => {
  console.error('❌ Google Ads report failed:', err);
  process.exit(1);
});
