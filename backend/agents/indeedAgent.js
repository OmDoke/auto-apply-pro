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
            protocolTimeout: 60000,
        });
        const pages = await this.browser.pages();
        this.page = pages.find(p => p.url().includes('indeed.com')) || pages[0];
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
        if (!this.page.url().includes('indeed.com')) {
            try {
                await this.page.goto('https://in.indeed.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) {
                console.log(`[${this.agentName}] Navigation interrupted, continuing...`);
            }
            await new Promise(r => setTimeout(r, 2500)); // wait for page to settle
        }

        const isLoggedIn = await this.page.evaluate(() => {
            return document.querySelector('[data-gnav-element-name="SignIn"]') === null
                && (!document.body || !document.body.innerText.includes('Sign in'));
        }).catch(() => false);

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
            await this.page.waitForSelector('.cardOutline, .job_seen_beacon', { timeout: 10000 }).catch(() => {});
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

    async findApplyButtonInFrame(frame) {
        try {
            const btn = await frame.evaluateHandle(() => {
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
            if (el) {
                const label = await frame.evaluate(e => e.getAttribute('aria-label') || e.innerText || e.textContent, el);
                console.log(`[${this.agentName}] ✅ Found apply button in frame: "${(label || '').trim()}"`);
                return el;
            }
        } catch (_) {}
        return null;
    }

    async findApplyWithIndeedButton(targetPage) {
        // Wait for detail panel or apply button to load
        const targetSelector = 'button[aria-label*="Apply with Indeed"], button[aria-label*="apply with indeed"], #indeedApplyButton, .jobsearch-IndeedApplyButton-newDesign, #jobDescriptionText';
        await targetPage.waitForSelector(targetSelector, { timeout: 10000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1500)); // small settle

        // Check main frame first
        const mainBtn = await this.findApplyButtonInFrame(targetPage.mainFrame());
        if (mainBtn) return mainBtn;

        // Check child frames
        const frames = targetPage.frames();
        for (const frame of frames) {
            const btn = await this.findApplyButtonInFrame(frame);
            if (btn) return btn;
        }

        console.log(`[${this.agentName}] ❌ No "Apply with Indeed" button found.`);
        return null;
    }

    // ─── SmartApply Form Filler ──────────────────────────────────────────────────

    /**
     * Fills all visible form fields on the smartapply.indeed.com page.
     */
    // ─── Error Recovery ──────────────────────────────────────────────────────────

    /**
     * Called when form errors are detected after clicking Continue.
     * Reads the error message text, finds the adjacent input, and force-fills
     * it with a numeric fallback (handles "Enter a decimal number larger than 0.0" errors).
     */
    async recoverFromFormErrors(applyPage, presetAnswers) {
        try {
            const errorFields = await applyPage.evaluate(() => {
                const errorEls = Array.from(document.querySelectorAll(
                    '.ia-FormError, [data-testid="error-message"], [class*="ErrorMessage"], [class*="error-message"]'
                )).filter(el => el.offsetParent !== null);

                return errorEls.map(errEl => {
                    // Walk up to find the containing field group
                    let container = errEl.parentElement;
                    for (let i = 0; i < 6; i++) {
                        if (!container) break;
                        const inp = container.querySelector('input, textarea, select');
                        if (inp) {
                            // Get label for this field
                            const label = container.querySelector('label, legend, [class*="label"]');
                            return {
                                errorText: errEl.innerText.trim(),
                                labelText: label ? label.innerText.trim() : (inp.name || inp.placeholder || ''),
                                aaidx: inp.getAttribute('data-aaidx') || null,
                                inputType: inp.type || 'text',
                                currentValue: inp.value || ''
                            };
                        }
                        container = container.parentElement;
                    }
                    return null;
                }).filter(Boolean);
            });

            if (errorFields.length === 0) return;

            console.log(`[${this.agentName}] 🔧 Recovering from ${errorFields.length} error(s)...`);

            for (const field of errorFields) {
                const isNumericError = /decimal|number|greater than|larger than|digits only|numeric/i.test(field.errorText);
                const isRequiredError = /required|cannot be blank|must be/i.test(field.errorText);

                console.log(`[${this.agentName}]   Error field: "${field.labelText}" → "${field.errorText}"`);

                let fixValue = null;
                if (isNumericError) {
                    // Numeric field: try to find a years-of-experience answer, fallback to '1'
                    const labelLower = field.labelText.toLowerCase();
                    if (labelLower.includes('salary') || labelLower.includes('ctc') || labelLower.includes('lpa')) {
                        fixValue = String(presetAnswers['current salary'] || presetAnswers['expected salary'] || '2');
                    } else {
                        fixValue = String(presetAnswers['experience'] || '1');
                    }
                } else if (isRequiredError && !field.currentValue) {
                    // Required field that's blank — try a generic lookup
                    const { getAnswer } = require('../utils/questionAnswerer');
                    fixValue = await getAnswer(field.labelText, presetAnswers, { type: field.inputType });
                    if (!fixValue) fixValue = '1';
                }

                if (!fixValue) continue;

                if (field.aaidx) {
                    await applyPage.evaluate(({ aaidx, value }) => {
                        const el = document.querySelector(`[data-aaidx="${aaidx}"]`);
                        if (!el) return;
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                        if (setter) setter.set.call(el, value);
                        else el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }, { aaidx: field.aaidx, value: fixValue });
                    console.log(`[${this.agentName}]   ✔ Fixed "${field.labelText}" → "${fixValue}"`);
                }
            }

            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.log(`[${this.agentName}] Error recovery failed: ${e.message}`);
        }
    }

    async fillSmartApplyForm(applyPage, presetAnswers) {
        try {
            const { getAnswer } = require('../utils/questionAnswerer');

            // Step 1: Assign a unique data-aaidx attribute to every input/select/fieldset
            await applyPage.evaluate(() => {
                let idCounter = 0;
                document.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea, select, fieldset'
                ).forEach(el => {
                    el.setAttribute('data-aaidx', String(idCounter++));
                });
            });

            // Step 2: Gather all empty/actionable fields with their labels and data-aaidx
            const fields = await applyPage.evaluate(() => {
                const results = [];

                // Text / number / tel / email / textarea
                document.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea'
                ).forEach((el) => {
                    if (el.offsetParent === null || el.type === 'hidden' || el.style.display === 'none') return;
                    if (el.closest('header, nav, #gnav-main-container, #gnav-header-container')) return;
                    if (el.value) return; // already filled
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    const labelText = label ? label.innerText.trim() : (el.placeholder || el.name || '');
                    const aaidx = el.getAttribute('data-aaidx');
                    if (labelText) results.push({ aaidx, type: 'text', label: labelText });
                });

                // Selects
                document.querySelectorAll('select').forEach((el) => {
                    if (el.offsetParent === null) return;
                    if (el.closest('header, nav, #gnav-main-container, #gnav-header-container')) return;
                    if (el.value && el.value !== '') return;
                    const label = document.querySelector(`label[for="${el.id}"]`);
                    const labelText = label ? label.innerText.trim() : (el.name || '');
                    const options = Array.from(el.options).filter(o => o.value).map(o => o.text.trim());
                    const aaidx = el.getAttribute('data-aaidx');
                    if (labelText) results.push({ aaidx, type: 'select', label: labelText, options });
                });

                // Radio / Checkbox / fieldset groups
                document.querySelectorAll('fieldset').forEach((fs) => {
                    if (fs.offsetParent === null) return;
                    if (fs.closest('header, nav, #gnav-main-container, #gnav-header-container')) return;
                    const legend = fs.querySelector('legend');
                    const radios = fs.querySelectorAll('input[type="radio"]');
                    const checkboxes = fs.querySelectorAll('input[type="checkbox"]');
                    const checkedRadio = fs.querySelector('input[type="radio"]:checked');

                    if (legend && radios.length > 0 && !checkedRadio) {
                        const opts = Array.from(fs.querySelectorAll('label')).map(l => l.innerText.trim());
                        const aaidx = fs.getAttribute('data-aaidx');
                        results.push({ aaidx, type: 'radio', label: legend.innerText.trim(), options: opts });
                    } else if (legend && checkboxes.length > 0) {
                        // For checkboxes, we want to evaluate each one
                        const opts = Array.from(fs.querySelectorAll('label')).map(l => l.innerText.trim());
                        const aaidx = fs.getAttribute('data-aaidx');
                        results.push({ aaidx, type: 'checkbox', label: legend.innerText.trim(), options: opts });
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
                    const el = document.querySelector(`[data-aaidx="${f.aaidx}"]`);
                    if (!el) return;

                    if (f.type === 'text') {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
                            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                        if (setter) setter.set.call(el, answer);
                        else el.value = answer;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    } else if (f.type === 'select') {
                        const opt = Array.from(el.options).find(o =>
                            o.text.toLowerCase().includes(answer.toLowerCase()) ||
                            o.value.toLowerCase().includes(answer.toLowerCase())
                        );
                        if (opt) {
                            el.value = opt.value;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else if (f.type === 'radio') {
                        const labels = Array.from(el.querySelectorAll('label'));
                        const match = labels.find(l => l.innerText.toLowerCase().includes(answer.toLowerCase()));
                        if (match) match.click();
                    } else if (f.type === 'checkbox') {
                        const labels = Array.from(el.querySelectorAll('label'));
                        const ansLower = answer.toLowerCase();
                        if (ansLower === 'yes' || ansLower === 'true' || ansLower === '1') {
                            // Single checkbox or "check all" - we assume the answer matches if it's truthy
                            // For multi-select we might need better logic, but this handles "I confirm" checkboxes
                            for (const l of labels) {
                                const input = el.querySelector(`input#${l.getAttribute('for')}`);
                                if (input && !input.checked) l.click();
                            }
                        } else {
                            const match = labels.find(l => l.innerText.toLowerCase().includes(ansLower) || ansLower.includes(l.innerText.toLowerCase()));
                            if (match) {
                                const input = el.querySelector(`input#${match.getAttribute('for')}`);
                                if (input && !input.checked) match.click();
                            }
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
            try {
                // Poll for actionable elements to load (up to 10s)
                for (let i = 0; i < 20; i++) {
                    const isLoaded = await applyPage.evaluate(() => {
                        const hasActionable = Array.from(document.querySelectorAll('button, input, select, textarea'))
                            .some(el => !el.closest('header, nav, #gnav-main-container, #gnav-header-container'));
                        const isStillLoading = document.querySelector('.ia-LoadingIndicator, [class*="loading-spinner"]') !== null ||
                            (document.body ? (document.body.innerText || '') : '').trim().toLowerCase() === 'loading';
                        return hasActionable && !isStillLoading;
                    }).catch(() => false);
                    if (isLoaded) break;
                    await new Promise(r => setTimeout(r, 500));
                }

                const currentUrl = applyPage.url();
                const currentStep = currentUrl.split('/').pop();
                console.log(`[${this.agentName}] SmartApply step: ${currentStep}`);

                // ── Detect reCAPTCHA block — skip this job ──
                const captchaStatus = await applyPage.evaluate(() => {
                    const body = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                    const hasIframe = !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha');
                    const isChallenge = body.includes('please complete the recaptcha') || body.includes('security check');
                    return { hasIframe, isChallenge };
                }).catch(() => ({ hasIframe: false, isChallenge: false }));
                if (captchaStatus.hasIframe && captchaStatus.isChallenge) {
                    console.log(`[${this.agentName}] 🛑 reCAPTCHA challenge detected — skipping this job.`);
                    return false;
                }

                // Fill any visible fields
                await this.fillSmartApplyForm(applyPage, presetAnswers);

                // ── Detect "Return to job search" — already applied or stuck ──
                const isReturnPage = await applyPage.evaluate(() => {
                    const body = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                    const links = Array.from(document.querySelectorAll('a, button'));
                    return body.includes('return to job search') ||
                        links.some(el => (el.innerText || '').toLowerCase().includes('return to job search'));
                }).catch(() => false);
                if (isReturnPage) {
                    console.log(`[${this.agentName}] ↩️  "Return to job search" detected — moving to next job.`);
                    return 'already_applied';
                }

                // Gather all non-disabled buttons with full metadata (excluding headers/nav)
                const buttons = await applyPage.evaluate(() => {
                    return Array.from(document.querySelectorAll('button'))
                        .filter(b => !b.disabled && !b.closest('header, nav, #gnav-main-container, #gnav-header-container'))
                        .map(b => ({
                            text: (b.textContent || '').trim().toLowerCase(),
                            testId: b.getAttribute('data-testid') || '',
                            cls: b.className || '',
                            type: b.type || '',
                        }));
                }).catch(() => []);

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
                    }).catch(() => {});
                    
                    // Poll for submission confirmation or closed page (up to 10s)
                    for (let i = 0; i < 10; i++) {
                        const isSubmitted = await applyPage.evaluate(() => {
                            const text = document.body ? document.body.innerText.toLowerCase() : '';
                            return text.includes('submitted') || text.includes('application sent') || text.includes('applied');
                        }).catch(() => true); // if closed, treat as done
                        if (isSubmitted) break;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    submitted = true;

                } else if (reviewBtn) {
                    console.log(`[${this.agentName}] Clicking Review...`);
                    await applyPage.evaluate(text => {
                        const btn = Array.from(document.querySelectorAll('button'))
                            .find(b => (b.textContent || '').trim().toLowerCase().includes(text) && !b.disabled);
                        if (btn) btn.click();
                    }, reviewBtn.text).catch(() => {});

                    // Poll for loader to disappear (up to 5s)
                    for (let i = 0; i < 10; i++) {
                        const isLoaded = await applyPage.evaluate(() => {
                            const loader = document.querySelector('.ia-LoadingIndicator, [class*="loading"], [class*="spinner"]');
                            return loader === null;
                        }).catch(() => false);
                        if (isLoaded) break;
                        await new Promise(r => setTimeout(r, 500));
                    }

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
                    }).catch(() => {});

                    // Poll for loader to disappear and next step to load (up to 5s)
                    for (let i = 0; i < 10; i++) {
                        const isLoaded = await applyPage.evaluate(() => {
                            const loader = document.querySelector('.ia-LoadingIndicator, [class*="loading"], [class*="spinner"]');
                            return loader === null && document.querySelector('button, input, select') !== null;
                        }).catch(() => false);
                        if (isLoaded) break;
                        await new Promise(r => setTimeout(r, 500));
                    }

                    // Check for form errors after clicking
                    const hasErrors = await applyPage.evaluate(() => {
                        const errs = document.querySelectorAll('.ia-FormError, [data-testid="error-message"], [class*="ErrorMessage"]');
                        return errs.length > 0;
                    }).catch(() => false);
                    if (hasErrors) {
                        console.log(`[${this.agentName}] ⚠️  Form errors detected, running targeted recovery...`);
                        // First: targeted recovery (numeric/type-mismatch errors)
                        await this.recoverFromFormErrors(applyPage, presetAnswers);
                        // Then: full re-fill pass to catch any remaining blanks
                        await this.fillSmartApplyForm(applyPage, presetAnswers);
                    }

                } else {
                    console.log(`[${this.agentName}] No actionable button found. Logging body snippet:`);
                    const bodySnippet = await applyPage.evaluate(() => document.body ? document.body.innerText.substring(0, 500) : '').catch(() => 'Error getting body snippet');
                    console.log(`[${this.agentName}] Body: ${bodySnippet}`);
                    break;
                }
            } catch (stepErr) {
                console.log(`[${this.agentName}] Error in step iteration, waiting 1.5s to retry: ${stepErr.message}`);
                await new Promise(r => setTimeout(r, 1500));
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

        const title = await this.page.evaluate(el => el ? el.innerText.trim() : '', titleEl).catch(() => null);
        if (!title) return false;
        console.log(`\n[${this.agentName}] ─── Job: ${title} ───`);

        // ── Step 3: Click card to load detail panel ──
        await this.page.evaluate(el => el.scrollIntoView({ block: 'center' }), titleEl);
        await new Promise(r => setTimeout(r, 1500)); // small pause before click
        await this.page.evaluate(el => el.click(), titleEl);
        await this.page.waitForSelector('#jobsearch-ViewjobPaneWrapper, #jobDescriptionText', { timeout: 10000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1500)); // small settle

        // ── Step 4: Confirm "Apply with Indeed" button exists in right panel ──
        const applyBtn = await this.findApplyWithIndeedButton(this.page);
        if (!applyBtn) {
            console.log(`[${this.agentName}] Skipping — not an Indeed Easy Apply job.`);
            return false;
        }

        // ── Step 5: Snapshot existing pages, then click ──
        const pagesBefore = await this.browser.pages();
        const urlsBefore = new Set(pagesBefore.map(p => p.url()));

        let tabOpened = false;
        const checkTab = async () => {
            const pages = await this.browser.pages();
            for (const p of pages) {
                try {
                    const url = p.url();
                    if ((url.includes('smartapply.indeed.com') || url.includes('apply.indeed.com')) && !urlsBefore.has(url)) {
                        return true;
                    }
                } catch (_) {}
            }
            return false;
        };

        // Try physical click
        try {
            console.log(`[${this.agentName}] Attempting physical click on applyBtn...`);
            await Promise.race([
                applyBtn.click(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 3000))
            ]);
            await new Promise(r => setTimeout(r, 1500));
            tabOpened = await checkTab();
        } catch (_) {}

        // Try coordinate click if still not opened
        if (!tabOpened) {
            try {
                console.log(`[${this.agentName}] Physical click did not open tab. Trying page-level coordinate click...`);
                const box = await applyBtn.boundingBox();
                if (box) {
                    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    await new Promise(r => setTimeout(r, 1500));
                    tabOpened = await checkTab();
                }
            } catch (_) {}
        }

        // Try focus + Enter keypress if still not opened
        if (!tabOpened) {
            try {
                console.log(`[${this.agentName}] Coordinate click did not open tab. Trying focus + Enter keypress...`);
                await applyBtn.focus();
                await applyBtn.press('Enter');
                await new Promise(r => setTimeout(r, 1500));
                tabOpened = await checkTab();
            } catch (_) {}
        }

        // Try JS evaluate click if still not opened
        if (!tabOpened) {
            try {
                console.log(`[${this.agentName}] Keypress did not open tab. Falling back to JS evaluate click...`);
                await applyBtn.evaluate(el => el.click());
            } catch (_) {}
        }
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
            console.log(`[${this.agentName}] ❌ SmartApply tab did not open. Capturing debug screenshot...`);
            const screenshotDir = path.join(__dirname, '..', 'data', 'screenshots');
            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
            }
            const screenshotPath = path.join(screenshotDir, `fail_tab_${Date.now()}.png`);
            await this.page.screenshot({ path: screenshotPath }).catch(() => {});
            console.log(`[${this.agentName}] Saved debug screenshot to: ${screenshotPath}`);
            this.failedJobs.push({ title, url: this.page.url() });
            return false;
        }

        await applyTab.bringToFront();
        // Poll for SmartApply page to load (up to 10s)
        for (let i = 0; i < 20; i++) {
            const isLoaded = await applyTab.evaluate(() => {
                const hasActionable = Array.from(document.querySelectorAll('button, input, select, textarea'))
                    .some(el => !el.closest('header, nav, #gnav-main-container, #gnav-header-container'));
                const isStillLoading = document.querySelector('.ia-LoadingIndicator, [class*="loading-spinner"]') !== null ||
                    (document.body ? (document.body.innerText || '') : '').trim().toLowerCase() === 'loading';
                return hasActionable && !isStillLoading;
            }).catch(() => false);
            if (isLoaded) break;
            await new Promise(r => setTimeout(r, 500));
        }

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
            this.recordJobApplied(title, applyUrl);
            return true;
        } else {
            console.log(`[${this.agentName}] ❌ Application failed for: ${title}`);
            this.failedJobs.push({ title, url: this.page.url() });
            return false;
        }
    }

    // ─── Cloudflare Detection ───────────────────────────────────────────────────

    async checkCloudflare() {
        const isCloudflare = await this.page.evaluate(() => {
            const title = document.title.toLowerCase();
            const body = document.body ? document.body.innerText.toLowerCase() : '';
            return title.includes('just a moment') || body.includes('cloudflare') || !!document.querySelector('#cf-wrapper');
        }).catch(() => false);

        if (isCloudflare) {
            console.log(`[${this.agentName}] 🛑 Cloudflare challenge detected! Waiting up to 60s for manual intervention...`);
            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 5000));
                const stillBlocked = await this.page.evaluate(() => {
                    const title = document.title.toLowerCase();
                    return title.includes('just a moment') || !!document.querySelector('#cf-wrapper');
                }).catch(() => false);
                if (!stillBlocked) {
                    console.log(`[${this.agentName}] ✅ Cloudflare challenge passed!`);
                    return false;
                }
            }
            console.log(`[${this.agentName}] ❌ Cloudflare challenge persists after 60s. Might need to restart or solve manually.`);
            return true;
        }
        return false;
    }

    // ─── Main Run Loop ───────────────────────────────────────────────────────────

    async run() {
        try {
            await this.initializeBrowser();

            const jobTitle = process.env.FRONTEND_JOB_TITLE || 'React Developer';
            const location = process.env.FRONTEND_LOCATION || '';
            // No apply limit — runs until Ctrl+C (SIGINT/SIGTERM handled by BaseAgent)

            this.resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');
            this.targetResume = process.env.RESUME_NAME || '';

            // Hot-load answers.json fresh each run — picks up edits without restart
            const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
            this.presetAnswers = {};
            if (fs.existsSync(answersPath)) {
                try {
                    this.presetAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
                    console.log(`[${this.agentName}] Loaded ${Object.keys(this.presetAnswers).length} answer(s) from answers.json`);
                } catch (e) {
                    console.error(`[${this.agentName}] Could not parse answers.json:`, e.message);
                }
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
                
                const blocked = await this.checkCloudflare();
                if (blocked) {
                    console.log(`[${this.agentName}] Cannot proceed past Cloudflare on home feed.`);
                } else {
                    await new Promise(r => setTimeout(r, 10000)); // wait for home feed to load
                }
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
                        if (processedJobTitles.has(title) || this.isJobApplied(title)) {
                            console.log(`[${this.agentName}] Skipping already processed/applied job: ${title}`);
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
