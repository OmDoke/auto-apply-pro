const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getAnswer } = require('../utils/questionAnswerer');

// Load answers.json from backend/data
const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
let presetAnswers = {};
if (fs.existsSync(answersPath)) {
    try {
        presetAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
    } catch(err) {
        console.error('Could not parse answers.json:', err);
    }
}

// Resume path from backend/data
const resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');

// Path to persist failed jobs
const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');

// Helper: merge & save failed jobs to disk
const saveFailedJobs = (failedJobs) => {
    try {
        let existing = [];
        if (fs.existsSync(failedJobsPath)) {
            existing = JSON.parse(fs.readFileSync(failedJobsPath, 'utf8'));
        }
        const merged = [...existing, ...failedJobs];
        fs.writeFileSync(failedJobsPath, JSON.stringify(merged, null, 2));
        console.log(`Failed jobs saved to failed_jobs.json (total: ${merged.length})`);
    } catch (e) {
        console.log('Could not save failed_jobs.json:', e.message);
    }
};

// Helper: close the Easy Apply modal by clicking Dismiss, then Discard if needed
const discardModal = async (page) => {
    try {
        const dismissBtn = await page.$('button[aria-label="Dismiss"]');
        if (dismissBtn) await dismissBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        // Confirm discard if prompted
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            for (const b of btns) {
                if (b.innerText && b.innerText.toLowerCase().includes('discard')) {
                    b.click();
                    return;
                }
            }
        });
        await new Promise(r => setTimeout(r, 800));
    } catch (e) {
        // ignore
    }
};

