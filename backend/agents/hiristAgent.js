const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getAnswer } = require('../utils/questionAnswerer');
const { getAIAnswer } = require('../utils/resumeQA');

// Load answers.json
const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
let presetAnswers = {};
if (fs.existsSync(answersPath)) {
    try {
        presetAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
    } catch(err) {
        console.error('Could not parse answers.json:', err);
    }
}
const resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');

// Path to persist failed jobs
const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');

// Helper: merge & save failed jobs to disk
const saveFailedJobs = (failedJobs) => {
    if (failedJobs.length === 0) return;
    try {
        let existing = [];
        if (fs.existsSync(failedJobsPath)) {
            existing = JSON.parse(fs.readFileSync(failedJobsPath, 'utf8'));
        }
        const merged = [...existing, ...failedJobs];
        fs.writeFileSync(failedJobsPath, JSON.stringify(merged, null, 2));
        console.log(`Failed jobs saved to failed_jobs.json (newly added: ${failedJobs.length})`);
    } catch (e) {
        console.log('Could not save failed_jobs.json:', e.message);
    }
};

/* Form Filler Function for Hirist */
async function fillHiristFormFields(page, answers) {
    if (Object.keys(answers).length === 0) return;

    // Wait a brief moment for form to render
    await page.waitForTimeout(1500);
    
    // Resume Upload first
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 0 && fs.existsSync(resumePath)) {
        for (const input of fileInputs) {
            try {
                await input.setInputFiles(resumePath);
                console.log('  Uploaded resume.pdf');
            } catch (err) { }
        }
    }

    // Evaluate basic inputs - simple text/number
    // Usually hirist inputs map to labels
    const inputs = await page.$$('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea');
    for (const input of inputs) {
        // find bounding label or placeholder
        const textToMatch = await page.evaluate(el => {
            let t = el.getAttribute('placeholder') || '';
            let label = el.closest('label');
            if(label) t += ' ' + label.innerText;
            // check for prior sibling element that might be a label
            let prev = el.previousElementSibling;
            if(prev) t += ' ' + prev.innerText;
            
            // Look upward for a parent form-group
            if (!t || t.trim().length < 3) {
                let container = el.closest('.form-group, fieldset, div[class*="group"]');
                if (container) {
                    let containerLabel = container.querySelector('label, h3, h4, p');
                    if (containerLabel) t += ' ' + containerLabel.innerText;
                }
            }
            return t;
        }, input);

        if (textToMatch.trim().length > 2) {
            let answer;
            const lowerMatch = textToMatch.toLowerCase();
            const isSubjective = lowerMatch.includes('why do you want') || 
                                 lowerMatch.includes('why should we hire') ||
                                 lowerMatch.includes('about yourself') ||
                                 lowerMatch.includes('why this company') ||
                                 lowerMatch.includes('more about yourself');
            
            if (isSubjective) {
                console.log(`  Calling Groq LLM directly for subjective question: "${textToMatch.substring(0, 30)}..."`);
                const instruction = " (Instruction: Read the candidate's resume carefully. Write a compelling 2 to 3 sentence paragraph answering this question. Do NOT output just a single sentence snippet. Address the company if named. Tailor it carefully to the candidate's strengths from the resume.)";
                answer = await getAIAnswer(textToMatch + instruction, { type: 'text' });
            }
            
            // Fallback to static rules / answers.json if Groq failed or not subjective
            if (!answer) {
                answer = await getAnswer(textToMatch, answers, { type: 'text' });
            }

            if (answer && (await input.inputValue()) !== String(answer)) {
                 await input.fill(String(answer));
                 console.log(`  Filled input field for "${textToMatch.substring(0, 30)}" with ${answer}`);
            }
        }
    }
    
    // Dropdowns
    const selects = await page.$$('select');
    for (const sel of selects) {
        const textToMatch = await page.evaluate(el => {
            let t = el.getAttribute('name') || '';
            let label = el.closest('label');
            if(label) t += ' ' + label.innerText;
            let prev = el.previousElementSibling;
            if(prev) t += ' ' + prev.innerText;
            if (!t || t.trim().length < 3) {
                let container = el.closest('.form-group, fieldset, div[class*="group"]');
                if (container) {
                    let containerLabel = container.querySelector('label, h3, h4, span.label-text');
                    if (containerLabel) t += ' ' + containerLabel.innerText;
                }
            }
            return t;
        }, sel);
        
        if (textToMatch.trim().length > 2) {
            const answer = await getAnswer(textToMatch, answers, { type: 'select' });
            if (answer) {
                try {
                    // Extract all options from the select and try to fuzzy match internally
                    const options = await sel.$$eval('option', opts => 
                        opts.map(o => ({ text: o.innerText.trim(), value: o.value })).filter(o => o.value)
                    );
                    const lowerAnswer = String(answer).toLowerCase();
                    const match = options.find(o => o.text.toLowerCase().includes(lowerAnswer) || o.value.toLowerCase().includes(lowerAnswer));
                    
                    if (match) {
                        await sel.selectOption({ value: match.value });
                        console.log(`  Selected dropdown "${match.text}" for "${textToMatch.substring(0, 30)}..."`);
                    } else if (options.length > 0) {
                        await sel.selectOption({ value: options[0].value });
                        console.log(`  Selected dropdown fallback for "${textToMatch.substring(0, 30)}..."`);
                    }
                } catch(e) {}
            }
        }
    }
    
    // Checkboxes / Radios - Properly grouped layout
    const radioGroups = await page.evaluate(() => {
        const groups = {};
        document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(el => {
            const name = el.name || 'unnamed_' + Math.random();
            if (!groups[name]) {
                let qText = '';
                // Match Hirist exact nested class structure like .yes-no-answer-question-container
                let container = el.closest('.form-group, fieldset, div[class*="group"], div[class*="question-container"], [class*="question-"]');
                if (container) {
                    let containerLabel = container.querySelector('legend, h2, h3, h4, p, label, .question-text, .mandatory-question');
                    if (containerLabel) qText = containerLabel.innerText.replace(/[\n\r]+/g, ' ').trim();
                }
                groups[name] = { question: qText, options: [] };
            }
            
            let labelElement = el.closest('label');
            if(!labelElement && el.id){ 
                labelElement = document.querySelector(`label[for="${el.id}"]`);
            }
            if(!labelElement){
                labelElement = el.nextElementSibling;
            }
            let optText = labelElement ? labelElement.innerText.trim() : el.value;
            
            // Assign dynamic ID for playwright to click
            if (!el.id) el.id = 'gen_id_' + Math.random().toString(36).substring(2);
            groups[name].options.push({ text: optText, id: el.id });
        });
        return Object.values(groups);
    });

    for (const group of radioGroups) {
        if (group.question && group.question.length > 2) {
            const answer = await getAnswer(group.question, answers, { type: 'radio' });
            if (answer) {
                const lowerAns = String(answer).toLowerCase();
                const matchedOpt = group.options.find(o => o.text.toLowerCase() === lowerAns || o.text.toLowerCase().includes(lowerAns));
                if (matchedOpt) {
                    try {
                        const cHandle = await page.$(`#${matchedOpt.id}`);
                        if (cHandle) {
                            await cHandle.check();
                            console.log(`  Checked option "${matchedOpt.text}" for "${group.question.substring(0, 30)}..."`);
                        }
                    } catch(e) {}
                }
            }
        }
    }
}

