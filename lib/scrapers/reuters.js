/**
 * 路透社 - Autos & Transportation via Puppeteer
 */
const cheerio = require('cheerio');
const axios = require('axios');

const SOURCE = 'reuters';
const SOURCE_NAME = '路透社';

async function fetch({ withPage }) {
  const articles = [];

  // Strategy 1: Try RSS/API first
  try {
    const rssArticles = await fetchViaAPI();
    if (rssArticles.length > 0) return rssArticles;
  } catch (_) {}

  // Strategy 2: Puppeteer scrape
  try {
    const scraped = await withPage(async (page) => {
      await page.goto('https://www.reuters.com/business/autos-transportation/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await page.waitForSelector('a[href*="/business/autos"]', { timeout: 10000 }).catch(() => {});

      return await page.evaluate(() => {
        const items = [];
        // Reuters uses data-testid or article elements
        const links = document.querySelectorAll('a[data-testid*="Heading"], article a[href*="/business/autos"], h3 a, [class*="story"] a');
        const seen = new Set();
        links.forEach((a) => {
          const title = a.textContent?.trim();
          let href = a.getAttribute('href') || '';
          if (!title || title.length < 10 || seen.has(title)) return;
          seen.add(title);
          if (href.startsWith('/')) href = 'https://www.reuters.com' + href;
          items.push({ title, url: href });
        });
        return items.slice(0, 30);
      });
    }, 35000);

    for (const item of scraped) {
      articles.push({
        title: item.title,
        url: item.url,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: '',
        published_at: new Date().toISOString(),
        tags: ['Reuters', 'Autos'],
      });
    }
  } catch (e) {
    console.error(`[reuters] Puppeteer抓取失败: ${e.message}`);
  }

  return articles;
}

async function fetchViaAPI() {
  // Reuters wire API (may or may not be available)
  const res = await axios.get('https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-alias-or-id-v1', {
    params: {
      query: JSON.stringify({ section_id: '/business/autos-transportation/', size: 30 }),
      _website: 'reuters',
    },
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const items = res.data?.result?.articles || res.data?.articles || [];
  return items.map((item) => ({
    title: item.title || item.headline,
    url: item.canonical_url ? `https://www.reuters.com${item.canonical_url}` : '',
    source: SOURCE,
    source_name: SOURCE_NAME,
    summary: item.description || '',
    image_url: '',
    published_at: item.published_time || new Date().toISOString(),
    tags: ['Reuters', 'Autos'],
  }));
}

module.exports = { fetch };
