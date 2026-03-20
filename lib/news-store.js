const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

class NewsStore {
  constructor() {
    const dbPath = path.join(__dirname, '..', 'data', 'news.db');
    require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._init();
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
        // Clean title: collapse whitespace, strip trailing noise
        const cleanTitle = (item.title || '').replace(/\s+/g, ' ').trim();
        if (!cleanTitle || cleanTitle.length < 5) {
          skippedCount++;
          continue;
        }

        const id = item.id || crypto.createHash('md5').update(cleanTitle + item.source).digest('hex');

        // Explicitly check if article already exists in DB before inserting
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
          summary: item.summary || '',
          image_url: item.image_url || '',
          published_at: item.published_at || (new Date().toISOString().split('T')[0] + 'T00:00:00.000Z'),
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

    if (newOnes.length > 0 && this.onNewArticles) {
      this.onNewArticles(newOnes);
    }
    return newOnes.length;
  }

  /**
   * Query articles with filters
   */
  query({ source, keyword, page = 1, limit = 50 }) {
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
    const offset = (page - 1) * limit;

    const rows = this.db
      .prepare(`SELECT * FROM articles ${where} ORDER BY published_at DESC, scraped_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });

    return {
      total,
      page,
      limit,
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
