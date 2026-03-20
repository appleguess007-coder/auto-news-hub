/**
 * 汽车之家 - Cheerio优先 (GBK编码) + Puppeteer兜底
 */
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const SOURCE = 'autohome';
const SOURCE_NAME = '汽车之家';

async function fetch({ withPage }) {
  // Strategy 1: Cheerio direct (faster, no browser needed)
  try {
    const articles = await fetchViaCheerio();
    if (articles.length > 3) return articles;
  } catch (_) {}

  // Strategy 2: Puppeteer fallback
  try {
    return await fetchViaPuppeteer(withPage);
  } catch (e) {
    console.error(`[autohome] Puppeteer也失败: ${e.message}`);
  }

  return [];
}

async function fetchViaCheerio() {
  const res = await axios.get('https://www.autohome.com.cn/news/', {
    timeout: 20000,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  const html = iconv.decode(Buffer.from(res.data), 'gbk');
  const $ = cheerio.load(html);
  const articles = [];
  const seen = new Set();

  $('a').each((_, el) => {
    const $a = $(el);
    let href = $a.attr('href') || '';
    // Only match actual article URLs like /news/202603/1313035.html
    if (!href.match(/\/news\/\d{6}\/\d+\.html/)) return;

    // Prefer title attribute (clean), fall back to link text
    let title = $a.attr('title') || '';
    if (!title) {
      // Get only the first text line to avoid grabbing stats/metadata
      title = $a.text().trim().split(/\n/)[0].trim();
    }
    title = title.replace(/\s+/g, ' ').trim();

    // Clean trailing noise: "1天前 3474 0 [汽车之家 资讯] ..." -> remove stats
    title = title.replace(/\s+\d+[小时天分钟]+前.*$/, '').trim();
    title = title.replace(/\s+\d+\.\d+万\s+\d+\s+\[.*$/, '').trim();
    title = title.replace(/\s+\d+\s+\d+\s+\[.*$/, '').trim();

    if (!title || title.length < 8 || title.length > 120 || seen.has(title)) return;
    seen.add(title);

    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) href = 'https://www.autohome.com.cn' + href;

    // Extract date from the closest LI container text (e.g. "Title 1小时前 638 0 [content...]")
    const $container = $a.closest('li');
    const containerText = $container.length ? $container.text().trim().replace(/\s+/g, ' ') : '';
    const publishedAt = extractDateFromContext(containerText, href);

    // Extract summary from inline text after title
    const fullText = $a.text().trim().replace(/\s+/g, ' ');
    const bracketMatch = fullText.match(/\[汽车之家[^\]]*\]\s*(.+)/);
    const summary = bracketMatch ? bracketMatch[1].trim().slice(0, 200) : '';

    const img = $a.find('img');
    articles.push({
      title,
      url: href,
      source: SOURCE,
      source_name: SOURCE_NAME,
      summary,
      image_url: img.attr('src') || img.attr('data-src') || '',
      published_at: publishedAt,
      tags: ['汽车之家'],
    });
  });

  console.log(`[autohome] Cheerio抓取 ${articles.length} 条`);
  return articles;
}

async function fetchViaPuppeteer(withPage) {
  const scraped = await withPage(async (page) => {
    await page.goto('https://www.autohome.com.cn/news/', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    await page.waitForSelector('a[href*="/news/"]', { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    return await page.evaluate(() => {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/news/"]').forEach((a) => {
        const title = (a.getAttribute('title') || a.textContent?.trim() || '')
          .replace(/\s+/g, ' ').split('\n')[0].trim();
        let href = a.getAttribute('href') || '';
        if (!title || title.length < 8 || !href.match(/\/news\/\d{6}\/\d+/) || seen.has(title)) return;
        seen.add(title);
        if (href.startsWith('//')) href = 'https:' + href;
        const img = a.querySelector('img');
        // Get container LI text for date extraction
        const li = a.closest('li');
        const containerText = li ? li.textContent?.trim()?.replace(/\s+/g, ' ') || '' : '';
        items.push({
          title: title.replace(/\s+\d+[小时天分钟]+前.*$/, '').trim(),
          url: href,
          image_url: img?.src || '',
          containerText,
        });
      });
      return items.slice(0, 40);
    });
  }, 35000);

  return scraped.map((item) => ({
    ...item,
    source: SOURCE,
    source_name: SOURCE_NAME,
    summary: '',
    published_at: extractDateFromContext(item.containerText || '', item.url),
    tags: ['汽车之家'],
  }));
}

/**
 * Parse a relative date string like "1小时前", "2天前", "30分钟前" into an ISO date string.
 */
function parseRelativeDate(text) {
  const now = new Date();
  const hoursMatch = text.match(/(\d+)\s*小时前/);
  if (hoursMatch) {
    now.setHours(now.getHours() - parseInt(hoursMatch[1], 10));
    return now.toISOString();
  }
  const minsMatch = text.match(/(\d+)\s*分钟前/);
  if (minsMatch) {
    now.setMinutes(now.getMinutes() - parseInt(minsMatch[1], 10));
    return now.toISOString();
  }
  const daysMatch = text.match(/(\d+)\s*天前/);
  if (daysMatch) {
    now.setDate(now.getDate() - parseInt(daysMatch[1], 10));
    return now.toISOString();
  }
  if (/今天/.test(text)) {
    return now.toISOString();
  }
  if (/昨天/.test(text)) {
    now.setDate(now.getDate() - 1);
    return now.toISOString();
  }
  return null;
}

/**
 * Extract date from container text (preferred) or fall back to URL-based extraction.
 * Container text pattern: "Title 1小时前 638 0 [汽车之家 资讯] ..."
 */
function extractDateFromContext(containerText, url) {
  // 1. Try relative date from container text (e.g. "1小时前", "2天前", "30分钟前")
  const relMatch = containerText.match(/(\d+\s*[小时天分钟]+前)/);
  if (relMatch) {
    const parsed = parseRelativeDate(relMatch[1]);
    if (parsed) return parsed;
  }

  // 2. Try "今天" / "昨天" patterns
  if (/今天/.test(containerText)) return parseRelativeDate('今天');
  if (/昨天/.test(containerText)) return parseRelativeDate('昨天');

  // 3. Try ISO date pattern (e.g. "2026-03-20")
  const isoMatch = containerText.match(/(20\d{2}-\d{2}-\d{2})/);
  if (isoMatch) return new Date(isoMatch[1]).toISOString();

  // 4. Try Chinese date pattern (e.g. "3月20日") — infer year from URL or current year
  const cnMatch = containerText.match(/(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const urlYearMatch = url.match(/\/(\d{4})\d{2}\//);
    const year = urlYearMatch ? urlYearMatch[1] : new Date().getFullYear();
    const month = cnMatch[1].padStart(2, '0');
    const day = cnMatch[2].padStart(2, '0');
    return new Date(`${year}-${month}-${day}`).toISOString();
  }

  // 5. Last resort: extract year+month from URL, use day 15 as approximate
  const m = url.match(/\/(\d{4})(\d{2})\//);
  if (m) return new Date(`${m[1]}-${m[2]}-15`).toISOString();
  return new Date().toISOString();
}

module.exports = { fetch };