// Helper: fill all form fields on current modal step using the smart answer engine
const fillFormFields = async (page, answers) => {
    if (Object.keys(answers).length === 0) return;

    // Collect all form groups and their label texts in the browser
    const formGroups = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll(
            '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields'
        ));
        return groups.map((g, idx) => {
            const labelEl = g.querySelector('label, .fb-dash-form-element__label, legend');
            return { idx, questionText: labelEl ? labelEl.innerText : '' };
        }).filter(g => g.questionText.trim() !== '');
    });

    for (const { idx, questionText } of formGroups) {
        // Smart answer — runs on Node side so string-similarity works
        const answer = getAnswer(questionText, answers);
        if (!answer) continue;

        // Inject the answer into the correct input type inside that group
        await page.evaluate(({ idx, answer }) => {
            const groups = Array.from(document.querySelectorAll(
                '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields'
            ));
            const group = groups[idx];
            if (!group) return;

            // Text / number / tel / email / textarea
            const textInput = group.querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea, .fb-single-line-text__input'
            );
            if (textInput) {
                if (!textInput.value || textInput.value === '') {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                    if (setter) setter.set.call(textInput, answer);
                    else textInput.value = answer;
                    textInput.dispatchEvent(new Event('input', { bubbles: true }));
                    textInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return;
            }

            // Select dropdown
            const selectEl = group.querySelector('select');
            if (selectEl && (!selectEl.value || selectEl.value === '' || selectEl.value.toLowerCase().includes('select'))) {
                const opts = Array.from(selectEl.options);
                for (const opt of opts) {
                    if (
                        opt.text.toLowerCase().includes(answer.toLowerCase()) ||
                        opt.value.toLowerCase().includes(answer.toLowerCase())
                    ) {
                        selectEl.value = opt.value;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
                return;
            }

            // Radio buttons
            const radioLabels = Array.from(group.querySelectorAll('label'));
            for (const rLabel of radioLabels) {
                if (rLabel.innerText.toLowerCase().includes(answer.toLowerCase())) {
                    rLabel.click();
                    break;
                }
            }
        }, { idx, answer });
    }

    await new Promise(r => setTimeout(r, 500));
};

// Helper: try selecting resume by name, then fall back to file upload
const handleResumeStep = async (page) => {
    // Try to select named resume 'onkar_doke_7745042879'
    const targetResume = 'onkar_doke_7745042879';
    const resumeSelected = await page.evaluate((resumeName) => {
        const allEls = Array.from(document.querySelectorAll('label, div, span, h3, a, button'));
        for (const el of allEls) {
            if (el.innerText && el.innerText.includes(resumeName)) {
                let p = el;
                for (let up = 0; up < 5; up++) {
                    if (p && (p.tagName === 'LABEL' || p.getAttribute('role') === 'radio' || p.querySelector('input[type="radio"]'))) {
                        p.click();
                        return true;
                    }
                    if (p) p = p.parentElement;
                }
                el.click();
                return true;
            }
        }
        return false;
    }, targetResume);

    if (resumeSelected) {
        console.log(`Selected named resume: ${targetResume}`);
        return;
    }

    // Fallback: file upload
    const fileInputs = await page.$$('input[type="file"]');
    for (const input of fileInputs) {
        if (fs.existsSync(resumePath)) {
            try {
                await input.uploadFile(resumePath);
                console.log('Resume uploaded from file: resume.pdf');
            } catch (err) {
                console.log('Failed to upload resume:', err.message);
            }
        } else {
            console.log('resume.pdf not found at backend/data/resume.pdf — skipping upload.');
        }
    }
};

// Core: attempt to apply to a single job — returns 'submitted', 'skipped', or 'failed'
const attemptApply = async (page, jobInfo, attemptNum) => {
    console.log(`  [Attempt ${attemptNum}/2] Opening Easy Apply for: ${jobInfo.title}`);

    const applyBtn = await page.$('.jobs-apply-button');
    if (!applyBtn) {
        console.log('  No Easy Apply button visible in pane.');
        return 'failed';
    }

    await page.evaluate(b => b.click(), applyBtn);

    try {
        await page.waitForSelector('.artdeco-modal', { timeout: 10000 });
    } catch (e) {
        console.log('  Application modal did not open.');
        return 'failed';
    }

    console.log('  Modal opened. Filling form...');
    let applicationSubmitted = false;
    let maxSteps = 20; // safety cap on number of modal pages

    while (maxSteps > 0 && !applicationSubmitted) {
        maxSteps--;
        await new Promise(r => setTimeout(r, 1500));

        // A) Handle resume step
        await handleResumeStep(page);

        // B) Fill all text/select/radio fields from answers.json
        await fillFormFields(page, presetAnswers);

        // C) Try to click primary button
        const actionButtons = await page.$$('.artdeco-button--primary');
        let clicked = false;

        for (const btn of actionButtons) {
            const btnText = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);

            if (btnText.includes('submit application')) {
                console.log('  Submitting application...');
                await btn.click();
                await new Promise(r => setTimeout(r, 2000));
                applicationSubmitted = true;
                clicked = true;

                // Dismiss success dialog
                const dismissBtn = await page.$('button[aria-label="Dismiss"]');
                if (dismissBtn) await dismissBtn.click();
                break;

            } else if (btnText.includes('next') || btnText.includes('review') || btnText.includes('continue')) {
                console.log(`  Clicking "${btnText}"...`);
                await btn.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 1500));

                // Check for validation errors after clicking Next
                const errors = await page.$$('.artdeco-inline-feedback--error');
                if (errors.length > 0) {
                    console.log(`  Validation errors on step (attempt ${attemptNum}).`);
                    return 'failed'; // signal failure so outer retry loop kicks in
                }
                break;
            }
        }

        if (!clicked && !applicationSubmitted) {
            console.log('  Could not find Next/Submit button on this step.');
            return 'failed';
        }
    }

    return applicationSubmitted ? 'submitted' : 'failed';
};

