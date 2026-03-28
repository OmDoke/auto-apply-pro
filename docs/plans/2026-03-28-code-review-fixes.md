# Code Review Fixes Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Fix all 16 issues identified in the 2026-03-28 code review to make auto-apply-pro production-ready and reliable.

**Architecture:** Fixes span three layers — backend controller (process lifecycle), agents (Naukri apply flow + LinkedIn hardcoding), and utilities (Groq singleton, file I/O, env validation) — plus a minimal frontend log-key fix. No new architecture is introduced; all changes are targeted surgical edits.

**Tech Stack:** Node.js · Express · Puppeteer · Socket.IO · LangChain/Groq · React/TypeScript · Jest (new)

---

## Phase 1 — Critical Fixes

---

### Task 1: Fix `activeProcess` Race Condition in `sequentialController.js`

**Files:**
- Modify: `backend/controller/sequentialController.js:7,47-48,59-60,126-133`

**Step 1: Understand current flow**

Open `backend/controller/sequentialController.js`. Note:
- Line 7: `let activeProcess = null;` — single ref, replaced on every `runAgent` call.
- Line 47: `activeProcess = childProcess;` — overwrites previous.
- Line 60: `activeProcess = null;` — clears on close.
- Lines 127-130: `stopSequence` kills only the one stored ref.

**Step 2: Replace single ref with an array**

In `backend/controller/sequentialController.js`, make the following changes:

```js
// Line 7 — change:
let activeProcess = null;
// TO:
let activeProcesses = [];
```

```js
// In runAgent(), after fork (around line 47) — change:
activeProcess = childProcess;
// TO:
activeProcesses.push(childProcess);
```

```js
// In runAgent(), in childProcess.on('close', ...) (around line 59-60) — change:
activeProcess = null;
// TO:
activeProcesses = activeProcesses.filter(p => p !== childProcess);
```

```js
// In stopSequence() (lines 127-131) — change:
if (activeProcess) {
    addLog('Interrupting process...');
    activeProcess.kill('SIGINT');
    activeProcess = null;
}
// TO:
if (activeProcesses.length > 0) {
    addLog('Interrupting process...');
    activeProcesses.forEach(p => { try { p.kill('SIGINT'); } catch (_) {} });
    activeProcesses = [];
}
```

**Step 3: Manually verify**

1. Start the backend: `cd backend && node server.js`
2. Open the frontend, enter a job title, click **Start All**.
3. While "LinkedIn Agent" is shown as running, immediately click **Stop Current**.
4. In the terminal, confirm you see `Interrupting process...` and the browser window closes. No orphaned `node` processes should remain (check Task Manager → Details for lingering `node.exe` processes).

**Step 4: Commit**

```bash
git add backend/controller/sequentialController.js
git commit -m "fix: replace single activeProcess with activeProcesses array to prevent orphan processes"
```

---

### Task 2: Fix `naukriAgent.js` — `jobsApplied++` Before Success Confirmation

**Files:**
- Modify: `backend/agents/naukriAgent.js:187-192`

**Step 1: Understand current flow**

In `naukriAgent.js` around line 187–192:
```js
if (applyBtn && applyBtn.asElement()) {
    console.log('Success: Found Apply button on the detailed job page!');
    await applyBtn.click();
    console.log('Successfully clicked Apply!');
    await new Promise(r => setTimeout(r, 4000));
    jobsApplied++;   // ← fires regardless of actual outcome
```

**Step 2: Replace eager increment with a confirmation check**

Replace the block starting at `await applyBtn.click()` through `jobsApplied++` with:

```js
await applyBtn.click();
console.log('Successfully clicked Apply!');
await new Promise(r => setTimeout(r, 4000));

// Verify application was accepted before counting it
const applyConfirmed = await newPage.evaluate(() => {
    const body = document.body.innerText.toLowerCase();
    return (
        body.includes('application submitted') ||
        body.includes('applied successfully') ||
        body.includes('your application has been sent') ||
        body.includes('thank you for applying') ||
        body.includes('you have applied')
    );
});

if (applyConfirmed) {
    jobsApplied++;
    console.log(`  ✓ Application confirmed. Total so far: ${jobsApplied}`);
} else {
    console.log('  ! Apply clicked but no confirmation found — not counting as applied.');
    failedJobs.push({
        title: jobInfo.title,
        company: jobInfo.company,
        url: jobInfo.url,
        reason: 'Apply clicked but no success confirmation detected'
    });
}
```

