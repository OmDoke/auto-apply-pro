# LinkedIn Post Scraper Module — Design Doc

**Date:** 2026-04-07  
**Author:** Antigravity (agentic planning session)  
**Status:** Approved ✅

---

## Overview

Add a new `linkedinPostScraper.js` agent to the auto-apply-pro system that:

- Navigates to LinkedIn's post search filtered by "Latest" (date posted)
- Scrolls up to 30× collecting hiring-related posts
- Filters by job-profile keywords and rejects negative signals
- Stops automatically when posts exceed 2 weeks in age
- Saves matching post links to `backend/data/hiring_posts.json`
- Surfaces results in the existing "Did Not Apply" page (new "Hiring Posts" tab)

---

## Architecture

```
linkedinPostScraper.js  (new agent, fits existing agent pattern)
  └── Puppeteer browser (shared userDataDir with linkedinAgent.js)
       └── Navigate to search URL (sorted by Latest)
       └── Scroll loop (max 30 scrolls, 2000ms delay each)
            └── Parse posts from DOM
            └── Check post age → stop if > 336 hours (2 weeks)
            └── Match role keywords (case-insensitive)
            └── Reject negative keywords
            └── Deduplicate via Set of post IDs
       └── Write results to hiring_posts.json

sequentialController.js  (register new agent)
api.js                   (expose GET /api/hiring-posts + DELETE /api/hiring-posts)
ManualReviewPage.tsx     (add "Hiring Posts" tab alongside "Failed Jobs")
types/index.ts           (HiringPost type, agent registration)
```

---

## Configuration (top of file, easy to change)

```js
const CONFIG = {
  maxScrolls: 30,
  scrollDelay: 2000,            // ms between scrolls
  postAgeLimitHours: 336,       // 2 weeks
  outputFile: 'hiring_posts.json',
  searchUrl: 'https://www.linkedin.com/search/results/content/?keywords=hiring&sortBy=date_posted'
};
```

---

## Data Shape

`backend/data/hiring_posts.json`:
```json
[
  {
    "link": "https://www.linkedin.com/feed/update/urn:li:activity:...",
    "postedAt": "2026-04-06T10:00:00Z",
    "snippet": "We are hiring! Looking for a React developer..."
  }
]
```

---

## Role Keywords (match ANY, case-insensitive)

- frontend, front-end, front end
- backend, back-end, back end
- full stack, fullstack, full-stack
- fresher, freshers
- entry level, entry-level
- associate
- react, react.js, reactjs
- javascript, js developer
- node.js, nodejs, node js
- next.js, nextjs
- typescript
- junior developer, junior engineer
- 0-1 year, 0-2 years, no experience required
- we are hiring, we're hiring, now hiring
- looking for, open position, apply now, join our team
- urgent hiring, immediate joining, vacancy

## Negative Keywords (skip post if ANY matched)

- 5+ years, 7+ years, 10+ years
- senior only
- not accepting freshers

---

## Age Detection Logic

LinkedIn renders relative times like "2h", "1d", "1w", "2w", "3w".
Parser converts these to hours:
- `Xh` → X hours
- `Xd` → X * 24 hours
- `Xw` → X * 168 hours
- `Xmo` / `Xm` → skip (too old, > 2 weeks)

Stop scrolling when the **oldest visible post** exceeds 336 hours.

---

## Deduplication

Use a `Set<string>` of parsed post URN IDs (extracted from the post link `urn:li:activity:XXXXX`).
On subsequent runs, also merge with existing `hiring_posts.json` IDs.

---

## Frontend Changes — ManualReviewPage

Add two tabs at the top of the "Did Not Apply" page:
- **Failed Jobs** (existing content, unchanged)
- **Hiring Posts** (new tab, lists scraped LinkedIn post links with snippet + "Open Post" link)

The badge counter on the `AgentDashboard` "Did Not Apply" button shows `failedJobs.length + hiringPosts.length`.

---

## Error Handling

| Scenario | Handling |
|---|---|
| Not logged in | Wait 60s for manual login (same as linkedinAgent) |
| Network timeout | `waitUntil: 'networkidle2'` in try/catch, continue to next scroll |
| No posts found | Log and exit cleanly with empty array |
| DOM height unchanged after scroll | Retry once, then stop (lazy load complete) |
| Post timestamp unreadable | Skip post, log warning |

---

## Files Affected

| File | Change |
|---|---|
| `backend/agents/linkedinPostScraper.js` | NEW — the scraper agent |
| `backend/data/hiring_posts.json` | NEW — output data file |
| `backend/controller/sequentialController.js` | MODIFY — register new agent |
| `backend/routes/api.js` | MODIFY — add GET/DELETE `/api/hiring-posts` |
| `frontend/src/types/index.ts` | MODIFY — add HiringPost type + agent entry |
| `frontend/src/services/api.ts` | MODIFY — add getHiringPosts / clearHiringPosts |
| `frontend/src/components/ManualReviewPage.tsx` | MODIFY — add Hiring Posts tab |
| `frontend/src/components/AgentDashboard.tsx` | MODIFY — update badge count |
| `frontend/src/App.tsx` | MODIFY — pass hiringPostsCount to dashboard |
