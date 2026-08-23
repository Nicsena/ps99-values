(function () {
  'use strict';

  var PS99 = window.PS99 || {};

  PS99.slugify = function (name) {
    return String(name || '')
      .replace(/^\s+|\s+$/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  PS99.variantSlug = function (pt, shiny) {
    var num = Number(pt) || 0;
    var parts = [];
    if (shiny) parts.push('Shiny');
    if (num === 1) parts.push('Golden');
    else if (num === 2) parts.push('Rainbow');
    return parts.join('-');
  };

  PS99.itemPath = function (name, pt, shiny) {
    var slug = PS99.slugify(name);
    var variant = PS99.variantSlug(pt, shiny);
    return '/items/' + (variant ? variant + '-' + slug : slug);
  };

  window.PS99 = PS99;
})();
