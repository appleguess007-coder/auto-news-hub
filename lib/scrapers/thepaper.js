/**
 * 澎湃新闻 - 汽车频道 (thepaper.cn) - 高质量深度报道
 */
const axios = require('axios');

const SOURCE = 'thepaper';
const SOURCE_NAME = '澎湃新闻';

async function fetch() {
  const articles = [];

  try {
    // 澎湃新闻 API - 频道列表
    const res = await axios.get('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.thepaper.cn/',
      },
    });

    // 也尝试热门新闻列表
    const res2 = await axios.get('https://cache.thepaper.cn/contentapi/nodeCont/3', {
      params: { page: 1, pageSize: 40 },
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.thepaper.cn/',
      },
    }).catch(() => ({ data: {} }));

    const allItems = [
      ...(res.data?.data?.hotNews || []),
      ...(res2.data?.data?.list || res2.data?.data || []),
    ];

    const autoKeywords = [
      '汽车', '车企', '新能源', '电动车', '充电', '智能驾驶', '自动驾驶',
      '比亚迪', '特斯拉', '蔚来', '理想', '小鹏', '极氪', '问界', '华为',
      '小米汽车', '吉利', '长安', '长城', '广汽', '上汽', '一汽', '东风',
      '宝马', '奔驰', '奥迪', '大众', '丰田', '本田', '造车', '销量',
      '动力电池', '宁德时代', '4S店', '新车', '降价', '召回',
    ];

    for (const item of allItems) {
      const text = (item.name || item.title || '') + (item.summary || item.contAbstract || '');
      const isAuto = autoKeywords.some((kw) => text.includes(kw));
      if (!isAuto) continue;

      articles.push({
        title: item.name || item.title || '',
        url: `https://www.thepaper.cn/newsDetail_forward_${item.contId || item.id}`,
        source: SOURCE,
        source_name: SOURCE_NAME,
        summary: item.summary || item.contAbstract || '',
        image_url: item.pic || item.sharePic || '',
        published_at: item.pubTimeLong
          ? new Date(item.pubTimeLong).toISOString()
          : item.pubTime || new Date().toISOString(),
        tags: ['澎湃'],
      });
    }
  } catch (e) {
    console.error(`[thepaper] 抓取失败: ${e.message}`);
  }

  return articles;
}

module.exports = { fetch };
