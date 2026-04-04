require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const path = require('path');
const BaseAgent = require('./BaseAgent');

class IndeedAgent extends BaseAgent {
    constructor() {
        super('Indeed Agent', 'indeed_profile');
        // Override selectors specific to Indeed
        this.selectors.applyButton = '#indeedApplyButton, .jobsearch-IndeedApplyButton'; 
        this.selectors.modal = '.ia-BasePage-body, iframe[name="indeedapply-modal-preload-iframe"]';
        this.selectors.actionButtons = 'button.ia-continueButton, button.ia-submitButton';
        this.selectors.errorFeedback = '.ia-FormError';
    }

    async login(email, password) {
        console.log(`[${this.agentName}] Navigating directly to Indeed Login page...`);
        
        // Navigate explicitly to the login auth page as requested
        await this.page.goto('https://secure.indeed.com/auth', { waitUntil: 'domcontentloaded' });
        
        console.log(`[${this.agentName}] 🟡 MANUAL LOGIN REQUIRED: Please focus the browser window and log in.`);
        console.log(`[${this.agentName}] ⏳ Pausing for 120 seconds to allow you to solve Captchas, enter OTP, etc...`);
        
        // Wait for exactly 120 seconds
        await new Promise(r => setTimeout(r, 120000));
        
        console.log(`[${this.agentName}] 🟢 120 seconds elapsed. Resuming automation!`);
        
        // Wait an extra few seconds to let any final post-login redirects settle
        await new Promise(r => setTimeout(r, 5000));
    }

