const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const { getAnswer } = require('../utils/questionAnswerer');

class BaseAgent {
    constructor(agentName, userDataDirFolder) {
        this.agentName = agentName;
        this.userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', userDataDirFolder);
        this.failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
        
        // Ensure puppeteer data dir exists
        if (!fs.existsSync(this.userDataDir)) {
            fs.mkdirSync(this.userDataDir, { recursive: true });
        }

        this.browser = null;
        this.page = null;
        this.stopped = false;
        this.failedJobs = [];

        // Selectors that can be overridden by subclasses
        this.selectors = {
            applyButton: '.jobs-apply-button',
            modal: '.artdeco-modal',
            actionButtons: '.artdeco-button--primary',
            errorFeedback: '.artdeco-inline-feedback--error'
        };

        // Bind shutdown handlers
        this.handleShutdown = this.handleShutdown.bind(this);
        process.on('SIGINT', this.handleShutdown);
        process.on('SIGTERM', this.handleShutdown);
    }

    async handleShutdown() {
        if (this.stopped) return;
        this.stopped = true;
        console.log(`[${this.agentName}] Stop signal received. Shutting down...`);
        this.saveFailedJobs();
        if (this.browser) {
            try { await this.browser.close(); } catch (_) {}
        }
        process.exit(0);
    }

    saveFailedJobs() {
        if (this.failedJobs.length === 0) return;
        try {
            let existing = [];
            if (fs.existsSync(this.failedJobsPath)) {
                existing = JSON.parse(fs.readFileSync(this.failedJobsPath, 'utf8'));
            }
            // Filter duplicates by URL
            const existingUrls = new Set(existing.map(j => j.url));
            const newJobs = this.failedJobs.filter(j => !existingUrls.has(j.url));
            
            if (newJobs.length > 0) {
                const merged = [...existing, ...newJobs];
                fs.writeFileSync(this.failedJobsPath, JSON.stringify(merged, null, 2));
                console.log(`[${this.agentName}] Saved ${newJobs.length} new failed jobs to disk.`);
            }
        } catch (e) {
            console.log(`[${this.agentName}] Could not save failed jobs:`, e.message);
        }
    }

    async initializeBrowser() {
        console.log(`[${this.agentName}] Initializing browser...`);
        this.browser = await puppeteer.launch({
            headless: false,
            userDataDir: this.userDataDir,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800', '--disable-blink-features=AutomationControlled']
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
        
        // Stealth bypass for strict platforms like Indeed / Cloudflare
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            window.chrome = { runtime: {} };
        });
        
        // Set a default timeout
        this.page.setDefaultNavigationTimeout(60000);
        this.page.setDefaultTimeout(15000);
        
        return { browser: this.browser, page: this.page };
    }

    async closeBrowser() {
        if (this.browser && !this.stopped) {
            try { await this.browser.close(); } catch (_) {}
        }
    }

    // --- Common Methods: Login & Search (to be overridden or augmented by subclasses) ---
    async login(loginUrl) {
        console.log(`[${this.agentName}] Navigating to login...`);
        await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
        // Subclasses should implement actual login credential entry if not using saved profile
    }

    async search(searchUrl) {
        console.log(`[${this.agentName}] Navigating to search URL...`);
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    }

    // --- Form Wizard Logic (Common across many Easy Apply flows) ---
    async discardModal() {
        try {
            const dismissBtn = await this.page.$('button[aria-label="Dismiss"]');
            if (dismissBtn) await dismissBtn.click();
            await new Promise(r => setTimeout(r, 1000));
            // Confirm discard if prompted
            await this.page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                for (const b of btns) {
                    if (b.innerText && b.innerText.toLowerCase().includes('discard')) {
                        b.click();
                        return;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 800));
        } catch (e) {}
    }

