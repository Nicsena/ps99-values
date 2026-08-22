(function () {
  'use strict';

  var PS99 = window.PS99 || {};

  PS99.slugify = function (name) {
    return String(name || '')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  var PT_SLUGS = ['regular', 'golden', 'rainbow'];

  PS99.variantSlug = function (pt, shiny) {
    var base;
    if (typeof pt === 'string' && pt) {
      base = pt.toLowerCase();
      if (PT_SLUGS.indexOf(base) === -1) base = 'regular';
    } else {
      base = PT_SLUGS[Number(pt) || 0] || 'regular';
    }
    if (base !== 'golden' && base !== 'rainbow') base = 'regular';
    if (!shiny) return base;
    return base === 'regular' ? 'shiny' : base + '-shiny';
  };

  PS99.itemPath = function (name, pt, shiny) {
    return '/items/' + PS99.variantSlug(pt, shiny) + '-' + PS99.slugify(name);
  };

  window.PS99 = PS99;
})();
