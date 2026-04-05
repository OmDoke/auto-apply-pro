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

// ---------------------------------------------------------------------------
// Helper: type a value into a text/number input the correct way.
// Implements the "hidden zero bug fix" sequence:
//   Click → Ctrl+A → Delete → wait 500ms → type → verify
// ---------------------------------------------------------------------------
const typeIntoInput = async (page, elementHandle, value) => {
    await elementHandle.click({ clickCount: 3 }); // triple-click selects all
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    await new Promise(r => setTimeout(r, 500));
    await elementHandle.type(String(value), { delay: 80 });

    // Verify what's in the field
    const actual = await page.evaluate(el => el.value, elementHandle);
    if (actual !== String(value)) {
        // Retry once
        await elementHandle.click({ clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        await new Promise(r => setTimeout(r, 500));
        await elementHandle.type(String(value), { delay: 100 });
    }
};

// ---------------------------------------------------------------------------
// Helper: click a LinkedIn custom dropdown, wait 1s, then click option by text.
// Returns true if successful.
// ---------------------------------------------------------------------------
const clickDropdownOption = async (page, triggerHandle, optionText) => {
    try {
        await triggerHandle.click();
        await new Promise(r => setTimeout(r, 1000)); // wait for options to populate

        // Try to find and click the option in the newly opened listbox
        const clicked = await page.evaluate((text) => {
            // Standard <option> inside <select>
            // Custom listbox items: [role="option"], [data-value], li elements in a dropdown
            const candidates = Array.from(document.querySelectorAll(
                '[role="option"], .select__option, .fb-single-line-text__list-item, ' +
                '.jobs-easy-apply-form-element__select option, li[data-value]'
            ));
            for (const c of candidates) {
                const t = (c.innerText || c.textContent || '').trim().toLowerCase();
                if (t === text.toLowerCase() || t.includes(text.toLowerCase())) {
                    c.click();
                    return true;
                }
            }
            return false;
        }, optionText);

        await new Promise(r => setTimeout(r, 500));
        return clicked;
    } catch (e) {
        return false;
    }
};

// ---------------------------------------------------------------------------
// Helper: handle LinkedIn city/location autocomplete fields.
// LinkedIn uses a typeahead component — you must type slowly, wait for the
// suggestion list to appear, then CLICK the first matching suggestion.
// Returns true if a suggestion was selected, false if timed out.
// ---------------------------------------------------------------------------
const handleCityAutocomplete = async (page, inputHandle) => {
    try {
        const cityText = 'Pune';

        // Step 1: Clear the field
        await inputHandle.click({ clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        await new Promise(r => setTimeout(r, 400));

        // Step 2: Type slowly to trigger LinkedIn's typeahead API
        await inputHandle.type(cityText, { delay: 120 });

        // Step 3: Wait for autocomplete dropdown to appear (up to 3 seconds)
        const dropdownSelectors = [
            '[role="listbox"]',
            '[role="option"]',
            '.basic-typeahead__selectable',
            '.typeahead-result',
            '.search-typeahead-v2__hit',
            'div[data-test-typeahead-item]',
            'ul.fb-autocomplete__suggestions li',
            'li[role="option"]',
        ];

        let dropdownFound = false;
        for (let wait = 0; wait < 6; wait++) {
            await new Promise(r => setTimeout(r, 500));
            dropdownFound = await page.evaluate((selectors) => {
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }
                return false;
            }, dropdownSelectors);
            if (dropdownFound) break;
        }

        if (!dropdownFound) {
            console.log('  City autocomplete: no dropdown appeared, pressing Enter as fallback.');
            await page.keyboard.press('ArrowDown');
            await new Promise(r => setTimeout(r, 300));
            await page.keyboard.press('Enter');
            return false;
        }

        // Step 4: Click the first suggestion that contains 'Pune'
        const clicked = await page.evaluate((city) => {
            const allSelectors = [
                '[role="option"]',
                '[role="listbox"] li',
                '.basic-typeahead__selectable',
                'div[data-test-typeahead-item]',
                'ul.fb-autocomplete__suggestions li',
                'li[role="option"]',
            ];
            for (const sel of allSelectors) {
                const items = Array.from(document.querySelectorAll(sel));
                for (const item of items) {
                    const text = (item.innerText || item.textContent || '').toLowerCase();
                    if (text.includes(city.toLowerCase())) {
                        item.click();
                        return true;
                    }
                }
            }
            // Fallback: click first visible option regardless of text
            for (const sel of allSelectors) {
                const first = document.querySelector(sel);
                if (first && first.offsetParent !== null) {
                    first.click();
                    return true;
                }
            }
            return false;
        }, cityText);

        await new Promise(r => setTimeout(r, 600));

        if (!clicked) {
            // Last resort: keyboard navigation
            await page.keyboard.press('ArrowDown');
            await new Promise(r => setTimeout(r, 300));
            await page.keyboard.press('Enter');
        }

        console.log(`  City autocomplete: selected suggestion for "${cityText}".`);
        return true;
    } catch (e) {
        console.log('  City autocomplete error:', e.message);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Helper: handle native <select> elements.
// ---------------------------------------------------------------------------
const handleNativeSelect = async (page, selectHandle, value) => {
    try {
        // Check if this is a notice period field and if "Immediate" is the only option
        const options = await page.evaluate(el => {
            return Array.from(el.options)
                .filter(o => o.value && !o.text.toLowerCase().includes('select'))
                .map(o => ({ value: o.value, text: o.text.trim() }));
        }, selectHandle);

        // Notice period check: if only option is "Immediate", signal to skip the job
        const isNoticePeriodSelect = await page.evaluate(el => {
            const container = el.closest('[class*="form"], [class*="grouping"], [class*="element"]');
            if (!container) return false;
            const label = container.querySelector('label, legend, span[class*="label"]');
            if (!label) return false;
            const text = (label.innerText || '').toLowerCase();
            return text.includes('notice') || text.includes('joining') || text.includes('how soon');
        }, selectHandle);

        if (isNoticePeriodSelect) {
            const nonImmediate = options.filter(o =>
                !o.text.toLowerCase().includes('immediate') &&
                !o.text.toLowerCase().includes('instant')
            );
            if (nonImmediate.length === 0 && options.length > 0) {
                console.log('  ⚠️  Notice period dropdown has ONLY "Immediate" option — skipping this job.');
                return 'SKIP_JOB';
            }
        }

        // Try to find the best matching option
        const targetVal = String(value).toLowerCase();
        const match = options.find(o =>
            o.text.toLowerCase().includes(targetVal) ||
            o.value.toLowerCase().includes(targetVal)
        );

        if (match) {
            await page.select(await page.evaluate(el => {
                // Build a unique selector for this specific select element
                return null; // we'll use elementHandle directly
            }, selectHandle), match.value);
            // page.select doesn't work with elementHandle directly; use evaluate
            await page.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, selectHandle, match.value);
        }
        return 'OK';
    } catch (e) {
        return 'OK';
    }
};

// ---------------------------------------------------------------------------
// Core: fill all form fields on the current modal step.
// Uses real Puppeteer interactions — no JS injection for values.
// ---------------------------------------------------------------------------
const fillFormFields = async (page, answers) => {
    if (Object.keys(answers).length === 0) return 'OK';

    // Collect all form groups with their metadata
    const formGroups = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll(
            '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields'
        ));
        return groups.map((g, idx) => {
            const labelEl = g.querySelector('label, .fb-dash-form-element__label, legend');
            let type = 'text';
            let options = [];

            const selectEl = g.querySelector('select');
            if (selectEl) {
                type = 'select';
                options = Array.from(selectEl.options)
                    .filter(o => o.value && !o.text.toLowerCase().includes('select'))
                    .map(o => o.text.trim());
            }

            const radioEls = Array.from(g.querySelectorAll('label'));
            if (!selectEl && radioEls.length > 0 && g.querySelector('input[type="radio"]')) {
                type = 'radio';
                options = radioEls.map(r => r.innerText.trim());
            }

            return { idx, questionText: labelEl ? labelEl.innerText.trim() : '', type, options };
        }).filter(g => g.questionText !== '');
    });

    for (const { idx, questionText, type, options } of formGroups) {
        // Get the best answer for this question
        const answer = await getAnswer(questionText, answers, { type, options });
        if (!answer) continue;

        const groupSelector = '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields';

        if (type === 'select') {
            // Native <select> element
            try {
                const groups = await page.$$(groupSelector);
                const group = groups[idx];
                if (!group) continue;

                const selectHandle = await group.$('select');
                if (!selectHandle) continue;

                const result = await handleNativeSelect(page, selectHandle, answer);
                if (result === 'SKIP_JOB') return 'SKIP_JOB';
            } catch (e) {
                console.log(`  Warning: could not fill select for "${questionText}":`, e.message);
            }

        } else if (type === 'radio') {
            // Radio buttons — click the label that matches
            try {
                const groups = await page.$$(groupSelector);
                const group = groups[idx];
                if (!group) continue;

                const radioLabels = await group.$$('label');
                for (const lbl of radioLabels) {
                    const text = await page.evaluate(el => el.innerText.trim(), lbl);
                    if (text.toLowerCase() === answer.toLowerCase() || text.toLowerCase().includes(answer.toLowerCase())) {
                        await lbl.click();
                        await new Promise(r => setTimeout(r, 300));
                        break;
                    }
                }
            } catch (e) {
                console.log(`  Warning: could not fill radio for "${questionText}":`, e.message);
            }

        } else {
            // Text / number / email / tel / textarea
            try {
                const groups = await page.$$(groupSelector);
                const group = groups[idx];
                if (!group) continue;

                const inputHandle = await group.$(
                    'input[type="text"], input[type="number"], input[type="tel"], ' +
                    'input[type="email"], textarea, .fb-single-line-text__input'
                );
                if (!inputHandle) continue;

                // Check if field already has the correct value
                const currentVal = await page.evaluate(el => el.value, inputHandle);
                if (currentVal === String(answer)) continue;

                // Detect city/location fields — LinkedIn uses autocomplete typeahead for these.
                // We must type and then click the dropdown suggestion, NOT just set the value.
                const qLower = questionText.toLowerCase();
                const isCityField = (
                    qLower.includes('city') ||
                    qLower.includes('location') ||
                    qLower.includes('where are you based') ||
                    qLower.includes('your location')
                ) && !qLower.includes('previous') && !qLower.includes('office')
                  && !qLower.includes('address');

                if (isCityField) {
                    await handleCityAutocomplete(page, inputHandle);
                } else {
                    // Normal field: Ctrl+A → Delete → type
                    await typeIntoInput(page, inputHandle, answer);
                }
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.log(`  Warning: could not fill text for "${questionText}":`, e.message);
            }
        }
    }

    await new Promise(r => setTimeout(r, 500));
    return 'OK';
};

// ---------------------------------------------------------------------------
// Helper: try selecting resume by name, then fall back to file upload
// ---------------------------------------------------------------------------
const handleResumeStep = async (page) => {
    const targetResume = process.env.RESUME_NAME || presetAnswers['resume name'] || '';
    if (!targetResume) {
        console.log('  No resume name configured. Skipping named selection.');
    } else {
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
            console.log(`  Selected named resume: ${targetResume}`);
            return;
        }
    }

    // Fallback: file upload
    const fileInputs = await page.$$('input[type="file"]');
    for (const input of fileInputs) {
        if (fs.existsSync(resumePath)) {
            try {
                await input.uploadFile(resumePath);
                console.log('  Resume uploaded from file: resume.pdf');
            } catch (err) {
                console.log('  Failed to upload resume:', err.message);
            }
        } else {
            console.log('  resume.pdf not found at backend/data/resume.pdf — skipping upload.');
        }
    }
};

