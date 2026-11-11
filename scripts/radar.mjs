#!/usr/bin/env node
// Maintains site/data/blips.json for the technology radar. No dependencies; needs Node 20 or later (the workflows use Node 24).
//
//   node scripts/radar.mjs add-from-issue          Reads the GitHub issue event (GITHUB_EVENT_PATH) and adds, updates,
//                                                  retires or brings back a blip.
//   node scripts/radar.mjs new-edition "May 2027"  Starts a new edition: every blip goes back to "No change".
//
// Results are written to GITHUB_OUTPUT (ok, name, slug, message) so the workflow can report back on the issue.

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DATA_FILE = path.join(SITE, 'data', 'blips.json');
const CONFIG_FILE = path.join(SITE, 'config.json');
const IMAGES_DIR = path.join(SITE, 'images');
// Kept outside site/ so it is never published to the radar.
const LOG_FILE = path.join(ROOT, 'notes', 'decisions.md');
const LOG_HEADER = '# Decision log\n\nEvery change to the radar, newest first, with the reason given when it was approved. ' +
  'This file is written automatically; you can also edit it by hand.\n\n<!-- entries -->\n';

// Issue form labels (from .github/ISSUE_TEMPLATE/propose.yml) mapped to blip fields.
const FIELDS = {
  'What should happen?': 'action',
  'Technology name': 'name',
  'Quadrant': 'quadrant',
  'Ring': 'ring',
  'Description': 'description',
  'Related blips': 'related',
  'Viva Engage link': 'engage',
  'Banner image': 'banner',
  'Reason for this change': 'reason',
};
const NO_RESPONSE = '_No response_';
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ---------- parsing ----------

export function parseIssueForm(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const labels = Object.keys(FIELDS).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const heading = new RegExp(`^### (${labels.join('|')})[ \\t]*$`, 'gm');
  const marks = [...text.matchAll(heading)];
  const out = {};
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const value = text.slice(start, end).trim();
    out[FIELDS[m[1]]] = value === NO_RESPONSE ? '' : value;
  });
  return out;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseList(value) {
  return String(value || '').split(/[\n,]/)
    .map((s) => s.replace(/^\s*[-*]\s+/, '').trim())
    .filter((s) => s && s !== NO_RESPONSE);
}

function pickOption(options, value) {
  const v = String(value || '').trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) || null;
}

function extractImageUrl(value) {
  const v = String(value || '');
  const md = v.match(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/);
  if (md) return md[1];
  const img = v.match(/<img[^>]*\ssrc="(https:\/\/[^"]+)"/i);
  if (img) return img[1];
  const bare = v.match(/https:\/\/\S+/);
  return bare ? bare[0].replace(/[)>\]]+$/, '') : '';
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

// ---------- images ----------

