(function () {
  'use strict';

  const input = document.getElementById('navbar-search');
  const resultsBox = document.getElementById('search-results');
  if (!input || !resultsBox) return;

  const DEBOUNCE_MS = 300;
  let debounceTimer = null;
  let abortController = null;
  let activeIndex = -1;

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    );
  }

  function close() {
    resultsBox.hidden = true;
    resultsBox.innerHTML = '';
    activeIndex = -1;
    resultsBox.classList.remove('loading');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function formatNum(n) {
    return n === null || n === undefined ? '—' : Number(n).toLocaleString();
  }

  function highlight(name, q) {
    const idx = name.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, idx)) +
      '<b>' + escapeHtml(name.slice(idx, idx + q.length)) + '</b>' +
      escapeHtml(name.slice(idx + q.length))
    );
  }

  function itemHref(item) {
    if (window.PS99 && PS99.itemPath) {
      return PS99.itemPath(item.name, item.pt || 0, !!item.shiny);
    }
    return '/items/' + encodeURIComponent(item.slug || item.name || '');
  }

  function render(items, q) {
    if (items.length === 0) {
      resultsBox.innerHTML = '<div class="search-empty">No matches</div>';
      return;
    }
    const html = items.map((item) => {
      const meta = [escapeHtml(item.category || ''), formatNum(item.rap)]
        .filter(Boolean)
        .join(' · ');
      return (
        '<a class="search-result" href="' + itemHref(item) +
        '"><img class="search-thumb" src="/img/placeholder.svg" loading="lazy" alt="">' +
        '<span class="search-result-body"><span class="search-result-name">' +
        highlight(item.name, q) +
        '</span><span class="search-result-meta">' +
        meta +
        '</span></span></a>'
      );
    }).join('');
    resultsBox.innerHTML = html;
  }

  async function runSearch(q) {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    resultsBox.classList.add('loading');
    try {
      const res = await fetch(
        '/api/search?q=' + encodeURIComponent(q) + '&limit=8',
        { signal: abortController.signal },
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      render(Array.isArray(data.items) ? data.items : [], q);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      resultsBox.innerHTML = '<div class="search-empty">No matches</div>';
    } finally {
      resultsBox.classList.remove('loading');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || isEditable(document.activeElement)) return;
    e.preventDefault();
    input.focus();
  });

  input.addEventListener('keydown', (e) => {
    const links = resultsBox.querySelectorAll('.search-result');
    if (e.key === 'Escape') {
      close();
      input.blur();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (resultsBox.hidden || links.length === 0) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('active', i === activeIndex));
      links[activeIndex].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && activeIndex >= 0 && links[activeIndex]) {
      e.preventDefault();
      links[activeIndex].click();
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    debounceTimer = setTimeout(() => {
      resultsBox.hidden = false;
      runSearch(q);
    }, DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    if (!resultsBox.hidden) resultsBox.hidden = false;
  });

  document.addEventListener('click', (e) => {
    if (!resultsBox.hidden && !e.target.closest('.navbar-search')) close();
  });
})();
