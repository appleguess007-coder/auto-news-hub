/**
 * 懂车帝 (dongchedi.com) - Cheerio 抓取首页文章链接
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'dongchedi';
const SOURCE_NAME = '懂车帝';

async function fetch({ withPage }) {
  const articles = [];
  const seen = new Set();

  // Strategy 1: Cheerio scrape homepage
  try {
    const res = await axios.get('https://www.dongchedi.com/', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const $ = cheerio.load(res.data);

    // Try extracting SSR data
    $('script').each((_, el) => {
      const text = $(el).html() || '';
      if (text.includes('__INITIAL_DATA__') || text.includes('window.__data')) {
        const match = text.match(/(?:__INITIAL_DATA__|window\.__data)\s*=\s*(\{.+?\})\s*;/s);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            extractFromData(data, articles, seen);
          } catch (_) {}
        }
      }
    });

    // Also extract from HTML links
    $('a[href*="/article/"], a[href*="/news/"]').each((_, el) => {
      const $a = $(el);
      const title = $a.text().trim().replace(/\s+/g, ' ');
      let href = $a.attr('href') || '';
      if (title.length < 8 || title.length > 150 || seen.has(title)) return;
      seen.add(title);
      if (href.startsWith('/')) href = 'https://www.dongchedi.com' + href;

      articles.push({
        title,
        url: href,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: '',
        published_at: new Date().toISOString(),
        tags: ['懂车帝'],
      });
    });

    if (articles.length > 5) return articles;
  } catch (_) {}

  // Strategy 2: Puppeteer fallback
  try {
    const scraped = await withPage(async (page) => {
      await page.goto('https://www.dongchedi.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await new Promise((r) => setTimeout(r, 3000));
      return await page.evaluate(() => {
        const items = [];
        const s = new Set();
        document.querySelectorAll('a[href*="/article/"], a[href*="/news/"]').forEach((a) => {
          const title = a.textContent?.trim()?.replace(/\s+/g, ' ') || '';
          let href = a.href || '';
          if (title.length < 8 || s.has(title)) return;
          s.add(title);
          items.push({ title, url: href });
        });
        return items.slice(0, 40);
      });
    }, 35000);

    for (const item of scraped) {
      articles.push({
        ...item,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: '',
        published_at: new Date().toISOString(),
        tags: ['懂车帝'],
      });
    }
  } catch (e) {
    console.error(`[dongchedi] Puppeteer抓取失败: ${e.message}`);
  }

  return articles;
}

function extractFromData(data, articles, seen) {
  // Recursively find article-like objects
  const queue = [data];
  while (queue.length > 0) {
    const obj = queue.shift();
    if (!obj || typeof obj !== 'object') continue;
    if (obj.title && obj.title.length > 8 && !seen.has(obj.title)) {
      seen.add(obj.title);
      articles.push({
        title: obj.title,
        url: obj.article_url || obj.url || '',
        source: 'dongchedi',
        source_name: '懂车帝',
        summary: obj.abstract || obj.summary || '',
        image_url: obj.image_url || '',
        published_at: obj.publish_time
          ? new Date(obj.publish_time * 1000).toISOString()
          : new Date().toISOString(),
        tags: ['懂车帝'],
      });
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) val.forEach((v) => queue.push(v));
      else if (val && typeof val === 'object') queue.push(val);
    }
  }
}

module.exports = { fetch };
