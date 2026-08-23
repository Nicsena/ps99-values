(function () {
  'use strict';

  const grid = document.getElementById('items-grid');
  const sentinel = document.getElementById('scroll-sentinel');
  const loadingEl = document.getElementById('items-loading');
  const resultCount = document.getElementById('result-count');
  const toggleBtn = document.getElementById('toggle-filters');
  const filterPanel = document.getElementById('filter-panel');
  const sortSelect = document.getElementById('sort-select');
  if (!grid || !sentinel) return;

  const PAGE_SIZE = 24;
  const PILL_GROUPS = ['shiny', 'pt', 'category', 'collection', 'exists'];
  const DEFAULTS = {
    q: '',
    sort: 'rap_desc',
    shiny: 'all',
    pt: 'all',
    category: 'all',
    collection: 'all',
    exists: 'all',
    show_rap_zero: '1',
    show_exists_zero: '1',
    hide_pets: '0',
  };
  const VALID_SORTS = new Set([
    'rap_desc', 'rap_asc', 'name_asc', 'name_desc',
    'copies_desc', 'copies_asc', 'newest', 'oldest',
  ]);
  const VARIANT_NAMES = { regular: 'Regular', golden: 'Golden', rainbow: 'Rainbow' };

  let page = 1;
  let total = 0;
  let loading = false;
  let done = false;
  let observer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function fmt(n) {
    return n === null || n === undefined ? '—' : Number(n).toLocaleString();
  }

  function readState() {
    const params = new URLSearchParams(location.search);
    const state = {};
    Object.keys(DEFAULTS).forEach((key) => {
      let v = params.get(key);
      if (v === null || v === '') v = DEFAULTS[key];
      if (key === 'sort' && !VALID_SORTS.has(v)) v = DEFAULTS.sort;
      state[key] = v;
    });
    return state;
  }

  function writeState(state) {
    const params = new URLSearchParams();
    Object.keys(DEFAULTS).forEach((key) => {
      if (state[key] !== DEFAULTS[key]) params.set(key, state[key]);
    });
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function buildQuery(state, pageNum) {
    const params = new URLSearchParams();
    params.set('page', String(pageNum));
    params.set('pageSize', String(PAGE_SIZE));
    params.set('sort', state.sort);
    params.set('q', state.q);
    ['shiny', 'pt', 'category', 'collection', 'exists'].forEach((k) => params.set(k, state[k]));
    params.set('show_rap_zero', state.show_rap_zero);
    params.set('show_exists_zero', state.show_exists_zero);
    params.set('hide_pets', state.hide_pets);
    return params.toString();
  }

  function cardHtml(item) {
    const href = window.PS99 && PS99.itemPath
      ? PS99.itemPath(item.name, item.pt || 0, !!item.shiny)
      : '/items/' + (item.slug || PS99.slugify(item.name));
    return (
      '<a class="item-card-link" href="' + href + '">' +
      '<article class="item-card">' +
      '<img class="item-thumb" src="/img/placeholder.svg" loading="lazy" alt="">' +
      '<div class="item-info">' +
      '<h3 class="item-name">' + escapeHtml(item.name) + '</h3>' +
      '<div class="item-stats">' +
      '<span>RAP <b>' + fmt(item.rap) + '</b></span>' +
      '<span class="stat-sep">&middot;</span>' +
      '<span>Exists <b>' + fmt(item.exists) + '</b></span>' +
      '</div>' +
      '</div>' +
      '</article></a>'
    );
  }

  function setLoading(on) {
    loading = on;
    if (loadingEl) loadingEl.hidden = !on;
  }

  async function loadPage(state, pageNum, append) {
    if (loading) return;
    setLoading(true);
    sentinel.innerHTML = '';
    try {
      const res = await fetch('/api/items?' + buildQuery(state, pageNum));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      total = data.total || 0;
      page = data.page || pageNum;
      const items = Array.isArray(data.items) ? data.items : [];
      if (!append) grid.innerHTML = '';
      grid.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
      if (window.PS99 && typeof PS99.refreshIcons === 'function') PS99.refreshIcons();
      if (resultCount) resultCount.textContent = total.toLocaleString() + ' results';
      done = page * PAGE_SIZE >= total || items.length === 0;
      if (done && grid.children.length === 0) {
        grid.innerHTML = '<div class="empty-grid muted">No items match the current filters</div>';
      }
    } catch (err) {
      done = true;
      sentinel.innerHTML =
        '<button id="retry-btn" type="button" class="btn btn-ghost">Failed to load — Retry</button>';
      const retry = document.getElementById('retry-btn');
      if (retry) retry.addEventListener('click', () => { done = false; loadPage(state, page, append); });
    } finally {
      setLoading(false);
    }
  }

  function resetAndLoad() {
    const state = readState();
    page = 1;
    total = 0;
    done = false;
    if (observer) observer.disconnect();
    grid.innerHTML = '';
    loadPage(state, 1, false).then(() => {
      if (!done && observer) {
        observer.observe(sentinel);
      }
    });
  }

  function hydrateControls(state) {
    if (filterPanel) {
      filterPanel.querySelectorAll('.pill[data-group]').forEach((pill) => {
        const group = pill.getAttribute('data-group');
        pill.classList.toggle('active', (state[group] || 'all') === pill.getAttribute('data-value'));
      });
    }
    if (sortSelect) sortSelect.value = state.sort;
    [
      ['f-show-rap-zero', 'show_rap_zero'],
      ['f-show-exists-zero', 'show_exists_zero'],
      ['f-hide-pets', 'hide_pets'],
    ].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.checked = state[key] === '1';
    });
  }

  if (toggleBtn && filterPanel) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = filterPanel.hidden;
      filterPanel.hidden = !isHidden;
      toggleBtn.setAttribute('aria-expanded', String(!isHidden));
    });
  }

  if (filterPanel) {
    filterPanel.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill[data-group]');
    if (!pill) return;
    const group = pill.getAttribute('data-group');
    filterPanel
      .querySelectorAll('.pill[data-group="' + group + '"]')
      .forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    const state = readState();
    state[group] = pill.getAttribute('data-value');
    writeState(state);
    resetAndLoad();
  });
  }

  if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    const state = readState();
    state.sort = sortSelect.value;
    writeState(state);
    resetAndLoad();
  });
  }

  [['f-show-rap-zero', 'show_rap_zero'], ['f-show-exists-zero', 'show_exists_zero'], ['f-hide-pets', 'hide_pets']].forEach(
    ([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const state = readState();
        state[key] = el.checked ? '1' : '0';
        writeState(state);
        resetAndLoad();
      });
    },
  );

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      if (loading || done) return;
      const state = readState();
      loadPage(state, page + 1, true).then(() => {
        if (done) observer.disconnect();
      });
    },
    { rootMargin: '400px' },
  );

  const initial = readState();
  hydrateControls(initial);
  resetAndLoad();
})();