async function runHiristAgent() {
    console.log("Starting Hirist Agent via Playwright...");
    
    // Setup Playwright
    const userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', 'hirist_auth.json');
    const browser = await chromium.launch({ headless: false });
    const failedJobsToSave = [];
    
    let context;
    if (fs.existsSync(userDataDir)) {
        console.log("Using existing session storage to bypass login...");
        context = await browser.newContext({ storageState: userDataDir });
    } else {
        context = await browser.newContext();
    }
    
    const page = await context.newPage();

    try {
        if (!fs.existsSync(userDataDir)) {
            console.log("Navigating to hirist.tech for manual login pause...");
            await page.goto('https://www.hirist.tech/');
            
            console.log("Waiting 60 seconds for manual login...");
            await page.waitForTimeout(60000);
            
            console.log("Saving session state...");
            await context.storageState({ path: userDataDir });
        } else {
            console.log("Session found, skipping manual login pause.");
        }
        
        const jobTitle = process.env.FRONTEND_JOB_TITLE || 'software engineer';
        const keyword = encodeURIComponent(jobTitle.toLowerCase());
        
        // Ensure filters map correctly to the hirist query params (e.g. /search/react?loc=...)
        const searchUrl = `https://www.hirist.tech/search/${keyword}?loc=remote,maharashtra,india&minexp=0&maxexp=1`;
        console.log(`Navigating to filtered search: ${searchUrl}`);
        await page.goto(searchUrl);

        console.log("Waiting for job cards to load...");
        await page.waitForSelector('a[href*="/j/"]', { timeout: 15000 }).catch(() => console.log('Job cards timeout...'));
        
        const jobLinks = await page.$$eval('a[href*="/j/"]', links => {
            // Filter unique job links just in case there are duplicates (like logo vs title link)
            const uniqueLinks = [...new Set(links.map(a => a.href))];
            return uniqueLinks;
        });
        console.log(`Found ${jobLinks.length} jobs on current page.`);

        for (const link of jobLinks) {
            try {
                const jobPage = await context.newPage();
                await jobPage.goto(link);
                console.log(`Checking job: ${link}`);

                // Look for Apply button
                const applyBtn = await jobPage.$('button:has-text("Apply")');
                
                if (applyBtn) {
                    await applyBtn.click();
                    console.log("Clicked Apply. Waiting for resulting action...");
                    await jobPage.waitForTimeout(3000);
                    // Check if navigated away or opened modal. Skip external links handling.
                    if(!jobPage.url().includes('hirist.tech')){
                        console.log("External redirect detected. Skipping.");
                    } else {
                         console.log("Internal Apply detected. Handling questionnaire...");
                         
                         let attempts = 0;
                         let success = false;
                         const MAX_ATTEMPTS = 2; // Strict 2 parameter attempt
                         
                         while(attempts < MAX_ATTEMPTS) {
                             await fillHiristFormFields(jobPage, presetAnswers);
                             
                             const submitBtn = await jobPage.$('button:has-text("Submit"), button:has-text("Next"), button:has-text("Proceed")');
                             if(submitBtn) {
                                 console.log(`  Clicking Submit/Next button (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);
                                 await submitBtn.click();
                                 await jobPage.waitForTimeout(3000); // Wait for potential next step
                             } else {
                                 success = true;
                                 break; // No more submit buttons found, we are either done or stuck
                             }
                             attempts++;
                         }
                         
                         if (!success) {
                             const stillHasSubmit = await jobPage.$('button:has-text("Submit"), button:has-text("Next"), button:has-text("Proceed")');
                             if (stillHasSubmit) {
                                  console.log("  Internal Apply stuck! Exhausted 2 attempts. Marking as Failed...");
                                  failedJobsToSave.push({ title: 'Hirist Job', company: 'Hirist.tech', url: link });
                             } else {
                                  console.log("  Internal Apply form submitted successfully!");
                             }
                         } else {
                             console.log("  Internal Apply form submitted successfully!");
                         }
                    }
                } else {
                    console.log("Apply button not found or already applied.");
                }
                
                await jobPage.close();
            } catch (jobErr) {
                console.log(`Failed applying to job ${link}: ${jobErr.message}`);
                failedJobsToSave.push({ title: 'Hirist Job', company: 'Hirist.tech', url: link });
            }
        }
        
        if (failedJobsToSave.length > 0) {
            saveFailedJobs(failedJobsToSave);
        }
        
    } catch (e) {
        console.log(`Critical Error in Hirist Agent: ${e.message}`);
    } finally {
        await browser.close();
        console.log("Hirist Agent finished.");
    }
}

runHiristAgent();
