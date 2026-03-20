/**
 * 36氪 - 从 SSR 页面提取 window.initialState (API 返回500)
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'kr36';
const SOURCE_NAME = '36氪汽车';

const AUTO_KEYWORDS = [
  '汽车', '车企', '新能源', '电动', '造车', '智能驾驶', '自动驾驶',
  '比亚迪', '特斯拉', '蔚来', '理想', '小鹏', '极氪', '问界', '华为',
  '小米汽车', '吉利', '长安', '长城', '广汽', '上汽', '充电', '电池',
  '宝马', '奔驰', '奥迪', '大众', '丰田', '本田', '销量', '交付',
  '零跑', '哪吒', '岚图', '智己', '乘用车', '乘联',
];

async function fetch() {
  const articles = [];

  try {
    const res = await axios.get('https://36kr.com/newsflashes', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(res.data);
    let initialState = null;

    $('script').each((_, el) => {
      const text = $(el).html() || '';
      if (text.includes('window.initialState=')) {
        const match = text.match(/window\.initialState\s*=\s*(\{.+\})\s*;?\s*$/s);
        if (match) {
          try { initialState = JSON.parse(match[1]); } catch (_) {}
        }
      }
    });

    if (initialState === null) {
      console.error('[kr36] 无法从页面提取 initialState');
      return articles;
    }

    // Extract newsflash list from the state
    const catalogData = initialState.newsflashCatalogData || {};
    const flashData = catalogData.data || {};
    const flashList = flashData.newsflashList || flashData;
    const itemList = (flashList.data && flashList.data.itemList) || flashList.itemList || [];

    console.log(`[kr36] 从SSR数据获取 ${itemList.length} 条快讯`);

    for (const item of itemList) {
      const m = item.templateMaterial || {};
      const text = (m.widgetTitle || '') + (m.widgetContent || '');
      if (text.length < 5) continue;

      const isAuto = AUTO_KEYWORDS.some((kw) => text.includes(kw));
      if (!isAuto) continue;

      articles.push({
        title: m.widgetTitle || text.replace(/<[^>]+>/g, '').slice(0, 80),
        url: `https://36kr.com/newsflashes/${item.itemId}`,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: (m.widgetContent || '').replace(/<[^>]+>/g, '').slice(0, 300),
        image_url: '',
        published_at: m.publishTime
          ? new Date(m.publishTime).toISOString()
          : new Date().toISOString(),
        tags: ['36氪'],
      });
    }
  } catch (e) {
    console.error(`[kr36] 抓取失败: ${e.message}`);
  }

  return articles;
}

module.exports = { fetch };
