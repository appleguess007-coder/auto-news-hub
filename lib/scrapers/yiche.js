/**
 * 易车网 - 新闻频道 via Puppeteer
 */
const SOURCE = 'yiche';
const SOURCE_NAME = '易车网';

async function fetch({ withPage }) {
  const articles = [];

  try {
    const scraped = await withPage(async (page) => {
      await page.goto('https://news.yiche.com/hao/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await new Promise((r) => setTimeout(r, 2000));

      return await page.evaluate(() => {
        const items = [];
        const seen = new Set();
        const selectors = [
          '.list-dl a[href*="yiche.com"]',
          '.article-list a',
          '.news-list a',
          'a[href*="news.yiche.com"]',
          '.content-list a',
          'h3 a', 'h4 a',
          '.news-item a',
        ];

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((a) => {
            const title = a.textContent?.trim() || a.getAttribute('title') || '';
            let href = a.getAttribute('href') || '';
            if (!title || title.length < 6 || seen.has(title)) return;
            seen.add(title);
            if (href.startsWith('//')) href = 'https:' + href;
            else if (href.startsWith('/')) href = 'https://news.yiche.com' + href;

            const img = a.querySelector('img');
            items.push({
              title,
              url: href,
              image_url: img?.src || '',
            });
          });
        }
        return items.slice(0, 30);
      });
    }, 35000);

    for (const item of scraped) {
      articles.push({
        ...item,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        published_at: new Date().toISOString(),
        tags: ['易车'],
      });
    }
  } catch (e) {
    console.error(`[yiche] 抓取失败: ${e.message}`);
  }

  return articles;
}

module.exports = { fetch };
