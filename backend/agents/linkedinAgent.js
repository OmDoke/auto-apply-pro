const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const cfg = require('./linkedin/config');
const tracker = require('./linkedin/tracker');
const { attemptApply, discardModal } = require('./linkedin/applyFlow');
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
// Job card helpers
// ---------------------------------------------------------------------------
const readCardMeta = (card) => card.evaluate(el => {
    const holder = el.closest('[data-occludable-job-id]');
    const titleEl = el.querySelector('.job-card-list__title, .job-card-container__link, a[href*="/jobs/view/"]');
    return {
        jobId: el.getAttribute('data-job-id') || (holder && holder.getAttribute('data-occludable-job-id')) || null,
        cardTitle: titleEl ? titleEl.innerText.trim().split('\n')[0] : '',
    };
});

// Wait until the details pane shows the clicked card (not the previous job)
const waitForPane = (page, jobId, cardTitle) => page.waitForFunction((id, title) => {
    const paneTitleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24');
    const paneTitle = paneTitleEl ? paneTitleEl.innerText.trim().toLowerCase() : '';
    if (!paneTitle) return false;
    const current = new URL(location.href).searchParams.get('currentJobId');
    if (id && current === id) return true;
    if (title) return paneTitle.includes(title.toLowerCase().slice(0, 25));
    return !id;
}, { timeout: 8000, polling: 200 }, jobId, cardTitle).then(() => true, () => false);

