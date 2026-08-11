/**
 * Normalización y coincidencia de búsqueda (cliente) — alineada con utils/soportes-busqueda.js
 */
(function (global) {
  'use strict';

  function normalizeSearchText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeSearchQuery(q) {
    const norm = normalizeSearchText(q);
    if (!norm) return [];
    return norm.split(/\s+/).filter(Boolean);
  }

  function textMatchesQuery(haystack, q) {
    const tokens = tokenizeSearchQuery(q);
    if (!tokens.length) return true;
    const h = normalizeSearchText(haystack);
    return tokens.every((t) => h.includes(t));
  }

  function objectMatchesQuery(obj, keys, q) {
    const hay = (keys || []).map((k) => (obj && obj[k] != null ? String(obj[k]) : '')).join(' ');
    return textMatchesQuery(hay, q);
  }

  global.InnarBusqueda = {
    normalizeSearchText,
    tokenizeSearchQuery,
    textMatchesQuery,
    objectMatchesQuery
  };
})(typeof window !== 'undefined' ? window : globalThis);
