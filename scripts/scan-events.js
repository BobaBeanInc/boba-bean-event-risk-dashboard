// Main scan script for Boba Bean Event Risk Dashboard.
// Fetches each enabled source, parses event candidates, merges manual events,
// scores everything, deduplicates, and writes public/events.json.
//
// Run with:  node scripts/scan-events.js

'use strict';

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

const { getParser }        = require('./parsers');
const { scoreAll }         = require('./score-events');
const { validateOutput }   = require('./validate-data');
const {
  getTodayInTimezone,
  addDays,
  titlesAreSimilar,
  normalizeTitle
} = require('./utils');

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// ─── HTTP fetch helper ────────────────────────────────────────────────────────
// Follows up to 3 redirects, 15s timeout, polite User-Agent.
function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const maxRedirects = 3;
    let redirectsLeft = maxRedirects;

    function doRequest(currentUrl) {
      let mod;
      try {
        mod = currentUrl.startsWith('https') ? https : http;
      } catch {
        return reject(new Error(`Invalid URL: ${currentUrl}`));
      }

      const options = {
        headers: {
          'User-Agent': 'BobaBeanEventRiskScanner/1.0 (contact: events@bobabean.shop)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      };

      const req = mod.get(currentUrl, options, (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft-- <= 0) return reject(new Error('Too many redirects'));
          let next = res.headers.location;
          if (!next.startsWith('http')) {
            try {
              const base = new URL(currentUrl);
              next = new URL(next, base).href;
            } catch { /* use as-is */ }
          }
          res.resume();
          return doRequest(next);
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });
    }

    doRequest(url);
  });
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Priority score for choosing the "better" version of a duplicate event.
 * Higher is better.
 */
function dedupPriority(event) {
  let p = 0;
  if (event.source === 'Manual') p += 100;
  if (event.confidence === 'high')   p += 30;
  if (event.confidence === 'medium') p += 15;
  if (event.confidence === 'low')    p += 0;
  if (event.date)      p += 20;
  if (event.startTime) p += 10;
  if (event.description && event.description.length > 50) p += 5;
  return p;
}

function deduplicateEvents(events) {
  const kept = [];

  for (const candidate of events) {
    let isDuplicate = false;

    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];

      const sameDate = candidate.date && existing.date && candidate.date === existing.date;
      const similar  = titlesAreSimilar(candidate.title, existing.title);

      if (similar && sameDate) {
        isDuplicate = true;
        // Keep the higher-priority version
        if (dedupPriority(candidate) > dedupPriority(existing)) {
          kept[i] = candidate;
        }
        break;
      }
    }

    if (!isDuplicate) kept.push(candidate);
  }

  return kept;
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(events, config, today) {
  const tomorrow = addDays(today, 1);
  const weekEnd  = addDays(today, config.lookaheadDays || 7);

  const riskOrder = ['High', 'Moderate', 'Low', 'Minimal', 'Unscored'];

  function highestRiskLabel(dayEvents) {
    if (!dayEvents.length) return 'Minimal';
    for (const label of riskOrder) {
      if (dayEvents.some(e => e.riskLabel === label)) return label;
    }
    return 'Minimal';
  }

  const todayEvents = events.filter(e => e.date === today);

  // Tonight = today's events that start at or after 17:00
  const tonightEvents = todayEvents.filter(e => {
    if (!e.startTime) return false;
    const [h] = e.startTime.split(':').map(Number);
    return h >= 17;
  });

  const tomorrowEvents = events.filter(e => e.date === tomorrow);

  // Best risk day in the lookahead window (excluding today)
  const lookAheadDays = [];
  for (let i = 1; i <= (config.lookaheadDays || 7); i++) {
    const d = addDays(today, i);
    const dayEvts = events.filter(e => e.date === d);
    if (dayEvts.length > 0) {
      lookAheadDays.push({ date: d, risk: highestRiskLabel(dayEvts) });
    }
  }

  let weekHighestRiskDay = null;
  for (const label of riskOrder) {
    const found = lookAheadDays.find(d => d.risk === label);
    if (found) { weekHighestRiskDay = found.date; break; }
  }

  const scoredEvents = events.filter(e => e.date >= today && e.date <= weekEnd);

  return {
    todayRisk:         highestRiskLabel(todayEvents),
    tonightRisk:       highestRiskLabel(tonightEvents),
    tomorrowRisk:      highestRiskLabel(tomorrowEvents),
    weekHighestRiskDay,
    highRiskCount:     scoredEvents.filter(e => e.riskLabel === 'High').length,
    opportunityCount:  scoredEvents.filter(e => e.impactType === 'Opportunity').length,
    needsReviewCount:  scoredEvents.filter(e => e.needsReview).length
  };
}