**Step 3: Manually verify**

Run the Naukri agent manually (`node backend/agents/naukriAgent.js`) in a test session against one job. After clicking Apply, confirm the terminal logs either `✓ Application confirmed` or the fallback warning. The job count in the terminal should only tick up on confirmed applications.

**Step 4: Commit**

```bash
git add backend/agents/naukriAgent.js
git commit -m "fix: only increment jobsApplied after confirming Naukri application success"
```

---

### Task 3: Restrict CORS to Allowed Origins

**Files:**
- Modify: `backend/server.js:19`
- Modify: `backend/socket/index.js:5-10`

**Step 1: Update `server.js` Express CORS**

Replace line 19 in `backend/server.js`:
```js
// Before:
app.use(cors());

// After:
const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow same-origin (no origin header) or listed origins
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS: origin not allowed'));
        }
    },
    methods: ['GET', 'POST', 'DELETE']
}));
```

**Step 2: Update Socket.IO CORS in `socket/index.js`**

Replace the `cors` option in the `new Server(...)` call (lines 5-10):
```js
// Before:
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// After:
const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});
```

**Step 3: Update `.env.example`**

Add to `.env.example`:
```
# Comma-separated list of allowed frontend origins (default: localhost dev origins)
ALLOWED_ORIGIN=http://localhost:5173,http://localhost:3000
```

**Step 4: Manual verify**

Start the backend. Open a plain HTML file (served from a different port, e.g. via `npx serve`) that tries to fetch `http://localhost:3000/api/health`. The browser console should show a CORS error. Loading the actual frontend at `localhost:5173` should work normally.

**Step 5: Commit**

```bash
git add backend/server.js backend/socket/index.js .env.example
git commit -m "fix: restrict CORS to allowed origins instead of wildcard *"
```

---

### Task 4: Mark Aggregator Agent as Stub or Disable from Pipeline

**Files:**
- Modify: `backend/agents/aggregatorAgent.js:10-22`
- Modify: `backend/controller/sequentialController.js` (remove aggregator from `runSequence`)
- Modify: `frontend/src/types/index.ts` (or wherever `agents` array is defined — remove/mark aggregator)

**Step 1: Find the frontend `agents` array**

```bash
grep -r "aggregator" frontend/src --include="*.ts" --include="*.tsx" -l
```

Open the file(s) returned. It is likely `frontend/src/types/index.ts` or similar.

**Step 2: Add a `stub` flag to the agents definition**

In the frontend types file, find the agents array entry for `Aggregator Agent` and add `stub: true`:
```ts
{ id: 'Aggregator Agent', name: 'Aggregator', desc: 'Collects leads from job boards [STUB]', stub: true }
```

**Step 3: Update `AgentDashboard.tsx` to visually mark stub agents**

In `frontend/src/components/AgentDashboard.tsx`, update the agent card render to show a badge when `agent.stub` is true:
```tsx
<h3 className="font-semibold text-lg text-slate-200">{agent.name}</h3>
{agent.stub && (
  <span className="text-xs text-amber-400 border border-amber-500/30 rounded px-1 py-0.5 mt-0.5">STUB</span>
)}
```

Also disable the "Start" button for stub agents:
```tsx
<button
  onClick={() => handleStartAgent(agent.id)}
  disabled={state.status === 'Running' || agent.stub}
  title={agent.stub ? 'Not yet implemented' : undefined}
  ...
>
```

**Step 4: Remove aggregator from `runSequence` in controller**

In `backend/controller/sequentialController.js`, remove the line:
```js
await runAgent('Aggregator Agent', path.join(__dirname, '..', 'agents', 'aggregatorAgent.js'), prefs);
```

**Step 5: Add a clear stub warning at the top of `aggregatorAgent.js`**

At line 10 of `backend/agents/aggregatorAgent.js`, before `const run = async () =>`:
```js
console.warn('[aggregatorAgent] WARNING: This agent is a stub — no real scraping is performed.');
```

**Step 6: Manual verify**

Start frontend + backend. Confirm the Aggregator card shows `[STUB]` badge and its "Start" button is greyed out. Clicking "Start All" should only run LinkedIn and Naukri agents (check logs).

**Step 7: Commit**