// ---------------------------------------------------------------------------
// Core: attempt to apply to a single job.
// Returns: 'submitted', 'skipped', or 'failed'
// ---------------------------------------------------------------------------
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
    let maxSteps = 20;

    while (maxSteps > 0 && !applicationSubmitted) {
        maxSteps--;
        await new Promise(r => setTimeout(r, 1500));

        // A) Handle resume step
        await handleResumeStep(page);

        // B) Fill all form fields — real Puppeteer interactions
        const fillResult = await fillFormFields(page, presetAnswers);
        if (fillResult === 'SKIP_JOB') {
            await discardModal(page);
            return 'skipped';
        }

        // C) Identify and click the best action button
        const actionButtons = await page.$$('.artdeco-button--primary');
        let clicked = false;
        let btnToClick = null;
        let btnType = '';

        const buttons = [];
        for (const btn of actionButtons) {
            const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
            buttons.push({ btn, text });
        }

        const submitBtn = buttons.find(b =>
            b.text === 'apply' ||
            b.text === 'submit application' ||
            b.text.includes('submit application')
        );
        const reviewBtn = buttons.find(b => b.text.includes('review'));
        const nextBtn = buttons.find(b => b.text.includes('next') || b.text.includes('continue'));

        if (submitBtn) {
            btnToClick = submitBtn.btn;
            btnType = 'submit';

            console.log('  Reviewing application details (scrolling)...');
            await page.evaluate(() => {
                const modal = document.querySelector('.jobs-easy-apply-modal__content, .artdeco-modal__content');
                if (modal) modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
            });
            await new Promise(r => setTimeout(r, 1500));

            console.log('  Submitting application...');
            await btnToClick.click();
            await new Promise(r => setTimeout(r, 2500));
            applicationSubmitted = true;
            clicked = true;

            const dismissBtn = await page.$('button[aria-label="Dismiss"]');
            if (dismissBtn) await dismissBtn.click();

        } else if (reviewBtn) {
            btnToClick = reviewBtn.btn;
            btnType = 'review';
            console.log('  Clicking "Review"...');
            await btnToClick.click();
            clicked = true;
            await new Promise(r => setTimeout(r, 1500));

            const reviewErrors = await page.$$('.artdeco-inline-feedback--error');
            if (reviewErrors.length > 0) {
                console.log(`  Validation errors after Review (attempt ${attemptNum}).`);
                return 'failed';
            }

        } else if (nextBtn) {
            btnToClick = nextBtn.btn;
            btnType = 'next';
            console.log(`  Clicking "${nextBtn.text}"...`);
            await btnToClick.click();
            clicked = true;
            await new Promise(r => setTimeout(r, 1500));

            const errors = await page.$$('.artdeco-inline-feedback--error');
            if (errors.length > 0) {
                console.log(`  Validation errors on step (attempt ${attemptNum}).`);
                return 'failed';
            }
        }

        if (!clicked && !applicationSubmitted) {
            console.log('  Could not find Next/Submit button on this step.');
            return 'failed';
        }
    }

    return applicationSubmitted ? 'submitted' : 'failed';
};

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
const run = async () => {
    console.log('LinkedIn Agent Initializing...');

    const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'linkedin_profile');

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const failedJobs = [];
    const skippedJobs = [];
    let stopped = false;

    const saveAndExit = async () => {
        if (stopped) return;
        stopped = true;
        console.log('Stop signal received. Closing browser...');
        try { await browser.close(); } catch (_) {}
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

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

        const jobTitleEnv = process.env.FRONTEND_JOB_TITLE || process.env.JOB_TITLE || 'Software Engineer';
        const jobLocationEnv = process.env.FRONTEND_LOCATION || process.env.JOB_LOCATION || process.env.LOCATION || 'Remote';
        const MAX_APPLICATIONS = 50;

        console.log(`Searching for: ${jobTitleEnv} in ${jobLocationEnv}`);
        console.log('Filters: Easy Apply ON | Experience Level: Entry Level + Associate');

        // f_AL=true  → Easy Apply only
        // f_E=1%2C2  → Experience Level: Entry Level (1) + Associate (2)
        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(jobTitleEnv)}&location=${encodeURIComponent(jobLocationEnv)}&f_AL=true&f_E=1%2C2`;
        console.log('Navigating to search results...');
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
            let jobsApplied = 0;
            let currentPage = 1;

            while (!stopped) {
                await page.waitForSelector('.job-card-container', { timeout: 10000 });
                console.log(`Job listings loaded for page ${currentPage}.`);

                for (let i = 0; i < 5; i++) {
                    if (stopped) break;
                    await page.evaluate(() => {
                        const pane = document.querySelector('.jobs-search-results-list');
                        if (pane) pane.scrollTop += 600;
                    });
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
                }

                const jobs = await page.$$('.job-card-container');
                console.log(`Found ${jobs.length} jobs on page ${currentPage}.`);

                for (let i = 0; i < jobs.length; i++) {
                    if (stopped) break;

                    if (jobsApplied >= MAX_APPLICATIONS) {
                        console.log(`\nReached maximum application limit of ${MAX_APPLICATIONS}. Stopping.`);
                        stopped = true;
                        break;
                    }

                    console.log(`\nSelecting job ${i + 1} on page ${currentPage}...`);
                    let jobInfo = { title: 'Unknown Job', company: 'Unknown Company', url: 'Unknown URL' };

                    try {
                        const jobsList = await page.$$('.job-card-container');
                        if (!jobsList[i]) continue;

                        await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), jobsList[i]);
                        await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
                        await jobsList[i].click();
                        await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500));

                        // Skip if already applied
                        const appliedBadge = await page.$('.artdeco-inline-feedback--success');
                        if (appliedBadge) {
                            const badgeText = await page.evaluate(el => el.innerText, appliedBadge);
                            if (badgeText.includes('Applied')) {
                                console.log('  Already applied — skipping...');
                                continue;
                            }
                        }

                        const fetchedInfo = await page.evaluate(() => {
                            const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24');
                            const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .t-16');
                            return {
                                title: titleEl ? titleEl.innerText.trim() : 'Unknown Job',
                                company: companyEl ? companyEl.innerText.trim() : 'Unknown Company',
                                url: window.location.href
                            };
                        });
                        jobInfo = { ...jobInfo, ...fetchedInfo };
                        console.log(`  Job: "${jobInfo.title}" at ${jobInfo.company}`);

                        // Skip restricted companies
                        const restrictedCompanies = ['ht media', 'ht media labs', 'ht media lbas', 'ht labs', 'ht media group'];
                        const normalizedCompany = jobInfo.company.toLowerCase().trim();
                        if (restrictedCompanies.some(c => normalizedCompany.includes(c))) {
                            console.log(`  Skipping restricted company: ${jobInfo.company}`);
                            continue;
                        }

                        // Retry loop: up to 2 attempts
                        const maxRetries = 2;
                        let result = 'failed';

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

                            if (result === 'skipped') {
                                console.log(`  ⏭️  Job skipped (notice period: Immediate only).`);
                                skippedJobs.push({ title: jobInfo.title, company: jobInfo.company, url: jobInfo.url, reason: 'Immediate-only notice period' });
                                break;
                            }

                            if (attempt < maxRetries) {
                                console.log(`  Retry ${attempt} failed. Trying again...`);
                            }
                        }

                        if (result !== 'submitted' && result !== 'skipped') {
                            console.log(`  ✗ Both attempts failed. Discarding and tracking for manual review.`);
                            await discardModal(page);
                            failedJobs.push({ title: jobInfo.title, company: jobInfo.company, url: jobInfo.url });
                        }

                    } catch (e) {
                        console.log(`  Error processing job ${i + 1}:`, e.message);
                        failedJobs.push({
                            title: jobInfo.title,
                            company: jobInfo.company,
                            url: jobInfo.url || page.url(),
                            reason: 'Exception: ' + e.message
                        });
                        await discardModal(page);
                    }
                }

                if (stopped) break;

                // --- PAGINATE: 3 strategies ---
                console.log(`\nAttempting to go to page ${currentPage + 1}...`);
                let clickedNext = false;

                await page.evaluate(() => {
                    const pagination = document.querySelector('.artdeco-pagination, [data-test-pagination-page-btn]');
                    if (pagination) pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

                // Strategy 1: numbered page button
                try {
                    const paginationBtns = await page.$$('.artdeco-pagination__indicator--number button, [data-test-pagination-page-btn]');
                    for (const btn of paginationBtns) {
                        const label = await page.evaluate(el =>
                            (el.getAttribute('aria-label') || el.textContent || '').trim(), btn
                        );
                        if (label.includes(`Page ${currentPage + 1}`) || label === String(currentPage + 1)) {
                            await page.evaluate(b => b.click(), btn);
                            clickedNext = true;
                            console.log(`  Strategy 1: clicked page ${currentPage + 1} button.`);
                            break;
                        }
                    }
                } catch (_) {}

                // Strategy 2: Next arrow button
                if (!clickedNext) {
                    try {
                        const nextBtn = await page.evaluateHandle(() => {
                            const candidates = Array.from(document.querySelectorAll('button, li > button'));
                            return candidates.find(el => {
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

                currentPage++;
                console.log(`Waiting for page ${currentPage} to load...`);
                try {
                    await new Promise(r => setTimeout(r, 4000));
                    await page.waitForSelector('.job-card-container', { timeout: 30000 });
                    console.log(`Page ${currentPage} loaded.`);
                } catch (e) {
                    console.log(`Timed out waiting for page ${currentPage} cards. Stopping.`);
                    break;
                }
            }

            console.log(`\nFinished. Applied to ${jobsApplied} job(s) total.`);
            if (skippedJobs.length > 0) {
                console.log(`${skippedJobs.length} job(s) skipped (Immediate-only notice period).`);
            }
            if (failedJobs.length > 0) {
                console.log(`${failedJobs.length} job(s) could not be auto-applied — saved for manual review.`);
            }

        } catch (e) {
            console.log('Could not load job listings:', e.message);
        }

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
