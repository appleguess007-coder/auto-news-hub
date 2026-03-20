/**
 * 财联社 24小时电报 - 从 m.cls.cn/telegraph 提取 __NEXT_DATA__ (roll_data)
 * 同时从 PC 版 cls.cn/telegraph 兜底
 */
const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE = 'cailian';
const SOURCE_NAME = '财联社';

const AUTO_KEYWORDS = [
  '汽车', '车企', '新能源', '电动车', 'EV', '充电桩', '智能驾驶', '自动驾驶',
  '比亚迪', '特斯拉', 'Tesla', '蔚来', '理想', '小鹏', '极氪', '问界',
  '华为', '小米汽车', '吉利', '长安', '长城', '广汽', '上汽', '一汽', '东风',
  '宝马', 'BMW', '奔驰', '奥迪', '大众', '丰田', '本田', '日产',
  '造车', '销量', '交付', '上险', '车型', '新车', '燃油', '混动', '插混',
  '动力电池', '锂电', '宁德时代', '固态电池', '4S店', '经销商',
  '乘用车', '商用车', '乘联', '中汽协', '零跑', '哪吒', '岚图', '智己',
  '油价', '加油', '汽油', '充电',
];

async function fetch() {
  const articles = [];

  // Strategy 1: Mobile page (m.cls.cn) - has __NEXT_DATA__ with roll_data
  try {
    const res = await axios.get('https://m.cls.cn/telegraph', {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });

    const $ = cheerio.load(res.data);
    let rollData = null;

    $('script').each((_, el) => {
      const text = $(el).html() || '';
      // Mobile page uses: __NEXT_DATA__ = {...};
      const match = text.match(/__NEXT_DATA__\s*=\s*(\{.+?"roll_data".+?\})\s*;?\s*(?:\/\/|$)/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          rollData = parsed.props?.initialState?.roll_data || [];
        } catch (_) {
          // Try partial parse - find roll_data array
        }
      }
    });

    // Fallback: try to extract roll_data from raw text
    if (rollData === null || rollData.length === 0) {
      $('script').each((_, el) => {
        const text = $(el).html() || '';
        if (text.includes('roll_data') && text.includes('__NEXT_DATA__')) {
          // Extract the roll_data array directly
          const rdMatch = text.match(/"roll_data"\s*:\s*(\[.+?\])\s*,\s*"(?:errno|showTopBanner)/s);
          if (rdMatch) {
            try { rollData = JSON.parse(rdMatch[1]); } catch (_) {}
          }
        }
      });
    }

    if (rollData && rollData.length > 0) {
      console.log(`[cailian] 从移动版获取 ${rollData.length} 条电报`);
      extractAutoNews(rollData, articles);
      if (articles.length > 0) return articles;
    }
  } catch (e) {
    console.error(`[cailian] 移动版抓取失败: ${e.message}`);
  }

  // Strategy 2: PC page (www.cls.cn/telegraph)
  try {
    const res = await axios.get('https://www.cls.cn/telegraph', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    const $ = cheerio.load(res.data);
    let list = [];

    $('script').each((_, el) => {
      const text = $(el).html() || '';
      if (text.startsWith('{"props"') && text.includes('telegraphList')) {
        try {
          const parsed = JSON.parse(text);
          list = parsed.props?.initialState?.telegraph?.telegraphList || [];
        } catch (_) {}
      }
    });

    if (list.length === 0) {
      $('script#__NEXT_DATA__').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).html());
          list = parsed.props?.initialState?.telegraph?.telegraphList || [];
        } catch (_) {}
      });
    }

    if (list.length > 0) {
      console.log(`[cailian] 从PC版获取 ${list.length} 条电报`);
      extractAutoNews(list, articles);
    }
  } catch (e) {
    console.error(`[cailian] PC版抓取失败: ${e.message}`);
  }

  return articles;
}

function extractAutoNews(list, articles) {
  for (const item of list) {
    const content = (item.title || '') + (item.content || '') + (item.brief || '');
    const plainContent = content.replace(/<[^>]+>/g, '');
    if (plainContent.length < 5) continue;

    const isAuto = AUTO_KEYWORDS.some((kw) => plainContent.includes(kw));
    if (!isAuto) continue;

    // Extract title from 【...】 brackets or use first sentence
    let title = '';
    const bracketMatch = plainContent.match(/【(.+?)】/);
    if (bracketMatch) {
      title = bracketMatch[1];
    } else {
      title = plainContent.split(/[。！\n]/)[0].trim().slice(0, 100);
    }
    if (!title || title.length < 5) continue;

    articles.push({
      title,
      url: `https://www.cls.cn/detail/${item.id}`,
      source: 'cailian',
      source_name: '财联社',
      summary: plainContent.slice(0, 300),
      image_url: '',
      published_at: item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString(),
      tags: ['财联社电报'],
    });
  }
}

module.exports = { fetch };
