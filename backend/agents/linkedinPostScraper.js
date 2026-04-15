// backend/agents/linkedinPostScraper.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const CONFIG = {
  maxScrolls: 50,           // max scrolls PER keyword search
  scrollDelay: 1800,        // ms between scrolls
  postAgeLimitHours: 504,   // 3 weeks = 21 × 24
  outputFile: 'hiring_posts.json',
  searchBaseUrl: 'https://www.linkedin.com/search/results/content/?sortBy=%22date_posted%22&keywords='
};

// ─── KEYWORD LISTS ────────────────────────────────────────────────────────────
// Each entry becomes its own LinkedIn search query.
// Posts are also matched against the full list for content filtering.
const ROLE_KEYWORDS = [
  // Core role searches
  'frontend developer hiring',
  'backend developer hiring',
  'full stack developer hiring',
  'react developer hiring',
  'node.js developer hiring',
  'javascript developer hiring',
  'software engineer hiring',
  'junior developer hiring',
  'fresher developer hiring',
  // Direct outreach keywords
  'we are hiring developer',
  "we're hiring engineer",
  'now hiring software',
  'urgent hiring developer',
  'immediate joining developer',
  'open to work developer',
  'apply now developer',
  'join our team developer',
  // Email CTA keywords — maximize email capture
  'send resume to',
  'share cv at',
  'share resume at',
  'mail your cv',
  'email your resume',
  'drop your cv',
  'apply at hr@',
  'send cv to hr',
  'contact hr for',
  // Skill-specific
  'react.js fresher',
  'reactjs developer 0-2 years',
  'node.js fresher',
  'javascript fresher',
  'mern stack fresher',
  'mern stack developer',
  'full stack fresher',
  'entry level software',
  'associate software engineer',
  // Location-specific (Pune/India market)
  'hiring pune developer',
  'pune frontend developer',
  'pune full stack',
  'remote developer india',
  'work from home developer india'
];

const NEGATIVE_KEYWORDS = [
  '5+ years', '7+ years', '10+ years',
  'senior only', 'not accepting freshers'
];

// Simple individual tokens to match — ANY one of these in the post is enough
const MATCH_TOKENS = [
  'hiring', 'we are hiring', "we're hiring", 'now hiring',
  'looking for', 'open position', 'job opening', 'vacancy',
  'apply now', 'send resume', 'send cv', 'share cv', 'drop cv',
  'frontend', 'front-end', 'full stack', 'fullstack', 'backend',
  'react', 'node.js', 'nodejs', 'javascript', 'mern',
  'fresher', 'entry level', 'junior developer', 'junior engineer',
  'immediate joining', 'urgent requirement', 'urgent hiring',
  'reactjs', 'react.js', 'next.js', 'typescript',
  '0-1 year', '0-2 year', 'no experience', 'freshers welcome',
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Parse LinkedIn's relative time string → hours.
 * Returns Infinity if the post is older than 2 weeks or unreadable.
 */
const parseLinkedInAge = (timeText) => {
  if (!timeText) return 0; // If we can't find the time, assume it is NEW (0h) to avoid bailing
  const t = timeText.toLowerCase().trim();
  const match = t.match(/(\d+)\s*(s|m|h|d|w|mo|yr)/);
  if (!match) return 0; 
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num / 3600;
    case 'm': return num / 60;
    case 'h': return num;
    case 'd': return num * 24;
    case 'w': return num * 168;
    case 'mo': return 720; // ~30 days, definitely old
    case 'yr': return 8760; // 1 year
    default: return 0;
  }
};

/** Returns true if the post text matches at least one role keyword. */
const matchesRoleKeywords = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MATCH_TOKENS.some(token => lower.includes(token));
};

/** Returns true if the post text contains a negative keyword (should skip). */
const hasNegativeKeyword = (text) => {
  if (!text) return false;
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
  } catch (_) { }
  return new Set();
};

