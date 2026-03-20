const puppeteer = require('puppeteer');

// Shared browser instance
let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.connected) {
    const launchOpts = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--lang=zh-CN',
      ],
      defaultViewport: { width: 1440, height: 900 },
    };
    // Use system Chromium in Docker
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    _browser = await puppeteer.launch(launchOpts);
  }
  return _browser;
}

async function withPage(fn, timeout = 30000) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
  try {
    return await Promise.race([
      fn(page),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Page timeout')), timeout)),
    ]);
  } finally {
    await page.close().catch(() => {});
  }
}

// All scraper modules
const scrapers = {
  'sina-auto': require('./scrapers/sina-auto'),
  cailian: require('./scrapers/cailian'),
  reuters: require('./scrapers/reuters'),
  autohome: require('./scrapers/autohome'),
  yiche: require('./scrapers/yiche'),
  kr36: require('./scrapers/kr36'),
  tencent: require('./scrapers/tencent'),
  gasgoo: require('./scrapers/gasgoo'),
  dongchedi: require('./scrapers/dongchedi'),
  thepaper: require('./scrapers/thepaper'),
  sohu: require('./scrapers/sohu'),
};

class ScraperManager {
  constructor(store) {
    this.store = store;
    this.status = {};
    for (const key of Object.keys(scrapers)) {
      this.status[key] = { lastRun: null, lastError: null, articleCount: 0, running: false };
    }
  }

  async runAll() {
    const tasks = Object.entries(scrapers).map(([key, scraper]) => this._run(key, scraper));
    await Promise.allSettled(tasks);
  }

  async _run(key, scraper) {
    if (this.status[key].running) return;
    this.status[key].running = true;
    try {
      console.log(`  [${key}] 开始抓取...`);
      const articles = await scraper.fetch({ withPage, getBrowser });
      const newCount = this.store.addArticles(articles);
      this.status[key].lastRun = new Date().toISOString();
      this.status[key].articleCount += newCount;
      this.status[key].lastError = null;
      console.log(`  [${key}] 完成, 新增 ${newCount} 条 (共获取 ${articles.length} 条)`);
    } catch (err) {
      this.status[key].lastError = err.message;
      console.error(`  [${key}] 抓取失败: ${err.message}`);
    } finally {
      this.status[key].running = false;
    }
  }

  getStatus() {
    return this.status;
  }
}

module.exports = { ScraperManager };
