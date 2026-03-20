/**
 * 盖世汽车 (gasgoo.com) - 汽车行业B2B专业媒体，编辑必看
 * Scrapes multiple section pages for broader coverage.
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'gasgoo';
const SOURCE_NAME = '盖世汽车';

const SECTION_URLS = [
  'https://auto.gasgoo.com/',
  'https://auto.gasgoo.com/ev',
  'https://auto.gasgoo.com/new-energy',
  'https://auto.gasgoo.com/qcxl',
];

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/**
 * Extract a date string from a gasgoo article URL.
 * URLs look like: /news/202603/20I70450849C108.shtml
 */
function dateFromUrl(href) {
  const m = href.match(/\/news\/(\d{4})(\d{2})\/(\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
  }
  return null;
}

/**
 * Scrape article links from a single page using cheerio.
 */
function extractArticles($) {
  const items = [];
  $('a[href*="/news/"]').each((_, el) => {
    const $a = $(el);
    const title = $a.text().trim();
    let href = $a.attr('href') || '';
    if (!title || title.length < 8 || !href.includes('.shtml')) return;
    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) href = 'https://auto.gasgoo.com' + href;

    const img = $a.find('img').attr('src') || '';
    const published = dateFromUrl(href) || null;
    if (!published) return; // Skip links without a recognizable article date in URL

    items.push({
      title,
      url: href,
      source: SOURCE,
      source_name: SOURCE_NAME,
      summary: '',
      image_url: img,
      published_at: published,
      tags: ['盖世汽车'],
    });
  });
  return items;
}

async function fetch({ withPage }) {
  let articles = [];

  // Strategy 1: Fetch multiple section pages via HTTP (fast, broad coverage)
  const fetches = SECTION_URLS.map(async (url) => {
    try {
      const res = await axios.get(url, { timeout: 15000, headers: HTTP_HEADERS });
      const $ = cheerio.load(res.data);
      return extractArticles($);
    } catch (e) {
      console.error(`[gasgoo] ${url} 失败: ${e.message}`);
      return [];
    }
  });

  const results = await Promise.all(fetches);
  for (const batch of results) {
    articles.push(...batch);
  }

  if (dedup(articles).length > 5) return dedup(articles);

  // Strategy 2: Puppeteer fallback (only if HTTP yields too few)
  try {
    const scraped = await withPage(async (page) => {
      await page.goto('https://auto.gasgoo.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await new Promise((r) => setTimeout(r, 2000));
      return await page.evaluate(() => {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/news/"]').forEach((a) => {
          const title = a.textContent?.trim() || a.getAttribute('title') || '';
          let href = a.getAttribute('href') || '';
          if (!title || title.length < 8 || seen.has(title) || !href.includes('.shtml')) return;
          seen.add(title);
          if (href.startsWith('/')) href = 'https://auto.gasgoo.com' + href;
          items.push({ title, url: href });
        });
        return items;
      });
    }, 35000);

    for (const item of scraped) {
      const published = dateFromUrl(item.url);
      if (!published) continue;
      articles.push({
        ...item,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: '',
        published_at: published,
        tags: ['盖世汽车'],
      });
    }
  } catch (e) {
    console.error(`[gasgoo] Puppeteer抓取失败: ${e.message}`);
  }

  return dedup(articles);
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter((a) => {
    if (seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });
}

module.exports = { fetch };