const readJobPane = (page) => page.evaluate(() => {
    const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24');
    const companyEl =
        document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
        document.querySelector('.jobs-unified-top-card__company-name') ||
        document.querySelector('.job-details-jobs-unified-top-card__primary-description a') ||
        document.querySelector('.job-details-jobs-unified-top-card__primary-description');
    const jdEl = document.querySelector(
        '#job-details, .jobs-description__content, .jobs-description-content__text, ' +
        '.job-details-jobs-unified-top-card__job-description, article.jobs-description'
    );
    return {
        title: titleEl ? titleEl.innerText.trim() : 'Unknown Job',
        company: companyEl ? companyEl.innerText.trim() : 'Unknown Company',
        url: window.location.href,
        jobDescription: jdEl ? (jdEl.innerText || jdEl.textContent).trim() : ''
    };
});

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
    const browser = await puppeteer.launch(launchOptions);

    let stopped = false;
    const stop = async (why) => {
        if (stopped) return;
        stopped = true;
        console.log(`${why} Closing browser...`);
        try { await browser.close(); } catch (_) {}
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
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to LinkedIn Jobs...');
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Checking authentication status...');
        try {
            await page.waitForSelector('#global-nav', { timeout: 10000 });
            console.log('Successfully authenticated!');
        } catch (e) {
            console.log("Please log in manually if you haven't. Waiting 60 seconds...");
            await new Promise(r => setTimeout(r, 60000));
        }

        const resumeText = await getResumeText();
        const screeningPrefs = cfg.screening;
        console.log(`Screening config: minMatchScore=${screeningPrefs.minMatchScore}% | skills=[${screeningPrefs.skills.join(', ')}]`);
        console.log(`Excluded companies: [${screeningPrefs.excludeCompanies.join(', ')}] | keywords: [${screeningPrefs.excludeKeywords.join(', ')}]`);
        console.log(`Strict answers: ${cfg.strictAnswers} | Tailor resume: ${cfg.tailorResume} | Per-run cap: ${cfg.maxApplicationsPerRun}`);

        // ── Process a single job card ───────────────────────────────────────
        const processJob = async (card) => {
            const meta = await readCardMeta(card);
            let jobInfo = { jobId: meta.jobId, title: meta.cardTitle || 'Unknown Job', company: 'Unknown Company', url: page.url() };

            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), card);
            await sleep(400 + Math.random() * 300);
            await card.click();

            if (!(await waitForPane(page, meta.jobId, meta.cardTitle))) {
                return finishJob(jobInfo, 'skipped', 'Job details pane did not load for this card');
            }
            await sleep(500 + Math.random() * 500); // let the description render

            jobInfo = { ...jobInfo, ...(await readJobPane(page)) };
            jobInfo.jobId = jobInfo.jobId || tracker.jobIdFromUrl(jobInfo.url);
            console.log(`  Job: "${jobInfo.title}" at ${jobInfo.company} (id ${jobInfo.jobId})`);

            // Already-applied jobs have no Easy Apply button — LinkedIn is the source of truth
            if (!(await page.$('.jobs-apply-button'))) {
                const reason = (await paneShowsApplied(page)) ? 'Already applied (LinkedIn)' : 'No Easy Apply button (closed or external)';
                return finishJob(jobInfo, 'skipped', reason);
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
        const searchTitle = async (title) => {
            console.log(`\nSearching for: ${title} in ${cfg.location}`);
            console.log(`Filters: Easy Apply ON | Experience levels (f_E): ${cfg.experienceLevels}`);
            await page.goto(searchUrlFor(title), { waitUntil: 'domcontentloaded', timeout: 60000 });

            let currentPage = 1;
            while (!stopped) {
                try {
                    await page.waitForSelector('.job-card-container', { timeout: 10000 });
                } catch (e) {
                    console.log(`No job cards found on page ${currentPage}.`);
                    break;
                }
                const jobCount = (await page.$$('.job-card-container')).length;
                console.log(`Found ${jobCount} jobs on page ${currentPage}.`);

                for (let i = 0; i < jobCount && !stopped; i++) {
                    const reason = limitReason();
                    if (reason) {
                        console.log(`\nReached ${reason}. Stopping.`);
                        stopped = true;
                        break;
                    }

                    console.log(`Selecting job ${i + 1} on page ${currentPage}...`);
                    try {
                        const card = (await page.$$('.job-card-container'))[i];
                        if (!card) continue;
                        await processJob(card);
                    } catch (e) {
                        if (stopped) break;
                        console.log(`  Error processing job ${i + 1}:`, e.message);
                        finishJob({ title: 'Unknown Job', company: 'Unknown Company', url: page.url(), jobId: tracker.jobIdFromUrl(page.url()) },
                            'failed', `Exception: ${e.message}`);
                        await discardModal(page);
                    }
                }

                if (stopped) break;

                // --- PAGINATE ---
                console.log(`\nAttempting to go to page ${currentPage + 1}...`);
                const firstCardId = await page.$eval('.job-card-container', el =>
                    el.getAttribute('data-job-id') || el.innerText.slice(0, 80)).catch(() => null);
                let clickedNext = false;

                await page.evaluate(() => {
                    const pagination = document.querySelector('.jobs-search-pagination, .artdeco-pagination, [data-test-pagination-page-btn]');
                    if (pagination) pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await sleep(1000 + Math.random() * 500);

                // Strategy 1: numbered page button
                try {
                    const paginationBtns = await page.$$('.artdeco-pagination__indicator--number button, [data-test-pagination-page-btn], .jobs-search-pagination__indicator-button');
                    for (const btn of paginationBtns) {
                        const label = await page.evaluate(el => (el.getAttribute('aria-label') || el.textContent || '').trim(), btn);
                        if (label.includes(`Page ${currentPage + 1}`) || label === String(currentPage + 1)) {
                            await page.evaluate(b => b.click(), btn);
                            clickedNext = true;
                            console.log(`  Strategy 1: clicked page ${currentPage + 1} button.`);
                            break;
                        }
                    }
                } catch (_) {}

                // Strategy 2: Next arrow — only inside the pagination component
                if (!clickedNext) {
                    try {
                        const nextBtn = await page.evaluateHandle(() => {
                            const scope = document.querySelector('.jobs-search-pagination, .artdeco-pagination');
                            if (!scope) return null;
                            return Array.from(scope.querySelectorAll('button')).find(el => {
                                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                                const text = (el.textContent || '').toLowerCase().trim();
                                return label.includes('next') || text === 'next' || el.classList.contains('artdeco-pagination__button--next');
                            }) || null;
                        });
                        const el = nextBtn.asElement();
                        if (el) {
                            const isDisabled = await page.evaluate(b => b.disabled || b.getAttribute('aria-disabled') === 'true', el);
                            if (!isDisabled) {
                                await page.evaluate(b => b.click(), el);
                                clickedNext = true;
                                console.log('  Strategy 2: clicked Next arrow button.');
                            }
                        }
                    } catch (_) {}
                }

                // Strategy 3: URL navigation
                if (!clickedNext) {
                    try {
                        const currentUrl = page.url();
                        const nextStart = currentPage * 25;
                        const nextUrl = currentUrl.includes('start=')
                            ? currentUrl.replace(/start=\d+/, `start=${nextStart}`)
                            : `${currentUrl}&start=${nextStart}`;
                        console.log(`  Strategy 3: navigating via URL (start=${nextStart}).`);
                        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        clickedNext = true;
                    } catch (e) {
                        console.log('  Strategy 3 failed:', e.message);
                    }
                }

                if (!clickedNext) {
                    console.log('All pagination strategies exhausted. No more pages.');
                    break;
                }

                currentPage++;
                console.log(`Waiting for page ${currentPage} to load...`);
                // Wait until the card list actually changes (not the old page's cards)
                const changed = await page.waitForFunction((prev) => {
                    const el = document.querySelector('.job-card-container');
                    if (!el) return false;
                    return (el.getAttribute('data-job-id') || el.innerText.slice(0, 80)) !== prev;
                }, { timeout: 15000, polling: 300 }, firstCardId).then(() => true, () => false);
                if (!changed) {
                    console.log(`Page ${currentPage} did not load new jobs. Done with "${title}".`);
                    break;
                }
                await sleep(800);
                console.log(`Page ${currentPage} loaded.`);
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
        try { await browser.close(); } catch (_) {}
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
