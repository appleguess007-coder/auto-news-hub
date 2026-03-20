const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { ScraperManager } = require('./lib/scraper-manager');
const { NewsStore } = require('./lib/news-store');
const { sendFeishuNotification, sendFeishuAlert } = require('./lib/feishu-notify');

const app = express();
const PORT = process.env.PORT || 3000;
const store = new NewsStore();
const manager = new ScraperManager(store);

// SSE clients
const sseClients = new Set();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- API Routes ---

// Get news with optional filters
app.get('/api/news', (req, res) => {
  const { source, keyword, page = 1, limit = 50 } = req.query;
  const result = store.query({
    source: source || null,
    keyword: keyword || null,
    page: parseInt(page),
    limit: parseInt(limit),
  });
  res.json(result);
});

// Get available sources
app.get('/api/sources', (_req, res) => {
  res.json(store.getSources());
});

// Get scraper status
app.get('/api/status', (_req, res) => {
  res.json(manager.getStatus());
});

// Health check for Render / uptime monitors
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Manual refresh trigger
app.post('/api/refresh', async (_req, res) => {
  manager.runAll();
  res.json({ ok: true, message: '刷新任务已触发' });
});

// SSE endpoint for push notifications
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');

  const client = { res };
  sseClients.add(client);
  req.on('close', () => sseClients.delete(client));
});

// Broadcast new articles to SSE clients
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.res.write(msg);
  }
}

// === Feishu batch buffer ===
// Collect new articles across all scrapers in a single run, then send one Feishu message
let feishuBuffer = [];
let feishuFlushTimer = null;

function bufferForFeishu(articles) {
  console.log(`[feishu] 收到 ${articles.length} 条新增文章，加入推送缓冲区 (缓冲区现有 ${feishuBuffer.length} 条)`);
  feishuBuffer.push(...articles);
  // Debounce: wait 30s after last scraper finishes, then flush
  clearTimeout(feishuFlushTimer);
  feishuFlushTimer = setTimeout(async () => {
    if (feishuBuffer.length > 0) {
      const batch = feishuBuffer.splice(0);
      console.log(`[feishu] 发送汇总推送: ${batch.length} 条新资讯`);
      await sendFeishuNotification(batch).catch((e) => console.error('[feishu]', e.message));
    } else {
      console.log('[feishu] 缓冲区为空，跳过推送');
    }
  }, 30000);
}

// Hook store events to SSE + Feishu — only truly new articles reach here
store.onNewArticles = (articles) => {
  console.log(`[store->feishu] onNewArticles 回调: ${articles.length} 条真正的新文章`);
  broadcast({ type: 'new_articles', count: articles.length, articles });
  bufferForFeishu(articles);
};

// --- Cron: every 5 minutes ---
cron.schedule('*/5 * * * *', () => {
  console.log(`[${new Date().toLocaleTimeString()}] 定时抓取开始...`);
  manager.runAll();
});

// --- Start ---
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚗 汽车新闻聚合平台运行在 http://localhost:${PORT}`);
  console.log(`📡 飞书推送已启用`);
  console.log(`📰 新闻源: 新浪汽车 | 财联社 | 路透社 | 汽车之家 | 易车网 | 36氪 | 腾讯汽车 | 盖世汽车 | 懂车帝 | 澎湃新闻 | 搜狐汽车`);
  console.log('首次抓取启动中...');
  await manager.runAll();
});
