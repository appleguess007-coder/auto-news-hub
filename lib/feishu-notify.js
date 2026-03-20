/**
 * 飞书机器人推送 - Interactive Card 格式
 */
const axios = require('axios');

const WEBHOOK_URL = process.env.FEISHU_WEBHOOK ||
  'https://open.feishu.cn/open-apis/bot/v2/hook/234c9926-2fca-4bce-9087-b930718cec98';

// 来源颜色映射 (用于飞书卡片标签)
const SOURCE_EMOJI = {
  'sina-auto': '🟠',
  cailian: '🔴',
  reuters: '🟡',
  autohome: '🔵',
  yiche: '🟢',
  kr36: '💠',
  tencent: '🟩',
  gasgoo: '⚙️',
  dongchedi: '🚗',
  thepaper: '📰',
  sohu: '🔶',
};

const SOURCE_NAMES = {
  'sina-auto': '新浪汽车',
  cailian: '财联社',
  reuters: '路透社',
  autohome: '汽车之家',
  yiche: '易车网',
  kr36: '36氪',
  tencent: '腾讯汽车',
  gasgoo: '盖世汽车',
  dongchedi: '懂车帝',
  thepaper: '澎湃新闻',
  sohu: '搜狐汽车',
};

/**
 * 发送飞书卡片消息
 * @param {Array} articles - 新增文章列表
 */
async function sendFeishuNotification(articles) {
  if (!articles || articles.length === 0) return;
  if (!WEBHOOK_URL) return;

  // 按来源分组
  const grouped = {};
  for (const a of articles) {
    const key = a.source || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  }

  // 限制总条数，避免消息过长 (飞书卡片有字数限制)
  const MAX_TOTAL = 30;
  const MAX_PER_SOURCE = 6;
  let totalShown = 0;

  // 构建卡片 elements
  const elements = [];

  // 概览行
  const sourceCount = Object.keys(grouped).length;
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `📊 共 **${articles.length}** 条新资讯，来自 **${sourceCount}** 个来源`,
    },
  });

  elements.push({ tag: 'hr' });

  // 按来源输出
  const sourceKeys = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

  for (const srcKey of sourceKeys) {
    if (totalShown >= MAX_TOTAL) break;

    const srcArticles = grouped[srcKey];
    const emoji = SOURCE_EMOJI[srcKey] || '📄';
    const name = SOURCE_NAMES[srcKey] || srcKey;

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `${emoji} **${name}** (${srcArticles.length}条)`,
      },
    });

    const shown = srcArticles.slice(0, MAX_PER_SOURCE);
    let lines = [];
    for (const a of shown) {
      if (totalShown >= MAX_TOTAL) break;
      const time = formatTime(a.published_at);
      const link = a.url ? `[${escMd(a.title)}](${a.url})` : escMd(a.title);
      lines.push(`• ${time} ${link}`);
      totalShown++;
    }

    if (srcArticles.length > MAX_PER_SOURCE) {
      lines.push(`  _...还有 ${srcArticles.length - MAX_PER_SOURCE} 条_`);
    }

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: lines.join('\n'),
      },
    });

    elements.push({ tag: 'hr' });
  }

  // 底部时间戳
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `AutoPulse 汽车脉搏 · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 每5分钟自动更新`,
      },
    ],
  });

  const card = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `🚗 汽车新闻速报 · ${articles.length}条新资讯`,
        },
        template: 'red',
      },
      elements,
    },
  };

  try {
    const res = await axios.post(WEBHOOK_URL, card, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.data?.code === 0 || res.data?.StatusCode === 0) {
      console.log(`[feishu] 推送成功: ${articles.length} 条新资讯`);
    } else {
      console.error(`[feishu] 推送返回异常:`, res.data);
    }
  } catch (e) {
    console.error(`[feishu] 推送失败: ${e.message}`);
  }
}

/**
 * 发送错误告警
 */
async function sendFeishuAlert(scraperName, error) {
  if (!WEBHOOK_URL) return;

  const card = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `⚠️ 爬虫告警 · ${scraperName}` },
        template: 'orange',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**爬虫名称**: ${scraperName}\n**错误信息**: ${escMd(error)}\n**时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
          },
        },
      ],
    },
  };

  try {
    await axios.post(WEBHOOK_URL, card, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_) {}
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
  } catch {
    return '';
  }
}

function escMd(str) {
  if (!str) return '';
  // Escape markdown special chars that break feishu lark_md
  return str.replace(/[[\]()]/g, (c) => '\\' + c);
}

module.exports = { sendFeishuNotification, sendFeishuAlert };
