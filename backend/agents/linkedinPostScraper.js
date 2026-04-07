// backend/agents/linkedinPostScraper.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const CONFIG = {
  maxScrolls: 30,           // max scrolls PER keyword search
  scrollDelay: 2000,        // ms between scrolls
  postAgeLimitHours: 336,   // 2 weeks = 14 × 24
  outputFile: 'hiring_posts.json',
  searchBaseUrl: 'https://www.linkedin.com/search/results/content/?sortBy=date_posted&keywords='
};

// ─── KEYWORD LISTS ────────────────────────────────────────────────────────────
// Each entry becomes its own LinkedIn search query.
// Posts are also matched against the full list for content filtering.
const ROLE_KEYWORDS = [
  'frontend', 'front-end', 'front end',
  'backend', 'back-end', 'back end',
  'full stack', 'fullstack', 'full-stack',
  'fresher', 'freshers',
  'entry level', 'entry-level',
  'associate',
  'react', 'react.js', 'reactjs',
  'javascript', 'js developer',
  'node.js', 'nodejs', 'node js',
  'next.js', 'nextjs',
  'typescript',
  'junior developer', 'junior engineer',
  '0-1 year', '0-2 years', 'no experience required',
  'we are hiring', "we're hiring", 'now hiring',
  'looking for', 'open position', 'apply now', 'join our team',
  'urgent hiring', 'immediate joining', 'vacancy'
];

const NEGATIVE_KEYWORDS = [
  '5+ years', '7+ years', '10+ years',
  'senior only', 'not accepting freshers'
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Parse LinkedIn's relative time string → hours.
 * Returns Infinity if the post is older than 2 weeks or unreadable.
 */
const parseLinkedInAge = (timeText) => {
  if (!timeText) return Infinity;
  const t = timeText.toLowerCase().trim();
  const match = t.match(/(\d+)\s*(s|m|h|d|w|mo|yr)/);
  if (!match) return Infinity;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num / 3600;
    case 'm': return num / 60;
    case 'h': return num;
    case 'd': return num * 24;
    case 'w': return num * 168;
    case 'mo': return Infinity;
    case 'yr': return Infinity;
    default:  return Infinity;
  }
};

/** Returns true if the post text matches at least one role keyword. */
const matchesRoleKeywords = (text) => {
  const lower = text.toLowerCase();
  return ROLE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
};

/** Returns true if the post text contains a negative keyword (should skip). */
const hasNegativeKeyword = (text) => {
  const lower = text.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
};

/** Load existing post links from the output file to avoid duplicates across runs. */
const loadExistingIds = (outputPath) => {
  try {
    if (fs.existsSync(outputPath)) {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      return new Set(existing.map(p => p.link));
    }
  } catch (_) {}
  return new Set();
};

