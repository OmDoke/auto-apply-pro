const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getAnswer } = require('../utils/questionAnswerer');

// Load answers.json
const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
let presetAnswers = {};
if (fs.existsSync(answersPath)) {
    try {
        presetAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
    } catch(err) {}
}

const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
const saveFailedJobs = (failedJobs) => {
    if (failedJobs.length === 0) return;
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

const MAX_APPLICATIONS = 50;

const run = async () => {
    console.log('Naukri Agent Initializing...');

    // Setup persistent data directory for Chrome profile
    const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'naukri_profile');

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });

    const failedJobs = [];
    let stopped = false;
    const saveAndExit = async () => {
        if (stopped) return;
        stopped = true;
        console.log('Stop signal received. Closing browser to abort current operations...');
        try { await browser.close(); } catch (_) {}
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to Naukri...');
        await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Checking authentication status...');

        try {
            await page.waitForSelector('.nI-gNb-header__wrapper', { timeout: 10000 });
            console.log('Successfully authenticated!');
        } catch (e) {
            console.log('Please log in manually if you haven\'t. Waiting 5 minutes (300 seconds)...');
            await new Promise(r => setTimeout(r, 300000));
        }

        const envTitle = process.env.FRONTEND_JOB_TITLE || process.env.JOB_TITLE || 'React Developer';
        const jobTitle = envTitle.includes(',') ? envTitle.split(',')[0].trim() : envTitle.trim();
        const jobLocation = 'Pune'; // Naukri location is hardcoded per user request via cityTypeGids

        console.log(`Searching for: ${jobTitle} in ${jobLocation} (Max: ${MAX_APPLICATIONS} applications)`);

        const formattedTitle = encodeURIComponent(jobTitle);
        // User requested specific Naukri URL structure for React Developer in Pune
        const searchUrl = `https://www.naukri.com/${jobTitle.replace(/\s+/g, '-').toLowerCase()}-jobs?k=${formattedTitle}&nignbevent_src=jobsearchDeskGNB&cityTypeGid=17&cityTypeGid=139&cityTypeGid=183`;

        console.log(`Navigating to search results...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
            let jobsApplied = 0;
            let currentPage = 1;

            while (!stopped) {
                await page.waitForSelector('.srp-jobtuple-wrapper, .jobTuple', { timeout: 10000 });
                console.log(`Job listings loaded for page ${currentPage}.`);

                // Scroll to lazily load cards
                for (let i = 0; i < 5; i++) {
                    if (stopped) break;
                    await page.evaluate(() => { window.scrollBy(0, 800); });
                    await new Promise(r => setTimeout(r, 1000));
                }

                const jobs = await page.$$('.srp-jobtuple-wrapper, .jobTuple');
                console.log(`Found ${jobs.length} jobs on page ${currentPage}.`);

                for (let i = 0; i < jobs.length; i++) {
                    if (stopped) break;

                    if (jobsApplied >= MAX_APPLICATIONS) {
                        console.log(`\nReached maximum application limit of ${MAX_APPLICATIONS}. Stopping further applications.`);
                        stopped = true;
                        break;
                    }

                    console.log(`\nScanning job ${i + 1} on page ${currentPage}...`);
                    let jobInfo = { title: 'Unknown Job', company: 'Unknown Company', url: 'Unknown URL', reason: '' };

                    try {
                        // Re-query list to avoid stale element references
                        const currentJobs = await page.$$('.srp-jobtuple-wrapper, .jobTuple');
                        if (!currentJobs[i]) continue;
                        
                        jobInfo = await page.evaluate((el) => {
                            const titleEl = el.querySelector('.title');
                            const companyEl = el.querySelector('.comp-name');
                            const urlEl = el.querySelector('a.title');
                            return {
                                title: titleEl ? titleEl.innerText.trim() : 'Unknown Job',
                                company: companyEl ? companyEl.innerText.trim() : 'Unknown Company',
                                url: urlEl ? urlEl.href : window.location.href
                            };
                        }, currentJobs[i]);

                        // Skip restricted companies
                        const restrictedCompanies = ['ht media', 'ht media labs', 'ht media lbas', 'ht labs', 'ht media group'];
                        const normalizedCompany = jobInfo.company.toLowerCase().trim();
                        if (restrictedCompanies.some(c => normalizedCompany.includes(c))) {
                            console.log(`Notice: Skipping restricted company: ${jobInfo.company}`);
                            continue;
                        }

                        await currentJobs[i].hover();
                        await currentJobs[i].scrollIntoView?.();
                        await new Promise(r => setTimeout(r, 1000));

                        // Check if already applied from the list view before clicking
                        const listAppliedText = await page.evaluate(el => el.innerText.toLowerCase(), currentJobs[i]);
                        if (listAppliedText.includes('already applied') || listAppliedText.includes('applied on')) {
                            console.log('Notice: Already applied to this job (seen in list view). Skipping.');
                            continue;
                        }

                        console.log('Clicking the job card to open details...');
                        const pagesBefore = await browser.pages();

                        const titleSelector = await currentJobs[i].$('.title');
                        if (titleSelector) {
                            await titleSelector.click();
                        } else {
                            await currentJobs[i].click();
                        }

                        let newPage = null;
                        for (let t = 0; t < 10; t++) {
                            await new Promise(r => setTimeout(r, 1000));
                            const pagesAfter = await browser.pages();
                            if (pagesAfter.length > pagesBefore.length) {
                                newPage = pagesAfter[pagesAfter.length - 1];
                                break;
                            }
                        }

                        if (newPage) {
                            console.log('Navigated to job details in new tab.');
                            await newPage.bringToFront();
                            await new Promise(r => setTimeout(r, 4000));

                            try {
                                console.log('Searching for Apply button...');
                                const applyBtn = await newPage.evaluateHandle(() => {
                                    const elements = Array.from(document.querySelectorAll('button, a, div[role="button"], span.apply-message'));
                                    return elements.find(el => {
                                        const text = el.innerText ? el.innerText.toLowerCase().trim() : '';
                                        return text === 'apply' || text === 'apply now' || text.includes('apply on company website');
                                    });
                                });

                                if (applyBtn && applyBtn.asElement()) {
                                    console.log('Success: Found Apply button on the detailed job page!');
                                    await applyBtn.click();
                                    console.log('Successfully clicked Apply!');
                                    await new Promise(r => setTimeout(r, 4000));
                                    jobsApplied++;

                                    // Handle chatbot / questionnaire
                                    const hasQuestions = await newPage.$('.chatbot, .bot-container, .layer-wrap');
                                    if (hasQuestions) {
                                        console.log('Additional questions detected. Attempting to answer...');
                                        await newPage.evaluate(async (ans) => {
                                            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
                                            for (let input of inputs) {
                                                let questionText = '';
                                                const msgBubbles = Array.from(document.querySelectorAll('.msg-content, .botMsg'));
                                                if (msgBubbles.length > 0) {
                                                    questionText = msgBubbles[msgBubbles.length - 1].innerText.toLowerCase();
                                                }

                                                let bestMatch = '0';
                                                if (questionText.includes('salary') || questionText.includes('ctc') || questionText.includes('lpa')) {
                                                    bestMatch = ans['salary'] ?? '0';
                                                } else if (questionText.includes('experience') || questionText.includes('years')) {
                                                    bestMatch = ans['experience'] ?? '0';
                                                } else if (questionText.includes('notice') || questionText.includes('joining')) {
                                                    bestMatch = ans['notice period'] ?? 'Immediate';
                                                } else if (questionText.includes('relocate')) {
                                                    bestMatch = ans['relocate'] ?? 'Yes';
                                                }

                                                input.value = bestMatch;
                                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                            }

                                            const submitBtns = Array.from(document.querySelectorAll('button'));
                                            for (let btn of submitBtns) {
                                                if (btn.innerText && (btn.innerText.toLowerCase().includes('save') || btn.innerText.toLowerCase().includes('submit') || btn.innerText.toLowerCase().includes('send'))) {
                                                    btn.click();
                                                    break;
                                                }
                                            }
                                        }, presetAnswers);
                                        await new Promise(r => setTimeout(r, 2000));
                                    }
                                } else {
                                    const alreadyApplied = await newPage.evaluate(() => {
                                        const text = document.body.innerText.toLowerCase();
                                        return text.includes('already applied') || text.includes('applied on');
                                    });
                                    if (alreadyApplied) {
                                        console.log('Notice: Already applied to this job.');
                                    } else {
                                        console.log('Notice: Could not find an Apply button inside the new tab.');
                                        failedJobs.push({
                                            title: jobInfo.title,
                                            company: jobInfo.company,
                                            url: jobInfo.url,
                                            reason: 'Could not find an Apply button'
                                        });
                                    }
                                }
                            } catch (e) {
                                console.log('Error interacting with new tab:', e.message);
                                failedJobs.push({
                                    title: jobInfo.title,
                                    company: jobInfo.company,
                                    url: jobInfo.url,
                                    reason: 'Tab interaction error: ' + e.message
                                });
                            } finally {
                                await newPage.close();
                                // Focus back to main search page
                                await page.bringToFront();
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        } else {
                            console.log('Notice: Failed to open job details in a new tab.');
                            failedJobs.push({
                                title: jobInfo.title,
                                company: jobInfo.company,
                                url: jobInfo.url,
                                reason: 'Failed to open job details in a new tab'
                            });
                        }
                    } catch (err) {
                        console.log(`Error on job ${i + 1}:`, err.message);
                        failedJobs.push({
                            title: jobInfo.title,
                            company: jobInfo.company,
                            url: jobInfo.url || page.url(),
                            reason: 'Exception: ' + err.message
                        });
                    }
                }

                if (stopped) break;

                // Pagination
                console.log('Checking for next page of jobs...');
                let clickedNext = false;
                try {
                    const nextBtn = await page.evaluateHandle(() => {
                        const candidates = Array.from(document.querySelectorAll('a.fs14.state-active, button'));
                        return candidates.find(el => {
                            const text = (el.innerText || '').toLowerCase().trim();
                            return text === 'next' || text.includes('next >');
                        }) || null;
                    });

                    if (nextBtn && nextBtn.asElement()) {
                        await page.evaluate(b => b.click(), nextBtn.asElement());
                        clickedNext = true;
                        currentPage++;
                        console.log(`Navigating to Page ${currentPage}...`);
                        await new Promise(r => setTimeout(r, 5000)); // wait for page load
                    }
                } catch (e) {
                    console.log('Failed to click Next page:', e.message);
                }

                if (!clickedNext) {
                    console.log('No more pages or failed to paginate. Stopping.');
                    break;
                }
            }
            
            console.log(`\nFinished. Applied to ${jobsApplied} job(s) total.`);
        } catch (e) {
            console.log('Notice: Could not find job listings or page format changed on Naukri.');
        }

        saveFailedJobs(failedJobs);
        console.log('Naukri Agent finished tasks.');
    } catch (e) {
        console.error('Naukri Agent Error during execution:', e);
        process.exit(1); // Force script to exit with an error code
    } finally {
        await browser.close();
    }
};

run().catch(err => {
    console.error('Naukri Agent Fatal Error:', err);
    process.exit(1);
});
