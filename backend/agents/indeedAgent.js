require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const BaseAgent = require('./BaseAgent');

/**
 * IndeedAgent — targets ONLY "Apply with Indeed" (Easy Apply / SmartApply) jobs.
 *
 * Real-world flow (confirmed via live inspection):
 *  1. Job cards with "Easily apply" badge → Indeed-native apply.
 *  2. Clicking "Apply with Indeed" button (aria-label includes "opens in a new tab")
 *     opens https://smartapply.indeed.com/beta/indeedapply/form/... in a NEW TAB.
 *  3. The form is a multi-step wizard on that new tab (no iframe on main page).
 *  4. Steps: profile-location → resume → questions → review → submit.
 */
class IndeedAgent extends BaseAgent {
    constructor() {
        super('Indeed Agent', 'indeed_profile');

        // Selector for the "Apply with Indeed" button (confirmed aria-label pattern)
        this.selectors.applyButton = [
            'button[aria-label*="Apply with Indeed"]',
            'button[aria-label*="apply with indeed"]',
            '#indeedApplyButton',
            'button[id*="indeedApplyButton"]',
            '.jobsearch-IndeedApplyButton-newDesign',
        ].join(', ');

        // SmartApply form selectors
        this.selectors.continueBtn = 'button[data-testid="continue-button"], button.ia-continueButton, button[type="submit"]';
        this.selectors.submitBtn = 'button[data-testid="submit-button"], button.ia-submitButton';
        this.selectors.formError = '.ia-FormError, [data-testid="error-message"], .error-message';
    }

    // ─── Browser ────────────────────────────────────────────────────────────────

