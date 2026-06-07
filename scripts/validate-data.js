// Validation script for Boba Bean Event Risk Dashboard.
// Checks config.json, sources.json, manual-events.json, and events.json.
//
// Run standalone:  node scripts/validate-data.js
// Used internally by scan-events.js via validateOutput().

'use strict';

const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ─── Schema checks ────────────────────────────────────────────────────────────

function validateConfig(cfg) {
  const errors = [];
  const required = [
    'businessName', 'city', 'state', 'timezone',
    'primaryRiskWindowStart', 'primaryRiskWindowEnd',
    'lookaheadDays', 'highRiskThreshold', 'moderateRiskThreshold', 'lowRiskThreshold',
    'businessLatitude', 'businessLongitude'
  ];
  for (const field of required) {
    if (cfg[field] === undefined || cfg[field] === null) {
      errors.push(`config.json missing required field: ${field}`);
    }
  }
  if (typeof cfg.lookaheadDays !== 'number') errors.push('config.json: lookaheadDays must be a number');
  if (typeof cfg.businessLatitude !== 'number')  errors.push('config.json: businessLatitude must be a number');
  if (typeof cfg.businessLongitude !== 'number') errors.push('config.json: businessLongitude must be a number');
  return errors;
}

function validateSources(sources) {
  const errors = [];
  if (!Array.isArray(sources)) return ['sources.json must be an array'];
  sources.forEach((s, i) => {
    if (!s.name)    errors.push(`sources.json[${i}]: missing name`);
    if (!s.url)     errors.push(`sources.json[${i}]: missing url`);
    if (s.enabled === undefined) errors.push(`sources.json[${i}]: missing enabled flag`);
  });
  return errors;
}

function validateManualEvents(events) {
  const errors = [];
  if (!Array.isArray(events)) return ['manual-events.json must be an array'];
  events.forEach((e, i) => {
    if (!e.title) errors.push(`manual-events.json[${i}]: missing title`);
  });
  return errors;
}

function validateEventObject(event, i, context) {
  const errors = [];
  const prefix = `${context}[${i}]`;
  const required = ['id', 'title', 'source'];
  for (const field of required) {
    if (!event[field]) errors.push(`${prefix}: missing required field "${field}"`);
  }
  // date is optional (needsReview events may not have one)
  if (event.date && !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    errors.push(`${prefix}: date "${event.date}" is not YYYY-MM-DD`);
  }
  if (event.startTime && !/^\d{2}:\d{2}$/.test(event.startTime)) {
    errors.push(`${prefix}: startTime "${event.startTime}" is not HH:mm`);
  }
  return errors;
}

/**
 * Validate a fully-built output object (as would be written to events.json).
 * Used internally by scan-events.js and returns array of error strings.
 */
function validateOutput(output) {
  const errors = [];

  if (!output || typeof output !== 'object') return ['events.json: root must be an object'];

  if (!output.updatedAt && output.updatedAt !== null) errors.push('events.json: missing updatedAt');
  if (!output.timezone)   errors.push('events.json: missing timezone');
  if (!output.summary)    errors.push('events.json: missing summary');
  if (!Array.isArray(output.sourceHealth)) errors.push('events.json: sourceHealth must be an array');
  if (!Array.isArray(output.events))       errors.push('events.json: events must be an array');

  if (output.summary) {
    const summaryFields = ['todayRisk', 'tonightRisk', 'tomorrowRisk', 'highRiskCount', 'opportunityCount', 'needsReviewCount'];
    for (const f of summaryFields) {
      if (output.summary[f] === undefined) errors.push(`events.json summary: missing field "${f}"`);
    }
  }

  if (Array.isArray(output.events)) {
    output.events.forEach((e, i) => {
      errors.push(...validateEventObject(e, i, 'events.json events'));
    });
  }

  return errors;
}

// ─── Standalone runner ────────────────────────────────────────────────────────

function runStandalone() {
  let allErrors = [];
  let hasWarnings = false;

  // config.json
  const configPath = path.join(PUBLIC_DIR, 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const errs = validateConfig(cfg);
    if (errs.length === 0) {
      console.log('✓ config.json — valid');
    } else {
      errs.forEach(e => console.error(`✗ ${e}`));
      allErrors = allErrors.concat(errs);
    }
  } catch (e) {
    console.error(`✗ config.json — could not read or parse: ${e.message}`);
    allErrors.push(e.message);
  }

  // sources.json
  const sourcesPath = path.join(PUBLIC_DIR, 'sources.json');
  try {
    const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    const errs = validateSources(sources);
    if (errs.length === 0) {
      console.log(`✓ sources.json — valid (${sources.length} sources)`);
    } else {
      errs.forEach(e => console.error(`✗ ${e}`));
      allErrors = allErrors.concat(errs);
    }
  } catch (e) {
    console.error(`✗ sources.json — could not read or parse: ${e.message}`);
    allErrors.push(e.message);
  }

  // manual-events.json
  const manualPath = path.join(PUBLIC_DIR, 'manual-events.json');
  try {
    const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    const errs = validateManualEvents(manual);
    if (errs.length === 0) {
      console.log(`✓ manual-events.json — valid (${manual.length} events)`);
    } else {
      errs.forEach(e => console.error(`✗ ${e}`));
      allErrors = allErrors.concat(errs);
    }
  } catch (e) {
    console.error(`✗ manual-events.json — could not read or parse: ${e.message}`);
    allErrors.push(e.message);
  }

  // events.json
  const eventsPath = path.join(PUBLIC_DIR, 'events.json');
  try {
    const eventsData = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    const errs = validateOutput(eventsData);
    if (errs.length === 0) {
      console.log(`✓ events.json — valid (${eventsData.events.length} events, updated: ${eventsData.updatedAt || 'never'})`);
    } else {
      errs.forEach(e => console.error(`✗ ${e}`));
      allErrors = allErrors.concat(errs);
    }
  } catch (e) {
    console.error(`✗ events.json — could not read or parse: ${e.message}`);
    allErrors.push(e.message);
  }

  if (allErrors.length > 0) {
    console.error(`\nValidation FAILED with ${allErrors.length} error(s).`);
    process.exit(1);
  } else {
    console.log('\nAll validation checks passed.');
    process.exit(0);
  }
}

// Run standalone if called directly
if (require.main === module) {
  runStandalone();
}

module.exports = { validateOutput, validateConfig, validateSources, validateManualEvents };
