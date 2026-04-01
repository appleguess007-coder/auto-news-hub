const puppeteer = require('puppeteer');

// Shared browser instance
let _browser = null;
// Global lock: prevent concurrent runAll() calls
let _isRunning = false;

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
        // ❌ Removed --single-process: causes instability on Linux/Render and often uses MORE memory
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--no-first-run',
        // Limit JS heap inside each renderer process (128 MB)
        '--js-flags=--max-old-space-size=128',
        // Limit shared memory usage
        '--shm-size=256mb',
        // Disable features that consume background memory
        '--disable-features=TranslateUI,BlinkGenPropertyTrees,Translate',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
      // Keep viewport small — we don't need screenshots
      defaultViewport: { width: 1024, height: 600 },
      // Limit the number of renderer processes
      ignoreHTTPSErrors: true,
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    _browser = await puppeteer.launch(launchOpts);
    console.log('[browser] Chromium launched');

    // Auto-cleanup if the browser process crashes unexpectedly
    _browser.on('disconnected', () => {
      console.warn('[browser] Chromium disconnected, resetting reference');
      _browser = null;
    });
  }
  return _browser;
}

/**
 * Run `fn(page)` with a hard timeout, then close the page.
 * Aborts pending navigation/network requests before closing to release renderer memory.
 */
async function withPage(fn, timeout = 30000) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Intercept and block heavy resources (images, fonts, media) to reduce memory
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

  try {
    return await Promise.race([
      fn(page),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page timeout')), timeout)
      ),
    ]);
  } finally {
    // Best-effort: stop loading and close page to free renderer memory
    await page.evaluate(() => window.stop()).catch(() => {});
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
    // 🔒 Global re-entrancy guard: skip if a full cycle is already in progress
    if (_isRunning) {
      console.log('[scraper] 上一轮抓取仍在进行，跳过本次触发');
      return;
    }
    _isRunning = true;

    try {
      // Phase 1: HTTP-only scrapers in parallel (low memory)
      const httpOnly = ['sina-auto', 'cailian', 'reuters', 'autohome', 'kr36', 'gasgoo', 'sohu', 'thepaper'];
      const httpTasks = httpOnly
        .filter((k) => scrapers[k])
        .map((k) => this._run(k, scrapers[k]));
      await Promise.allSettled(httpTasks);

      // Phase 2: Puppeteer scrapers — run strictly one at a time to cap peak memory
      const puppeteerCapable = ['yiche', 'tencent', 'dongchedi'];
      for (const key of puppeteerCapable) {
        if (scrapers[key]) {
          await this._run(key, scrapers[key]).catch(() => {});
          // Force GC hint after each Puppeteer scraper
          if (global.gc) global.gc();
        }
      }
    } finally {
      // Always close browser and release the lock when done
      if (_browser && _browser.connected) {
        await _browser.close().catch(() => {});
        _browser = null;
        console.log('[browser] Chromium closed after cycle');
      }
      _isRunning = false;
    }
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