async function downloadImage(url, slug) {
  const headers = { 'User-Agent': 'tech-radar-action' };
  const host = new URL(url).hostname;
  // Attachments dragged into issues in private repos need the token. Node's fetch drops the
  // Authorization header if GitHub redirects to a different host.
  if (process.env.GITHUB_TOKEN && (host === 'github.com' || host.endsWith('.githubusercontent.com'))) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`download returned ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error(`not a supported image type (${type || 'unknown'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image is larger than 5 MB');
  await mkdir(IMAGES_DIR, { recursive: true });
  const file = `${slug}.${ext}`;
  await writeFile(path.join(IMAGES_DIR, file), buf);
  return `images/${file}`;
}

// ---------- decision log ----------

async function logDecision({ date, title, summary, reason, issue }) {
  let text;
  try { text = await readFile(LOG_FILE, 'utf8'); } catch { text = LOG_HEADER; }
  if (!text.includes('<!-- entries -->')) text = text.trimEnd() + '\n\n<!-- entries -->\n';
  const repo = process.env.GITHUB_REPOSITORY;
  const link = issue ? (repo ? ` · [#${issue}](https://github.com/${repo}/issues/${issue})` : ` · #${issue}`) : '';
  // reason === null means the entry needs no reason (for example a new edition).
  const body = reason === null ? '' : `\n${String(reason || '').trim() || '_No reason given._'}\n`;
  const entry = `\n## ${formatDate(date)} · ${title}\n\n${summary}${link}\n${body}`;
  text = text.replace('<!-- entries -->\n', '<!-- entries -->\n' + entry);
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, text);
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ---------- commands ----------

async function addFromIssue() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const issue = event.issue;
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  data.blips = data.blips || [];

  const f = parseIssueForm(issue.body);
  const action = /retire/i.test(f.action || '') ? 'retire' : 'add';
  const name = String(f.name || '').replace(/\s+/g, ' ').trim();
  const slug = slugify(name);
  const today = new Date().toISOString().slice(0, 10);
  const existing = data.blips.find((b) => b.slug === slug || b.name.toLowerCase() === name.toLowerCase());
  const siteUrl = config.siteUrl ? config.siteUrl.replace(/\/?$/, '/') : '';
  const fail = (verb, errors) => output({
    ok: 'false',
    message: `I couldn't ${verb}:\n\n${errors.map((e) => `- ${e}`).join('\n')}\n\n` +
      'Edit the issue to fix this, then remove and re-add the `approved` label.',
  });

  // ----- retire -----
  if (action === 'retire') {
    const errors = [];
    if (!name) errors.push('The **Technology name** is empty.');
    else if (!existing) errors.push(`There is no blip called **${name}**. Check the name matches the radar exactly.`);
    else if (existing.retired) errors.push(`**${existing.name}** is already retired.`);
    if (errors.length) return fail('retire this blip', errors);

    const reason = String(f.reason || '').trim();
    existing.retired = { date: today, ring: existing.ring, edition: data.edition || '', reason, issue: issue.number };
    existing.history = existing.history || [];
    existing.history.push({ date: today, ring: existing.ring, change: `Retired from ${existing.ring}`, issue: issue.number });
    data.updated = today;
    await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
    await logDecision({ date: today, title: existing.name, summary: `**Retired** from ${existing.ring} (${existing.quadrant}).`, reason, issue: issue.number });

    const notes = reason ? '' : '\n\n**Note:** no reason was given, so the Archive tab shows the retirement without one.';
    const link = siteUrl ? `\n\nIt moves to the Archive tab in a minute or two: ${siteUrl}?view=archive#${existing.slug}` : '';
    return output({ ok: 'true', name: existing.name, slug: existing.slug,
      message: `Retired **${existing.name}** from ${existing.ring} (${existing.quadrant}). Its details and history are kept, and you can bring it back with a new proposal using the same name.` + link + notes });
  }

  // ----- add, update or bring back -----
  const errors = [];
  const warnings = [];
  if (!name) errors.push('The **Technology name** is empty.');
  if (name.length > 80) errors.push('The **Technology name** is longer than 80 characters.');

  const quadrantNames = config.quadrants.map((q) => q.name);
  const ringNames = config.rings.map((r) => r.name);
  const quadrant = pickOption(quadrantNames, f.quadrant);
  const ring = pickOption(ringNames, f.ring);
  if (!quadrant) errors.push(`**Quadrant** "${f.quadrant || ''}" is not one of: ${quadrantNames.join(', ')}.`);
  if (!ring) errors.push(`**Ring** "${f.ring || ''}" is not one of: ${ringNames.join(', ')}.`);

  const description = String(f.description || '').trim();
  if (!description) errors.push('The **Description** is empty.');

  const engage = String(f.engage || '').trim();
  if (engage && !isHttpsUrl(engage)) errors.push('The **Viva Engage link** must be a full https:// address.');

  if (errors.length) return fail('add this to the radar', errors);

  const related = parseList(f.related).filter((r) => r.toLowerCase() !== name.toLowerCase());

  let banner = '';
  const bannerUrl = extractImageUrl(f.banner);
  if (bannerUrl) {
    try {
      banner = await downloadImage(bannerUrl, slug);
    } catch (e) {
      banner = bannerUrl;
      warnings.push(`I couldn't copy the banner image into the repository (${e.message}), so the radar links to it directly. ` +
        'If it does not show, add the image to `site/images/` and set `banner` in `site/data/blips.json`.');
    }
  } else if (String(f.banner || '').trim()) {
    warnings.push('I couldn\'t find an image link in **Banner image**, so the banner was left unchanged.');
  }

  const findByName = (n) => data.blips.find((b) => b.name.toLowerCase() === n.toLowerCase());
  const unknown = related.filter((r) => !findByName(r));
  const retiredRel = related.filter((r) => findByName(r) && findByName(r).retired && r.toLowerCase() !== name.toLowerCase());
  if (unknown.length) warnings.push(`These related blips are not on the radar yet, so they show as plain tiles: ${unknown.join(', ')}.`);
  if (retiredRel.length) warnings.push(`These related blips are retired, so their tiles stay hidden until they come back: ${retiredRel.join(', ')}.`);

  let blip = existing;
  let summary, logSummary;

  if (!blip) {
    blip = { name, slug, quadrant, ring, status: 'New', description, related, history: [] };
    if (engage) blip.engage = engage;
    if (banner) blip.banner = banner;
    blip.history.push({ date: today, ring, change: 'Added', issue: issue.number });
    data.blips.push(blip);
    summary = `Added **${name}** to ${quadrant}, in ${ring}.`;
    logSummary = `**Added** to ${quadrant}, in ${ring}.`;
  } else if (blip.retired) {
    // Bringing a retired blip back: keep its history, show it as New in this edition.
    const was = blip.retired;
    delete blip.retired;
    delete blip.previousRing;
    Object.assign(blip, { quadrant, ring, description, status: 'New' });
    if (related.length) blip.related = related;
    if (engage) blip.engage = engage;
    if (banner) blip.banner = banner;
    blip.history = blip.history || [];
    blip.history.push({ date: today, ring, change: `Returned to ${ring}`, issue: issue.number });
    const since = was.edition ? ` (retired in ${was.edition})` : '';
    summary = `Brought **${blip.name}** back to ${quadrant}, in ${ring}${since}. It shows as New in this edition.`;
    logSummary = `**Returned** to ${quadrant}, in ${ring}${since}.`;
  } else {
    const previousRing = blip.ring;
    Object.assign(blip, { quadrant, ring, description }); // keep the existing name and its capitalisation
    if (related.length) blip.related = related;
    if (engage) blip.engage = engage;
    if (banner) blip.banner = banner;
    let change;
    if (previousRing !== ring) {
      blip.status = 'Moved';
      blip.previousRing = previousRing;
      change = `Moved from ${previousRing} to ${ring}`;
    } else {
      change = 'Updated';
    }
    blip.history = blip.history || [];
    blip.history.push({ date: today, ring, change, issue: issue.number });
    summary = previousRing !== ring
      ? `Moved **${blip.name}** from ${previousRing} to ${ring} (${quadrant}).`
      : `Updated **${blip.name}** (${quadrant}, ${ring}).`;
    logSummary = previousRing !== ring ? `**${change}** (${quadrant}).` : `**Updated** (${quadrant}, ${ring}).`;
  }

  data.updated = today;
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
  await logDecision({ date: today, title: blip.name, summary: logSummary, reason: f.reason, issue: issue.number });

  const link = siteUrl ? `\n\nIt will be live in a minute or two: ${siteUrl}#${blip.slug}` : '';
  const notes = warnings.length ? `\n\n**Notes**\n${warnings.map((w) => `- ${w}`).join('\n')}` : '';
  await output({ ok: 'true', name: blip.name, slug: blip.slug, message: summary + link + notes });
}

async function newEdition(label) {
  if (!label) throw new Error('Give the edition a name, for example: node scripts/radar.mjs new-edition "May 2027"');
  const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  for (const b of data.blips || []) {
    if (b.retired) continue;
    b.status = 'No change';
    delete b.previousRing;
  }
  data.edition = label;
  data.updated = new Date().toISOString().slice(0, 10);
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
  await logDecision({ date: data.updated, title: `Edition: ${label}`, summary: '**New edition started.** All blips reset to "No change".', reason: null });
  await output({ ok: 'true', name: label, message: `Started edition ${label}.` });
}

async function output(values) {
  const file = process.env.GITHUB_OUTPUT;
  for (const [k, v] of Object.entries(values)) {
    if (!file) { console.log(`${k}: ${v}`); continue; }
    const delim = `EOF_${Math.random().toString(36).slice(2)}`;
    await appendFile(file, `${k}<<${delim}\n${v}\n${delim}\n`);
  }
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, ...args] = process.argv.slice(2);
  const commands = { 'add-from-issue': addFromIssue, 'new-edition': () => newEdition(args.join(' ').trim()) };
  if (!commands[command]) {
    console.error('Usage: node scripts/radar.mjs add-from-issue | new-edition "<name>"');
    process.exit(2);
  }
  commands[command]().catch((e) => { console.error(e); process.exit(1); });
}
