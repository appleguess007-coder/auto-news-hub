/**
 * 新浪汽车 7x24 快讯
 * Strategy 1: 直接调用 7x24 JSON API (快速、可靠、无需浏览器)
 * Strategy 2: PC 页面 Cheerio 兜底
 *
 * API: https://a.sina.cn/topic/inside/shortnews/shortnews/
 * Params: day (YYYY-M-D), page, limit, tagid (0=全部)
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'sina-auto';
const SOURCE_NAME = '新浪汽车7x24';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Referer: 'https://auto.sina.cn/7x24/',
};

async function fetch() {
  const articles = [];
  const seen = new Set();

  // Strategy 1: 7x24 JSON API (主力)
  try {
    const apiArticles = await fetch7x24API(seen);
    articles.push(...apiArticles);
    console.log(`[sina-auto] 7x24 API获取 ${apiArticles.length} 条`);
    if (articles.length > 3) return articles;
  } catch (e) {
    console.error(`[sina-auto] 7x24 API失败: ${e.message}`);
  }

  // Strategy 2: PC 页面 Cheerio 兜底
  try {
    const pcArticles = await fetchPC(seen);
    articles.push(...pcArticles);
  } catch (e) {
    console.error(`[sina-auto] PC页面抓取失败: ${e.message}`);
  }

  return articles;
}

/**
 * Fetch from 7x24 JSON API - returns structured feed data
 * Fetches today + yesterday for broader coverage
 */
async function fetch7x24API(seen) {
  const articles = [];
  const now = new Date();

  // Fetch today and yesterday
  const days = [
    formatDay(now),
    formatDay(new Date(now.getTime() - 86400000)),
  ];

  for (const day of days) {
    for (let page = 1; page <= 3; page++) {
      try {
        const res = await axios.get(
          'https://a.sina.cn/topic/inside/shortnews/shortnews/',
          {
            params: { day, page, limit: 20, tagid: 0 },
            timeout: 12000,
            headers: HEADERS,
          }
        );

        const data = res.data;
        if (data.code !== 1000 || !data.data || data.data.length === 0) break;

        for (const item of data.data) {
          // Determine title: news items have hasTitle="1" with a real title
          // Weibo posts have hasTitle="0" - extract from summary
          let title = '';
          let summary = '';

          if (item.title && item.title.length > 0) {
            // News item with title
            title = item.title.trim();
            summary = (item.summary || '').trim();
          } else if (item.summary) {
            // Weibo post - extract first sentence as title, rest as summary
            const cleanText = item.summary
              .replace(/#[^#]*#/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            const sentences = cleanText.split(/[。！？\n]/);
            title = sentences[0]?.trim() || '';
            if (title.length > 80) title = title.substring(0, 78) + '…';
            summary =
              cleanText.length > title.length + 3
                ? cleanText.substring(title.length).replace(/^[。！？\s]+/, '').trim().substring(0, 300)
                : '';
          }

          if (!title || title.length < 8 || title.length > 200 || seen.has(title)) continue;
          seen.add(title);

          // Build URL: prefer article URL, fall back to weibo detail
          const url = item.URL || item.wapURL || '';

          // Parse time: cTime format "2026-03-20 17:51:10"
          let publishedAt = '';
          if (item.cTime) {
            try {
              // cTime is in Beijing time (UTC+8)
              publishedAt = new Date(item.cTime.replace(' ', 'T') + '+08:00').toISOString();
            } catch (_) {
              publishedAt = new Date().toISOString();
            }
          }

          articles.push({
            title,
            url,
            source: SOURCE,
            source_name: SOURCE_NAME,
            summary,
            image_url: item.pic || item.fpic || '',
            published_at: publishedAt || new Date().toISOString(),
            tags: ['新浪7x24'],
          });
        }

        // If fewer than limit returned, no more pages
        if (data.data.length < 20) break;
      } catch (e) {
        console.error(`[sina-auto] API page=${page} day=${day} 失败: ${e.message}`);
        break;
      }
    }
  }

  return articles;
}

/**
 * Format date as "YYYY-M-D" (no zero-padding, as the API expects)
 */
function formatDay(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Fallback: Cheerio scrape PC news pages
 */
async function fetchPC(seen) {
  const articles = [];
  const pages = ['https://auto.sina.com.cn/newcar/', 'https://auto.sina.com.cn/'];
  const pcHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };

  for (const pageUrl of pages) {
    try {
      const res = await axios.get(pageUrl, { timeout: 15000, headers: pcHeaders });
      const $ = cheerio.load(res.data);

      $('a').each((_, el) => {
        const $a = $(el);
        let href = $a.attr('href') || '';
        if (!href.match(/detail-[a-z]+\d+\.shtml|detail-[a-z]+\d+\.d\.html/)) return;

        const rawTitle = $a.text().trim().replace(/\s+/g, ' ');
        if (rawTitle.length < 10 || rawTitle.length > 120 || seen.has(rawTitle)) return;
        seen.add(rawTitle);

        if (href.startsWith('//')) href = 'https:' + href;
        href = href.replace(/\?.*$/, '');

        const dateMatch = href.match(/(\d{4}-\d{2}-\d{2})/);
        const publishedAt = dateMatch
          ? new Date(dateMatch[1]).toISOString()
          : new Date().toISOString();

        articles.push({
          title: rawTitle,
          url: href,
          source: SOURCE,
          source_name: SOURCE_NAME,
          summary: '',
          image_url: '',
          published_at: publishedAt,
          tags: ['新浪汽车'],
        });
      });
    } catch (e) {
      console.error(`[sina-auto] PC ${pageUrl} 失败: ${e.message}`);
    }
  }
  return articles;
}

module.exports = { fetch };
