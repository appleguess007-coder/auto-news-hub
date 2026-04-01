const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Maximum number of articles to keep in the database.
// On Render free tier (512 MB RAM), SQLite with >50k rows starts to cause pressure.
// Setting a reasonable cap keeps memory stable.
const MAX_ARTICLES = 5000;

// Run cleanup every N insertions (not every call, to avoid I/O overhead)
const CLEANUP_EVERY = 200;

class NewsStore {
  constructor() {
    const dbPath = path.join(__dirname, '..', 'data', 'news.db');
    require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // WAL mode: better concurrency, lower write amplification
    this.db.pragma('journal_mode = WAL');
    // Limit in-memory page cache (default is 2000 pages × 4 KB = 8 MB; cap at 4 MB)
    this.db.pragma('cache_size = -4000'); // negative = KB
    // Allow SQLite to memory-map up to 32 MB (avoids extra heap copies for reads)
    this.db.pragma('mmap_size = 33554432');
    this._init();
    this._insertCount = 0;
    this.onNewArticles = null; // callback
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT,
        source TEXT NOT NULL,
        source_name TEXT NOT NULL,
        summary TEXT,
        image_url TEXT,
        published_at TEXT,
        scraped_at TEXT DEFAULT (datetime('now','localtime')),
        tags TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
      CREATE INDEX IF NOT EXISTS idx_scraped ON articles(scraped_at DESC);
      CREATE INDEX IF NOT EXISTS idx_published ON articles(published_at DESC);
    `);

    this._insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO articles (id, title, url, source, source_name, summary, image_url, published_at, tags)
      VALUES (@id, @title, @url, @source, @source_name, @summary, @image_url, @published_at, @tags)
    `);
  }

  /**
   * Batch insert articles, returns count of new articles inserted.
   * Only truly new (not already in DB) articles are passed to onNewArticles.
   */
  addArticles(articles) {
    const newOnes = [];
    let duplicateCount = 0;
    let skippedCount = 0;

    const existsStmt = this.db.prepare('SELECT 1 FROM articles WHERE id = ?');

    const insert = this.db.transaction((items) => {
      for (const item of items) {
        const cleanTitle = (item.title || '').replace(/\s+/g, ' ').trim();
        if (!cleanTitle || cleanTitle.length < 5) {
          skippedCount++;
          continue;
        }

        const id = item.id || crypto.createHash('md5').update(cleanTitle + item.source).digest('hex');

        if (existsStmt.get(id)) {
          duplicateCount++;
          continue;
        }

        const row = {
          id,
          title: cleanTitle,
          url: item.url || '',
          source: item.source,
          source_name: item.source_name || item.source,
          // Truncate summary to 500 chars max — avoids large BLOBs inflating page cache
          summary: (item.summary || '').slice(0, 500),
          // Don't store image URLs from Puppeteer — they're often blob: or data: URIs
          image_url: (item.image_url || '').startsWith('http') ? item.image_url : '',
          published_at: item.published_at || new Date().toISOString(),
          tags: JSON.stringify(item.tags || []),
        };
        const info = this._insertStmt.run(row);
        if (info.changes > 0) {
          newOnes.push(row);
        }
      }
    });
    insert(articles);

    console.log(
      `[store] addArticles: ${articles.length} total, ${newOnes.length} new, ${duplicateCount} duplicates, ${skippedCount} skipped`
    );

    // Periodic cleanup: trim old articles to keep DB size bounded
    this._insertCount += newOnes.length;
    if (this._insertCount >= CLEANUP_EVERY) {
      this._insertCount = 0;
      this._trimOldArticles();
    }

    if (newOnes.length > 0 && this.onNewArticles) {
      this.onNewArticles(newOnes);
    }
    return newOnes.length;
  }

  /**
   * Delete oldest articles beyond MAX_ARTICLES cap.
   * Runs synchronously (SQLite is sync) but only triggers every CLEANUP_EVERY inserts.
   */
  _trimOldArticles() {
    const countRow = this.db.prepare('SELECT COUNT(*) as total FROM articles').get();
    const total = countRow.total;
    if (total <= MAX_ARTICLES) return;

    const excess = total - MAX_ARTICLES;
    // Delete the oldest articles by scraped_at
    const deleted = this.db
      .prepare(
        `DELETE FROM articles WHERE id IN (
           SELECT id FROM articles ORDER BY scraped_at ASC LIMIT ?
         )`
      )
      .run(excess);
    console.log(`[store] 清理旧文章: 删除 ${deleted.changes} 条 (总量 ${total} → 保留 ${MAX_ARTICLES})`);

    // Reclaim disk space and shrink WAL
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Query articles with filters
   */
  query({ source, keyword, page = 1, limit = 50 }) {
    // Cap limit to prevent accidental huge result sets from consuming too much memory
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);

    let where = 'WHERE 1=1';
    const params = {};

    if (source) {
      where += ' AND source = @source';
      params.source = source;
    }
    if (keyword) {
      where += ' AND (title LIKE @kw OR summary LIKE @kw)';
      params.kw = `%${keyword}%`;
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM articles ${where}`).get(params);
    const total = countRow.total;
    const offset = (safePage - 1) * safeLimit;

    const rows = this.db
      .prepare(
        `SELECT id, title, url, source, source_name, summary, image_url, published_at, scraped_at, tags
         FROM articles ${where}
         ORDER BY published_at DESC, scraped_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: safeLimit, offset });

    return {
      total,
      page: safePage,
      limit: safeLimit,
      data: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') })),
    };
  }

  /**
   * Get all source stats
   */
  getSources() {
    return this.db
      .prepare(
        `SELECT source, source_name, COUNT(*) as count, MAX(scraped_at) as last_update
         FROM articles GROUP BY source ORDER BY last_update DESC`
      )
      .all();
  }
}

module.exports = { NewsStore };