/** Append new posts to the output file (merges with existing). */
const savePosts = (outputPath, newPosts) => {
  let existing = [];
  try {
    if (fs.existsSync(outputPath)) {
      existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    }
  } catch (_) { }
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  Navigation timeout for "${keyword}" (non-fatal), continuing...`);
  }

  // Wait for search results or generic content (up to 15 seconds)
  // We wait for structural tags since classes are obfuscation-prone
  const resultsSelector = 'main li, main article, main div[data-view-name], main div[class*="result"]';

  try {
    await page.waitForSelector(resultsSelector, { timeout: 15000 });
  } catch (_) {
    console.log(`  No results container found for "${keyword}". Skipping.`);
    // Debug info
    const pageTitle = await page.title();
    console.log(`  [debug] Page title: "${pageTitle}"`);
    console.log(`  [debug] URL: ${page.url()}`);
    return;
  }

  await new Promise(r => setTimeout(r, 4000)); // allow more time for results to settle

  let scrollCount = 0;
  let reachedAgeLimit = false;

  while (scrollCount < CONFIG.maxScrolls && !reachedAgeLimit) {
    const evaluation = await page.evaluate(() => {
      // 1. Broadly find all potential meaningful links in main
      const allLinks = Array.from(document.querySelectorAll('main a, .scaffold-layout__main a'));
      const hrefs = allLinks.map(a => a.href).filter(h => h.length > 5);

      // 2. Identification Patterns
      // We prioritize post links, but fall back to author profile links as unique anchors
      const POST_PATTERNS = ['/feed/update/', '/activity/', '/news/', '/posts/', '/update/urn:li:activity:'];
      const AUTHOR_PATTERNS = ['/in/'];
      const EXTERNAL_LINK_PATTERNS = ['lnkd.in', 'safety/go', 'jobs.'];

      const postAnchors = allLinks.filter(a => POST_PATTERNS.some(p => a.href.includes(p)));
      const authorAnchors = allLinks.filter(a => AUTHOR_PATTERNS.some(p => a.href.includes(p)));

      // 3. Map cards (closest structural containers)
      const cardMap = new Map();
      const addCard = (anchor, type) => {
        // Find the absolute container for this item
        const card = anchor.closest('li, article, div[data-view-name], [class*="result-container"], [componentkey]') || anchor.parentElement;
        if (card && !cardMap.has(card)) {
          cardMap.set(card, { anchor, type });
        }
      };

      postAnchors.forEach(a => addCard(a, 'direct_post_link'));
      // ALWAYS use author anchors as cards if they aren't already grouped,
      // as the obfuscated view often hides the post link.
      authorAnchors.forEach(a => addCard(a, 'author_link'));

      const cards = Array.from(cardMap.keys());
      const rawCount = cards.length;

      const posts = cards.map(card => {
        const info = cardMap.get(card);
        
        // ── Link Identification ──
        // Try direct link, then external links found in the card, then author profile
        let link = info.type === 'direct_post_link' ? info.anchor.href : null;
        if (!link) {
          const extLink = Array.from(card.querySelectorAll('a')).find(a => EXTERNAL_LINK_PATTERNS.some(p => a.href.includes(p)));
          if (extLink) link = extLink.href;
        }
        if (!link) {
          const authLink = card.querySelector('a[href*="/in/"]');
          if (authLink) link = authLink.href;
        }

        // ── Post Snippet (Text) ──
        // Try precise selector, then fall back to all text in the card
        const snippetEl = card.querySelector('[data-testid="expandable-text-box"]');
        let fullSnippet = '';
        if (snippetEl) {
          fullSnippet = (snippetEl.innerText || snippetEl.textContent || '').trim().replace(/\s+/g, ' ');
        } else {
          // Fallback: Grab all spans and ps and join them
          const fragments = Array.from(card.querySelectorAll('span, p')).map(el => (el.innerText || el.textContent || '').trim());
          fullSnippet = fragments.filter(f => f.length > 5).join(' ').slice(0, 1500);
        }

        // ── Author Info ──
        const authorAnchor = card.querySelector('a[href*="/in/"]');
        const authorName = authorAnchor ? (authorAnchor.innerText || authorAnchor.textContent || '').trim().split('\n')[0] : '';
        const authorProfileUrl = authorAnchor ? authorAnchor.href : '';

        // ── Heuristic Time Detection ──
        // Scan all short text nodes for patterns like "7m", "2h", "1d"
        const allText = (card.innerText || '').slice(0, 500);
        const timeMatch = allText.match(/(?:\s|^)(\d+[smhdw])(?:\s|•|$)/);
        const timeText = timeMatch ? timeMatch[1] : '';

        return { link, fullSnippet, timeText, authorName, authorTitle: '', authorProfileUrl };
      });

      const filtered = posts.filter(p => p.link && p.link.includes('linkedin.com') && p.fullSnippet.length > 20);
      return { 
        rawCount, 
        filteredCount: filtered.length, 
        posts: filtered, 
        sampleHrefs: hrefs.slice(0, 10) 
      };
    });

    const { rawCount, filteredCount, posts, sampleHrefs } = evaluation;

    // Report discovery
    console.log(`  [scroll ${scrollCount}] Cards: ${rawCount} | Valid Posts: ${filteredCount}`);
    
    if (rawCount > 0 && filteredCount === 0) {
      console.log(`  [debug] All ${rawCount} cards filtered out. Sample data:`);
      // Log some info about the first card to debug filter
      const firstCard = evaluation.posts[0] || {};
      console.log(`    - Snippet: ${firstCard.fullSnippet?.slice(0, 50)}...`);
    }

    for (const post of posts) {
      let link = post.link;
      // Normalize URL FIRST — before any seenLinks check
      try {
        const urlObj = new URL(link);
        link = urlObj.origin + urlObj.pathname;
      } catch (_) { }

      // NOW check dedup with the normalized URL
      if (seenLinks.has(link)) {
        console.log(`  - Skip: Duplicate link`);
        continue;
      }

      const ageHours = parseLinkedInAge(post.timeText);
      if (ageHours > CONFIG.postAgeLimitHours && post.timeText.length > 0) {
        console.log(`  Age limit reached (${post.timeText}). Stopping keyword search.`);
        reachedAgeLimit = true;
        break;
      }

      if (hasNegativeKeyword(post.fullSnippet)) {
        console.log(`  - Skip: Negative keyword found`);
        seenLinks.add(link);
        continue;
      }

      if (!matchesRoleKeywords(post.fullSnippet)) {
        console.log(`  - Skip: No hiring keywords in snippet (${post.fullSnippet.slice(0, 40)}...)`);
        continue;
      }

      // Extract emails from snippet
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const rawEmails = post.fullSnippet.match(emailRegex) || [];
      const emails = [...new Set(rawEmails.map(e => e.replace(/[.,;:!?]+$/, '').toLowerCase()))];

      // Extract phone numbers (Indian + international formats)
      const phoneRegex = /(?<!\d)(?:\+91[\s\-]?)?[6-9]\d{9}(?!\d)|(?<!\d)(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}(?!\d)/g;
      const phones = [...new Set((post.fullSnippet.match(phoneRegex) || []))];

      // Heuristic: extract job title from snippet
      const jobTitleMatch = post.fullSnippet.match(
        /(?:hiring|looking for|position[:\s]+|role[:\s]+|opening[:\s]+|vacancy[:\s]+)\s*(?:a\s+)?([A-Za-z][A-Za-z\s\/\-\.]{3,50}?)(?:\s*[\|\-,\n!]|developer|engineer|designer|analyst|intern|lead)/i
      );
      const jobTitle = jobTitleMatch ? jobTitleMatch[1].trim() : '';

      // Heuristic: extract company name from snippet
      const companyMatch = post.fullSnippet.match(
        /(?:at|@|from|company[:\s]+|organisation[:\s]+|firm[:\s]+)\s+([A-Z][A-Za-z\s&\.]{2,40}?)(?:\s*[\|\-,\n!])/
      );
      const company = companyMatch ? companyMatch[1].trim() : '';

      // Clean author profile URL — strip tracking params
      let authorProfileUrl = post.authorProfileUrl;
      try {
        if (authorProfileUrl) {
          const profileUrlObj = new URL(authorProfileUrl);
          authorProfileUrl = profileUrlObj.origin + profileUrlObj.pathname;
        }
      } catch (_) { }

      seenLinks.add(link);
      collectedPosts.push({
        link,
        postedAt: post.timeText,
        snippet: post.fullSnippet.slice(0, 300),   // keep short preview
        fullText: post.fullSnippet,
        authorName: post.authorName,
        authorTitle: post.authorTitle,
        authorProfileUrl,
        emails,
        phones,
        jobTitle,
        company,
        scrapedAt: new Date().toISOString()
      });
      console.log(`  + ${link.slice(-55)}`);
    }

    if (reachedAgeLimit) break;

    // Scroll the correct LinkedIn container and wait for new content
    const scrolled = await page.evaluate(() => {
      // LinkedIn search results use a scrollable inner container
      const scrollContainerSelectors = [
        '.search-results-container',
        '.scaffold-layout__main',
        '.artdeco-list',
        'main',
        '.application-outlet',
      ];

      let container = null;
      for (const sel of scrollContainerSelectors) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight) {
          container = el;
          break;
        }
      }

      if (container) {
        const before = container.scrollTop;
        container.scrollBy(0, 800);
        return { usedContainer: true, before, after: container.scrollTop, scrollHeight: container.scrollHeight };
      } else {
        // Fallback: scroll window
        window.scrollBy(0, 800);
        return { usedContainer: false, scrollHeight: document.body.scrollHeight };
      }
    });

    // Also always scroll window as secondary signal
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, CONFIG.scrollDelay));

    // Wait for new cards to appear — LinkedIn lazy-loads on scroll
    const countBefore = posts.length;
    await new Promise(r => setTimeout(r, 500));

    // Check if new content loaded by counting cards (using link-first logic)
    const newCardCount = await page.evaluate(() => {
      const postAnchors = Array.from(document.querySelectorAll('a[href*="/feed/update/"], a[href*="/activity/"], a[href*="/news/"]'));
      const cardSet = new Set();
      postAnchors.forEach(a => {
        const card = a.closest('li, article, div[data-view-name], .reusable-search__result-container') || a.parentElement;
        if (card) cardSet.add(card);
      });
      return cardSet.size;
    });

    if (newCardCount <= countBefore && scrollCount > 0) {
      // No new cards appeared — wait longer and try again
      await new Promise(r => setTimeout(r, 2500));
      const retryCount = await page.evaluate(() => {
        const postAnchors = Array.from(document.querySelectorAll('a[href*="/feed/update/"], a[href*="/activity/"], a[href*="/news/"]'));
        const cardSet = new Set();
        postAnchors.forEach(a => {
          const card = a.closest('li, article, div[data-view-name], .reusable-search__result-container') || a.parentElement;
          if (card) cardSet.add(card);
        });
        return cardSet.size;
      });
      if (retryCount <= countBefore) {
        console.log(`  No new content loaded after scroll. Moving to next keyword.`);
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
    // Save whatever we collected before shutting down
    if (collectedPosts.length > 0) {
      console.log(`Saving ${collectedPosts.length} posts collected before shutdown...`);
      savePosts(outputPath, collectedPosts);
    }
    try { await browser.close(); } catch (_) { }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Auth check
    console.log('Checking auth status...');
    try {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

      // Intermediate save every 5 keywords
      if ((i + 1) % 5 === 0 && collectedPosts.length > 0) {
        console.log(`[Checkpoint] Saving ${collectedPosts.length} posts after keyword ${i + 1}...`);
        savePosts(outputPath, collectedPosts);
        collectedPosts.length = 0; // clear after save to avoid re-saving same posts
        // Reload seenLinks from file to stay in sync
        const freshSeen = loadExistingIds(outputPath);
        freshSeen.forEach(id => seenLinks.add(id));
      }

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