const run = async () => {
    console.log('LinkedIn Agent Initializing...');

    const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'linkedin_profile');

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    // Track jobs we could NOT apply to
    const failedJobs = [];
    let stopped = false;

    // Graceful shutdown on Stop button (SIGINT from parent)
    const saveAndExit = async () => {
        if (stopped) return;
        stopped = true;
        console.log('Stop signal received. Saving state and closing browser...');
        try { await browser.close(); } catch (_) {}
        saveFailedJobs(failedJobs);
        process.exit(0);
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to LinkedIn...');
        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Checking authentication status...');
        try {
            await page.waitForSelector('#global-nav', { timeout: 10000 });
            console.log('Successfully authenticated!');
        } catch (e) {
            console.log("Please log in manually if you haven't. Waiting 60 seconds...");
            await new Promise(r => setTimeout(r, 60000));
        }

        const jobTitleEnv = process.env.FRONTEND_JOB_TITLE || process.env.JOB_TITLE || 'Software Engineer';
        const jobLocationEnv = process.env.FRONTEND_LOCATION || process.env.JOB_LOCATION || process.env.LOCATION || 'Remote';
        const jobTitle = jobTitleEnv;
        const jobLocation = jobLocationEnv;

        console.log(`Searching for: ${jobTitle} in ${jobLocation}`);

        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(jobTitle)}&location=${encodeURIComponent(jobLocation)}&f_AL=true`;
        console.log('Navigating to search results...');
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
            let jobsApplied = 0;
            let currentPage = 1;

            // Runs until Stop is clicked or no more pages exist
            while (!stopped) {
                await page.waitForSelector('.job-card-container', { timeout: 10000 });
                console.log(`Job listings loaded for page ${currentPage}.`);

                // Scroll to lazily load all cards
                for (let i = 0; i < 5; i++) {
                    if (stopped) break;
                    await page.evaluate(() => {
                        const pane = document.querySelector('.jobs-search-results-list');
                        if (pane) pane.scrollTop += 600;
                    });
                    await new Promise(r => setTimeout(r, 1000));
                }

                const jobs = await page.$$('.job-card-container');
                console.log(`Found ${jobs.length} Easy Apply jobs on page ${currentPage}.`);

                for (let i = 0; i < jobs.length; i++) {
                    if (stopped) break;

                    console.log(`\nSelecting job ${i + 1} on page ${currentPage}...`);

                    try {
                        const jobsList = await page.$$('.job-card-container');
                        if (!jobsList[i]) continue;

                        await page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), jobsList[i]);
                        await new Promise(r => setTimeout(r, 1000));
                        await jobsList[i].click();
                        await new Promise(r => setTimeout(r, 3000));

                        // Skip if already applied
                        const appliedBadge = await page.$('.artdeco-inline-feedback--success');
                        if (appliedBadge) {
                            const badgeText = await page.evaluate(el => el.innerText, appliedBadge);
                            if (badgeText.includes('Applied')) {
                                console.log('  Already applied to this job, skipping...');
                                continue;
                            }
                        }

                        // Get job info for tracking
                        const jobInfo = await page.evaluate(() => {
                            const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24');
                            const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .t-16');
                            const url = window.location.href;
                            return {
                                title: titleEl ? titleEl.innerText.trim() : 'Unknown Job',
                                company: companyEl ? companyEl.innerText.trim() : 'Unknown Company',
                                url: url
                            };
                        });

                        console.log(`  Job: "${jobInfo.title}" at ${jobInfo.company}`);

                        // Retry loop: attempt up to 2 times
                        const maxRetries = 2;
                        let result = 'failed';

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
                            // Make sure modal is closed before re-attempting
                            if (attempt > 1) {
                                await discardModal(page);
                                await new Promise(r => setTimeout(r, 2000));
                            }

                            result = await attemptApply(page, jobInfo, attempt);

                            if (result === 'submitted') {
                                jobsApplied++;
                                console.log(`  ✓ Applied! Total so far: ${jobsApplied}`);
                                break;
                            }

                            if (attempt < maxRetries) {
                                console.log(`  Retry ${attempt} failed. Trying again...`);
                            }
                        }

                        if (result !== 'submitted') {
                            // Both attempts failed — discard and track this job
                            console.log(`  ✗ Both attempts failed. Discarding and tracking for manual review.`);
                            await discardModal(page);
                            failedJobs.push({
                                title: jobInfo.title,
                                company: jobInfo.company,
                                url: jobInfo.url
                            });
                        }

                    } catch (e) {
                        console.log(`  Error processing job ${i + 1}:`, e.message);
                        await discardModal(page);
                    }
                }

                if (stopped) break;

                // --- PAGINATE: 3 strategies ---
                console.log(`\nAttempting to go to page ${currentPage + 1}...`);
                let clickedNext = false;

                // Scroll pagination into view first
                await page.evaluate(() => {
                    const pagination = document.querySelector(
                        '.artdeco-pagination, [data-test-pagination-page-btn]'
                    );
                    if (pagination) pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await new Promise(r => setTimeout(r, 1000));

                // Strategy 1: click numbered page button matching currentPage + 1
                try {
                    const paginationBtns = await page.$$(
                        '.artdeco-pagination__indicator--number button, [data-test-pagination-page-btn]'
                    );
                    for (const btn of paginationBtns) {
                        const label = await page.evaluate(
                            el => (el.getAttribute('aria-label') || el.textContent || '').trim(),
                            btn
                        );
                        if (
                            label.includes(`Page ${currentPage + 1}`) ||
                            label === String(currentPage + 1)
                        ) {
                            await btn.scrollIntoView?.();
                            await page.evaluate(b => b.click(), btn);
                            clickedNext = true;
                            console.log(`  Strategy 1: clicked page ${currentPage + 1} button.`);
                            break;
                        }
                    }
                } catch (_) {}

                // Strategy 2: click the "Next" arrow button
                if (!clickedNext) {
                    try {
                        const nextBtn = await page.evaluateHandle(() => {
                            const candidates = Array.from(document.querySelectorAll('button, li > button'));
                            return candidates.find(el => {
                                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                                const text  = (el.textContent || '').toLowerCase().trim();
                                return (
                                    label.includes('next') ||
                                    text === 'next' ||
                                    el.classList.contains('artdeco-pagination__button--next')
                                );
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

                // Strategy 3: navigate via URL (start= param increments by 25 per page)
                if (!clickedNext) {
                    try {
                        const currentUrl = page.url();
                        const startParam = (currentPage) * 25;
                        const nextStart  = (currentPage + 1) * 25;
                        let nextUrl;
                        if (currentUrl.includes('start=')) {
                            nextUrl = currentUrl.replace(/start=\d+/, `start=${nextStart}`);
                        } else {
                            nextUrl = `${currentUrl}&start=${nextStart}`;
                        }
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

                // Wait until new job cards appear (or timeout after 30s)
                currentPage++;
                console.log(`Waiting for page ${currentPage} to load...`);
                try {
                    // Wait for job-card list to refresh (staleness heuristic: wait briefly then re-check)
                    await new Promise(r => setTimeout(r, 4000));
                    await page.waitForSelector('.job-card-container', { timeout: 30000 });
                    console.log(`Page ${currentPage} loaded.`);
                } catch (e) {
                    console.log(`Timed out waiting for page ${currentPage} cards. Stopping.`);
                    break;
                }
            }

            console.log(`\nFinished. Applied to ${jobsApplied} job(s) total.`);
            if (failedJobs.length > 0) {
                console.log(`${failedJobs.length} job(s) could not be auto-applied — saved for manual review.`);
            }

        } catch (e) {
            console.log('Could not load job listings:', e.message);
        }

        // Save failed jobs to disk
        saveFailedJobs(failedJobs);

        console.log('LinkedIn Agent finished tasks.');
    } catch (e) {
        console.error('LinkedIn Agent Error during execution:', e);
        process.exit(1);
    } finally {
        await browser.close();
    }
};

run().catch(err => {
    console.error('LinkedIn Agent Fatal Error:', err);
    process.exit(1);
});
