/**
 * 搜狐汽车 (auto.sohu.com) - Cheerio 抓取汽车频道首页
 * 注意：搜狐 API sceneId=13 实际是文化频道，不是汽车频道
 * 改用直接抓取 auto.sohu.com 页面
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'sohu';
const SOURCE_NAME = '搜狐汽车';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://auto.sohu.com/',
};

async function fetch() {
  const articles = [];
  const seen = new Set();

  // Strategy 1: Cheerio 抓取 auto.sohu.com 首页
  try {
    const res = await axios.get('https://auto.sohu.com/', {
      timeout: 20000,
      headers: HEADERS,
    });
    const $ = cheerio.load(res.data);

    $('a').each((_, el) => {
      const $a = $(el);
      const title = ($a.attr('title') || $a.text()).trim().replace(/\s+/g, ' ');
      let href = $a.attr('href') || '';

      // Only match sohu article URLs: sohu.com/a/123456_789
      if (!href.match(/sohu\.com\/a\/\d+/)) return;
      if (title.length < 8 || title.length > 120 || seen.has(title)) return;
      seen.add(title);

      if (href.startsWith('//')) href = 'https:' + href;

      const img = $a.find('img');
      articles.push({
        title,
        url: href,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: img.attr('src') || img.attr('data-src') || '',
        published_at: new Date().toISOString(),
        tags: ['搜狐汽车'],
      });
    });

    console.log(`[sohu] auto.sohu.com Cheerio抓取 ${articles.length} 条`);
    if (articles.length > 3) return articles;
  } catch (e) {
    console.error(`[sohu] auto.sohu.com抓取失败: ${e.message}`);
  }

  // Strategy 2: 搜狐汽车新闻列表页
  try {
    const res2 = await axios.get('https://auto.sohu.com/news/', {
      timeout: 15000,
      headers: HEADERS,
    });
    const $2 = cheerio.load(res2.data);

    $2('a').each((_, el) => {
      const title = ($2(el).attr('title') || $2(el).text()).trim().replace(/\s+/g, ' ');
      let href = $2(el).attr('href') || '';
      if (!href.match(/sohu\.com\/a\/\d+/) || title.length < 8 || title.length > 120 || seen.has(title)) return;
      seen.add(title);
      if (href.startsWith('//')) href = 'https:' + href;

      articles.push({
        title,
        url: href,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: '',
        image_url: '',
        published_at: new Date().toISOString(),
        tags: ['搜狐汽车'],
      });
    });
  } catch (_) {}

  return articles;
}

module.exports = { fetch };
