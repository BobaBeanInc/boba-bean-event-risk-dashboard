// HTML parsers for each event source.
// Each parser receives (html, source, config) and returns an array of raw candidate objects.
// Raw candidates are normalized downstream in scan-events.js.
//
// IMPROVING PARSERS LATER:
// Each site has its own function. When a site's HTML changes, only that function needs updating.
// Use the parseGeneric fallback as a starting point, then add site-specific selectors.

const cheerio = require('cheerio');
const { parseDate, parseTime, parseEndTime, extractTags, generateId } = require('./utils');

// ─── Date/time regex patterns ─────────────────────────────────────────────────

const DATE_PATTERNS = [
  // YYYY-MM-DD
  /\b(\d{4}-\d{2}-\d{2})\b/,
  // MM/DD/YYYY
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
  // Month D, YYYY  or  Month D YYYY
  /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/i,
  // Month D (no year)
  /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2})\b/i
];

const TIME_PATTERNS = [
  // 6:30 PM - 9:00 PM  or  6 PM – 9 PM  (ranges)
  /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i,
  // 6:30 PM  or  6 PM
  /\b(\d{1,2}:\d{2}\s*(?:am|pm))\b/i,
  /\b(\d{1,2}\s*(?:am|pm))\b/i,
  // 18:00
  /\b([01]\d|2[0-3]):[0-5]\d\b/
];

/**
 * Try to extract a date string from arbitrary text using DATE_PATTERNS.
 */
function findDateInText(text) {
  if (!text) return null;
  for (const pat of DATE_PATTERNS) {
    const m = text.match(pat);
    if (m) return m[1] || m[0];
  }
  return null;
}

/**
 * Try to extract a time string from arbitrary text using TIME_PATTERNS.
 */
function findTimeInText(text) {
  if (!text) return null;
  for (const pat of TIME_PATTERNS) {
    const m = text.match(pat);
    if (m) return m[1] || m[0];
  }
  return null;
}

/**
 * Build a minimal candidate object from scraped fields.
 * All fields are optional; downstream normalization fills gaps.
 */
function buildCandidate(fields, source) {
  const rawDate = findDateInText(fields.dateText) || fields.date || null;
  const rawTime = findTimeInText(fields.timeText) || fields.time || null;

  const parsedDate = parseDate(rawDate);
  const parsedStart = parseTime(rawTime);
  const parsedEnd   = parseEndTime(rawTime);

  const title = (fields.title || '').trim();
  const description = (fields.description || '').trim();
  const allText = `${title} ${description} ${fields.extraText || ''}`.toLowerCase();

  const tags = extractTags(allText);
  const confidence = parsedDate && parsedStart ? 'medium' : 'low';
  const needsReview = !parsedDate;

  // Stable ID from title + date
  const idSeed = `${source.name}:${title}:${parsedDate || 'nodate'}`;

  return {
    id: generateId(idSeed),
    title,
    date: parsedDate,
    startTime: parsedStart,
    endTime: parsedEnd || fields.endTime || null,
    venue: (fields.venue || source.name || '').trim(),
    city: fields.city || 'Concord',
    distanceMiles: source.defaultDistanceMiles || 10,
    description,
    source: source.name,
    sourceUrl: source.url,
    eventUrl: fields.eventUrl || '',
    tags,
    confidence,
    needsReview,
    sourceWeight: source.sourceWeight || 5,
    // Score fields filled later
    score: 0,
    riskLabel: 'Unscored',
    impactType: 'Unknown',
    whyItMatters: '',
    suggestedAction: ''
  };
}

// ─── Generic Parser ───────────────────────────────────────────────────────────

/**
 * parseGeneric: Attempts to find event-like content in any HTML page.
 * Looks for common event containers and extracts title, link, date, time, description.
 * Returns an array of raw candidate objects (may be empty).
 */
