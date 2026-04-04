# Agent Architecture & Expanded Reach Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Refactor the existing automation agents into a unified Object-Oriented `BaseAgent` architecture, and expand reach by scaffolding new agents for Indeed, Glassdoor, and Wellfound.

**Architecture:** Create `BaseAgent.js` to handle all Puppeteer initialization, graceful shutdown, and error logging. Refactor LinkedIn and Naukri to extend this class. Scaffold Indeed, Glassdoor, and Wellfound inheriting the same base, and add them to the sequential execution pipeline.

**Tech Stack:** Node.js, Puppeteer (ES6 Classes)

---

### Task 1: Create the BaseAgent Utility Class

**Files:**
- Create: `backend/agents/BaseAgent.js`

**Step 1: Write the minimal implementation**
Create a class that handles Puppeteer, graceful shutdown (SIGINT/SIGTERM), and failed job persistence to `failed_jobs.json`.

```javascript
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class BaseAgent {
    constructor(agentName, userDataDirFolder) {
        this.agentName = agentName;
        this.userDataDir = path.join(__dirname, '..', 'data', 'puppeteer', userDataDirFolder);
        this.failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
        this.browser = null;
        this.page = null;
        this.stopped = false;
        this.failedJobs = [];

        // Bind shutdown handlers so they reference this class instance correctly
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
            const merged = [...existing, ...this.failedJobs];
            fs.writeFileSync(this.failedJobsPath, JSON.stringify(merged, null, 2));
            console.log(`[${this.agentName}] Saved ${this.failedJobs.length} failed jobs to disk.`);
        } catch (e) {
            console.log(`[${this.agentName}] Could not save failed jobs:`, e.message);
        }
    }

    async initializeBrowser() {
        console.log(`[${this.agentName}] Initializing browser...`);
        this.browser = await puppeteer.launch({
            headless: false,
            userDataDir: this.userDataDir,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
        return { browser: this.browser, page: this.page };
    }

    async closeBrowser() {
        if (this.browser) {
            try { await this.browser.close(); } catch (_) {}
        }
    }
}

module.exports = BaseAgent;
```

**Step 2: Commit**
```bash
git add backend/agents/BaseAgent.js
git commit -m "feat: create BaseAgent class to handle common puppeteer and logging boilerplate"
```

---

### Task 2: Scaffold Indeed, Glassdoor, and Wellfound Agents

**Files:**
- Create: `backend/agents/indeedAgent.js`
- Create: `backend/agents/glassdoorAgent.js`
- Create: `backend/agents/wellfoundAgent.js`

**Step 1: Write minimal implementation for Indeed**
```javascript
// backend/agents/indeedAgent.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const BaseAgent = require('./BaseAgent');

class IndeedAgent extends BaseAgent {
    constructor() {
        super('Indeed Agent', 'indeed_profile');
    }

    async run() {
        try {
            await this.initializeBrowser();
            console.log('Navigating to Indeed...');
            await this.page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // To be implemented: Indeed specific search, pagination, and application logic
            console.log('Indeed logic to be implemented later.');
            
            this.saveFailedJobs();
            console.log('Indeed Agent finished tasks.');
        } catch (e) {
            console.error('Indeed Agent Error:', e);
            process.exit(1);
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
```

**Step 2: Write minimal implementation for Glassdoor and Wellfound**
Duplicate the Exact code from `indeedAgent.js` into the other two files, replacing "Indeed" and "indeed_profile" with "Glassdoor" / "glassdoor_profile" and "Wellfound" / "wellfound_profile" respectively. Note: Wellfound's domain is `wellfound.com`, Glassdoor's is `glassdoor.com`.

**Step 3: Commit**
```bash
git add backend/agents/indeedAgent.js backend/agents/glassdoorAgent.js backend/agents/wellfoundAgent.js
git commit -m "feat: scaffold new agents for Indeed, Glassdoor, and Wellfound using BaseAgent"
```

---

### Task 3: Add New Agents to Controller Pipeline & UI

**Files:**
- Modify: `backend/controller/sequentialController.js`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/AgentDashboard.tsx`

**Step 1: Edit backend pipeline**
In `backend/controller/sequentialController.js`, add the three new agents to the `AGENTS` array:
```javascript
const AGENTS = [
    { id: 'linkedin', script: path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), name: 'LinkedIn' },
    { id: 'naukri', script: path.join(__dirname, '..', 'agents', 'naukriAgent.js'), name: 'Naukri' },
    { id: 'indeed', script: path.join(__dirname, '..', 'agents', 'indeedAgent.js'), name: 'Indeed' },
    { id: 'glassdoor', script: path.join(__dirname, '..', 'agents', 'glassdoorAgent.js'), name: 'Glassdoor' },
    { id: 'wellfound', script: path.join(__dirname, '..', 'agents', 'wellfoundAgent.js'), name: 'Wellfound' }
]; // Leave the aggregator out of this sequence list since it was mocked out previously
```

**Step 2: Update Frontend Definitions**
In `frontend/src/types/index.ts`, add the new agents to `agents` array immediately below Naukri:
```typescript
  { id: 'indeed', name: 'Indeed Agent', desc: 'Scan and apply to jobs on Indeed using Easy Apply (Coming Soon)', active: false, stub: true },
  { id: 'glassdoor', name: 'Glassdoor Agent', desc: 'Scan and apply to jobs on Glassdoor (Coming Soon)', active: false, stub: true },
  { id: 'wellfound', name: 'Wellfound Agent', desc: 'Auto-apply to startups on Wellfound (Coming Soon)', active: false, stub: true },
```
*(Added as stubs so the UI knows they exist but prevents running until the DOM scraping logic is filled in).*

**Step 3: Commit**
```bash
git add backend/controller/sequentialController.js frontend/src/types/index.ts
git commit -m "feat: register Indeed, Glassdoor, and Wellfound agents in controller and dashboard"
```

---

### Task 4: (Later/Future Implementation) Refactor LinkedIn & Naukri

**Goal:** Refactoring LinkedIn and Naukri into ES6 classes is technically complex due to their large size, and not strictly required to pass new modules for expansion. This step is deferred outside this current phase to maintain safety, but `BaseAgent` is ready for them to consume.
