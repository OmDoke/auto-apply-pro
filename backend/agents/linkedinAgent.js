const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const cfg = require('./linkedin/config');
const tracker = require('./linkedin/tracker');
const { attemptApply, discardModal, findEasyApplyButton, installPageHelpers } = require('./linkedin/applyFlow');
const { sleep, randInt } = require('./linkedin/formFields');
const { shouldApplyToJob } = require('../utils/jobMatcher');
const { getResumeText }    = require('../utils/resumeQA');
const { generateTailoredResume } = require('../utils/resumeGenerator');

// ---------------------------------------------------------------------------
// Logging helpers — timestamp + elapsed timer
// ---------------------------------------------------------------------------
// ts() → "[HH:MM:SS.mmm]" prefix for every log line
const ts = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `[${hh}:${mm}:${ss}.${ms}]`;
};

const timer = () => Date.now();
const elapsed = (start) => `(${Date.now() - start}ms)`;

// Wrap the native console.log to auto-prepend timestamp
const _log = console.log.bind(console);
console.log = (...args) => _log(ts(), ...args);

// Load answers fresh from disk (called at the start of each run)
const loadAnswers = () => {
    try {
        if (fs.existsSync(cfg.answersPath)) {
            return JSON.parse(fs.readFileSync(cfg.answersPath, 'utf8'));
        }
    } catch (err) {
        console.error('Could not parse answers.json:', err);
    }
    return {};
};