    async fillFormFields(answers) {
        if (!answers || Object.keys(answers).length === 0) return;

        const formGroups = await this.page.evaluate(() => {
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
                    options = Array.from(selectEl.options).filter(o => o.value && !o.text.toLowerCase().includes('select')).map(o => o.text.trim());
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
            const answer = await getAnswer(questionText, answers, { type, options });
            if (!answer) continue;

            await this.page.evaluate(({ idx, answer }) => {
                const groups = Array.from(document.querySelectorAll(
                    '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields'
                ));
                const group = groups[idx];
                if (!group) return;

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

                const radioLabels = Array.from(group.querySelectorAll('label'));
                for (const rLabel of radioLabels) {
                    if (rLabel.innerText.toLowerCase().trim() === answer.toLowerCase().trim() || rLabel.innerText.toLowerCase().includes(answer.toLowerCase())) {
                        rLabel.click();
                        break;
                    }
                }
            }, { idx, answer });
        }

        await new Promise(r => setTimeout(r, 500));
    }

    async handleResumeStep(resumePath, targetResume) {
        if (!targetResume) {
            console.log(`[${this.agentName}] No resume name configured. Skipping named selection.`);
        } else {
            const resumeSelected = await this.page.evaluate((resumeName) => {
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
                console.log(`[${this.agentName}] Selected named resume: ${targetResume}`);
                return;
            }
        }

        // Fallback: file upload
        const fileInputs = await this.page.$$('input[type="file"]');
        for (const input of fileInputs) {
            if (fs.existsSync(resumePath)) {
                try {
                    await input.uploadFile(resumePath);
                    console.log(`[${this.agentName}] Resume uploaded from file: resume.pdf`);
                } catch (err) {
                    console.log(`[${this.agentName}] Failed to upload resume:`, err.message);
                }
            }
        }
    }

    async attemptApply(jobInfo, presetAnswers, resumePath, targetResume, attemptNum = 1) {
        console.log(`[${this.agentName}] [Attempt ${attemptNum}] Opening Apply Form for: ${jobInfo.title}`);

        const applyBtn = await this.page.$(this.selectors.applyButton);
        if (!applyBtn) {
            console.log(`[${this.agentName}] No Apply button visible in pane.`);
            return 'failed';
        }

        await this.page.evaluate(b => b.click(), applyBtn);

        try {
            await this.page.waitForSelector(this.selectors.modal, { timeout: 10000 });
        } catch (e) {
            console.log(`[${this.agentName}] Application modal did not open within timeout.`);
            return 'failed';
        }

        console.log(`[${this.agentName}] Modal opened. Filling form...`);
        let applicationSubmitted = false;
        let maxSteps = 20;

        while (maxSteps > 0 && !applicationSubmitted) {
            maxSteps--;
            await new Promise(r => setTimeout(r, 1500));

            await this.handleResumeStep(resumePath, targetResume);
            await this.fillFormFields(presetAnswers);

            const actionButtons = await this.page.$$(this.selectors.actionButtons);
            let clicked = false;
            let btnToClick = null;

            const buttons = [];
            for (const btn of actionButtons) {
                const text = await this.page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
                buttons.push({ btn, text });
            }

            const submitBtn = buttons.find(b => b.text === 'apply' || b.text === 'submit application' || b.text.includes('submit application'));
            const reviewBtn = buttons.find(b => b.text.includes('review'));
            const nextBtn = buttons.find(b => b.text.includes('next') || b.text.includes('continue'));

            if (submitBtn) {
                btnToClick = submitBtn.btn;
                console.log(`[${this.agentName}] Reviewing application details (scrolling)...`);
                await this.page.evaluate(() => {
                    const modal = document.querySelector('.jobs-easy-apply-modal__content, .artdeco-modal__content');
                    if (modal) {
                        modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
                    }
                });
                await new Promise(r => setTimeout(r, 1500));
                
                console.log(`[${this.agentName}] Submitting application...`);
                await btnToClick.click();
                await new Promise(r => setTimeout(r, 2500));
                applicationSubmitted = true;
                clicked = true;

                const dismissBtn = await this.page.$('button[aria-label="Dismiss"]');
                if (dismissBtn) await dismissBtn.click();

            } else if (reviewBtn) {
                btnToClick = reviewBtn.btn;
                console.log(`[${this.agentName}] Clicking "Review"...`);
                await btnToClick.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 1500));

                const reviewErrors = await this.page.$$(this.selectors.errorFeedback);
                if (reviewErrors.length > 0) {
                    console.log(`[${this.agentName}] Validation errors on step after Review.`);
                    return 'failed';
                }

            } else if (nextBtn) {
                btnToClick = nextBtn.btn;
                console.log(`[${this.agentName}] Clicking "${nextBtn.text}"...`);
                await btnToClick.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 1500));

                const errors = await this.page.$$(this.selectors.errorFeedback);
                if (errors.length > 0) {
                    console.log(`[${this.agentName}] Validation errors on step.`);
                    return 'failed';
                }
            }

            if (!clicked && !applicationSubmitted) {
                console.log(`[${this.agentName}] Could not find Next/Submit button on this step.`);
                return 'failed';
            }
        }
        return applicationSubmitted ? 'submitted' : 'failed';
    }
}

module.exports = BaseAgent;