```bash
git add backend/agents/aggregatorAgent.js backend/controller/sequentialController.js frontend/src/types/index.ts frontend/src/components/AgentDashboard.tsx
git commit -m "fix: mark aggregatorAgent as stub, disable from sequential pipeline and UI"
```

---

## Phase 2 — Important Fixes

---

### Task 5: Read LinkedIn Resume Name from Config Instead of Hardcoding

**Files:**
- Modify: `backend/agents/linkedinAgent.js:138`
- Modify: `backend/data/answers.json` (add key if not present)
- Modify: `.env.example` (document new env var)

**Step 1: Check `answers.json` for a resume name key**

```bash
type backend\data\answers.json
```

**Step 2: Add `resumeName` to `answers.json` if missing**

Add a key `"resume name"` to `backend/data/answers.json`:
```json
{
  "resume name": "onkar_doke_7745042879",
  ... existing keys ...
}
```

**Step 3: Update `linkedinAgent.js:138` to read from config**

Replace:
```js
const targetResume = 'onkar_doke_7745042879';
```
With:
```js
const targetResume = process.env.RESUME_NAME || presetAnswers['resume name'] || '';
if (!targetResume) {
    console.log('  No resume name configured (RESUME_NAME env or "resume name" in answers.json). Skipping named selection.');
    return;
}
```

**Step 4: Document in `.env.example`**

Add to `.env.example`:
```
# Name of the saved LinkedIn resume to select (must match exactly)
RESUME_NAME=your_resume_name_here
```

**Step 5: Manual verify**

Set `RESUME_NAME=nonexistent_resume` in `.env`. Run the LinkedIn agent up to the resume step and confirm it logs "Skipping named selection" and falls through to the file upload fallback. Then set the correct name and confirm it selects properly.

**Step 6: Commit**

```bash
git add backend/agents/linkedinAgent.js backend/data/answers.json .env.example
git commit -m "fix: read LinkedIn resume name from RESUME_NAME env / answers.json instead of hardcoded string"
```

---

### Task 6: Singleton `ChatGroq` Client + Exponential Back-off in `resumeQA.js`

**Files:**
- Modify: `backend/utils/resumeQA.js:12-58`

**Step 1: Move `ChatGroq` instantiation to module level**

Replace the per-call instantiation (inside `getAIAnswer`, around lines 54-58) with a lazy module-level singleton:

```js
// Add after the imports (around line 13), before cachedResumeText:
let _llmClient = null;
const getLLMClient = () => {
    if (!_llmClient) {
        _llmClient = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
        });
    }
    return _llmClient;
};
```

Then in `getAIAnswer`, replace the `new ChatGroq(...)` block with:
```js
const llm = getLLMClient();
```

**Step 2: Add exponential back-off around `llm.invoke()`**

Replace the direct `llm.invoke(formattedPrompt)` call with a retry helper:

```js
// Inline retry helper (no new dependency needed)
const invokeWithBackoff = async (llm, prompt, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await llm.invoke(prompt);
        } catch (err) {
            if (attempt === maxRetries) throw err;
            const isRateLimit = err?.status === 429 || (err?.message || '').includes('rate limit');
            if (!isRateLimit) throw err;
            const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            fs.appendFileSync(
                path.join(__dirname, '..', 'qa_logs.txt'),
                `[${new Date().toISOString()}] Groq rate limit hit (attempt ${attempt}). Retrying in ${delay}ms...\n`
            );
            await new Promise(r => setTimeout(r, delay));
        }
    }
};

// Then call:
const response = await invokeWithBackoff(llm, formattedPrompt);
```

**Step 3: Remove duplicate `modelName` key**

In the same file line 57, remove `modelName: "llama-3.1-8b-instant"` — `model` is sufficient.

**Step 4: Manual verify**

Run `node backend/test-qa.js` from the `backend/` directory. Confirm it still returns answers. Check `qa_logs.txt` for any rate-limit retry messages if you fire many questions rapidly.

**Step 5: Commit**

```bash
git add backend/utils/resumeQA.js
git commit -m "fix: singleton ChatGroq client, add exponential back-off on 429s, remove duplicate modelName"
```

---

### Task 7: Remove Duplicate `'graphql'` from `SKILL_TOKENS`

**Files:**
- Modify: `backend/utils/questionAnswerer.js:31`

**Step 1: Locate and remove the duplicate**

In `questionAnswerer.js`, the SKILL_TOKENS array contains `'graphql'` on both line 24 and line 31. Delete the second occurrence on line 31.

