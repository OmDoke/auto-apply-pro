const { chromium } = require('playwright');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runHiristAgent() {
    console.log("Starting Hirist Agent via Playwright...");
    
    // Setup Playwright
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log("Navigating to hirist.tech for manual login pause...");
        await page.goto('https://www.hirist.tech/');
        
        console.log("Waiting 60 seconds for manual login...");
        await page.waitForTimeout(60000);
        
        const jobTitle = process.env.FRONTEND_JOB_TITLE || 'software engineer';
        const keyword = encodeURIComponent(jobTitle.toLowerCase());
        
        // Ensure filters map correctly to the hirist query params (e.g. /search/react?loc=...)
        const searchUrl = `https://www.hirist.tech/search/${keyword}?loc=remote,maharashtra,india&minexp=0&maxexp=1`;
        console.log(`Navigating to filtered search: ${searchUrl}`);
        await page.goto(searchUrl);

        console.log("Waiting for job cards to load...");
        await page.waitForSelector('.job-title', { timeout: 15000 }).catch(() => console.log('Job cards timeout...'));
        
        const jobLinks = await page.$$eval('.job-title a', links => links.map(a => a.href));
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
                         console.log("Internal Apply completed.");
                    }
                } else {
                    console.log("Apply button not found or already applied.");
                }
                
                await jobPage.close();
            } catch (jobErr) {
                console.log(`Failed applying to job ${link}: ${jobErr.message}`);
                // Continue to next job
            }
        }
        
    } catch (e) {
        console.log(`Critical Error in Hirist Agent: ${e.message}`);
    } finally {
        await browser.close();
        console.log("Hirist Agent finished.");
    }
}

runHiristAgent();