/** Append new posts to the output file (merges with existing). */
const savePosts = (outputPath, newPosts) => {
  let existing = [];
  try {
    if (fs.existsSync(outputPath)) {
      existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    }
  } catch (_) {}
  const merged = [...existing, ...newPosts];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Saved ${newPosts.length} new posts. Total in file: ${merged.length}`);
};

// ─── SCRAPE ONE KEYWORD ───────────────────────────────────────────────────────
// Navigates to the LinkedIn search for `keyword`, scrolls, collects matching posts.
// Mutates `seenLinks` and `collectedPosts` in place.
const scrapeKeyword = async (page, keyword, seenLinks, collectedPosts) => {
  const url = CONFIG.searchBaseUrl + encodeURIComponent(keyword);
  console.log(`\n--- Searching: "${keyword}" ---`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (e) {
    console.log(`  Navigation timeout for "${keyword}" (non-fatal), continuing...`);
  }
  await new Promise(r => setTimeout(r, 2500));

  let scrollCount = 0;
  let reachedAgeLimit = false;

  while (scrollCount < CONFIG.maxScrolls && !reachedAgeLimit) {
    const posts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(
        '[data-urn], .search-results__list > li, .reusable-search__result-container'
      ));
      return cards.map(card => {
        const anchor = card.querySelector('a[href*="/feed/update/"], a[href*="activity"]');
        const link = anchor ? anchor.href : null;
        const textEl = card.querySelector(
          '.feed-shared-update-v2__description, .search-results-content, ' +
          '[class*="commentary"], [class*="update-components-text"]'
        );
        const snippet = textEl ? (textEl.innerText || '').trim().slice(0, 300) : '';
        const timeEl = card.querySelector(
          'time, [class*="posted-date"], [class*="timestamp"], ' +
          '.search-result__time-badge, span[aria-label*="ago"]'
        );
        const timeText = timeEl
          ? (timeEl.getAttribute('aria-label') || timeEl.innerText || '').trim()
          : '';
        return { link, snippet, timeText };
      }).filter(p => p.link);
    });

    for (const post of posts) {
      let link = post.link;
      try {
        const urlObj = new URL(link);
        link = urlObj.origin + urlObj.pathname;
      } catch (_) {}

      if (seenLinks.has(link)) continue;

      const ageHours = parseLinkedInAge(post.timeText);
      if (ageHours > CONFIG.postAgeLimitHours) {
        console.log(`  Age limit reached (${post.timeText}). Stopping this keyword.`);
        reachedAgeLimit = true;
        break;
      }

      if (hasNegativeKeyword(post.snippet)) {
        seenLinks.add(link); // mark seen so we don't re-evaluate
        continue;
      }

      if (!matchesRoleKeywords(post.snippet)) continue;

      seenLinks.add(link);
      collectedPosts.push({ link, postedAt: post.timeText, snippet: post.snippet });
      console.log(`  + ${link.slice(-55)}`);
    }

    if (reachedAgeLimit) break;

    const heightBefore = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await new Promise(r => setTimeout(r, CONFIG.scrollDelay));
    const heightAfter = await page.evaluate(() => document.body.scrollHeight);

    if (heightAfter === heightBefore) {
      await new Promise(r => setTimeout(r, 2000));
      const heightRetry = await page.evaluate(() => document.body.scrollHeight);
      if (heightRetry === heightBefore) {
        console.log(`  No more content for "${keyword}". Moving to next keyword.`);
        break;
      }
    }

    scrollCount++;
  }
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const run = async () => {
  console.log('LinkedIn Post Scraper Initializing...');
  console.log(`Config: maxScrolls=${CONFIG.maxScrolls}/keyword, ageLimitHours=${CONFIG.postAgeLimitHours}, delay=${CONFIG.scrollDelay}ms`);
  console.log(`Total keyword searches to run: ${ROLE_KEYWORDS.length}`);

  const outputPath = path.join(__dirname, '..', 'data', CONFIG.outputFile);
  const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'linkedin_profile');

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  // Global dedup set — shared across ALL keyword searches
  const seenLinks = loadExistingIds(outputPath);
  const collectedPosts = [];
  let stopped = false;

  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    try { await browser.close(); } catch (_) {}
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Auth check
    console.log('Checking auth status...');
    try {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('#global-nav', { timeout: 10000 });
      console.log('Authenticated.');
    } catch (e) {
      console.log('Not logged in. Please log in manually. Waiting 60 seconds...');
      await new Promise(r => setTimeout(r, 60000));
    }

    // Loop through EVERY role keyword as a separate search
    for (let i = 0; i < ROLE_KEYWORDS.length; i++) {
      if (stopped) break;
      console.log(`\n[${i + 1}/${ROLE_KEYWORDS.length}] Keyword: "${ROLE_KEYWORDS[i]}"`);
      await scrapeKeyword(page, ROLE_KEYWORDS[i], seenLinks, collectedPosts);
      // Short pause between keyword searches to be polite to LinkedIn
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`\nAll keywords done. ${collectedPosts.length} new unique posts collected.`);
    savePosts(outputPath, collectedPosts);

  } catch (err) {
    console.error('LinkedIn Post Scraper error:', err.message);
  } finally {
    await cleanup();
  }
};

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
