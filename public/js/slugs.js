(function () {
  'use strict';

  var PS99 = window.PS99 || {};

  // Detail URLs are exact base slugs only (no variant segments); base slugs
  // always come from the server. The canonical source is src/util/slug.ts.
  // Passing a raw item name also works: the backend resolves it exactly.
  PS99.itemPath = function (slugOrName) {
    return '/items/' + String(slugOrName || '');
  };

  window.PS99 = PS99;
})();