    async search(jobTitle, location) {
        const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(jobTitle)}&l=${encodeURIComponent(location)}`;
        console.log(`[${this.agentName}] Searching: ${url}`);
        try {
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            if (e.message.includes('ERR_ABORTED') || e.message.includes('Execution context was destroyed') || e.message.includes('detached')) {
                console.log(`[${this.agentName}] Navigation interrupted by Indeed security redirect. Retrying...`);
                await new Promise(r => setTimeout(r, 5000));
                
                try {
                    // Fallback to ensuring we have a solid page object
                    const pages = await this.browser.pages();
                    this.page = pages[0]; // Usually the primary visible tab
                    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (retryE) {
                    console.log(`[${this.agentName}] Retry failed. Proceeding anyway, DOM may have loaded.`);
                }
            } else {
                throw e; 
            }
        }
    }

    // Overriding the Apply logic specifically for Indeed
    async attemptApply(jobInfo, presetAnswers, resumePath, targetResume, attemptNum = 1) {
        console.log(`[${this.agentName}] [Attempt ${attemptNum}] Opening Apply Form for: ${jobInfo.title || 'Unknown'}`);

        const applyBtn = await this.page.$(this.selectors.applyButton);
        if (!applyBtn) {
            console.log(`[${this.agentName}] No 'Apply Now' button visible.`);
            return 'failed';
        }

        await this.page.evaluate(b => b.click(), applyBtn);

        try {
            await this.page.waitForSelector(this.selectors.modal, { timeout: 10000 });
        } catch (e) {
            console.log(`[${this.agentName}] Indeed apply modal did not open or not an Easy Apply job.`);
            return 'failed';
        }

        console.log(`[${this.agentName}] Modal opened. Starting wizard...`);
        let applicationSubmitted = false;
        let maxSteps = 15;

        // Try to handle iframe if it exists
        let applyFrame = this.page;
        const iframeElement = await this.page.$('iframe[title="Indeed Apply"]');
        if (iframeElement) {
            applyFrame = await iframeElement.contentFrame();
        }

        while (maxSteps > 0 && !applicationSubmitted) {
            maxSteps--;
            await new Promise(r => setTimeout(r, 2000));

            // Fill fields on this page (inheriting the BaseAgent fill logic via page evaluation)
            // But we must run it in the frame context if applicable
            await this.fillFormFields(presetAnswers); 

            const actionButtons = await applyFrame.$$('button');
            let clicked = false;
            let btnToClick = null;

            const buttons = [];
            for (const btn of actionButtons) {
                const text = await applyFrame.evaluate(el => el.textContent.trim().toLowerCase(), btn);
                const aria = await applyFrame.evaluate(el => el.getAttribute('aria-label') || '', btn);
                buttons.push({ btn, text, aria: aria.toLowerCase() });
            }

            const submitBtn = buttons.find(b => b.text === 'submit application' || b.text.includes('submit'));
            const reviewBtn = buttons.find(b => b.text.includes('review'));
            const nextBtn = buttons.find(b => b.aria === 'continue' || b.text.includes('continue') || b.text.includes('next'));

            if (submitBtn) {
                btnToClick = submitBtn.btn;
                console.log(`[${this.agentName}] Submitting application...`);
                await btnToClick.click();
                await new Promise(r => setTimeout(r, 3000));
                applicationSubmitted = true;
                clicked = true;
            } else if (reviewBtn) {
                console.log(`[${this.agentName}] Clicking Review...`);
                await reviewBtn.btn.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 1500));
            } else if (nextBtn) {
                console.log(`[${this.agentName}] Clicking Next/Continue...`);
                await nextBtn.btn.click();
                clicked = true;
                await new Promise(r => setTimeout(r, 1500));
            }

            if (!clicked && !applicationSubmitted) {
                console.log(`[${this.agentName}] Could not find Next/Submit button. Stopped at step.`);
                return 'failed';
            }
        }
        return applicationSubmitted ? 'submitted' : 'failed';
    }

    async run() {
        try {
            await this.initializeBrowser();
            
            const jobTitle = process.env.FRONTEND_JOB_TITLE || 'Software Engineer';
            const location = process.env.FRONTEND_LOCATION || 'Remote';
            const presetAnswers = {}; // To be loaded from answers.json if integrated
            const resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');
            const targetResume = process.env.RESUME_NAME || '';

            await this.login(process.env.INDEED_EMAIL, process.env.INDEED_PASSWORD);
            await this.search(jobTitle, location);
            
            console.log(`[${this.agentName}] Starting to process job listings...`);
            
            let appliedCount = 0;
            const targetApplies = 20;

            // Wait for job list to load
            await this.page.waitForSelector('.jobsearch-ResultsList', { timeout: 15000 }).catch(() => {});

            // Loop through pages
            while (appliedCount < targetApplies && !this.stopped) {
                const jobCards = await this.page.$$('.jobsearch-ResultsList > li');
                console.log(`[${this.agentName}] Found ${jobCards.length} job cards on this page.`);

                if (jobCards.length === 0) {
                    console.log(`[${this.agentName}] No jobs found. Ending search.`);
                    break;
                }

                for (let i = 0; i < jobCards.length; i++) {
                    if (this.stopped || appliedCount >= targetApplies) break;

                    const card = jobCards[i];
                    // Skip ads or empty lis
                    const titleEl = await card.$('.jcs-JobTitle, h2.jobTitle');
                    if (!titleEl) continue;

                    const title = await this.page.evaluate(el => el.innerText.trim(), titleEl);
                    console.log(`[${this.agentName}] Selecting job: ${title}`);

                    await this.page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), titleEl);
                    await new Promise(r => setTimeout(r, 1000));
                    await titleEl.click();

                    // Wait for the right pane to load
                    await new Promise(r => setTimeout(r, 3000));
                    
                    // Check if the Apply button exists in the right pane
                    const applyBtn = await this.page.$(this.selectors.applyButton);
                    if (applyBtn) {
                        const result = await this.attemptApply({ title }, presetAnswers, resumePath, targetResume);
                        if (result === 'submitted') {
                            appliedCount++;
                            console.log(`[${this.agentName}] ✅ Successfully applied! (${appliedCount}/${targetApplies})`);
                        } else {
                            console.log(`[${this.agentName}] ❌ Failed to apply or aborted Easy Apply.`);
                            this.failedJobs.push({ title, url: this.page.url() });
                        }
                    } else {
                        console.log(`[${this.agentName}] Not an Easy Apply job or already applied. Skipping.`);
                    }

                    // Refresh tab to clear any stuck modals
                    if (this.page.url().includes('indeedapply')) {
                        console.log(`[${this.agentName}] Stuck in apply frame. Backing out...`);
                        await this.page.goto(this.page.url().split('&vjs=')[0], { waitUntil: 'domcontentloaded' });
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                if (appliedCount >= targetApplies) break;

                // Go to next page
                const nextBtn = await this.page.$('[data-testid="pagination-page-next"]');
                if (nextBtn) {
                    console.log(`[${this.agentName}] Navigating to next page...`);
                    await nextBtn.click();
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    console.log(`[${this.agentName}] No more pages available.`);
                    break;
                }
            }
            
            this.saveFailedJobs();
            console.log(`[${this.agentName}] Finished tasks.`);
        } catch (e) {
            console.error(`[${this.agentName}] Error:`, e);
            if (this.page) {
                this.failedJobs.push({ title: 'Fatal Error', url: this.page.url() });
                this.saveFailedJobs();
            }
        } finally {
            await this.closeBrowser();
        }
    }
}

const agent = new IndeedAgent();
agent.run().catch(err => {
    console.error('Indeed Agent Fatal Error:', err);
    process.exit(1);
});