The corrected end of the array (lines 29-33) should look like:
```js
    'flutter', 'react native', 'android', 'ios', 'machine learning',
    'ml', 'artificial intelligence', 'ai', 'data science', 'pandas',
    'numpy', 'tensorflow', 'pytorch', 'next.js', 'nextjs',
    'nest', 'nestjs', 'spring boot', 'kafka', 'rabbitmq', 'jenkins',
    'ci/cd', 'terraform', 'ansible', 'elasticsearch'
```

**Step 2: Commit**

```bash
git add backend/utils/questionAnswerer.js
git commit -m "fix: remove duplicate 'graphql' entry from SKILL_TOKENS array"
```

---

### Task 8: Rolling Log Buffer — Don't Wipe Logs on Every Run

**Files:**
- Modify: `backend/controller/sequentialController.js:78,103`

**Step 1: Replace log-clear with a rolling buffer**

Define a max log size constant at the top of the file (after existing `let` declarations):
```js
const MAX_LOG_ENTRIES = 500;
```

In `addLog` (around line 19), after `currentState.logs.push(logStr)`, add a trim:
```js
const addLog = (message) => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const logStr = `[${timestamp}] ${message}`;
    currentState.logs.push(logStr);
    if (currentState.logs.length > MAX_LOG_ENTRIES) {
        currentState.logs = currentState.logs.slice(-MAX_LOG_ENTRIES);
    }
    console.log(message);
    engineEvents.emit('log', logStr);
};
```

In `runSequence` (line 78), **remove**:
```js
currentState.logs = []; // clear previous logs
```
Replace with a separator so users can distinguish runs:
```js
addLog('─────────────────────────────────────────────────');
addLog('--- Starting Universal Job Agent Sequence ---');
```
(Also remove the subsequent `addLog('--- Starting Universal Job Agent Sequence ---')` to avoid the duplicate.)

Similarly in `runSingleAgent` (line 103), **remove**:
```js
currentState.logs = [];
```
Replace with:
```js
addLog('─────────────────────────────────────────────────');
```

**Step 2: Commit**

```bash
git add backend/controller/sequentialController.js
git commit -m "fix: rolling 500-entry log buffer instead of wiping logs on each run"
```

---

### Task 9: Fix Synchronous `fs.readFileSync` in `routes/api.js`

**Files:**
- Modify: `backend/routes/api.js:38-46`

**Step 1: Make the `GET /failed-jobs` handler async**

Replace lines 36-47 in `api.js`:
```js
router.get('/failed-jobs', (req, res) => {
    const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
    if (!fs.existsSync(failedJobsPath)) {
        return res.json([]);
    }
    try {
        const jobs = JSON.parse(fs.readFileSync(failedJobsPath, 'utf8'));
        res.json(jobs);
    } catch (e) {
        res.json([]);
    }
});
```
With:
```js
router.get('/failed-jobs', async (req, res) => {
    const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
    try {
        const raw = await fs.promises.readFile(failedJobsPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        // File missing or invalid JSON — return empty list
        res.json([]);
    }
});
```

> **Note:** `fs.existsSync` is also a blocking call. The try/catch on `readFile` handles the missing-file case (ENOENT), so the `existsSync` pre-check is no longer needed.

**Step 2: Commit**

```bash
git add backend/routes/api.js
git commit -m "fix: use async fs.promises.readFile for failed-jobs endpoint"
```

---

### Task 10: Fix Naukri Chatbot Loop — Wait for Each Question Before Answering

**Files:**
- Modify: `backend/agents/naukriAgent.js:194-228`

**Step 1: Understand the current broken flow**

The current code:
1. Checks if `.chatbot` selector exists.
2. Grabs ALL `.msg-content` elements at once (they only have the first question at this point).
3. Loops and "answers" them, but the next question only appears after the previous is submitted.

**Step 2: Replace static scrape with an iterative wait-and-answer loop**

Replace the chatbot block (lines 195-228) with:

