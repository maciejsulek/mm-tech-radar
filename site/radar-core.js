// Shared code for the radar page (index.html) and the PDF report (report.html).
// Plain JavaScript, no dependencies.
(function (global) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const W = 820, C = 410, R = 380;   // viewBox size, centre, outer radius
  const GX = 8, GY = 18;             // half-gaps between quadrants (GY leaves room for ring labels)
  const BR = 12;                     // blip radius
  const RING_FR = [0.32, 0.58, 0.80, 1.0];
  const POS = { 'top-left': [-1, -1], 'top-right': [1, -1], 'bottom-left': [-1, 1], 'bottom-right': [1, 1] };
  const FALLBACK_COLORS = ['#1f7a8c', '#b7791f', '#4f7d3a', '#a23b4f'];
  // Colours can be overridden with "theme" in config.json.
  const DEFAULT_THEME = { primary: '#16384c', highlight: '', ink: '#1d2433', muted: '#5b6475', panel: '#eef1f5' };
  let THEME = { ...DEFAULT_THEME };

  // ---------- loading ----------
  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' returned ' + r.status);
    return r.json();
  }
  async function getText(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? r.text() : '';
    } catch { return ''; }
  }
  async function load() {
    const [config, data] = await Promise.all([getJson('config.json'), getJson('data/blips.json')]);
    return { config, data };
  }

  // ---------- theme ----------
  function setTheme(config) {
    THEME = { ...DEFAULT_THEME, ...((config && config.theme) || {}) };
    if (!THEME.highlight) THEME.highlight = THEME.primary;
    const root = document.documentElement.style;
    root.setProperty('--accent', THEME.primary);
    root.setProperty('--on-accent', textOn(THEME.primary));
    root.setProperty('--highlight', THEME.highlight);
    root.setProperty('--ink', THEME.ink);
    root.setProperty('--muted', THEME.muted);
    root.setProperty('--panel', THEME.panel);
    return THEME;
  }
  // Black or white, whichever reads better on the given colour.
  function textOn(hex) {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return '#ffffff';
    const lin = (v) => { v = parseInt(v, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#ffffff' : '#000000';
  }

  // ---------- model ----------
  function prepare(config, data) {
    setTheme(config);
    const quadrants = config.quadrants.map((q, i) => {
      const [sx, sy] = POS[q.position] || Object.values(POS)[i];
      return { ...q, index: i, sx, sy, ox: C + sx * GX, oy: C + sy * GY, color: q.color || FALLBACK_COLORS[i] };
    });
    const rings = config.rings.map((r, i) => ({ ...r, index: i, inner: i ? RING_FR[i - 1] * R : 0, outer: RING_FR[i] * R }));
    const qByName = new Map(quadrants.map((q) => [q.name.toLowerCase(), q]));
    const rByName = new Map(rings.map((r) => [r.name.toLowerCase(), r]));

    const blips = [];
    const retired = [];
    for (const b of data.blips || []) {
      if (b.retired) {
        // Retired blips stay in the data for the Archive; they are not drawn or numbered.
        const q = qByName.get(String(b.quadrant || '').toLowerCase()) || { name: b.quadrant || 'Unknown', color: '#9aa3b2', index: 99 };
        const r = rByName.get(String(b.retired.ring || b.ring || '').toLowerCase()) || { name: b.retired.ring || b.ring || '', index: 99 };
        retired.push({ ...b, slug: b.slug || slugify(b.name), q, r });
        continue;
      }
      const q = qByName.get(String(b.quadrant || '').toLowerCase());
      const r = rByName.get(String(b.ring || '').toLowerCase());
      if (!q || !r) { console.warn('Skipping blip with unknown quadrant or ring:', b.name); continue; }
      const prev = b.previousRing ? rByName.get(b.previousRing.toLowerCase()) : null;
      blips.push({ ...b, slug: b.slug || slugify(b.name), q, r,
        moved: b.status === 'Moved' && prev ? (prev.index > r.index ? 'in' : 'out') : null });
    }
    blips.sort((a, b) => a.q.index - b.q.index || a.r.index - b.r.index || a.name.localeCompare(b.name));
    blips.forEach((b, i) => { b.num = i + 1; });
    place(blips);
    retired.sort((a, b) => String(b.retired.date).localeCompare(String(a.retired.date)) || a.name.localeCompare(b.name));
    return {
      config, data, quadrants, rings, blips, retired,
      bySlug: new Map(blips.map((b) => [b.slug, b])),
      byName: new Map(blips.map((b) => [b.name.toLowerCase(), b])),
      retiredBySlug: new Map(retired.map((b) => [b.slug, b])),
      retiredByName: new Map(retired.map((b) => [b.name.toLowerCase(), b])),
    };
  }

  // Related blips of b, as { name, blip, retired }.
  // Retired relations are hidden (left out) unless opts.includeRetired is set, e.g. on the Archive tab.
  function related(model, b, opts = {}) {
    const out = [];
    for (const n of (b.related || []).filter(Boolean)) {
      const key = String(n).toLowerCase();
      const active = model.byName.get(key);
      if (active) { out.push({ name: active.name, blip: active, retired: false }); continue; }
      const gone = model.retiredByName.get(key);
      if (gone) { if (opts.includeRetired) out.push({ name: gone.name, blip: gone, retired: true }); continue; }
      out.push({ name: String(n), blip: null, retired: false });
    }
    return out;
  }

  // ---------- placement ----------
  function place(list) {
    const M = BR + 8;      // keep blips this far from the quadrant edges
    const PAD = BR + 5;    // keep blips this far from ring lines
    for (const b of list) {
      const rand = mulberry(hash(b.slug));
      const rMin = Math.max(b.r.inner + PAD, M * 1.6), rMax = b.r.outer - PAD;
      const rr = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
      const t = 0.12 + rand() * (Math.PI / 2 - 0.24);
      b.dx = rr * Math.cos(t); b.dy = rr * Math.sin(t);
      b.rMin = rMin; b.rMax = rMax; b.M = M;
    }
    const MIN_D = BR * 2 + 6;
    for (let it = 0; it < 300; it++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], c = list[j];
          if (a.q !== c.q) continue;
          let vx = a.dx - c.dx, vy = a.dy - c.dy, d = Math.hypot(vx, vy);
          if (d >= MIN_D) continue;
          if (d < 0.01) { vx = 1; vy = 0.5; d = Math.hypot(vx, vy); }
          const push = (MIN_D - d) / 2;
          a.dx += (vx / d) * push; a.dy += (vy / d) * push;
          c.dx -= (vx / d) * push; c.dy -= (vy / d) * push;
          moved = true;
        }
      }
      for (const b of list) clamp(b);
      if (!moved) break;
    }
    for (const b of list) { b.x = b.q.ox + b.q.sx * b.dx; b.y = b.q.oy + b.q.sy * b.dy; }
  }
  function clamp(b) {
    for (let k = 0; k < 3; k++) {
      b.dx = Math.max(b.dx, b.M); b.dy = Math.max(b.dy, b.M);
      const r = Math.hypot(b.dx, b.dy);
      const target = Math.min(Math.max(r, b.rMin), b.rMax);
      if (target !== r) { b.dx *= target / r; b.dy *= target / r; }
    }
  }
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- drawing ----------
  // Returns an <svg> of the whole radar, or of one quadrant when opts.quadrant is given.
  function drawRadar(model, opts = {}) {
    const { quadrants, rings, blips, config } = model;
    const only = opts.quadrant || null;
    let viewBox = `0 0 ${W} ${W}`;
    if (only) {
      const xs = only.sx < 0 ? [only.ox - R - 6, C + 2] : [C - 2, only.ox + R + 6];
      const ys = only.sy < 0 ? [only.oy - R - 6, C + 12] : [C - 12, only.oy + R + 6];
      viewBox = `${xs[0]} ${ys[0]} ${xs[1] - xs[0]} ${ys[1] - ys[0]}`;
    }
    const svg = el('svg', { viewBox, role: 'group', 'aria-label': only ? only.name : (config.title || 'Technology Radar') });

    for (const q of quadrants) {
      if (only && q !== only) continue;
      const x0 = Math.min(q.ox, q.ox + q.sx * R), y0 = Math.min(q.oy, q.oy + q.sy * R);
      svg.appendChild(el('rect', { x: x0, y: y0, width: R, height: R, fill: THEME.panel }));
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i].outer;
        const sweep = q.sx * q.sy > 0 ? 1 : 0;
        const d = `M${q.ox},${q.oy} L${q.ox + q.sx * r},${q.oy} A${r},${r} 0 0 ${sweep} ${q.ox},${q.oy + q.sy * r} Z`;
        svg.appendChild(el('path', { d, fill: i === 0 ? '#f9fafc' : '#ffffff', stroke: '#c8cfd9', 'stroke-width': 1.2 }));
      }
      if (!only) {
        const tx = q.sx < 0 ? q.ox - R + 16 : q.ox + R - 16;
        const ty = q.sy < 0 ? q.oy - R + 30 : q.oy + R - 18;
        const label = text(opts.linkQuadrants ? q.name + ' ›' : q.name, { x: tx, y: ty, 'text-anchor': q.sx < 0 ? 'start' : 'end',
          'font-size': 16, 'font-weight': 700, fill: THEME.ink });
        if (opts.linkQuadrants) {
          const a = el('a', { href: opts.linkQuadrants(q), class: 'q-link', 'aria-label': `Open the ${q.name} quadrant` });
          a.appendChild(label);
          svg.appendChild(a);
        } else {
          svg.appendChild(label);
        }
      }
    }
    for (const sx of [-1, 1]) {
      if (only && only.sx !== sx) continue;
      for (const r of rings) {
        const m = (r.inner + r.outer) / 2;
        svg.appendChild(text(r.name, { x: C + sx * (GX + m), y: C + 4, 'text-anchor': 'middle', 'font-size': 11,
          'font-weight': 700, fill: THEME.muted, 'letter-spacing': '.04em' }));
      }
    }

    for (const b of blips) {
      if (only && b.q !== only) continue;
      const g = el('g', { class: 'blip', 'data-slug': b.slug, transform: `translate(${b.x.toFixed(1)},${b.y.toFixed(1)})`,
        'aria-label': `${b.num}. ${b.name}, ${b.q.name}, ${b.r.name}, ${b.status || 'No change'}` });
      if (b.status === 'New') {
        g.appendChild(el('circle', { r: BR + 4, fill: 'none', stroke: b.q.color, 'stroke-width': 2 }));
      } else if (b.moved) {
        // Arc on the side the blip moved from: centre side when it moved out, outer side when it moved in.
        const toCentre = Math.atan2(b.q.oy - b.y, b.q.ox - b.x);
        const phi = b.moved === 'out' ? toCentre : toCentre + Math.PI;
        const rr = BR + 4, a1 = phi - Math.PI / 3, a2 = phi + Math.PI / 3;
        g.appendChild(el('path', { d: `M${rr * Math.cos(a1)},${rr * Math.sin(a1)} A${rr},${rr} 0 0 1 ${rr * Math.cos(a2)},${rr * Math.sin(a2)}`,
          fill: 'none', stroke: b.q.color, 'stroke-width': 2.5 }));
      }
      const light = textOn(b.q.color) === '#000000';
      g.appendChild(el('circle', { class: 'dot', r: BR, fill: b.q.color, stroke: light ? 'rgba(0,0,0,.35)' : '#fff', 'stroke-width': light ? 1 : 1.5 }));
      g.appendChild(text(b.num, { 'text-anchor': 'middle', dy: '0.35em', 'font-size': b.num > 99 ? 9 : 10,
        'font-weight': 700, fill: textOn(b.q.color), 'pointer-events': 'none' }));
      svg.appendChild(g);
    }
    return svg;
  }

  function legendHtml() {
    const ACCENT = THEME.primary;
    const item = (shape, label) => `<span><svg width="22" height="22" aria-hidden="true">${shape}</svg>${label}</span>`;
    return item(`<circle cx="11" cy="11" r="6" fill="${ACCENT}"/><circle cx="11" cy="11" r="9.5" fill="none" stroke="${ACCENT}" stroke-width="1.6"/>`, 'New') +
      item(`<circle cx="11" cy="11" r="6" fill="${ACCENT}"/><path d="M4.5,6 A9.5,9.5 0 0 1 17.5,6" fill="none" stroke="${ACCENT}" stroke-width="2"/>`, 'Moved in/out') +
      item(`<circle cx="11" cy="11" r="6" fill="${ACCENT}"/>`, 'No change');
  }

  // ---------- shared bits of HTML ----------
  function statusText(b) {
    return b.status === 'Moved' && b.previousRing ? `Moved ${b.moved} from ${b.previousRing}` : (b.status || 'No change');
  }
  function bannerHtml(b) {
    const src = safeUrl(b.banner);
    return src ? `<img class="banner" data-slug="${esc(b.slug)}" src="${esc(src)}" alt="">` : fallbackBanner(b);
  }
  function fallbackBanner(b) {
    return `<div class="banner banner-fallback" style="background:${b.q.color};color:${textOn(b.q.color)}">${esc(b.q.name)}</div>`;
  }
  // Swap broken banner images for the coloured fallback.
  function fixBrokenBanners(root, model) {
    root.querySelectorAll('img.banner').forEach((img) => {
      const swap = () => { const b = model.bySlug.get(img.dataset.slug); if (b) img.outerHTML = fallbackBanner(b); };
      if (img.complete && img.naturalWidth === 0) swap(); else img.addEventListener('error', swap, { once: true });
    });
  }

  // ---------- helpers ----------
  function el(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function text(value, attrs) { const t = el('text', attrs); t.textContent = value; return t; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function slugify(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function safeUrl(u, httpsOnly) {
    if (!u) return '';
    u = String(u).trim();
    if (/^https:\/\//i.test(u)) return u;
    if (!httpsOnly && /^http:\/\//i.test(u)) return u;
    if (!httpsOnly && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//')) return u; // relative path in the repo
    return '';
  }
  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function inline(s) { // s is already escaped
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  // Small, safe Markdown subset: paragraphs, bullet lists, headings, bold, italics, code, links.
  // opts.headingLevel: the HTML level for "##" (default: headings render as bold paragraphs).
  function markdown(src, opts = {}) {
    return String(src).replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      const h = lines.length === 1 && lines[0].match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const text = inline(esc(h[2]));
        if (!opts.headingLevel) return '<p><strong>' + text + '</strong></p>';
        const level = Math.min(6, opts.headingLevel + Math.max(0, h[1].length - 2));
        return `<h${level}>${text}</h${level}>`;
      }
      if (lines.every((l) => /^\s*[-*] /.test(l))) {
        return '<ul>' + lines.map((l) => '<li>' + inline(esc(l.replace(/^\s*[-*] /, ''))) + '</li>').join('') + '</ul>';
      }
      return '<p>' + lines.map((l) => inline(esc(l))).join('<br>') + '</p>';
    }).join('');
  }

  global.RadarCore = {
    load, getText, prepare, drawRadar, legendHtml, related,
    statusText, bannerHtml, fallbackBanner, fixBrokenBanners,
    esc, slugify, safeUrl, formatDate, markdown, textOn, theme: () => THEME,
  };
})(window);
