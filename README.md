# Boba Bean Local Event Risk Dashboard

A practical, free dashboard for **Boba Bean, Inc.** in **Concord, NC** that scans local event calendars and shows which events today, tonight, tomorrow, and this week may reduce shop traffic — especially after 5 PM.

> **This is a decision aid, not a perfect forecast.** Use it to plan social posts and staffing adjustments, not as a guaranteed prediction.

---

## What this project is

A small static website that:
- Scans local event calendars twice a day (via GitHub Actions)
- Scores events by how likely they are to pull away your customers
- Shows a simple risk dashboard you can check from your phone or computer

## What it does

- Fetches 10 curated local event websites in Concord/Cabarrus County area
- Extracts event titles, dates, times, and descriptions
- Scores each event based on: time of day, distance, audience overlap, food/dessert competition
- Labels events as: **High Risk**, **Moderate**, **Low**, **Minimal**, **Opportunity**, or **Needs Review**
- Updates automatically at 9 AM and 3 PM Eastern via GitHub Actions
- Works even when scrapers fail — your manually entered events always show up

## What it does NOT do

- Does not connect to Facebook, Instagram, or any social media
- Does not require any paid services, API keys, or accounts
- Does not predict exact revenue impact
- Does not replace your own judgment as a business owner
- Cannot parse every website perfectly — some sources may show "Partial" or "Failed"

---

## Requirements

- A **GitHub account** (free) — already set up since you're reading this
- **Node.js 20 or newer** on your computer (only needed for local use)
- A text editor (Notepad, VS Code, etc.)

---

## How to install Node.js

1. Go to **https://nodejs.org**
2. Download the **LTS** version (recommended)
3. Run the installer and follow the prompts
4. Verify by opening PowerShell or Terminal and typing:
   ```
   node --version
   ```
   You should see something like `v20.x.x`

---

## How to run locally

Open **PowerShell** (Windows) or **Terminal** (Mac), navigate to this folder, then run:

```powershell
# 1. Install dependencies (only needed once)
npm install

# 2. Validate your data files
npm run validate

# 3. Scan for events and generate events.json
npm run scan
```

The scan will take about 30–60 seconds as it contacts each website.

---

## How to view the dashboard locally

After running `npm run scan`, start a local web server:

```powershell
npm run serve
```

Then open your browser to: **http://localhost:3000**

> You cannot just double-click `index.html` — browsers block local file loading for security. The `npm run serve` command starts a small server automatically.

---

## How to edit sources

Open `public/sources.json` in a text editor.

Each source looks like this:
```json
{
  "name": "Downtown Concord",
  "url": "https://downtownconcordnc.com/event-calendar/",
  "defaultDistanceMiles": 4,
  "sourceWeight": 9,
  "audienceRelevance": "high",
  "enabled": true
}
```

- `name` — display name shown on the dashboard
- `url` — the public web page to scan
- `defaultDistanceMiles` — approximate distance from your shop (used for scoring)
- `sourceWeight` — how reliable this source is (1–10). Higher = more impact on score.
- `enabled` — set to `false` to skip this source

---

## How to disable a source

Find the source in `public/sources.json` and change `"enabled": true` to `"enabled": false`.

Example — disabling Charlotte Motor Speedway:
```json
{
  "name": "Charlotte Motor Speedway",
  "url": "https://www.charlottemotorspeedway.com/events/",
  "defaultDistanceMiles": 16,
  "sourceWeight": 8,
  "audienceRelevance": "medium-high",
  "enabled": false
}
```

---

## How to add manual events

Open `public/manual-events.json` and add events in this format:

```json
[
  {
    "id": "manual-001",
    "title": "Example School Family Night",
    "date": "2026-06-10",
    "startTime": "18:00",
    "endTime": "20:00",
    "venue": "Nearby School",
    "city": "Concord",
    "distanceMiles": 3,
    "description": "Parent and kids event near the shop",
    "source": "Manual",
    "sourceUrl": "",
    "eventUrl": "",
    "tags": ["family", "kids", "school", "evening"],
    "notes": "Manually entered because it may not appear on public calendars."
  }
]
```

**Rules:**
- `id` must be unique — use any string like `"manual-001"`, `"manual-002"`, etc.
- `date` must be in `YYYY-MM-DD` format (year-month-day)
- `startTime` and `endTime` must be in `HH:mm` 24-hour format (`"18:00"` = 6:00 PM)
- `tags` help with scoring — use values like: `family`, `kids`, `teen`, `free`, `concert`, `festival`, `food truck`, `dessert`, `parade`, `fireworks`, `sports`, `market`

After editing, run `npm run scan` to regenerate the dashboard.

---

## How to adjust scoring thresholds

Open `public/config.json`:

```json
{
  "highRiskThreshold": 75,
  "moderateRiskThreshold": 45,
  "lowRiskThreshold": 25
}
```

- Events scoring **75+** are labeled **High Risk**
- Events scoring **45–74** are labeled **Moderate**
- Events scoring **25–44** are labeled **Low**
- Events scoring below **25** are labeled **Minimal**

Lower the thresholds to see more events marked as High Risk, or raise them if too many events are flagged.

---

## How to update business coordinates

Open `public/config.json` and find:

```json
"businessLatitude": 35.4088,
"businessLongitude": -80.5795
```

To find your exact shop coordinates:
1. Open Google Maps
2. Right-click on your shop location
3. The first item shown will be the coordinates — copy them