```js
const hasQuestions = await newPage.$('.chatbot, .bot-container, .layer-wrap');
if (hasQuestions) {
    console.log('Additional questions detected. Attempting to answer...');
    const MAX_CHAT_STEPS = 15; // safety cap
    let chatStep = 0;

    while (chatStep < MAX_CHAT_STEPS) {
        chatStep++;
        // Wait for a new bot message to appear
        try {
            await newPage.waitForFunction(
                () => document.querySelectorAll('.msg-content, .botMsg').length > 0,
                { timeout: 5000 }
            );
        } catch (_) {
            // No more questions appeared — chatbot done
            break;
        }

        // Get the LAST bot message (newest question)
        const questionText = await newPage.evaluate(() => {
            const bubbles = Array.from(document.querySelectorAll('.msg-content, .botMsg'));
            const last = bubbles[bubbles.length - 1];
            return last ? (last.innerText || '') : '';
        });

        if (!questionText.trim()) break;
        console.log(`  Chat Q${chatStep}: "${questionText.trim()}"`);

        const bestMatch = await getAnswer(questionText, presetAnswers) || '0';
        console.log(`  Chat A${chatStep}: "${bestMatch}"`);

        // Type and submit the answer
        await newPage.evaluate((answer) => {
            const inputs = Array.from(document.querySelectorAll(
                'input[type="text"], input[type="number"], textarea'
            ));
            const emptyInput = inputs.find(inp => !inp.value);
            if (emptyInput) {
                emptyInput.value = answer;
                emptyInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const submitBtns = Array.from(document.querySelectorAll('button'));
            for (const btn of submitBtns) {
                const t = btn.innerText ? btn.innerText.toLowerCase() : '';
                if (t.includes('save') || t.includes('submit') || t.includes('send') || t.includes('next')) {
                    btn.click();
                    break;
                }
            }
        }, bestMatch);

        await new Promise(r => setTimeout(r, 1500));

        // Check if chatbot closed (success) — if so, exit loop
        const chatClosed = await newPage.$('.chatbot, .bot-container, .layer-wrap')
            .then(el => !el).catch(() => true);
        if (chatClosed) break;
    }
}
```

**Step 3: Commit**

```bash
git add backend/agents/naukriAgent.js
git commit -m "fix: naukri chatbot loop now waits for each question before answering (iterative, not batch)"
```

---

### Task 11: Fix Wildcard SPA Route Swallowing API 404s

**Files:**
- Modify: `backend/server.js:30`

**Step 1: Narrow the wildcard route**

Replace line 30 in `backend/server.js`:
```js
// Before:
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// After:
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});
```

**Step 2: Verify**

Start the backend. Run:
```bash
curl http://localhost:3000/api/nonexistent-route
```
Before the fix you'd get an HTML `index.html` response. After the fix the response should be an Express 404 (plain "Cannot GET /api/nonexistent-route"). The frontend should still serve normally at `http://localhost:3000/`.

**Step 3: Commit**

```bash
git add backend/server.js
git commit -m "fix: wildcard SPA route now excludes /api paths to prevent swallowing API 404s"
```

---

## Phase 3 — Minor Fixes

---

### Task 12: Add Env Var Validation on Backend Startup

**Files:**
- Create: `backend/utils/validateEnv.js`
- Modify: `backend/server.js` (import and call at startup)

**Step 1: Create `backend/utils/validateEnv.js`**

```js
'use strict';

const REQUIRED_VARS = ['GROQ_API_KEY'];
const RECOMMENDED_VARS = ['JOB_TITLE', 'RESUME_NAME'];

function validateEnv() {
    const missing = REQUIRED_VARS.filter(v => !process.env[v]);
    const missingRec = RECOMMENDED_VARS.filter(v => !process.env[v]);

    if (missing.length > 0) {
        console.error('\n❌ Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('\nPlease copy .env.example to .env and fill in the missing values.\n');
        process.exit(1);
    }

    if (missingRec.length > 0) {
        console.warn('\n⚠️  Missing recommended environment variables (will use defaults):');
        missingRec.forEach(v => console.warn(`   - ${v}`));
        console.warn('');
    }
}

module.exports = { validateEnv };
```

**Step 2: Call `validateEnv` in `server.js` after dotenv loads**

In `backend/server.js`, after line 6 (`dotenv.config(...)`), add:
```js
const { validateEnv } = require('./utils/validateEnv');
validateEnv();
```

**Step 3: Update `.env.example` to reflect all required/recommended keys**

