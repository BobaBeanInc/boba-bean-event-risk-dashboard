// Boba Bean Event Risk Dashboard — frontend app
// Loads events.json and renders the dashboard.
// No build step required — runs directly in the browser.

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let allEvents = [];
  let activeFilter = 'all';
  let todayStr = '';
  let tomorrowStr = '';

  // ─── DOM refs ─────────────────────────────────────────────────────────────
  const loadingEl   = document.getElementById('loading-state');
  const errorEl     = document.getElementById('error-state');
  const errorMsgEl  = document.getElementById('error-message');
  const dashboardEl = document.getElementById('dashboard');
  const lastUpdEl   = document.getElementById('last-updated');
  const summaryEl   = document.getElementById('summary-cards');
  const filterBarEl = document.getElementById('filter-bar');
  const eventsListEl = document.getElementById('events-list');
  const noEventsEl  = document.getElementById('no-events-state');
  const countBadgeEl = document.getElementById('event-count-badge');
  const sourceListEl = document.getElementById('source-health-list');

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getToday() {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now);
      const get = (t) => parts.find(p => p.type === t).value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function addDaysToDate(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  }

  function formatTime(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAfter5pm(startTime) {
    if (!startTime) return false;
    const [h] = startTime.split(':').map(Number);
    return h >= 17;
  }

  // ─── Filter logic ──────────────────────────────────────────────────────────

  function filterEvents(events, filter) {
    const today     = todayStr;
    const tomorrow  = tomorrowStr;
    const weekEnd   = addDaysToDate(today, 7);

    switch (filter) {
      case 'today':
        return events.filter(e => e.date === today);
      case 'tonight':
        return events.filter(e => e.date === today && isAfter5pm(e.startTime));
      case 'tomorrow':
        return events.filter(e => e.date === tomorrow);
      case 'week':
        return events.filter(e => e.date && e.date >= today && e.date <= weekEnd);
      case 'high':
        return events.filter(e => e.riskLabel === 'High');
      case 'opportunity':
        return events.filter(e => e.impactType === 'Opportunity' || e.impactType === 'Mixed');
      case 'review':
        return events.filter(e => e.needsReview);
      default:
        return events;
    }
  }

  // Sort: dated first → date asc → score desc → needsReview last
  function sortEvents(events) {
    return [...events].sort((a, b) => {
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
      if (b.score !== a.score) return (b.score || 0) - (a.score || 0);
      if (a.needsReview && !b.needsReview) return 1;
      if (!a.needsReview && b.needsReview) return -1;
      return 0;
    });
  }

  // ─── Render summary ────────────────────────────────────────────────────────

  function renderSummary(summary) {
    const cards = [
      { label: "Today's Risk",          value: summary.todayRisk || 'Minimal',   isRisk: true },
      { label: "Tonight after 5 PM",    value: summary.tonightRisk || 'Minimal', isRisk: true },
      { label: "Tomorrow's Risk",        value: summary.tomorrowRisk || 'Minimal', isRisk: true },
      { label: "Highest Risk Day",       value: summary.weekHighestRiskDay ? formatDate(summary.weekHighestRiskDay) : 'None', isRisk: false },
      { label: "High Risk Events",       value: summary.highRiskCount ?? 0,      isRisk: false },
      { label: "Opportunities",          value: summary.opportunityCount ?? 0,   isRisk: false },
      { label: "Needs Review",           value: summary.needsReviewCount ?? 0,   isRisk: false }
    ];

    summaryEl.innerHTML = cards.map(c => `
      <div class="summary-card">
        <div class="summary-card-label">${escHtml(c.label)}</div>
        <div class="summary-card-value ${c.isRisk ? 'risk-' + escHtml(String(c.value)) : ''}">${escHtml(String(c.value))}</div>
      </div>
    `).join('');
  }

  // ─── Render events ─────────────────────────────────────────────────────────

  function riskClass(riskLabel) {
    const map = { High: 'risk-high', Moderate: 'risk-moderate', Low: 'risk-low', Minimal: 'risk-minimal' };
    return map[riskLabel] || '';
  }

  function impactClass(impactType) {
    if (!impactType) return '';
    const t = impactType.toLowerCase();
    if (t.includes('diversion')) return 'impact-diversion';
    if (t.includes('opportunity')) return 'impact-opportunity';
    if (t.includes('mixed')) return 'impact-mixed';
    return 'impact-low';
  }

  function riskBadgeClass(riskLabel) {
    return `badge badge-risk-${riskLabel || 'Minimal'}`;
  }

  function impactBadgeClass(impactType) {
    if (!impactType) return 'badge badge-impact-low';
    const t = impactType.toLowerCase();
    if (t.includes('diversion')) return 'badge badge-impact-diversion';
    if (t.includes('opportunity')) return 'badge badge-impact-opportunity';
    if (t.includes('mixed')) return 'badge badge-impact-mixed';
    return 'badge badge-impact-low';
  }

  function buildTimeString(event) {
    const s = formatTime(event.startTime);
    const e = formatTime(event.endTime);
    if (s && e) return `${s} – ${e}`;
    if (s) return `${s}`;
    return 'Time TBD';
  }

  function buildEventCard(event) {
    const dateStr     = event.date ? formatDate(event.date) : '(date unknown)';
    const timeStr     = buildTimeString(event);
    const distStr     = event.distanceMiles != null ? `~${event.distanceMiles} mi` : '';
    const venue       = event.venue || '';
    const city        = event.city || '';
    const locationStr = [venue, city].filter(Boolean).join(' · ');
    const score       = event.score != null ? event.score : '—';
    const confidence  = event.confidence || 'unknown';
    const isManual    = event.source === 'Manual';

    const cardClasses = ['event-card', riskClass(event.riskLabel), impactClass(event.impactType)].filter(Boolean).join(' ');

    const tagsHtml = Array.isArray(event.tags) && event.tags.length > 0
      ? `<div class="event-tags">${event.tags.map(t => `<span class="event-tag">${escHtml(t)}</span>`).join('')}</div>`
      : '';

    const sourceLink = event.sourceUrl
      ? `<a href="${escHtml(event.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="event-source-link">🔗 ${escHtml(event.source || 'Source')}</a>`
      : `<span>${escHtml(event.source || 'Unknown')}</span>`;

    const eventLink = event.eventUrl
      ? `<a href="${escHtml(event.eventUrl)}" target="_blank" rel="noopener noreferrer" class="event-link">View event ↗</a>`
      : '';

    const descHtml = event.description
      ? `<p class="event-description">${escHtml(event.description)}</p>`
      : '';

    const whyHtml = event.whyItMatters
      ? `<div class="event-why"><strong>Why it matters:</strong> ${escHtml(event.whyItMatters)}</div>`
      : '';

    const actionHtml = event.suggestedAction
      ? `<div class="event-action"><strong>Suggested action:</strong> ${escHtml(event.suggestedAction)}</div>`
      : '';

    return `
      <article class="${cardClasses}" role="listitem">
        <div class="event-card-header">
          <div class="event-card-badges">
            <span class="${riskBadgeClass(event.riskLabel)}">${escHtml(event.riskLabel || 'Unscored')}</span>
            <span class="${impactBadgeClass(event.impactType)}">${escHtml(event.impactType || 'Unknown')}</span>
            ${event.needsReview ? '<span class="badge badge-needs-review">⚠ Needs Review</span>' : ''}
            ${isManual ? '<span class="badge badge-manual">Manual</span>' : ''}
            <span class="badge badge-score">Score: ${escHtml(String(score))}</span>
            <span class="badge badge-confidence">${escHtml(confidence)} confidence</span>
          </div>
          <h3 class="event-title">${escHtml(event.title || 'Untitled Event')}</h3>
          <div class="event-meta">
            <span class="event-meta-item">📅 ${escHtml(dateStr)}</span>
            <span class="event-meta-item">🕐 ${escHtml(timeStr)}</span>
            ${locationStr ? `<span class="event-meta-item">📍 ${escHtml(locationStr)}</span>` : ''}
            ${distStr ? `<span class="event-meta-item">📏 ${escHtml(distStr)}</span>` : ''}
          </div>
        </div>
        <div class="event-card-body">
          ${descHtml}
          ${whyHtml}
          ${actionHtml}
        </div>
        ${tagsHtml}
        <footer class="event-card-footer">
          ${sourceLink}
          ${eventLink}
        </footer>
      </article>
    `;
  }

  function renderEvents(events) {
    const sorted   = sortEvents(events);
    const visible  = filterEvents(sorted, activeFilter);

    countBadgeEl.textContent = visible.length;

    if (visible.length === 0) {
      eventsListEl.innerHTML = '';
      noEventsEl.hidden = false;
    } else {
      noEventsEl.hidden = true;
      eventsListEl.innerHTML = visible.map(buildEventCard).join('');
    }
  }

  // ─── Render source health ──────────────────────────────────────────────────

  function renderSourceHealth(sourceHealth) {
    if (!sourceHealth || sourceHealth.length === 0) {
      sourceListEl.innerHTML = '<p class="section-description">No source health data available. Run <code>npm run scan</code> to populate.</p>';
      return;
    }

    sourceListEl.innerHTML = sourceHealth.map(s => {
      const statusClass = {
        'OK': 'status-ok', 'Failed': 'status-failed',
        'Partial': 'status-partial', 'Unknown': 'status-unknown'
      }[s.status] || 'status-unknown';

      const checkedStr = s.lastChecked
        ? new Date(s.lastChecked).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '—';

      const errorHtml = s.error
        ? `<div class="source-error">⚠ ${escHtml(s.error)}</div>`
        : '';

      return `
        <div class="source-card">
          <div class="source-card-header">
            <span class="source-name">${escHtml(s.name || 'Unknown')}</span>
            <span class="source-status ${statusClass}">${escHtml(s.status || 'Unknown')}</span>
          </div>
          <div class="source-meta">
            <span>Candidates found: <strong>${s.candidateCount ?? 0}</strong></span>
            <span>Last checked: ${escHtml(checkedStr)}</span>
            <a href="${escHtml(s.url || '#')}" target="_blank" rel="noopener noreferrer" class="source-url-link">${escHtml(s.url || '')}</a>
          </div>
          ${errorHtml}
        </div>
      `;
    }).join('');
  }

  // ─── Filter button wiring ──────────────────────────────────────────────────

  function initFilters() {
    filterBarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      const filter = btn.dataset.filter;
      if (!filter) return;

      activeFilter = filter;

      filterBarEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      renderEvents(allEvents);
    });
  }

  // ─── Last updated timestamp ────────────────────────────────────────────────

  function renderUpdatedAt(isoString) {
    if (!isoString) { lastUpdEl.textContent = 'Last updated: never — run npm run scan'; return; }
    try {
      const d = new Date(isoString);
      const str = d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
      });
      lastUpdEl.textContent = `Last updated: ${str}`;
    } catch {
      lastUpdEl.textContent = `Last updated: ${isoString}`;
    }
  }

  // ─── Show/hide helpers ─────────────────────────────────────────────────────

  function showLoading() {
    loadingEl.hidden  = false;
    errorEl.hidden    = true;
    dashboardEl.hidden = true;
  }

  function showError(msg) {
    loadingEl.hidden   = false; // keep structure but hide spinner
    loadingEl.style.display = 'none';
    errorEl.hidden     = false;
    dashboardEl.hidden = true;
    errorMsgEl.textContent = msg;
  }

  function showDashboard() {
    loadingEl.hidden   = true;
    errorEl.hidden     = true;
    dashboardEl.hidden = false;
  }

  // ─── Main load ─────────────────────────────────────────────────────────────

  async function loadData() {
    showLoading();
    todayStr    = getToday();
    tomorrowStr = addDaysToDate(todayStr, 1);

    let data;
    try {
      const resp = await fetch('events.json?_=' + Date.now());
      if (!resp.ok) throw new Error(`HTTP ${resp.status} — events.json not found`);
      data = await resp.json();
    } catch (err) {
      showError(
        `Could not load events.json: ${err.message}. ` +
        'Make sure you have run "npm run scan" at least once in your terminal.'
      );
      return;
    }

    // Validate shape
    if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
      showError('events.json is malformed. Run "npm run validate" to diagnose.');
      return;
    }

    allEvents = data.events || [];

    renderUpdatedAt(data.updatedAt);
    renderSummary(data.summary || {});
    renderSourceHealth(data.sourceHealth || []);
    initFilters();
    renderEvents(allEvents);

    showDashboard();
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', loadData);

})();