    async initializeBrowser() {
        console.log(`[${this.agentName}] Connecting to Chrome on port 9222...`);
        this.browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null,
        });
        const pages = await this.browser.pages();
        this.page = pages[0];
        this.page.setDefaultNavigationTimeout(60000);
        this.page.setDefaultTimeout(20000);
        console.log(`[${this.agentName}] ✅ Connected to Chrome!`);
        return { browser: this.browser, page: this.page };
    }

    async closeBrowser() {
        try { this.browser.disconnect(); } catch (_) { }
    }

    // ─── Login ───────────────────────────────────────────────────────────────────

    async login() {
        console.log(`[${this.agentName}] Checking login status...`);
        try {
            await this.page.goto('https://in.indeed.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`[${this.agentName}] Navigation interrupted, continuing...`);
        }
        await new Promise(r => setTimeout(r, 10000)); // wait for page to settle

        const isLoggedIn = await this.page.evaluate(() => {
            return document.querySelector('[data-gnav-element-name="SignIn"]') === null
                && !document.body.innerText.includes('Sign in');
        });

        if (isLoggedIn) {
            console.log(`[${this.agentName}] ✅ Already logged in!`);
        } else {
            console.log(`[${this.agentName}] ⚠️  Please log in manually. Waiting 120 s...`);
            await new Promise(r => setTimeout(r, 120000));
        }
    }

    // ─── Search ──────────────────────────────────────────────────────────────────

    async search(jobTitle, location) {
        const base = this.page.url().includes('in.indeed.com')
            ? 'https://in.indeed.com/jobs'
            : 'https://www.indeed.com/jobs';
        const url = `${base}?q=${encodeURIComponent(jobTitle)}&l=${encodeURIComponent(location)}&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11`;
        console.log(`[${this.agentName}] Searching: ${url}`);
        try {
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 10000)); // wait for search results
        } catch (e) {
            console.log(`[${this.agentName}] Search navigation error, continuing...`);
        }
    }

    // ─── Card Filtering ──────────────────────────────────────────────────────────

    /**
     * Returns true if the job card has the "Easily apply" badge,
     * which indicates an Indeed-native apply job.
     */
    async cardHasEasyApply(card) {
        return this.page.evaluate(el => {
            const text = (el.innerText || '').toLowerCase();
            // "Easily apply" is the badge text on Indeed-native apply jobs
            return text.includes('easily apply');
        }, card);
    }

    // ─── Apply Button Detection ──────────────────────────────────────────────────

    /**
     * Finds the "Apply with Indeed" button in the right-side job detail panel.
     * Returns the element handle or null.
     */
    async findApplyWithIndeedButton(targetPage) {
        await new Promise(r => setTimeout(r, 10000)); // wait for right panel to fully render

        const btn = await targetPage.evaluateHandle(() => {
            const all = Array.from(document.querySelectorAll('button, a'));
            return all.find(el => {
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const text = (el.innerText || el.textContent || '').toLowerCase().trim();
                const id = (el.id || '').toLowerCase();
                const cls = (el.className || '').toLowerCase();

                const isIndeedApply =
                    aria.includes('apply with indeed') ||
                    text === 'apply with indeed' ||
                    text.includes('apply with indeed') ||
                    id.includes('indeedapply') ||
                    cls.includes('indeedapplybuttoncontainer') ||
                    cls.includes('jobsearch-indeedapplybutton');

                const isExternal =
                    aria.includes('company site') ||
                    text.includes('company site') ||
                    text.includes('apply on company') ||
                    aria.includes('apply on company');

                return isIndeedApply && !isExternal;
            });
        });

        const el = btn.asElement ? btn.asElement() : null;
        if (!el) {
            console.log(`[${this.agentName}] ❌ No "Apply with Indeed" button found.`);
            return null;
        }

        const label = await targetPage.evaluate(e =>
            e.getAttribute('aria-label') || e.innerText || e.textContent, el);
        console.log(`[${this.agentName}] ✅ Found apply button: "${label.trim()}"`);
        return el;
    }

    // ─── SmartApply Form Filler ──────────────────────────────────────────────────

    /**
     * Fills all visible form fields on the smartapply.indeed.com page.
     */
    async fillSmartApplyForm(applyPage, presetAnswers) {
        try {
            const { getAnswer } = require('../utils/questionAnswerer');

            const fields = await applyPage.evaluate(() => {
                const results = [];

                // Text / number / tel / email / textarea
                document.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea'
                ).forEach((el, i) => {
                    if (el.offsetParent === null || el.type === 'hidden' || el.style.display === 'none') return;
                    if (el.value) return; // already filled
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    const labelText = label ? label.innerText.trim() : (el.placeholder || el.name || '');
                    if (labelText) results.push({ idx: i, type: 'text', label: labelText, id: el.id || null });
                });

                // Selects
                document.querySelectorAll('select').forEach((el, i) => {
                    if (el.offsetParent === null) return;
                    if (el.value && el.value !== '') return;
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    const labelText = label ? label.innerText.trim() : (el.name || '');
                    const options = Array.from(el.options).filter(o => o.value).map(o => o.text.trim());
                    if (labelText) results.push({ idx: i, type: 'select', label: labelText, options, id: el.id || null });
                });

                // Radio / fieldset groups
                document.querySelectorAll('fieldset').forEach((fs, i) => {
                    if (fs.offsetParent === null) return;
                    const legend = fs.querySelector('legend');
                    const radios = fs.querySelectorAll('input[type="radio"]');
                    const checked = fs.querySelector('input[type="radio"]:checked');
                    if (legend && radios.length > 0 && !checked) {
                        const opts = Array.from(fs.querySelectorAll('label')).map(l => l.innerText.trim());
                        results.push({ idx: i, type: 'radio', label: legend.innerText.trim(), options: opts });
                    }
                });

                return results;
            });

            if (fields.length === 0) return;
            console.log(`[${this.agentName}] Filling ${fields.length} field(s)...`);

            // Skill tokens to match inside "How many years of X experience" questions
            const SKILL_MAP = {
                'reactjs': 'react', 'react.js': 'react', 'react': 'react',
                'nodejs': 'node', 'node.js': 'node', 'node': 'node',
                'redux': 'redux', 'typescript': 'typescript', 'ts': 'typescript',
                'javascript': 'javascript', 'js': 'javascript',
                'python': 'python', 'java': 'java', 'sql': 'sql',
                'mongodb': 'mongodb', 'spring boot': 'spring boot',
                'html': 'html', 'css': 'css', 'git': 'git',
                'docker': 'docker', 'aws': 'aws', 'kubernetes': 'kubernetes',
                'angular': 'angular', 'vue': 'vue', 'c++': 'c++',
                'full stack': 'full stack', 'fullstack': 'full stack',
                'frontend': 'frontend', 'front end': 'frontend', 'front-end': 'frontend',
                'backend': 'backend', 'back end': 'backend', 'back-end': 'backend',
            };

            /**
             * For "How many years of ReactJS experience do you have?" style questions,
             * extract the skill name and look it up directly — bypassing AI/fuzzy.
             */
            const resolveYearsQuestion = (label) => {
                const lower = label.toLowerCase();
                // Must mention years + experience
                if (!(lower.includes('year') && lower.includes('experience'))) return null;
                for (const [token, key] of Object.entries(SKILL_MAP)) {
                    if (lower.includes(token)) {
                        const val = presetAnswers[key];
                        if (val !== undefined) return String(val);
                    }
                }
                // Generic fallback: total experience
                return String(presetAnswers['experience'] ?? '1');
            };

            for (const f of fields) {
                // Try skill-years resolution first (handles "How many years of X experience")
                let answer = resolveYearsQuestion(f.label);
                if (!answer) {
                    answer = await getAnswer(f.label, presetAnswers, { type: f.type, options: f.options || [] });
                }
                if (!answer) continue;

                console.log(`[${this.agentName}]   "${f.label}" → "${answer}"`);

                await applyPage.evaluate(({ f, answer }) => {
                    if (f.type === 'text') {
                        const el = f.id
                            ? document.getElementById(f.id)
                            : Array.from(document.querySelectorAll(
                                'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea'
                            )).filter(e => !e.value && e.offsetParent !== null)[f.idx];
                        if (el) {
                            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                                || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                            if (setter) setter.set.call(el, answer);
                            else el.value = answer;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else if (f.type === 'select') {
                        const el = f.id
                            ? document.getElementById(f.id)
                            : Array.from(document.querySelectorAll('select'))
                                .filter(e => (!e.value || e.value === '') && e.offsetParent !== null)[f.idx];
                        if (el) {
                            const opt = Array.from(el.options).find(o =>
                                o.text.toLowerCase().includes(answer.toLowerCase()) ||
                                o.value.toLowerCase().includes(answer.toLowerCase())
                            );
                            if (opt) {
                                el.value = opt.value;
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    } else if (f.type === 'radio') {
                        const fieldsets = Array.from(document.querySelectorAll('fieldset'));
                        const fs = fieldsets[f.idx];
                        if (fs) {
                            const labels = Array.from(fs.querySelectorAll('label'));
                            const match = labels.find(l => l.innerText.toLowerCase().includes(answer.toLowerCase()));
                            if (match) match.click();
                        }
                    }
                }, { f, answer });
            }
        } catch (e) {
            console.log(`[${this.agentName}] Form fill error: ${e.message}`);
        }
    }

    // ─── SmartApply Wizard ───────────────────────────────────────────────────────

    /**
     * Steps through the smartapply.indeed.com multi-step form until submitted.
     */
    async stepThroughSmartApply(applyPage, presetAnswers) {
        let submitted = false;
        let maxSteps = 20;

        while (maxSteps-- > 0 && !submitted) {
            await new Promise(r => setTimeout(r, 10000)); // wait for SmartApply step to load

            const currentUrl = applyPage.url();
            const currentStep = currentUrl.split('/').pop();
            console.log(`[${this.agentName}] SmartApply step: ${currentStep}`);

            // ── Detect reCAPTCHA block — skip this job ──
            const captchaStatus = await applyPage.evaluate(() => {
                const body = (document.body.innerText || '').toLowerCase();
                const hasIframe = !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha');
                const isChallenge = body.includes('please complete the recaptcha') || body.includes('security check');
                return { hasIframe, isChallenge };
            });
            if (captchaStatus.hasIframe && captchaStatus.isChallenge) {
                console.log(`[${this.agentName}] 🛑 reCAPTCHA challenge detected — skipping this job.`);
                return false;
            }

            // Fill any visible fields
            await this.fillSmartApplyForm(applyPage, presetAnswers);

            // ── Detect "Return to job search" — already applied or stuck ──
            const isReturnPage = await applyPage.evaluate(() => {
                const body = (document.body.innerText || '').toLowerCase();
                const links = Array.from(document.querySelectorAll('a, button'));
                return body.includes('return to job search') ||
                    links.some(el => (el.innerText || '').toLowerCase().includes('return to job search'));
            });
            if (isReturnPage) {
                console.log(`[${this.agentName}] ↩️  "Return to job search" detected — moving to next job.`);
                return 'already_applied';
            }

            // Gather all non-disabled buttons with full metadata
            const buttons = await applyPage.evaluate(() => {
                return Array.from(document.querySelectorAll('button'))
                    .filter(b => !b.disabled)
                    .map(b => ({
                        text: (b.textContent || '').trim().toLowerCase(),
                        testId: b.getAttribute('data-testid') || '',
                        cls: b.className || '',
                        type: b.type || '',
                    }));
            });

            console.log(`[${this.agentName}] Buttons: ${buttons.map(b => b.text || b.testId || b.cls).join(' | ')}`);

            const isReviewStep = currentStep === 'review-module';

            // Priority 1: Submit — "Submit your application" OR ia-ContinueButton on review step
            const submitBtn = buttons.find(b =>
                b.text.includes('submit your application') ||
                b.testId.includes('submit') ||
                (isReviewStep && (b.cls.includes('ia-ContinueButton') || b.testId === 'ia-continue-button'))
            );

            // Priority 2: Review step
            const reviewBtn = !isReviewStep && buttons.find(b =>
                b.text.includes('review') || b.testId.includes('review')
            );

            // Priority 3: Continue / Next (not on review step)
            const continueBtn = !isReviewStep && buttons.find(b =>
                b.text.includes('continue') ||
                b.text.includes('next') ||
                b.text.includes('agree') ||
                b.testId.includes('continue') ||
                b.testId.includes('next') ||
                b.cls.includes('ia-ContinueButton')
            );

            if (submitBtn) {
                console.log(`[${this.agentName}] 🚀 Submitting application...`);
                await applyPage.evaluate(() => {
                    // Click by class (most reliable on review-module)
                    const byClass = document.querySelector('.ia-ContinueButton, [data-testid="ia-continue-button"]');
                    if (byClass && !byClass.disabled) { byClass.click(); return; }
                    // Fallback: text match
                    const all = Array.from(document.querySelectorAll('button'));
                    const btn = all.find(b =>
                        (b.textContent || '').toLowerCase().includes('submit') && !b.disabled
                    );
                    if (btn) btn.click();
                });
                await new Promise(r => setTimeout(r, 10000)); // wait for confirmation
                submitted = true;

            } else if (reviewBtn) {
                console.log(`[${this.agentName}] Clicking Review...`);
                await applyPage.evaluate(text => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => (b.textContent || '').trim().toLowerCase().includes(text) && !b.disabled);
                    if (btn) btn.click();
                }, reviewBtn.text);

            } else if (continueBtn) {
                console.log(`[${this.agentName}] Clicking "${continueBtn.text || 'continue'}"...`);
                await applyPage.evaluate(() => {
                    // Click the primary ContinueButton
                    const byClass = document.querySelector('.ia-ContinueButton');
                    if (byClass && !byClass.disabled) { byClass.click(); return; }
                    const all = Array.from(document.querySelectorAll('button'));
                    const btn = all.find(b =>
                        !b.disabled && (
                            (b.textContent || '').toLowerCase().includes('continue') ||
                            (b.textContent || '').toLowerCase().includes('next') ||
                            (b.textContent || '').toLowerCase().includes('agree')
                        )
                    );
                    if (btn) btn.click();
                });

                await new Promise(r => setTimeout(r, 10000)); // wait for next step

                // Check for form errors after clicking
                const hasErrors = await applyPage.evaluate(() => {
                    const errs = document.querySelectorAll('.ia-FormError, [data-testid="error-message"], [class*="error"]');
                    return errs.length > 0;
                });
                if (hasErrors) {
                    console.log(`[${this.agentName}] ⚠️  Form errors detected, attempting to fix...`);
                    await this.fillSmartApplyForm(applyPage, this.presetAnswers);
                }

            } else {
                console.log(`[${this.agentName}] No actionable button found. Logging body snippet:`);
                const bodySnippet = await applyPage.evaluate(() => document.body.innerText.substring(0, 500));
                console.log(`[${this.agentName}] Body: ${bodySnippet}`);
                break;
            }
        }

        return submitted;
    }


    // ─── Process One Job Card ────────────────────────────────────────────────────

    async processJobCard(card) {
        // ── Step 1: Pre-filter by "Easily apply" badge ──
        const isEasyApply = await this.cardHasEasyApply(card);
        if (!isEasyApply) {
            // Skip without even clicking — saves time
            return false;
        }

        // ── Step 2: Get job title ──
        const titleEl = await card.$('.jcs-JobTitle span, h2.jobTitle span, .jobTitle a span, h2, .jobTitle')
            .catch(() => null);
        if (!titleEl) return false;

        const title = await this.page.evaluate(el => el.innerText.trim(), titleEl);
        console.log(`\n[${this.agentName}] ─── Job: ${title} ───`);

        // ── Step 3: Click card to load detail panel ──
        await this.page.evaluate(el => el.scrollIntoView({ block: 'center' }), titleEl);
        await new Promise(r => setTimeout(r, 1500)); // small pause before click
        await this.page.evaluate(el => el.click(), titleEl);
        await new Promise(r => setTimeout(r, 10000)); // wait for job detail panel to load

        // ── Step 4: Confirm "Apply with Indeed" button exists in right panel ──
        const applyBtn = await this.findApplyWithIndeedButton(this.page);
        if (!applyBtn) {
            console.log(`[${this.agentName}] Skipping — not an Indeed Easy Apply job.`);
            return false;
        }

        // ── Step 5: Snapshot existing pages, then click ──
        const pagesBefore = await this.browser.pages();
        const urlsBefore = new Set(pagesBefore.map(p => p.url()));

        await this.page.evaluate(el => el.click(), applyBtn);
        console.log(`[${this.agentName}] Clicked "Apply with Indeed". Waiting for SmartApply tab...`);

        // Poll for up to 12s — catches both new tab AND same-tab navigation
        let applyTab = null;
        for (let attempt = 0; attempt < 24 && !applyTab; attempt++) {
            await new Promise(r => setTimeout(r, 500));
            const pagesNow = await this.browser.pages();
            for (const p of pagesNow) {
                try {
                    const url = p.url();
                    if (
                        (url.includes('smartapply.indeed.com') || url.includes('apply.indeed.com')) &&
                        !urlsBefore.has(url)
                    ) {
                        applyTab = p;
                        break;
                    }
                } catch (_) { }
            }
            // Also check if any pre-existing page navigated to SmartApply
            if (!applyTab) {
                for (const p of pagesNow) {
                    try {
                        const url = p.url();
                        if (url.includes('smartapply.indeed.com') || url.includes('apply.indeed.com')) {
                            applyTab = p;
                            break;
                        }
                    } catch (_) { }
                }
            }
        }

        if (!applyTab) {
            console.log(`[${this.agentName}] ❌ SmartApply tab did not open.`);
            this.failedJobs.push({ title, url: this.page.url() });
            return false;
        }

        await applyTab.bringToFront();
        await new Promise(r => setTimeout(r, 10000)); // wait for SmartApply tab to fully load

        const applyUrl = applyTab.url();
        console.log(`[${this.agentName}] SmartApply opened: ${applyUrl}`);

        if (!applyUrl.includes('indeed.com')) {
            console.log(`[${this.agentName}] ❌ Unexpected URL — not a SmartApply page. Closing.`);
            try { await applyTab.close(); } catch (_) { }
            this.failedJobs.push({ title, url: this.page.url() });
            return false;
        }

        // ── Step 6: Step through SmartApply form ──
        const submitted = await this.stepThroughSmartApply(
            applyTab,
            this.presetAnswers
        );

        // Close tab only if it was a new one (don't close pre-existing tabs)
        const wasNewTab = !pagesBefore.includes(applyTab);
        if (wasNewTab) {
            try { await applyTab.close(); } catch (_) { }
        }

        if (submitted) {
            console.log(`[${this.agentName}] ✅ Application submitted for: ${title}`);
            return true;
        } else {
            console.log(`[${this.agentName}] ❌ Application failed for: ${title}`);
            this.failedJobs.push({ title, url: this.page.url() });
            return false;
        }
    }

    // ─── Main Run Loop ───────────────────────────────────────────────────────────

    async run() {
        try {
            await this.initializeBrowser();

            const jobTitle = process.env.FRONTEND_JOB_TITLE || 'React Developer';
            const location = process.env.FRONTEND_LOCATION || '';
            // No apply limit — runs until Ctrl+C (SIGINT/SIGTERM handled by BaseAgent)

            this.presetAnswers = {};
            this.resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');
            this.targetResume = process.env.RESUME_NAME || '';

            const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
            if (fs.existsSync(answersPath)) {
                this.presetAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
                console.log(`[${this.agentName}] Loaded answers.json`);
            }

            await this.login();

            let appliedCount = 0;
            console.log(`[${this.agentName}] No apply limit set — press Ctrl+C to stop.`);

            const cardSelector = '.cardOutline, .job_seen_beacon, .jobsearch-SerpJobCard, [data-testid="jobcard-container"]';

            // ── Phase 1: Jobs For You (home feed) ──────────────────────────────
            console.log(`\n[${this.agentName}] ═══ Phase 1: Jobs For You ═══`);
            try {
                await this.page.goto('https://in.indeed.com/?from=gnav-homepage', {
                    waitUntil: 'networkidle2', timeout: 30000
                });
                await new Promise(r => setTimeout(r, 10000)); // wait for home feed to load
            } catch (e) {
                console.log(`[${this.agentName}] Home page load issue, continuing...`);
            }

            await this.page.waitForSelector(cardSelector, { timeout: 10000 }).catch(() => { });
            let homeCards = await this.page.$$(cardSelector);
            const processedJobTitles = new Set();

            for (let i = 0; i < homeCards.length && !this.stopped; i++) {
                try {
                    homeCards = await this.page.$$(cardSelector);
                    if (!homeCards[i]) break;

                    const titleEl = await homeCards[i].$('.jcs-JobTitle span, h2.jobTitle span, .jobTitle a span, h2, .jobTitle')
                        .catch(() => null);
                    if (titleEl) {
                        const title = await this.page.evaluate(el => el.innerText.trim(), titleEl);
                        if (processedJobTitles.has(title)) {
                            console.log(`[${this.agentName}] Skipping already processed job: ${title}`);
                            continue;
                        }
                        processedJobTitles.add(title);
                    }

                    const ok = await this.processJobCard(homeCards[i]);
                    if (ok) {
                        appliedCount++;
                        console.log(`[${this.agentName}] 🎉 Applied! Total so far: ${appliedCount}`);
                    }
                    await new Promise(r => setTimeout(r, 10000)); // pause between cards
                } catch (e) {
                    if (e.message.includes('detached') || e.message.includes('destroyed')) {
                        const pages = await this.browser.pages();
                        this.page = pages[0];
                        continue;
                    }
                    console.log(`[${this.agentName}] Card error: ${e.message}`);
                }
            }

            // ── Phase 2: Search (Removed as per user request) ────────────────────────────────────────────────
            if (!this.stopped) {
                console.log(`\n[${this.agentName}] Skipping Search Phase as per configuration.`);
            }

            this.saveFailedJobs();
            console.log(`\n[${this.agentName}] ═══ Done! Total Applied: ${appliedCount} ═══`);

        } catch (e) {
            console.error(`[${this.agentName}] Fatal error:`, e);
            this.saveFailedJobs();
        } finally {
            await this.closeBrowser();
        }
    }
}

module.exports = IndeedAgent;
