(function () {
  'use strict';

  const DEBOUNCE_MS = 300;

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function attachSearch(input, resultsBox) {
    let debounceTimer = null;
    let abortController = null;
    let activeIndex = -1;

    // Clicks outside this element close the dropdown.
    const scope = input.closest('[data-search-scope]') || input.parentElement;

    function close() {
      resultsBox.hidden = true;
      resultsBox.innerHTML = '';
      activeIndex = -1;
      resultsBox.classList.remove('loading');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function escapeHtml(s) {
      return String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c],
      );
    }

    function formatNum(n) {
      return n === null || n === undefined ? '—' : Number(n).toLocaleString();
    }

    function highlight(name, q) {
      const idx = name.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return escapeHtml(name);
      return (
        escapeHtml(name.slice(0, idx)) +
        '<b>' +
        escapeHtml(name.slice(idx, idx + q.length)) +
        '</b>' +
        escapeHtml(name.slice(idx + q.length))
      );
    }

    function itemHref(item) {
      if (item.slug) return '/items/' + item.slug;
      return '/items/' + encodeURIComponent(item.name || '');
    }

    function render(items, q) {
      if (items.length === 0) {
        resultsBox.innerHTML = '<div class="search-empty">No matches</div>';
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      const html = items
        .map((item, i) => {
          const optId = resultsBox.id + '-opt-' + i;
          const meta = [escapeHtml(item.category || ''), formatNum(item.rap)]
            .filter(Boolean)
            .join(' · ');
          return (
            '<a class="search-result" id="' + optId + '" role="option" href="' +
            itemHref(item) +
            '"><img class="search-thumb" src="/thumbnails/' + encodeURIComponent(item.displayName || item.name || '') + '" loading="lazy" alt="">' +
            '<span class="search-result-body"><span class="search-result-name">' +
            highlight(item.name, q) +
            '</span><span class="search-result-meta">' +
            meta +
            '</span></span></a>'
          );
        })
        .join('');
      resultsBox.innerHTML = html;
      input.setAttribute('aria-expanded', 'true');
    }

    async function runSearch(q) {
      if (abortController) abortController.abort();
      abortController = new AbortController();
      resultsBox.classList.add('loading');
      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=8', {
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        render(Array.isArray(data.items) ? data.items : [], q);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        resultsBox.innerHTML = '<div class="search-empty search-error">Search failed — try again</div>';
      } finally {
        resultsBox.classList.remove('loading');
      }
    }

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
        const active = links[activeIndex];
        if (active) {
          input.setAttribute('aria-activedescendant', active.id);
          active.scrollIntoView({ block: 'nearest' });
        }
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
        input.setAttribute('aria-expanded', 'true');
        runSearch(q);
      }, DEBOUNCE_MS);
    });

    input.addEventListener('focus', () => {
      if (!resultsBox.hidden) resultsBox.hidden = false;
    });

    document.addEventListener('click', (e) => {
      if (!resultsBox.hidden && scope && !scope.contains(e.target)) close();
    });
  }

  function init() {
    document.querySelectorAll('[data-search-input]').forEach((input) => {
      const resultsBox = document.getElementById(input.getAttribute('data-search-input'));
      if (resultsBox) attachSearch(input, resultsBox);
    });

    // "/" focuses the navbar search from anywhere.
    const navbarInput = document.getElementById('navbar-search');
    if (navbarInput) {
      document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || isEditable(document.activeElement)) return;
        e.preventDefault();
        navbarInput.focus();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