Replace the values in `config.json` with your exact coordinates.

> Note: The current coordinates are approximate for Concord, NC. The distance scoring uses `defaultDistanceMiles` in `sources.json`, not GPS routing — so exact coordinates are not required for the dashboard to work correctly.

---

## How to deploy on GitHub Pages

1. Push this repository to GitHub (if not already done)
2. Go to your repository on GitHub
3. Click **Settings** → **Pages**
4. Under **Source**, select **Deploy from a branch**
5. Choose branch: `main`, folder: `/public`
6. Click **Save**
7. Wait 1–2 minutes, then visit: `https://yourusername.github.io/boba-bean-event-risk-dashboard`

---

## How to connect a GoDaddy subdomain

For example, to use `events.bobabean.shop`:

1. First, set up GitHub Pages (see above) and confirm it works at the default URL
2. In your GitHub Pages settings, enter your custom domain (e.g. `events.bobabean.shop`) and save
3. GitHub will create a `CNAME` file in your repo automatically
4. Log in to **GoDaddy** → **My Products** → your domain → **DNS**
5. Add a **CNAME** record:
   - **Name:** `events` (the subdomain part)
   - **Value:** `yourusername.github.io` (your GitHub Pages default URL host)
   - **TTL:** 600 seconds or default

> DNS changes can take a few minutes to a few hours to take effect. Always verify current GitHub Pages DNS instructions at **docs.github.com/pages** when connecting a custom domain, as the exact setup can change.

---

## How GitHub Actions updates the data

The file `.github/workflows/update-events.yml` runs automatically:
- Every day at **9:00 AM Eastern**
- Every day at **3:00 PM Eastern**

Each run:
1. Fetches all enabled source websites
2. Parses event candidates
3. Merges your manual events
4. Scores and sorts everything
5. Writes a new `public/events.json`
6. Commits and pushes the updated file to GitHub
7. GitHub Pages serves the updated file to your dashboard

You do not need to do anything — it runs on its own.

---

## How to manually force an update in GitHub Actions

1. Go to your repository on GitHub
2. Click **Actions** in the top navigation
3. Click **Update Event Risk Data** on the left
4. Click the **Run workflow** button (top right of the list)
5. Click the green **Run workflow** confirmation

The scan will run within about 30 seconds and update `events.json`.

---

## How to troubleshoot failed sources

On the dashboard, scroll down to **Source Health**.

Each source shows:
- **OK** — fetched and parsed successfully
- **Partial** — fetched but no events were found (site markup may have changed)
- **Failed** — could not reach the website

**Common reasons a source fails:**
- The website is temporarily down
- The website uses heavy JavaScript to load events (we can only read static HTML)
- The website changed its HTML layout
- A network timeout occurred

**What to do:**
- For a temporary failure: wait for the next scheduled scan
- For a Partial result: visit the site manually and check if events are there
- For a persistent failure: you can disable the source in `sources.json` to stop seeing the error
- To improve a parser: open `scripts/parsers.js` and find the function for that source — add more specific CSS selectors

---

## How to improve parser accuracy over time

Open `scripts/parsers.js`. Each website has its own parser function, like `parseDowntownConcord` or `parseCannonBallers`.

To improve a parser:
1. Visit the website in your browser
2. Right-click on an event listing and click **Inspect** (or Inspect Element)
3. Look for the CSS class name on the event container (e.g., `.event-card`, `.eventlist-event`)
4. Add that selector to the appropriate parser function in `parsers.js`

You can always open a GitHub Issue or ask a developer friend if you're unsure — the parsers are designed to be small and easy to update.

---

## What "Needs Review" means

A **Needs Review** badge means:
- The event was scraped but could not be verified with a clear date
- Or the event has low confidence — the text was ambiguous
- The event still shows up so you don't miss it, but you should verify it manually before making staffing or promo decisions

Manual events you add to `manual-events.json` are always treated as verified and will not get this badge.

---

## Scoring quick reference

| Factor | Points |
|---|---|
| Starts 4–8 PM | +25 |
| Overlaps 5–9 PM risk window | +20 |
| Runs past 7 PM | +10 |
| Ends before 4 PM | −20 |
| Distance 0–3 miles | +25 |
| Distance 4–7 miles | +18 |
| Distance 8–15 miles | +10 |
| Family / kids tag | +25 each |
| Free event | +15 |
| Food truck / food festival | +25 |
| Dessert / coffee / drinks competitor | +25 |
| Parade / fireworks | +25 |
| Concert / festival | +20 |
| Source weight (varies) | +5–9 |
| Low confidence | −15 |
| Needs Review | −10 |

---

## File reference

| File | Purpose |
|---|---|
| `public/index.html` | The dashboard web page |
| `public/styles.css` | Colors and layout |
| `public/app.js` | Dashboard logic (no build step) |
| `public/events.json` | Generated event data (do not edit by hand) |
| `public/manual-events.json` | Your manually entered events — **edit this one** |
| `public/sources.json` | List of event sources — enable/disable here |
| `public/config.json` | Business settings and scoring thresholds |
| `scripts/scan-events.js` | Main scan script |
| `scripts/score-events.js` | Scoring logic |
| `scripts/parsers.js` | HTML parsers for each source |
| `scripts/utils.js` | Shared helper functions |
| `scripts/validate-data.js` | Data validation checks |
| `.github/workflows/update-events.yml` | Automatic daily update schedule |

---

*Built for Boba Bean, Inc. · Concord, NC*