// ─── Sort events ──────────────────────────────────────────────────────────────
function sortEvents(events) {
  return [...events].sort((a, b) => {
    // Dated events first
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    // Date ascending
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    // Score descending
    if (b.score !== a.score) return b.score - a.score;
    // Needs review lower priority
    if (a.needsReview && !b.needsReview) return 1;
    if (!a.needsReview && b.needsReview) return -1;
    return 0;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Boba Bean Event Risk Scanner ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // 1. Load config
  const configPath = path.join(PUBLIC_DIR, 'config.json');
  const config = loadJSON(configPath);
  console.log(`Business: ${config.businessName}, ${config.city}, ${config.state}`);

  const today    = getTodayInTimezone(config.timezone);
  const weekEnd  = addDays(today, config.lookaheadDays || 7);
  console.log(`Scanning for events: ${today} → ${weekEnd}\n`);

  // 2. Load sources
  const sources = loadJSON(path.join(PUBLIC_DIR, 'sources.json'));
  const enabledSources = sources.filter(s => s.enabled);
  console.log(`Sources enabled: ${enabledSources.length}/${sources.length}`);

  // 3. Load manual events
  let manualEvents = [];
  try {
    const raw = loadJSON(path.join(PUBLIC_DIR, 'manual-events.json'));
    manualEvents = Array.isArray(raw) ? raw : [];
    // Mark manual events with source, confidence, sourceWeight.
    // needsReview stays false unless the entry explicitly sets it to true.
    manualEvents = manualEvents.map(e => ({
      ...e,
      source: e.source || 'Manual',
      confidence: e.confidence || 'high',
      needsReview: e.needsReview === true,
      sourceWeight: 10,
      tags: e.tags || []
    }));
    console.log(`Manual events loaded: ${manualEvents.length}`);
  } catch (err) {
    console.warn(`Warning: Could not load manual-events.json — ${err.message}`);
  }

  // 4. Fetch and parse each source
  const sourceHealth = [];
  let allScrapedCandidates = [];

  for (const source of enabledSources) {
    const healthEntry = {
      name: source.name,
      url: source.url,
      status: 'Unknown',
      lastChecked: new Date().toISOString(),
      candidateCount: 0,
      error: null
    };

    console.log(`\nScanning: ${source.name}`);
    console.log(`  URL: ${source.url}`);

    try {
      const html = await fetchUrl(source.url);
      console.log(`  Fetch: OK (${html.length} chars)`);

      const parser = getParser(source.name);
      let candidates = [];
      try {
        candidates = parser(html, source, config);
      } catch (parseErr) {
        console.warn(`  Parse error: ${parseErr.message}`);
        healthEntry.status = 'Partial';
        healthEntry.error  = `Parser error: ${parseErr.message}`;
      }

      // Filter to events within the lookahead window (or no date = needsReview),
      // then force needsReview = true for any low-confidence or undated candidate
      // regardless of what the parser returned. This is the fix that makes the
      // Needs Review summary count match the badges on the cards.
      const filtered = candidates
        .filter(c => {
          if (!c.date) return true; // keep for review
          return c.date >= today && c.date <= weekEnd;
        })
        .map(c => ({
          ...c,
          needsReview: c.needsReview === true || c.confidence === 'low' || !c.date
        }));

      console.log(`  Candidates: ${candidates.length} raw → ${filtered.length} in window`);

      if (!healthEntry.error) {
        healthEntry.status = filtered.length > 0 ? 'OK' : 'OK';
        if (candidates.length === 0) {
          healthEntry.status = 'Partial';
          healthEntry.error  = 'Parser found no event candidates. Site markup may have changed.';
        }
      }

      healthEntry.candidateCount = filtered.length;
      allScrapedCandidates = allScrapedCandidates.concat(filtered);

    } catch (fetchErr) {
      console.warn(`  Fetch failed: ${fetchErr.message}`);
      healthEntry.status = 'Failed';
      healthEntry.error  = fetchErr.message;
    }

    sourceHealth.push(healthEntry);
  }

  // 5. Merge manual + scraped
  // Manual events go first so they win dedup
  const merged = [...manualEvents, ...allScrapedCandidates];
  console.log(`\nTotal before dedup: ${merged.length}`);

  // 6. Deduplicate
  const deduped = deduplicateEvents(merged);
  console.log(`After dedup: ${deduped.length}`);

  // 7. Score
  const scored = scoreAll(deduped, config);

  // 8. Sort
  const sorted = sortEvents(scored);

  // 9. Build summary
  const summary = buildSummary(sorted, config, today);
  console.log(`\nSummary:`);
  console.log(`  Today risk:    ${summary.todayRisk}`);
  console.log(`  Tonight risk:  ${summary.tonightRisk}`);
  console.log(`  Tomorrow risk: ${summary.tomorrowRisk}`);
  console.log(`  High risk:     ${summary.highRiskCount}`);
  console.log(`  Opportunities: ${summary.opportunityCount}`);
  console.log(`  Needs review:  ${summary.needsReviewCount}`);

  // 10. Build output
  const output = {
    updatedAt: new Date().toISOString(),
    timezone: config.timezone,
    summary,
    sourceHealth,
    events: sorted
  };

  // 11. Write events.json
  const outputPath = path.join(PUBLIC_DIR, 'events.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nWrote: ${outputPath}`);

  // 12. Validate
  const validationErrors = validateOutput(output);
  if (validationErrors.length > 0) {
    console.error('\nValidation errors:');
    validationErrors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('\nValidation: PASSED');
  console.log('=== Scan complete ===\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