Ensure `.env.example` lists all keys from `REQUIRED_VARS` and `RECOMMENDED_VARS`:
```
GROQ_API_KEY=your_groq_api_key_here
JOB_TITLE=Frontend Developer,Full Stack Developer
LOCATION=Remote
RESUME_NAME=your_resume_filename_here
ALLOWED_ORIGIN=http://localhost:5173,http://localhost:3000
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

**Step 4: Verify**

Start the backend with `GROQ_API_KEY` unset (comment it out in `.env`). The server should exit immediately with a clear error message. Restore the key and confirm the backend starts normally.

**Step 5: Commit**

```bash
git add backend/utils/validateEnv.js backend/server.js .env.example
git commit -m "fix: add startup env var validation with clear error messages"
```

---

### Task 13: Add Jest Tests for `questionAnswerer.js`

**Files:**
- Modify: `backend/package.json` (add Jest dependency + test script)
- Create: `backend/__tests__/questionAnswerer.test.js`

**Step 1: Install Jest**

```bash
cd backend
npm install --save-dev jest
```

**Step 2: Update `backend/package.json` test script**

Change the `scripts` section:
```json
"scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test": "jest",
    "test-qa": "node test-qa.js"
}
```

**Step 3: Create `backend/__tests__/questionAnswerer.test.js`**

```js
'use strict';

// Mock resumeQA to avoid network calls in unit tests
jest.mock('../utils/resumeQA', () => ({
    getAIAnswer: jest.fn().mockResolvedValue(null)
}));

const { getAnswer, normalizeText, getBestFuzzyMatch } = require('../utils/questionAnswerer');

const sampleUser = {
    experience: '3',
    react: '2',
    salary: '800000',
    'notice period': '30',
    github: 'https://github.com/testuser',
    linkedin: 'https://linkedin.com/in/testuser',
    gender: 'Male',
    english: 'Fluent',
    education: 'Bachelor of Engineering'
};

describe('normalizeText', () => {
    test('lowercases and strips punctuation', () => {
        expect(normalizeText('Hello, World!')).toBe('hello world');
    });

    test('collapses whitespace', () => {
        expect(normalizeText('  two   spaces  ')).toBe('two spaces');
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });
});

