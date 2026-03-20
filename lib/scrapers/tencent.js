/**
 * 腾讯新闻 - 汽车频道 via Puppeteer
 */
const SOURCE = 'tencent';
const SOURCE_NAME = '腾讯汽车';

async function fetch({ withPage }) {
  const articles = [];

  try {
    const scraped = await withPage(async (page) => {
      await page.goto('https://new.qq.com/ch/auto/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await new Promise((r) => setTimeout(r, 3000));

      return await page.evaluate(() => {
        const items = [];
        const seen = new Set();
        const selectors = [
          '.channel-news a[href*="qq.com"]',
          '.list-content a',
          '.item-info a',
          'a[href*="new.qq.com/rain/a/"]',
          'a[href*="new.qq.com/omn/"]',
          '.q-mediainfo a',
          'h3 a',
          '.feed-item a',
        ];

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((a) => {
            const title = a.textContent?.trim() || a.getAttribute('title') || '';
            let href = a.getAttribute('href') || '';
            if (!title || title.length < 6 || seen.has(title)) return;
            seen.add(title);
            if (href.startsWith('//')) href = 'https:' + href;

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
        tags: ['腾讯'],
      });
    }
  } catch (e) {
    console.error(`[tencent] 抓取失败: ${e.message}`);
  }

  return articles;
}

module.exports = { fetch };
