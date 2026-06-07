// Shared utilities for the Boba Bean event risk scanner.

const crypto = require('crypto');

/**
 * Generate a stable short ID from a string (title + date combo).
 * Using built-in crypto so no extra dependency is needed.
 */
function generateId(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 12);
}

/**
 * Parse a date string into YYYY-MM-DD format.
 * Returns null if parsing fails.
 */
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Already in YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY
  const mdyFull = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyFull) {
    const [, m, d, y] = mdyFull;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // M/D/YY
  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    const fullYear = parseInt(y) >= 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const MONTHS = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  // Month D, YYYY  or  Month D YYYY
  const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) {
    const mon = MONTHS[mdy[1].toLowerCase()];
    if (mon) return `${mdy[3]}-${mon}-${mdy[2].padStart(2, '0')}`;
  }

  // Month D (no year)
  const md = s.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (md) {
    const mon = MONTHS[md[1].toLowerCase()];
    if (mon) {
      const year = new Date().getFullYear();
      return `${year}-${mon}-${md[2].padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Parse a time string into HH:mm (24h) format.
 * Handles: "6 PM", "6:30 PM", "6:00pm", "18:00", "6–9 PM", "6:00 PM - 9:00 PM"
 * Returns null if parsing fails.
 */
function parseTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Already 24h HH:mm
  if (/^\d{2}:\d{2}$/.test(s)) return s;

  // Handle range — return start time
  const rangeMatch = s.match(/^(.+?)\s*[–\-–—to]+\s*.+$/i);
  const timePart = rangeMatch ? rangeMatch[1].trim() : s;

  // 12h with minutes: 6:30 PM
  const hm12 = timePart.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (hm12) {
    let h = parseInt(hm12[1]);
    const m = hm12[2];
    const period = hm12[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }

  // 12h without minutes: 6 PM
  const h12 = timePart.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (h12) {
    let h = parseInt(h12[1]);
    const period = h12[2].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }

  // 24h H:mm
  const h24 = timePart.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return `${h24[1].padStart(2, '0')}:${h24[2]}`;
  }

  return null;
}

/**
 * Parse end time from a range string like "6–9 PM" or "6:00 PM - 9:00 PM".
 * Returns null if not a range or parsing fails.
 */
function parseEndTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // "6:00 PM - 9:00 PM" or "6 PM – 9 PM"
  const rangeMatch = s.match(/^.+?\s*[–\-–—to]+\s*(.+)$/i);
  if (rangeMatch) {
    return parseTime(rangeMatch[1].trim());
  }
  return null;
}

/**
 * Convert HH:mm string to total minutes since midnight for comparisons.
 */
function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  if (parts.length !== 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Get today's date in YYYY-MM-DD in a given timezone.
 * Falls back to local date if Intl is not available.
 */
function getTodayInTimezone(timezone) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const get = (type) => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Add N days to a YYYY-MM-DD string.
 */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Lowercase + collapse whitespace for fuzzy title matching.
 */
function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Very simple title similarity: returns true if > 60% tokens overlap.
 */
function titlesAreSimilar(a, b) {
  const tokA = new Set(normalizeTitle(a).split(' ').filter(t => t.length > 3));
  const tokB = new Set(normalizeTitle(b).split(' ').filter(t => t.length > 3));
  if (tokA.size === 0 || tokB.size === 0) return false;
  let shared = 0;
  for (const t of tokA) { if (tokB.has(t)) shared++; }
  const ratio = shared / Math.max(tokA.size, tokB.size);
  return ratio >= 0.6;
}

/**
 * Scan text for scoring-relevant keywords and return tag array.
 */
function extractTags(text) {
  const t = String(text).toLowerCase();
  const tagMap = {
    family: ['family', 'families'],
    kids: ['kids', 'kid'],
    children: ['children', 'child'],
    teen: ['teen', 'teens', 'teenage'],
    student: ['student', 'students'],
    school: ['school'],
    free: ['free admission', 'free event', 'free entry', 'no admission', 'no charge', 'free!', ' free '],
    concert: ['concert', 'live performance'],
    festival: ['festival', 'fest'],
    'food truck': ['food truck', 'food trucks'],
    'food festival': ['food festival', 'food fair'],
    taste: ['taste', 'tasting', 'tastings'],
    dessert: ['dessert', 'ice cream', 'sweets', 'cupcake', 'cake', 'candy', 'pastry'],
    coffee: ['coffee', 'espresso', 'latte', 'café', 'cafe'],
    drinks: ['drinks', 'cocktail', 'beverage', 'smoothie', 'boba', 'bubble tea'],
    baseball: ['baseball', 'ballpark', 'cannon ballers', 'cannonballers'],
    game: ['game night', 'board game', 'game day', ' game '],
    sports: ['sports', 'sport', 'athletic', 'tournament', 'race', 'racing', 'nascar', 'speedway'],
    market: ['market', 'farmers market', 'craft market', 'pop-up'],
    vendor: ['vendor', 'vendors', 'artisan', 'craft fair', 'craft show'],
    'movie night': ['movie night', 'outdoor movie', 'film screening', 'cinema'],
    parade: ['parade'],
    fireworks: ['fireworks', 'firework'],
    'live music': ['live music', 'band', 'performer', 'singer', 'dj set'],
    beer: ['beer', 'craft beer', 'ale', 'lager'],
    brewery: ['brewery', 'brewing', 'taproom', 'tap room'],
    '21+': ['21+', '21 and over', '21 & over', 'adults only']
  };

  const found = [];
  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some(p => t.includes(p))) found.push(tag);
  }
  return found;
}

module.exports = {
  generateId,
  parseDate,
  parseTime,
  parseEndTime,
  timeToMinutes,
  getTodayInTimezone,
  addDays,
  normalizeTitle,
  titlesAreSimilar,
  extractTags
};