describe('getAnswer — rule-based', () => {
    test('returns react experience for React question', async () => {
        const answer = await getAnswer('How many years of experience do you have in React?', sampleUser);
        expect(answer).toBe('2');
    });

    test('returns general experience for generic experience question', async () => {
        const answer = await getAnswer('How many years of total experience do you have?', sampleUser);
        expect(answer).toBe('3');
    });

    test('returns Yes for work authorization question', async () => {
        const answer = await getAnswer('Are you legally authorized to work in India?', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns salary for CTC question', async () => {
        const answer = await getAnswer('What is your expected CTC?', sampleUser);
        expect(answer).toBe('800000');
    });

    test('returns notice period', async () => {
        const answer = await getAnswer('What is your notice period?', sampleUser);
        expect(answer).toBe('30');
    });

    test('returns GitHub URL for github question', async () => {
        const answer = await getAnswer('What is your GitHub profile URL?', sampleUser);
        expect(answer).toBe('https://github.com/testuser');
    });

    test('returns Yes for consent / I certify question', async () => {
        const answer = await getAnswer('I certify that all of the above is true.', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns No for sponsorship question with no user data', async () => {
        const answer = await getAnswer('Do you require visa sponsorship?', {});
        expect(answer).toBe('No');
    });

    test('returns Yes for remote work question', async () => {
        const answer = await getAnswer('Are you open to remote work?', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns gender', async () => {
        const answer = await getAnswer('What is your gender?', sampleUser);
        expect(answer).toBe('Male');
    });
});

describe('getBestFuzzyMatch', () => {
    test('finds close match above threshold', () => {
        const result = getBestFuzzyMatch('github profile', { github: 'https://github.com/x' });
        expect(result).toBe('https://github.com/x');
    });

    test('returns null for no match', () => {
        const result = getBestFuzzyMatch('zzz unrelated zzz xyz', { github: 'val' });
        expect(result).toBeNull();
    });

    test('returns null for empty userData', () => {
        const result = getBestFuzzyMatch('anything', {});
        expect(result).toBeNull();
    });
});
```

**Step 4: Run tests and confirm they pass**

```bash
cd backend
npm test
```

Expected output: all tests in the `questionAnswerer.test.js` suite pass (`PASS`). The `resumeQA` module is mocked so no network calls are made.

**Step 5: Commit**

```bash
git add backend/__tests__/questionAnswerer.test.js backend/package.json
git commit -m "test: add Jest unit tests for questionAnswerer rule-based and fuzzy matching"
```

---

### Task 14: Fix React Log Key and Log Coloring in `AgentDashboard.tsx`

**Files:**
- Modify: `frontend/src/components/AgentDashboard.tsx:158-172`

**Step 1: Fix `key` prop — use compound key instead of array index**

Replace:
```tsx
state.logs.map((log, i) => {
  ...
  return (
    <div key={i} className={...}>
```
With:
```tsx
state.logs.map((log, i) => {
  ...
  return (
    <div key={`${i}-${log.slice(0, 20)}`} className={...}>
```

**Step 2: Fix overlapping `isError`/`isWarning` check for `✗`**

Replace the coloring logic:
```tsx
// Before (isWarning also matches ✗ — dead branch):
const isError = log.includes('ERROR') || log.includes('✗');
const isSuccess = log.includes('✓') || log.includes('Completed Successfully');
const isWarning = log.includes('✗') || log.includes('failed') || log.includes('Discarding');

// After (clean separation):
const isError = log.includes('[ERROR]') || log.includes('Fatal');
const isSuccess = log.includes('✓') || log.includes('Completed Successfully');
const isWarning = log.includes('✗') || log.includes('failed') || log.includes('Discarding') || log.includes('ERROR');
```

This makes `✗` entries render as `isWarning` (amber) rather than `isError` (rose), matching the intended "failed application" colour. Actual crashes from `[ERROR]` tags remain rose.

**Step 3: Commit**

```bash
git add frontend/src/components/AgentDashboard.tsx
git commit -m "fix: stable React log key, fix isError/isWarning overlap in AgentDashboard"
```

---

### Task 15: Archive Scratch Test Files + Update `.gitignore`

**Files:**
- Modify: `.gitignore`

**Step 1: Add scratch file patterns to `.gitignore`**

Open `.gitignore` and find the existing section for test files. Add:
```
# Scratch / ad-hoc test files (use __tests__/ with Jest instead)
backend/debug.js
backend/debug-output.txt
backend/test-pdf.js
backend/test-pdf-invoke.js
backend/test-pdf-log.txt
backend/test-pdf-out.txt
backend/test-qa.js
backend/qa_logs.txt
```

**Step 2: Remove tracked files from git index (keep on disk)**

```bash
git rm --cached backend/debug.js backend/test-pdf.js backend/test-qa.js backend/debug-output.txt backend/test-pdf-invoke.js backend/test-pdf-log.txt backend/test-pdf-out.txt backend/qa_logs.txt
```

> These files will still exist on disk but will no longer be tracked by git. If any of these files don't exist, the `git rm --cached` will just skip them.

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore scratch test files, remove them from git tracking"
```

---

## Verification Plan

### Automated Tests

After completing all tasks, run the Jest test suite:

```bash
cd backend
npm test
```

Expected: All tests in `__tests__/questionAnswerer.test.js` pass. No `resumeQA` network call is made (verified by the mock).

### Manual Verification Checklist

Run the backend and frontend together:

```bash
# Terminal 1 — backend
cd backend && node server.js

# Terminal 2 — frontend
cd frontend && npm run dev
```

Then open `http://localhost:5173` and verify each fix:

| # | What to check | Expected result |
|---|--------------|----------------|
| 1 | Start a run, immediately click Stop | Server log shows `Interrupting process...` and all browser windows close. No orphan processes in Task Manager. |
| 2 | Naukri run against one live job | Terminal shows `✓ Application confirmed` or the fallback warning, not a blind increment. |
| 3 | Open `http://127.0.0.2:5500` (a different origin) and fetch `localhost:3000/api/health` | Browser console shows CORS error. Frontend at `localhost:5173` still works. |
| 4 | Dashboard loads | Aggregator card shows `[STUB]` badge; its Start button is disabled/greyed out. Start All runs only 2 agents. |
| 5 | Remove `RESUME_NAME` from `.env`, run LinkedIn | Logs show "No resume name configured. Skipping named selection." and falls through to file upload. |
| 6 | Start backend without `GROQ_API_KEY` in `.env` | Server exits immediately with `❌ Missing required environment variables: GROQ_API_KEY`. |
| 7 | `curl http://localhost:3000/api/nonexistent` | Returns Express 404 text, not `index.html`. |
| 8 | Run multiple Start All sequences | Logs from previous runs are still visible (separated by a divider line), not wiped. |
