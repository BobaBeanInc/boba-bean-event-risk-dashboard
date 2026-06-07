// Scoring engine for Boba Bean event risk dashboard.
// Each event gets a numeric score and descriptive labels.

const { timeToMinutes } = require('./utils');

/**
 * Score a single normalized event object.
 * Mutates the event in place (adds score, riskLabel, impactType,
 * whyItMatters, suggestedAction) and returns it.
 */
function scoreEvent(event, config) {
  const reasons = [];
  let score = 0;

  // ─── Time overlap scoring ────────────────────────────────────────────────
  const start = timeToMinutes(event.startTime);
  const end   = timeToMinutes(event.endTime);
  const riskStart = timeToMinutes(config.primaryRiskWindowStart); // 17:00 = 1020
  const riskEnd   = timeToMinutes(config.primaryRiskWindowEnd);   // 21:00 = 1260

  let timeNote = '';

  if (start !== null) {
    // Starts between 16:00 (960) and 20:00 (1200)
    if (start >= 960 && start <= 1200) {
      score += 25;
      reasons.push('starts during peak evening hours');
    }
    // Starts after 21:00
    if (start > 1260) {
      score -= 10;
      timeNote = 'starts late evening';
    }
    // Ends before 16:00
    if (end !== null && end < 960) {
      score -= 20;
      timeNote = 'ends before the evening window';
    }
    // Runs through 19:00 (1140) or later
    if (end !== null && end >= 1140) {
      score += 10;
      reasons.push('runs into or past 7 PM');
    }
    // Overlaps the 17:00–21:00 risk window
    if (end !== null) {
      const overlapStart = Math.max(start, riskStart);
      const overlapEnd   = Math.min(end, riskEnd);
      if (overlapEnd > overlapStart) {
        score += 20;
        reasons.push(`overlaps the 5–9 PM risk window`);
      }
    } else {
      // No end time — partial credit if start is in window
      if (start >= riskStart && start <= riskEnd) {
        score += 10;
        reasons.push('start time falls in the 5–9 PM window');
      }
    }
  } else {
    timeNote = 'time unclear';
    reasons.push('time not confirmed — may or may not overlap the evening window');
  }

  // ─── Distance scoring ───────────────────────────────────────────────────
  const dist = parseFloat(event.distanceMiles);
  let distNote = '';
  if (!isNaN(dist)) {
    if (dist <= 3) {
      score += 25;
      distNote = `very close (${dist} miles away)`;
    } else if (dist <= 7) {
      score += 18;
      distNote = `nearby (${dist} miles away)`;
    } else if (dist <= 15) {
      score += 10;
      distNote = `moderate distance (${dist} miles away)`;
    } else if (dist <= 25) {
      score += 5;
      distNote = `farther away (${dist} miles)`;
    } else {
      score += 0;
      distNote = `distant (${dist} miles) — limited local draw expected`;
    }
    reasons.push(distNote);
  }

  // ─── Audience / keyword match ────────────────────────────────────────────
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const tagScores = {
    family: 25, kids: 25, children: 25, teen: 18, student: 18, school: 18,
    free: 15, concert: 20, festival: 20, 'food truck': 25, 'food festival': 25,
    taste: 20, dessert: 25, coffee: 20, drinks: 20, baseball: 12, game: 12,
    sports: 12, market: 12, vendor: 12, 'movie night': 18, parade: 25,
    fireworks: 25, 'live music': 10, beer: 4, brewery: 4, '21+': 2
  };

  let audienceTags = [];
  for (const tag of tags) {
    const pts = tagScores[tag];
    if (pts) {
      score += pts;
      audienceTags.push(tag);
    }
  }
  if (audienceTags.length > 0) {
    reasons.push(`tagged: ${audienceTags.join(', ')}`);
  }

  // ─── Competition factor ──────────────────────────────────────────────────
  const isFood = tags.some(t => ['food truck', 'food festival', 'taste'].includes(t));
  const isDessert = tags.some(t => ['dessert', 'coffee', 'drinks'].includes(t));
  const isFamilyEnt = tags.some(t => ['family', 'kids', 'children', 'parade', 'fireworks', 'movie night'].includes(t));
  const isFreePublic = tags.includes('free');
  const isAdultTicketed = tags.some(t => ['21+', 'beer', 'brewery'].includes(t)) && !isFamilyEnt;

  if (isDessert) {
    score += 25;
    reasons.push('direct dessert/coffee/drinks competition');
  } else if (isFood) {
    score += 20;
    reasons.push('food event that competes with café traffic');
  } else if (isFamilyEnt) {
    score += 20;
    reasons.push('family entertainment that draws our core audience');
  } else if (isFreePublic) {
    score += 18;
    reasons.push('free public event may pull casual foot traffic');
  } else if (isAdultTicketed) {
    score += 5;
    reasons.push('ticketed adult event — moderate diversion risk');
  }

  // ─── Source weight ───────────────────────────────────────────────────────
  const sw = parseInt(event.sourceWeight) || 5;
  score += sw;
  reasons.push(`source reliability weight: ${sw}`);

  // ─── Confidence adjustment ───────────────────────────────────────────────
  if (event.confidence === 'medium') score -= 5;
  if (event.confidence === 'low')    score -= 15;
  if (event.needsReview)             score -= 10;

  // ─── Risk label ──────────────────────────────────────────────────────────
  const high = config.highRiskThreshold     || 75;
  const mod  = config.moderateRiskThreshold || 45;
  const low  = config.lowRiskThreshold      || 25;

  let riskLabel;
  if (score >= high)      riskLabel = 'High';
  else if (score >= mod)  riskLabel = 'Moderate';
  else if (score >= low)  riskLabel = 'Low';
  else                    riskLabel = 'Minimal';

  // ─── Impact type ─────────────────────────────────────────────────────────
  const isClose = !isNaN(dist) && dist <= 5;
  const isCommunity = tags.some(t => ['family', 'kids', 'children', 'market', 'vendor', 'festival', 'parade', 'fireworks', 'movie night'].includes(t));
  const endsBeforeEveningPeak = end !== null && end <= 1200; // ends by 8 PM
  const notDirectComp = !isDessert && !isFood;

  let impactType;
  if (isClose && isCommunity && notDirectComp && endsBeforeEveningPeak) {
    impactType = 'Opportunity';
  } else if (isClose && isCommunity && notDirectComp) {
    impactType = 'Mixed';
  } else if ((riskLabel === 'High' || riskLabel === 'Moderate') && start !== null && start <= riskEnd) {
    impactType = 'Diversion Risk';
  } else if (score < low) {
    impactType = 'Low Relevance';
  } else {
    impactType = 'Mixed';
  }

  // ─── Why it matters ──────────────────────────────────────────────────────
  let whyParts = [];

  if (event.needsReview) {
    whyParts.push('Details need manual review before acting on this.');
  }

  if (timeNote) {
    whyParts.push(`Time note: ${timeNote}.`);
  } else if (reasons.some(r => r.includes('risk window') || r.includes('peak evening'))) {
    whyParts.push('This event overlaps the 5–9 PM window when Boba Bean sees evening traffic.');
  }

  if (distNote) {
    whyParts.push(`Location: ${distNote}.`);
  }

  if (tags.includes('family') || tags.includes('kids') || tags.includes('children')) {
    whyParts.push('Targets families and kids — a core Boba Bean audience.');
  }
  if (tags.includes('teen') || tags.includes('student') || tags.includes('school')) {
    whyParts.push('Draws teens and students who may otherwise stop in.');
  }
  if (tags.includes('free')) {
    whyParts.push('Free admission may pull casual walk-in traffic.');
  }
  if (isDessert) {
    whyParts.push('This is a direct dessert, coffee, or drinks competitor.');
  } else if (isFood) {
    whyParts.push('Food event that may satisfy the same impulse as stopping at Boba Bean.');
  }
  if (event.confidence === 'low') {
    whyParts.push('Confidence is low — this event may not be current or accurate.');
  }

  if (whyParts.length === 0) {
    whyParts.push('Low overall relevance to Boba Bean traffic patterns.');
  }

  // ─── Suggested action ────────────────────────────────────────────────────
  let suggestedAction;

  if (event.needsReview) {
    suggestedAction = 'Manual review needed before making staffing or promo decisions.';
  } else if (impactType === 'Opportunity') {
    suggestedAction = 'Post a "stop by before or after" message. Promote kids menu items and family drinks.';
  } else if (impactType === 'Mixed') {
    if (isClose) {
      suggestedAction = 'Post a 3–5 PM pre-event drink reminder to catch traffic before the event starts.';
    } else {
      suggestedAction = 'Monitor foot traffic. Consider a mild social post about the event as local context.';
    }
  } else if (riskLabel === 'High') {
    if (isDessert || isFood) {
      suggestedAction = 'Plan a counter-promo: post a 3–5 PM drink special and an after-event treat promo from 8–9 PM.';
    } else if (tags.includes('family') || tags.includes('kids')) {
      suggestedAction = 'Promote kids menu items before families leave. Post an after-event dessert reminder.';
    } else {
      suggestedAction = 'Post a 3–5 PM pre-event drink reminder. Run an after-event treat promo from 8–9 PM.';
    }
  } else if (riskLabel === 'Moderate') {
    if (end !== null && end < 960) {
      suggestedAction = 'Do not overreact — this ends before the evening window.';
    } else {
      suggestedAction = 'Watch staffing. Consider a soft social post to stay top-of-mind during the event window.';
    }
  } else if (riskLabel === 'Low') {
    suggestedAction = 'No major action needed. Keep normal operations.';
  } else {
    suggestedAction = 'Minimal impact expected. No action required.';
  }

  if (isAdultTicketed && !isFamilyEnt) {
    suggestedAction = 'Watch staffing, but this likely affects adults more than families. Limited action needed.';
  }

  // ─── Assign to event ──────────────────────────────────────────────────────
  event.score         = score;
  event.riskLabel     = riskLabel;
  event.impactType    = impactType;
  event.whyItMatters  = whyParts.join(' ');
  event.suggestedAction = suggestedAction;

  return event;
}

/**
 * Score all events in an array and return the scored array.
 */
function scoreAll(events, config) {
  return events.map(e => scoreEvent(e, config));
}

module.exports = { scoreEvent, scoreAll };
