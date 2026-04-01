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

// SSE clients — use a Map keyed by a numeric ID so we can log client count
let _sseNextId = 0;
const sseClients = new Map();

// Cap SSE connections to avoid unbounded memory growth
const SSE_MAX_CLIENTS = 20;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));

// --- API Routes ---

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

app.get('/api/sources', (_req, res) => {
  res.json(store.getSources());
});

app.get('/api/status', (_req, res) => {
  res.json({
    ...manager.getStatus(),
    sseClients: sseClients.size,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/refresh', async (_req, res) => {
  // Fire and forget — don't await so the HTTP response returns immediately
  manager.runAll().catch((e) => console.error('[refresh]', e.message));
  res.json({ ok: true, message: '刷新任务已触发' });
});

// SSE endpoint for push notifications
app.get('/api/stream', (req, res) => {
  if (sseClients.size >= SSE_MAX_CLIENTS) {
    return res.status(503).json({ error: '连接数已达上限，请稍后重试' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Prevent Render/nginx from buffering SSE
    'X-Accel-Buffering': 'no',
  });
  res.write('data: {"type":"connected"}\n\n');

  const clientId = _sseNextId++;
  sseClients.set(clientId, res);
  console.log(`[sse] client ${clientId} connected (total: ${sseClients.size})`);

  // Send a keep-alive comment every 30s to prevent idle connection drops
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(clientId);
    console.log(`[sse] client ${clientId} disconnected (total: ${sseClients.size})`);
  });
});

// Broadcast new articles to SSE clients
function broadcast(data) {
  if (sseClients.size === 0) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of sseClients) {
    try {
      res.write(msg);
    } catch (e) {
      // Dead connection — remove it
      sseClients.delete(id);
    }
  }
}

// === Feishu batch buffer ===
// Collect new articles across all scrapers in a single run, then send one Feishu message.
// Use a plain array with a hard cap to avoid unbounded growth.
const FEISHU_BUFFER_CAP = 500;
let feishuBuffer = [];
let feishuFlushTimer = null;

function bufferForFeishu(articles) {
  // Avoid spread operator on large arrays (stack overflow risk); use concat instead
  const remaining = FEISHU_BUFFER_CAP - feishuBuffer.length;
  if (remaining > 0) {
    feishuBuffer = feishuBuffer.concat(articles.slice(0, remaining));
  }
  console.log(`[feishu] 收到 ${articles.length} 条新增文章，加入推送缓冲区 (缓冲区现有 ${feishuBuffer.length} 条)`);

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
  console.log(`[${new Date().toLocaleTimeString()}] 定时抓取开始... (内存: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB)`);
  manager.runAll().catch((e) => console.error('[cron]', e.message));
});

// === Self-ping to prevent Render free tier sleep ===
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  const https = require('https');
  const http = require('http');
  const pingLib = RENDER_URL.startsWith('https') ? https : http;

  setInterval(() => {
    pingLib.get(`${RENDER_URL}/healthz`, (res) => {
      console.log(`[keep-alive] self-ping → ${res.statusCode}`);
      res.resume(); // drain response body to free socket
    }).on('error', (e) => {
      console.warn(`[keep-alive] self-ping failed: ${e.message}`);
    });
  }, 13 * 60 * 1000);

  console.log(`[keep-alive] 自保活已启用, 每13分钟ping ${RENDER_URL}/healthz`);
} else {
  console.log('[keep-alive] 未检测到RENDER_EXTERNAL_URL, 自保活未启用(非Render环境)');
}

// --- Start ---
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚗 汽车新闻聚合平台运行在 http://localhost:${PORT}`);
  console.log(`📡 飞书推送已启用`);
  console.log(`📰 新闻源: 新浪汽车 | 财联社 | 路透社 | 汽车之家 | 易车网 | 36氪 | 腾讯汽车 | 盖世汽车 | 懂车帝 | 澎湃新闻 | 搜狐汽车`);
  console.log('首次抓取启动中...');
  await manager.runAll();
});