function parseGeneric(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Common event container selectors, tried in order
  const containerSelectors = [
    'article',
    '.event',
    '.events',
    '.tribe-events-calendar-list__event',
    '.tribe-events-event',
    '.tribe-event',
    '.calendar-event',
    '.event-card',
    '.event-item',
    '.card',
    '.eventitem',
    '.eventWrapper',
    '[class*="event"]',
    'li'
  ];

  let $items = $([]);
  for (const sel of containerSelectors) {
    const found = $(sel);
    if (found.length >= 2) {
      $items = found;
      break;
    }
  }

  // If nothing useful found, return empty
  if ($items.length === 0) return candidates;

  $items.each((i, el) => {
    const $el = $(el);

    // Title: prefer h1–h4, then anchor text
    let title = '';
    $el.find('h1,h2,h3,h4').each((_, hEl) => {
      const t = $(hEl).text().trim();
      if (t && t.length > 3 && t.length < 200) { title = t; return false; }
    });
    if (!title) {
      $el.find('a').each((_, aEl) => {
        const t = $(aEl).text().trim();
        if (t && t.length > 3 && t.length < 200) { title = t; return false; }
      });
    }
    if (!title) return; // skip containers with no discernible title

    // Event URL
    let eventUrl = '';
    const $link = $el.find('a').first();
    if ($link.length) {
      const href = $link.attr('href') || '';
      if (href.startsWith('http')) {
        eventUrl = href;
      } else if (href.startsWith('/')) {
        try {
          const base = new URL(source.url);
          eventUrl = `${base.origin}${href}`;
        } catch { eventUrl = href; }
      }
    }

    // Full text of the container for date/time/description extraction
    const fullText = $el.text().replace(/\s+/g, ' ').trim();

    // Description: first 300 chars of text that isn't just the title
    let description = fullText.replace(title, '').trim().slice(0, 300);

    // Look for date and time in the full text
    const dateText = findDateInText(fullText);
    const timeText = findTimeInText(fullText);

    // Only add if title seems like a real event title (not nav/footer noise)
    const noiseWords = ['home', 'contact', 'about', 'menu', 'login', 'sign in', 'privacy', 'terms'];
    if (noiseWords.some(n => title.toLowerCase() === n)) return;

    candidates.push(buildCandidate({
      title,
      dateText,
      timeText,
      description,
      eventUrl,
      extraText: fullText
    }, source));
  });

  // Deduplicate within this source by title+date
  const seen = new Set();
  return candidates.filter(c => {
    const key = `${c.title}|${c.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Source-specific parsers ──────────────────────────────────────────────────
// Each of these can add site-specific logic above the generic fallback.
// When you want to improve a parser, add cheerio selectors specific to that site.

function parseDowntownConcord(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // The Evrnt/Tribe Events plugin is commonly used on WordPress event sites
  const tribeItems = $('.tribe-events-calendar-list__event, .tribe-event, .type-tribe_events');
  if (tribeItems.length > 0) {
    tribeItems.each((i, el) => {
      const $el = $(el);
      const title = $el.find('.tribe-events-calendar-list__event-title, .tribe-event-url, h3, h2').first().text().trim();
      const dateText = $el.find('.tribe-events-calendar-list__event-datetime, .tribe-event-date-start, time').first().text().trim();
      const eventUrl = $el.find('a').first().attr('href') || '';
      const description = $el.find('.tribe-events-calendar-list__event-description, .tribe-event-description, p').first().text().trim().slice(0, 300);
      const venue = $el.find('.tribe-events-calendar-list__event-venue, .tribe-venue').first().text().trim();

      if (!title || title.length < 3) return;
      candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue }, source));
    });
    if (candidates.length > 0) return candidates;
  }

  // Fallback
  return parseGeneric(html, source, config);
}

function parseKannapolis(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // City government sites often use a table or list layout
  $('table tr, .event-row, .cal-event, .eventListing').each((i, el) => {
    const $el = $(el);
    const title = $el.find('td, .event-title, a').first().text().trim();
    const dateText = $el.find('td').eq(0).text().trim();
    const description = $el.find('td').eq(1).text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    if (/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|date|time|event)$/i.test(title)) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseExploreCabarrus(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Explore NC tourism sites often use .em-item or .em-event from Events Manager plugin
  $('.em-item, .em-event, .event_listing, article.event').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h2, h3, .em-event-name, a').first().text().trim();
    const dateText = $el.find('.em-event-when, .em-date, time').first().text().trim();
    const description = $el.find('.em-event-description, p').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseCabarrusArena(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Arena sites often list events in .event-list-item or table rows
  $('.event-list-item, .event-listing, .event-row, tr').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h2, h3, h4, .event-name, a').first().text().trim();
    const dateText = $el.find('.event-date, .date, td').first().text().trim();
    const description = $el.find('.event-description, p, td').eq(1).text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    if (/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|date|time|event|buy|tickets)$/i.test(title)) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseCannonBallers(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // MiLB schedule pages vary. Try common schedule table patterns.
  $('.schedule-table tr, .schedule-row, .game-card, tr[data-gamepk]').each((i, el) => {
    const $el = $(el);
    const dateText = $el.find('.date, td').first().text().trim();
    const opponent = $el.find('.opponent, .team-name, td').eq(1).text().trim();
    const time = $el.find('.time, .game-time, td').eq(2).text().trim();

    if (!dateText) return;
    const title = opponent ? `Cannon Ballers vs ${opponent}` : 'Cannon Ballers Home Game';
    candidates.push(buildCandidate({
      title,
      dateText,
      timeText: time,
      description: 'Minor league baseball game at Atrium Health Ballpark, Kannapolis, NC',
      venue: 'Atrium Health Ballpark',
      city: 'Kannapolis'
    }, source));
  });

  // If no schedule rows found, try to find at least that there are games
  if (candidates.length === 0) {
    // Look for any game-related text blocks
    $('[class*="game"], [class*="schedule"], [class*="Game"]').each((i, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (text.length < 10) return;
      const dateText = findDateInText(text);
      const timeText = findTimeInText(text);
      if (!dateText) return;
      candidates.push(buildCandidate({
        title: 'Cannon Ballers Game',
        dateText,
        timeText,
        description: 'Minor league baseball game at Atrium Health Ballpark',
        venue: 'Atrium Health Ballpark',
        city: 'Kannapolis'
      }, source));
    });
  }

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseCharlotteMotorSpeedway(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // CMS site uses various event card layouts
  $('.event-card, .event-item, article, .race-card').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h1,h2,h3,h4,.event-title').first().text().trim();
    const dateText = $el.find('.event-date, .date, time, .race-date').first().text().trim();
    const description = $el.find('p, .event-description').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({
      title,
      dateText,
      description,
      eventUrl,
      venue: 'Charlotte Motor Speedway',
      city: 'Concord'
    }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseConcordMills(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Simon mall pages use JSON-LD structured data or .event-card
  // Try JSON-LD first
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Event' || (Array.isArray(item['@type']) && item['@type'].includes('Event'))) {
          const title = item.name || '';
          const dateText = item.startDate || '';
          const description = (item.description || '').slice(0, 300);
          const eventUrl = item.url || '';
          const venue = (item.location && item.location.name) ? item.location.name : 'Concord Mills';

          if (!title) continue;
          candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue, city: 'Concord' }, source));
        }
      }
    } catch { /* malformed JSON-LD — skip */ }
  });

  if (candidates.length > 0) return candidates;

  // Fallback: standard card selectors
  $('.event-card, .event-item, .promo-card').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h2,h3,h4,a').first().text().trim();
    const dateText = $el.find('.event-date, .date, time').first().text().trim();
    const description = $el.find('p').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue: 'Concord Mills', city: 'Concord' }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseGibsonMill(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Gibson Mill uses Squarespace or similar; look for summary-item blocks
  $('.eventlist-event, .summary-item, .event-item, article').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h1,h2,h3,.eventlist-title,.summary-title').first().text().trim();
    const dateText = $el.find('.event-time-12hr, .eventlist-meta, time, .summary-metadata').first().text().trim();
    const description = $el.find('p, .eventlist-description, .summary-excerpt').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue: 'Gibson Mill', city: 'Concord' }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseBankFoodHall(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Food hall sites often use a simple event list or section blocks
  $('.event, .event-block, article, section.event-section').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h1,h2,h3,h4').first().text().trim();
    const dateText = $el.find('time, .date, .event-date').first().text().trim();
    const description = $el.find('p').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue: 'The Bank Food Hall', city: 'Kannapolis' }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

function parseCabarrusBrewing(html, source, config) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Brewery event pages often list events in .event-list or Wix/Squarespace layouts
  $('[class*="eventCard"], [class*="event-card"], .event-list li, article').each((i, el) => {
    const $el = $(el);
    const title = $el.find('h1,h2,h3,h4,a').first().text().trim();
    const dateText = $el.find('time, .event-date, .date').first().text().trim() ||
                     findDateInText($el.text());
    const description = $el.find('p').first().text().trim().slice(0, 300);
    const eventUrl = $el.find('a').first().attr('href') || '';

    if (!title || title.length < 3) return;
    candidates.push(buildCandidate({ title, dateText, description, eventUrl, venue: 'Cabarrus Brewing', city: 'Concord' }, source));
  });

  if (candidates.length > 0) return candidates;
  return parseGeneric(html, source, config);
}

// ─── Parser dispatch map ───────────────────────────────────────────────────────

const PARSER_MAP = {
  'Downtown Concord':                parseDowntownConcord,
  'City of Kannapolis Calendar':     parseKannapolis,
  'Explore Cabarrus Events':         parseExploreCabarrus,
  'Cabarrus Arena Events':           parseCabarrusArena,
  'Kannapolis Cannon Ballers Schedule': parseCannonBallers,
  'Charlotte Motor Speedway':        parseCharlotteMotorSpeedway,
  'Concord Mills Events':            parseConcordMills,
  'Gibson Mill':                     parseGibsonMill,
  'The Bank Food Hall':              parseBankFoodHall,
  'Cabarrus Brewing Company':        parseCabarrusBrewing
};

/**
 * Get the right parser for a source, falling back to parseGeneric.
 */
function getParser(sourceName) {
  return PARSER_MAP[sourceName] || parseGeneric;
}

module.exports = {
  parseGeneric,
  parseDowntownConcord,
  parseKannapolis,
  parseExploreCabarrus,
  parseCabarrusArena,
  parseCannonBallers,
  parseCharlotteMotorSpeedway,
  parseConcordMills,
  parseGibsonMill,
  parseBankFoodHall,
  parseCabarrusBrewing,
  getParser
};