const searchUrlFor = (title) =>
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(title)}` +
    `&location=${encodeURIComponent(cfg.location)}&f_AL=true&f_E=${encodeURIComponent(cfg.experienceLevels)}`;

// ---------------------------------------------------------------------------
// Search-page + job-page helpers
// ---------------------------------------------------------------------------
// LinkedIn's job-list markup changes often, so we don't click cards. We collect job IDs from the
// search page (links, data attributes, embedded JSON) and open each job directly at /jobs/view/<id>.
const collectJobIds = (page) => page.evaluate(() => {
    const ids = new Set();
    const add = (v) => { if (v && /^\d{8,}$/.test(v)) ids.add(v); };
    document.querySelectorAll('[data-occludable-job-id], [data-job-id]').forEach(el =>
        add(el.getAttribute('data-occludable-job-id') || el.getAttribute('data-job-id')));
    // New layout (/jobs/search-results/): <div role="button" componentkey="job-card-component-ref-<id>">
    document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach(el =>
        add(el.getAttribute('componentkey').slice('job-card-component-ref-'.length)));
    document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').forEach(a => {
        const href = a.getAttribute('href') || '';
        add((href.match(/\/jobs\/view\/(?:[^/?]*-)?(\d+)/) || href.match(/currentJobId=(\d+)/) || [])[1]);
    });
    const html = document.documentElement.innerHTML;
    for (const m of html.matchAll(/(?:fsd_jobPosting|jobPosting|fs_normalized_jobPosting)[:%3A]+(\d{8,})/g)) add(m[1]);
    return Array.from(ids);
});

// Scroll every scrollable container (the result list is lazy-loaded) so more jobs render
const scrollResults = async (page) => {
    for (let i = 0; i < 6; i++) {
        await page.evaluate(() => {
            window.scrollBy(0, 800);
            document.querySelectorAll('*').forEach(el => {
                if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop += 800;
            });
        });
        await sleep(600);
    }
};

// Wait until job IDs appear on the search page, scrolling to load the full list
const waitForJobIds = async (page, timeout = 20000) => {
    const end = Date.now() + timeout;
    let ids = [];
    while (Date.now() < end) {
        ids = await collectJobIds(page).catch(() => []);
        if (ids.length) break;
        await sleep(1000);
    }
    if (!ids.length) return ids;
    await scrollResults(page);
    return collectJobIds(page).catch(() => ids);
};

// Save a screenshot + HTML and log what the page looks like, so new selectors can be found
const dumpedPages = new Set();
const dumpPage = async (page, label) => {
    if (dumpedPages.has(label)) return; // one dump per kind per run
    dumpedPages.add(label);
    try {
        const info = await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            h1: (document.querySelector('h1') || {}).innerText || null,
            jobLinks: document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').length,
            noResults: /no matching jobs|no results found|we couldn.t find/i.test(document.body.innerText || ''),
            authwall: /authwall|login|checkpoint/i.test(location.pathname),
        }));
        console.log(`  Page diagnostics (${label}): ${JSON.stringify(info)}`);
        fs.mkdirSync(cfg.screenshotDir, { recursive: true });
        const base = path.join(cfg.screenshotDir, `debug-${label}-${Date.now()}`);
        await page.screenshot({ path: `${base}.png`, fullPage: false });
        fs.writeFileSync(`${base}.html`, await page.content());
        console.log(`  Saved ${base}.png / .html — use these to update selectors.`);
    } catch (e) {
        console.log('  Could not save page diagnostics:', e.message);
    }
};

// New search layout (/jobs/search-results/): cards carry no job ID, only the selected job's
// currentJobId is in the URL. Click each card and read the ID from the URL.
const harvestIdsByClicking = async (page, max = 30) => {
    const count = await page.evaluate(() => {
        document.querySelectorAll('[data-aa-card]').forEach(el => el.removeAttribute('data-aa-card'));
        const cands = Array.from(document.querySelectorAll('main [role="button"], main a, main li, main [componentkey]'))
            .filter(el => {
                const t = el.innerText || '';
                return /easy apply/i.test(t) && !/^\s*easy apply\s*$/i.test(t) && t.length < 800 && el.offsetParent !== null;
            });
        // keep the innermost card-sized element of each nested group
        const cards = cands.filter(el => !cands.some(o => o !== el && el.contains(o)));
        cards.forEach((el, i) => el.setAttribute('data-aa-card', String(i)));
        return cards.length;
    });
    const ids = [];
    for (let i = 0; i < Math.min(count, max); i++) {
        const card = await page.$(`[data-aa-card="${i}"]`);
        if (!card) continue;
        const before = new URL(page.url()).searchParams.get('currentJobId');
        await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await card.click().catch(() => card.evaluate(el => el.click()));
        await page.waitForFunction((prev) => {
            const id = new URL(location.href).searchParams.get('currentJobId');
            return id && id !== prev;
        }, { timeout: 4000, polling: 200 }, before).catch(() => {});
        const id = new URL(page.url()).searchParams.get('currentJobId');
        if (id && !ids.includes(id)) ids.push(id);
        await sleep(300 + Math.random() * 300);
    }
    return ids;
};

const TITLE_SELECTOR = '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .t-24, h1';

// Wait until the job page has rendered (old title element, or the new layout's "About the job" / Easy Apply)
const waitForJobPage = (page) => page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) return true;
    return Array.from(document.querySelectorAll('h2, h3')).some(h => /about the job/i.test(h.innerText || '')) ||
        !!document.querySelector('button[aria-label*="Easy Apply" i]');
}, { timeout: 15000, polling: 300 }, TITLE_SELECTOR).then(() => true, () => false);

const readJobPane = (page) => page.evaluate((titleSel) => {
    // New layout uses hashed class names; document.title is "<Title> | <Company> | LinkedIn"
    const parts = document.title.split(' | ').map(s => s.trim());
    const fromTitle = parts.length >= 3 ? { title: parts[0], company: parts[1] } : {};

    const titleEl = document.querySelector(titleSel);
    const companyEl =
        document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
        document.querySelector('.jobs-unified-top-card__company-name') ||
        document.querySelector('.job-details-jobs-unified-top-card__primary-description a') ||
        document.querySelector('.job-details-jobs-unified-top-card__primary-description');
    let jdEl = document.querySelector(
        '#job-details, .jobs-description__content, .jobs-description-content__text, ' +
        '.job-details-jobs-unified-top-card__job-description, article.jobs-description'
    );
    if (!jdEl) {
        // New layout: the expandable text box under the "About the job" heading
        const h = Array.from(document.querySelectorAll('h2, h3')).find(e => /about the job/i.test(e.innerText || ''));
        for (let p = h && h.parentElement; p && !jdEl; p = p.parentElement) {
            jdEl = p.querySelector('[data-testid="expandable-text-box"]');
        }
    }
    const company = companyEl ? companyEl.innerText.trim().split('\n')[0] : '';
    return {
        title: (titleEl && titleEl.innerText.trim().split('\n')[0]) || fromTitle.title || 'Unknown Job',
        company: company || fromTitle.company || 'Unknown Company',
        url: window.location.href,
        // textContent includes the text hidden behind "… more"
        jobDescription: jdEl ? (jdEl.textContent || jdEl.innerText).trim() : ''
    };
}, TITLE_SELECTOR);

// No Easy Apply button: distinguish "already applied" from closed/external jobs
const paneShowsApplied = (page) => page.evaluate(() => {
    const top = document.querySelector('.job-details-jobs-unified-top-card__container--two-pane, .jobs-unified-top-card, .job-details-jobs-unified-top-card') || document.body;
    return /\bApplied\s+\d+\s+(second|minute|hour|day|week|month)s?\s+ago\b/i.test(top.innerText || '') ||
        !!top.querySelector('.artdeco-inline-feedback--success');
});

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
const run = async () => {
    console.log('LinkedIn Agent Initializing...');
    // Tell the controller this agent reports outcomes over IPC
    if (process.send) process.send({ type: 'ready', ipcOutcomes: true });

    const presetAnswers = loadAnswers();
    console.log(`Loaded ${Object.keys(presetAnswers).length} answer(s) from answers.json`);

    const alreadyToday = tracker.appliedTodayCount();
    console.log(`Daily limit: ${alreadyToday}/${cfg.dailyLimit} LinkedIn applications already today.`);
    if (alreadyToday >= cfg.dailyLimit) {
        console.log('Daily limit reached — nothing to do today.');
        return;
    }

    // Regenerate the clean base resume (per-job tailored copies never overwrite it)
    try {
        await generateTailoredResume(null, cfg.baseResumePath);
    } catch (err) {
        console.log('  ⚠️ Could not regenerate base resume (using existing file):', err.message);
    }

    const launchOptions = {
        headless: false,
        executablePath: cfg.chromePath,
        userDataDir: cfg.userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    };
    if (cfg.hideAutomationFlags) {
        launchOptions.args.push('--disable-blink-features=AutomationControlled');
        launchOptions.ignoreDefaultArgs = ['--enable-automation'];
    }
    // LINKEDIN_CDP_URL (e.g. http://localhost:9222) → attach to the user's own logged-in Chrome
    // started with --remote-debugging-port, instead of launching a fresh profile
    const browser = cfg.cdpUrl
        ? await puppeteer.connect({ browserURL: cfg.cdpUrl, defaultViewport: null })
        : await puppeteer.launch(launchOptions);
    if (cfg.cdpUrl) console.log(`Attached to existing Chrome at ${cfg.cdpUrl}`);
    let page;
    // Never close the user's own browser — only our tab
    const closeBrowser = async () => {
        if (!cfg.cdpUrl) return browser.close();
        if (page) await page.close().catch(() => {});
        browser.disconnect();
    };

    let stopped = false;
    const stop = async (why) => {
        if (stopped) return;
        stopped = true;
        console.log(`${why} Closing browser...`);
        try { await closeBrowser(); } catch (_) {}
    };
    process.on('SIGINT', () => stop('Stop signal received.'));
    process.on('SIGTERM', () => stop('Stop signal received.'));
    // Dashboard Stop arrives over IPC (signals don't reach handlers on Windows)
    process.on('message', (m) => { if (m && m.type === 'stop') stop('Stop requested from dashboard.'); });

    const stats = { applied: 0, unconfirmed: 0, skipped: 0, needsAnswer: 0, failed: 0 };

    const limitReason = () => {
        if (stats.applied + stats.unconfirmed >= cfg.maxApplicationsPerRun) return `per-run limit of ${cfg.maxApplicationsPerRun}`;
        if (tracker.appliedTodayCount() + stats.unconfirmed >= cfg.dailyLimit) return `daily limit of ${cfg.dailyLimit}`;
        return null;
    };

    // Persist + log one job outcome
    const finishJob = (jobInfo, status, reason, extra = {}) => {
        const icon = { applied: '✅', unconfirmed: '❓', skipped: '⏭️ ', needs_answer: '📝', failed: '✗' }[status] || '-';
        console.log(`  ${icon} [${status.toUpperCase()}] "${jobInfo.title}" at ${jobInfo.company} — ${reason}`);
        tracker.recordOutcome({ jobId: jobInfo.jobId, title: jobInfo.title, company: jobInfo.company, status, reason, ...extra });
        if (['failed', 'needs_answer', 'unconfirmed'].includes(status)) {
            tracker.appendFailedJob({ jobId: jobInfo.jobId, title: jobInfo.title, company: jobInfo.company, url: jobInfo.url, reason });
        }
        if (status === 'skipped') stats.skipped++;
        if (status === 'needs_answer') stats.needsAnswer++;
        if (status === 'failed') stats.failed++;
    };

    // Random gap after each submission; longer break every N applications
    const cooldown = async () => {
        const n = stats.applied + stats.unconfirmed;
        let ms = randInt(cfg.applyGapMinMs, cfg.applyGapMaxMs);
        if (cfg.longBreakEvery > 0 && n % cfg.longBreakEvery === 0) ms = randInt(cfg.longBreakMinMs, cfg.longBreakMaxMs);
        console.log(`  💤 Cooling down ${Math.round(ms / 1000)}s before the next application...`);
        const end = Date.now() + ms;
        while (!stopped && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
    };

    try {
        page = await browser.newPage();
        await installPageHelpers(page);
        if (!cfg.cdpUrl) await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to LinkedIn Jobs...');
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Checking authentication status...');
        const loggedIn = async () => (await page.cookies('https://www.linkedin.com')).some(c => c.name === 'li_at') &&
            !/login|authwall|checkpoint/i.test(new URL(page.url()).pathname);
        if (await loggedIn()) {
            console.log('Successfully authenticated!');
        } else {
            console.log("Please log in manually if you haven't. Waiting up to 60 seconds...");
            const end = Date.now() + 60000;
            while (Date.now() < end && !(await loggedIn().catch(() => false))) await sleep(2000);
        }

        const resumeText = await getResumeText();
        const screeningPrefs = cfg.screening;
        console.log(`Screening config: minMatchScore=${screeningPrefs.minMatchScore}% | skills=[${screeningPrefs.skills.join(', ')}]`);
        console.log(`Excluded companies: [${screeningPrefs.excludeCompanies.join(', ')}] | keywords: [${screeningPrefs.excludeKeywords.join(', ')}]`);
        console.log(`Strict answers: ${cfg.strictAnswers} | Tailor resume: ${cfg.tailorResume} | Per-run cap: ${cfg.maxApplicationsPerRun}`);

        // ── Process a single job (opened directly by ID) ────────────────────
        const processJob = async (jobId) => {
            const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
            let jobInfo = { jobId, title: 'Unknown Job', company: 'Unknown Company', url: jobUrl };

            // Hidden tabs are throttled hard by Chrome (timers, rendering) — keep ours in front
            await page.bringToFront().catch(() => {});
            await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            if (!(await waitForJobPage(page))) {
                await dumpPage(page, 'job-page');
                return finishJob(jobInfo, 'skipped', 'Job page did not load');
            }
            await sleep(1000 + Math.random() * 500); // let the description render

            jobInfo = { ...jobInfo, ...(await readJobPane(page)), jobId };
            console.log(`  Job: "${jobInfo.title}" at ${jobInfo.company} (id ${jobInfo.jobId})`);

            // Already-applied jobs have no Easy Apply button — LinkedIn is the source of truth
            if (!(await findEasyApplyButton(page))) {
                const applied = await paneShowsApplied(page);
                if (!applied) await dumpPage(page, 'no-easy-apply');
                return finishJob(jobInfo, 'skipped', applied ? 'Already applied (LinkedIn)' : 'No Easy Apply button (closed or external)');
            }

            // ── Screening: rule filter (incl. excluded companies) + Gemini score ──
            const screening = await shouldApplyToJob(jobInfo, screeningPrefs, resumeText);
            const scoreTag = screening.matchScore !== null ? ` (score: ${screening.matchScore}%)` : '';
            if (!screening.shouldApply) {
                return finishJob(jobInfo, 'skipped', `Screening${scoreTag}: ${screening.reason}`, { matchScore: screening.matchScore });
            }
            console.log(`  ✅  [APPLY]${scoreTag} ${screening.reason}`);

            // ── Tailored resume in its own folder; base resume on any failure ──
            let resumeForJob = cfg.baseResumePath;
            if (cfg.tailorResume && jobInfo.jobDescription) {
                const out = path.join(cfg.tailoredDir, String(jobInfo.jobId || Date.now()), cfg.resumeFileName);
                try {
                    const resumeStart = timer();
                    resumeForJob = await generateTailoredResume(jobInfo.jobDescription, out);
                    console.log(`  ✔ Resume tailored & ready ${elapsed(resumeStart)}`);
                } catch (err) {
                    resumeForJob = cfg.baseResumePath;
                    console.log('  ⚠️ Resume tailoring failed — using base resume:', err.message);
                }
            }

            // ── Apply: retry only transient failures, never after Submit was clicked ──
            let result;
            for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
                if (attempt > 1) {
                    await discardModal(page);
                    await sleep(2000 + Math.random() * 1000);
                }
                const applyStart = timer();
                try {
                    result = await attemptApply(page, jobInfo, attempt, presetAnswers, resumeForJob);
                } catch (e) {
                    if (stopped) return;
                    result = jobInfo.submitClicked
                        ? { status: 'unconfirmed', reason: `Error after Submit click: ${e.message} — verify manually` }
                        : { status: 'failed', reason: `Exception: ${e.message}`, retryable: /timeout|detached|destroyed/i.test(e.message) };
                }
                console.log(`  ⏱  Apply attempt took ${elapsed(applyStart)}`);
                if (result.status !== 'failed' || !result.retryable || jobInfo.submitClicked) break;
                if (attempt < cfg.maxAttempts) console.log(`  Attempt ${attempt} failed (${result.reason}). Retrying...`);
            }

            const extra = { screenshot: result.screenshot, matchScore: screening.matchScore };
            switch (result.status) {
                case 'submitted':
                    stats.applied++;
                    tracker.recordAppliedJob(jobInfo);
                    console.log(`  ✓ Applied! Total so far: ${stats.applied} (today: ${tracker.appliedTodayCount()}/${cfg.dailyLimit})`);
                    finishJob(jobInfo, 'applied', result.reason, extra);
                    break;
                case 'unconfirmed':
                    stats.unconfirmed++;
                    await discardModal(page);
                    finishJob(jobInfo, 'unconfirmed', result.reason, extra);
                    break;
                case 'needs_answer':
                    tracker.logUnanswered(result.unanswered, jobInfo);
                    finishJob(jobInfo, 'needs_answer', result.reason, extra);
                    break;
                case 'skipped':
                    finishJob(jobInfo, 'skipped', result.reason, extra);
                    break;
                default:
                    await discardModal(page);
                    finishJob(jobInfo, 'failed', result.reason, extra);
            }

            if (result.status === 'submitted' || result.status === 'unconfirmed') {
                if (!limitReason()) await cooldown();
            }
        };

        // ── Search each job title and walk its result pages ─────────────────
        // Pages are loaded by URL (start=0,25,50…); jobs are opened directly, so no card clicking.
        const seen = new Set();
        const searchTitle = async (title) => {
            console.log(`\nSearching for: ${title} in ${cfg.location}`);
            console.log(`Filters: Easy Apply ON | Experience levels (f_E): ${cfg.experienceLevels}`);

            for (let currentPage = 1; !stopped && currentPage <= cfg.maxSearchPages; currentPage++) {
                const url = `${searchUrlFor(title)}&start=${(currentPage - 1) * 25}`;
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

                let ids = (await waitForJobIds(page)).filter(id => !seen.has(id));
                if (ids.length < 3) {
                    // New layout: only the selected job's ID is on the page — click the cards to get the rest
                    const clicked = (await harvestIdsByClicking(page)).filter(id => !seen.has(id));
                    ids = Array.from(new Set([...ids, ...clicked]));
                    if (ids.length < 3) await dumpPage(page, 'search');
                }
                if (!ids.length) {
                    console.log(`No new jobs found on page ${currentPage}. Done with "${title}".`);
                    break;
                }
                ids.forEach(id => seen.add(id));
                console.log(`Found ${ids.length} jobs on page ${currentPage}.`);

                for (let i = 0; i < ids.length && !stopped; i++) {
                    const reason = limitReason();
                    if (reason) {
                        console.log(`\nReached ${reason}. Stopping.`);
                        stopped = true;
                        break;
                    }
                    console.log(`Opening job ${i + 1}/${ids.length} on page ${currentPage} (id ${ids[i]})...`);
                    try {
                        await processJob(ids[i]);
                    } catch (e) {
                        if (stopped) break;
                        console.log(`  Error processing job ${ids[i]}:`, e.message);
                        finishJob({ title: 'Unknown Job', company: 'Unknown Company', url: page.url(), jobId: ids[i] },
                            'failed', `Exception: ${e.message}`);
                        await discardModal(page).catch(() => {});
                    }
                }
            }
        };

        for (const title of cfg.jobTitles) {
            if (stopped) break;
            try {
                await searchTitle(title);
            } catch (e) {
                if (stopped) break;
                console.log(`Could not process search "${title}":`, e.message);
            }
        }

        console.log(`\nFinished. Applied: ${stats.applied} | Unconfirmed: ${stats.unconfirmed} | Needs answer: ${stats.needsAnswer} | Failed: ${stats.failed} | Skipped: ${stats.skipped}`);
        if (stats.needsAnswer > 0) console.log(`Add answers for the questions in ${path.relative(cfg.dataDir, cfg.unansweredPath)} to answers.json, then retry those jobs.`);
        console.log('LinkedIn Agent finished tasks.');
    } catch (e) {
        if (!stopped) {
            console.error('LinkedIn Agent Error during execution:', e);
            process.exitCode = 1;
        }
    } finally {
        try { await closeBrowser(); } catch (_) {}
    }
};

run()
    .catch(err => {
        console.error('LinkedIn Agent Fatal Error:', err);
        process.exitCode = 1;
    })
    .finally(() => {
        // Close the IPC channel so the process can exit
        if (process.connected) process.disconnect();
    });
