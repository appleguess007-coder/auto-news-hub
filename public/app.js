/**
 * AutoPulse 汽车脉搏 — Frontend Application
 */
(function () {
  'use strict';

  // === STATE ===
  const state = {
    articles: [],
    source: null,
    keyword: '',
    page: 1,
    total: 0,
    limit: 50,
    loading: false,
    countdownSec: 300,
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

  // === DOM REFS ===
  const $feed = document.getElementById('feed');
  const $loading = document.getElementById('feedLoading');
  const $loadMore = document.getElementById('loadMore');
  const $clock = document.getElementById('clock');
  const $countdown = document.getElementById('countdown');
  const $refreshBadge = document.getElementById('refreshBadge');
  const $totalCount = document.getElementById('totalCount');
  const $filterBar = document.getElementById('filterBar');
  const $searchInput = document.getElementById('searchInput');
  const $quickChips = document.getElementById('quickChips');
  const $toastContainer = document.getElementById('toastContainer');
  const $statusBar = document.getElementById('statusBar');
  const $scrollTop = document.getElementById('scrollTop');

  // === API ===
  async function fetchNews(append) {
    if (state.loading) return;
    state.loading = true;
    if (!append) {
      state.page = 1;
      showLoading();
    }
    try {
      const params = new URLSearchParams({
        page: state.page,
        limit: state.limit,
      });
      if (state.source) params.set('source', state.source);
      if (state.keyword) params.set('keyword', state.keyword);

      const res = await fetch('/api/news?' + params);
      const json = await res.json();
      state.total = json.total;
      $totalCount.textContent = json.total + ' 条';

      if (append) {
        state.articles = state.articles.concat(json.data);
      } else {
        state.articles = json.data;
      }
      renderFeed(append);
      $loadMore.style.display = state.articles.length < state.total ? 'block' : 'none';
    } catch (e) {
      console.error('Fetch news error:', e);
    } finally {
      state.loading = false;
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const json = await res.json();
      renderStatus(json);
    } catch (_) {}
  }

  async function triggerRefresh() {
    try {
      await fetch('/api/refresh', { method: 'POST' });
      state.countdownSec = 300;
      showToast('手动刷新已触发');
      setTimeout(() => fetchNews(false), 3000);
      setTimeout(() => fetchStatus(), 5000);
    } catch (_) {}
  }

  // === SSE ===
  function connectSSE() {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'new_articles' && data.count > 0) {
          showToast(`新增 ${data.count} 条汽车资讯`);
          // Refresh feed
          fetchNews(false);
          fetchStatus();
        }
      } catch (_) {}
    };
    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }

  // === RENDER: FEED ===
  function showLoading() {
    $loading.style.display = 'flex';
    // Remove existing cards
    $feed.querySelectorAll('.news-card').forEach((c) => c.remove());
  }

  function renderFeed(append) {
    $loading.style.display = 'none';
    if (state.articles.length === 0) {
      $feed.innerHTML =
        '<div class="feed-empty"><div class="empty-icon">🚗</div><div>暂无新闻数据，等待首次抓取完成...</div></div>';
      return;
    }
    if (!append) {
      // Clear all cards
      $feed.querySelectorAll('.news-card,.feed-empty').forEach((c) => c.remove());
    }

    const startIdx = append ? state.articles.length - (state.page > 1 ? state.limit : 0) : 0;
    const frag = document.createDocumentFragment();

    const items = append ? state.articles.slice(startIdx) : state.articles;
    items.forEach((article, i) => {
      const card = createCard(article, i);
      frag.appendChild(card);
    });

    $feed.appendChild(frag);
  }

  function createCard(article, idx) {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.style.animationDelay = Math.min(idx * 30, 600) + 'ms';

    const timeAgo = formatTimeAgo(article.published_at || article.scraped_at);
    const tags = (article.tags || []).slice(0, 3);

    card.innerHTML = `
      <div class="card-source">
        <span class="source-tag" data-s="${esc(article.source)}">${esc(article.source_name)}</span>
        <span class="card-time">${esc(timeAgo)}</span>
      </div>
      <div class="card-body">
        <h3>${esc(article.title)}</h3>
        ${article.summary ? `<p class="snippet">${esc(article.summary)}</p>` : ''}
        ${tags.length ? `<div class="card-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card-actions">
        ${article.url ? `<a class="card-link" href="${esc(article.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">原文 →</a>` : ''}
      </div>
    `;

    if (article.url) {
      card.addEventListener('click', () => window.open(article.url, '_blank'));
    }
    return card;
  }

  // === RENDER: STATUS BAR ===
  function renderStatus(statusMap) {
    let html = '<span style="color:var(--text-muted);margin-right:.25rem">SCRAPERS</span>';
    for (const [key, s] of Object.entries(statusMap)) {
      const name = SOURCE_NAMES[key] || key;
      let dotClass = 'ok';
      if (s.running) dotClass = 'run';
      else if (s.lastError) dotClass = 'err';
      else if (!s.lastRun) dotClass = 'err';

      const tip = s.lastError
        ? `错误: ${s.lastError}`
        : s.lastRun
          ? `上次: ${new Date(s.lastRun).toLocaleTimeString()}`
          : '未运行';

      html += `<span class="status-item" title="${esc(tip)}"><span class="status-dot ${dotClass}"></span>${esc(name)}</span>`;
    }
    $statusBar.innerHTML = html;
  }

  // === RENDER: TOAST ===
  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // === CLOCK & COUNTDOWN ===
  function tickClock() {
    const now = new Date();
    $clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });

    state.countdownSec = Math.max(0, state.countdownSec - 1);
    const m = String(Math.floor(state.countdownSec / 60)).padStart(2, '0');
    const s = String(state.countdownSec % 60).padStart(2, '0');
    $countdown.textContent = m + ':' + s;

    if (state.countdownSec <= 0) {
      state.countdownSec = 300;
    }
  }

  // === FILTER EVENTS ===
  $filterBar.addEventListener('click', (e) => {
    const pill = e.target.closest('.source-pill');
    if (!pill) return;
    $filterBar.querySelectorAll('.source-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    const src = pill.dataset.source;
    state.source = src === 'all' ? null : src;
    fetchNews(false);
  });

  let searchTimer;
  $searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = $searchInput.value.trim();
      // Deactivate chips
      $quickChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      if (state.keyword) {
        $quickChips.querySelectorAll('.chip').forEach((c) => {
          if (c.dataset.kw === state.keyword) c.classList.add('active');
        });
      }
      fetchNews(false);
    }, 350);
  });

  $quickChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const kw = chip.dataset.kw;
    const wasActive = chip.classList.contains('active');

    $quickChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    if (wasActive) {
      state.keyword = '';
      $searchInput.value = '';
    } else {
      chip.classList.add('active');
      state.keyword = kw;
      $searchInput.value = kw;
    }
    fetchNews(false);
  });

  $loadMore.addEventListener('click', () => {
    state.page++;
    fetchNews(true);
  });

  $refreshBadge.addEventListener('click', triggerRefresh);

  // Scroll top
  window.addEventListener('scroll', () => {
    $scrollTop.classList.toggle('visible', window.scrollY > 400);
  });
  $scrollTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // === HELPERS ===
  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + '天前';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  }

  // === INIT ===
  fetchNews(false);
  fetchStatus();
  connectSSE();
  setInterval(tickClock, 1000);
  setInterval(fetchStatus, 30000);
  tickClock();
})();
