# LLM Thinking & Answering Integration Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Upgrade the AI Q&A engine to use a reasoning LLM (DeepSeek-R1 Distill on Groq) utilizing both the user's parsed resume and the structured profile data (`answers.json`), and only use static/rule-based matching for simple, deterministic fields.

**Architecture:** 
1. Introduce `GROQ_MODEL` and `LLM_FIRST` environment variables.
2. In `backend/utils/resumeQA.js`, format the user profile data (`userData`) and feed it alongside the resume PDF text to the LLM. Update `getAIAnswer` to support reasoning models and strip `<think>...</think>` blocks.
3. In `backend/utils/questionAnswerer.js`, update `getAnswer` to route dynamic questions (like experience, notice period, salary) to the LLM first in the hybrid flow, and all questions to the LLM first if `LLM_FIRST=true`.
4. Fix the broken existing test case in `backend/__tests__/questionAnswerer.test.js` and add new test coverage.

**Tech Stack:** Node.js, @langchain/groq, Jest, dotenv

---

## Proposed Changes

### Task 1: Configuration Updates

**Files:**
- Modify: [validateEnv.js](file:///c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/utils/validateEnv.js)
- Modify: [.env.example](file:///c:/Users/Admin/Desktop/tech/auto-apply-pro/.env.example)

**Step 1: Update environment variable validation**
Modify `backend/utils/validateEnv.js` to allow `GROQ_MODEL` and `LLM_FIRST` as recommended variables.
```javascript
const RECOMMENDED_VARS = ['JOB_TITLE', 'RESUME_NAME', 'GROQ_MODEL', 'LLM_FIRST'];
```

**Step 2: Update example environment file**
Modify `.env.example` to include the new variables.
```env
GROQ_MODEL=deepseek-r1-distill-llama-70b
LLM_FIRST=false
```

**Step 3: Commit**
```bash
git add backend/utils/validateEnv.js .env.example
git commit -m "feat: add GROQ_MODEL and LLM_FIRST configuration options"
```

---

### Task 2: Update LLM Client and Prompt with Profile Context

**Files:**
- Modify: [resumeQA.js](file:///c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/utils/resumeQA.js)

**Step 1: Implement Profile Context Formatting and Thinking Stripper**
Update `backend/utils/resumeQA.js` to:
1. Initialize the LLM client using `process.env.GROQ_MODEL || 'deepseek-r1-distill-llama-70b'`.
2. Format `userData` as `PROFILE DATA:` key-value text block.
3. Pass `profile_data` into the template format step.
4. Clean the generated answer by stripping `<think>...</think>` tags and content.

Update the `getLLMClient` function:
```javascript
const getLLMClient = () => {
    if (!_llmClient) {
        const modelName = process.env.GROQ_MODEL || 'deepseek-r1-distill-llama-70b';
        _llmClient = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: modelName,
            temperature: 0.1,
        });
    }
    return _llmClient;
};
```

Update `getAIAnswer` signature and implementation:
```javascript
async function getAIAnswer(questionText, context = {}, userData = {}) {
    if (!process.env.GROQ_API_KEY) {
        fs.appendFileSync(
            path.join(__dirname, '..', 'qa_logs.txt'),
            `[${new Date().toISOString()}] No GROQ_API_KEY set.\n`
        );
        return null;
    }

    const resumeText = await getResumeText();
    
    // Format profile data context from userData and cached profile
    const mergedProfile = { ...userData };
    let profileDataString = '';
    for (const [key, val] of Object.entries(mergedProfile)) {
        if (val !== undefined && val !== null && val !== '') {
            profileDataString += `${key}: ${val}\n`;
        }
    }
    if (!profileDataString.trim()) {
        profileDataString = 'None available.';
    }

    let optionsPrompt = '';
    if (context.options && context.options.length > 0) {
        optionsPrompt = `\n5. DROPDOWN/RADIO OPTIONS:\nYou MUST choose exactly ONE of the following options: [${context.options.join(', ')}]\nDo not invent a new answer. Return ONLY the exact text of the best matching option.`;
    }

    try {
        const llm = getLLMClient();

        const prompt = PromptTemplate.fromTemplate(`
You are helping a job applicant fill out application forms to secure interviews.
Use the resume text and profile data below to answer the question. FOLLOW ALL RULES STRICTLY.

PROFILE DATA:
{profile_data}

RESUME TEXT:
{resume_text}

RULES:
1. NUMERIC FIELDS (years, decimal, days, number): Output ONLY a single number. No text, no units, no period at end.
   - Notice period / can you start immediately / joining time → "15"  (this candidate has a 15-day notice period)
   - Total years of relevant experience → sum internships + full-time roles from dates on resume to today
   - Years of experience in a specific skill → look at work experience dates, estimate overlap
2. YES/NO QUESTIONS: Output only "Yes" or "No". No period at end.
   - Comfortable / willing / open to / available / agree → "Yes"
   - Prior employment at a company NOT in the resume → "No"
   - Uncertain yes/no → "Yes" (benefit of the doubt)
3. SHORT OPEN TEXT: One short phrase or sentence. No paragraphs, no preamble.
   - Use profile data and resume content directly where available
   - For current/expected salary: current = 2, expected = 6
4. UNKNOWN: If you truly have no idea and no sensible default exists, output exactly: I don't know{options_prompt}

Current Date: {current_date}

Question:
{question}

Answer:`);

        const formattedPrompt = await prompt.format({
            profile_data: profileDataString,
            resume_text: resumeText || 'No resume text available.',
            current_date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            question: questionText
        });

        const response = await invokeWithBackoff(llm, formattedPrompt);

        // Clean up the answer: strip <think> blocks, trim whitespace, strip trailing period, take first line
        let answer = (response.content || '').trim();
        answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        answer = answer.split('\n')[0].trim();  // take first line if multi-line
        answer = answer.replace(/\.$/, '').trim(); // strip trailing period

        fs.appendFileSync(
            path.join(__dirname, '..', 'qa_logs.txt'),
            `[${new Date().toISOString()}] Q: "${questionText}" -> A: "${answer}"\n`
        );

        if (/i\s+don'?t\s+know/i.test(answer)) {
            return null;
        }

        return answer || null;
    } catch (error) {
        fs.appendFileSync(
            path.join(__dirname, '..', 'qa_logs.txt'),
            `[${new Date().toISOString()}] Error invoking Groq LLM: ${error}\n`
        );
        return null;
    }
}
```

**Step 2: Commit**
```bash
git add backend/utils/resumeQA.js
git commit -m "feat: upgrade LLM prompt with profile context and add thinking parser"
```

---

### Task 3: Refactor questionAnswerer Precedence and Rules

**Files:**
- Modify: [questionAnswerer.js](file:///c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/utils/questionAnswerer.js)

**Step 1: Modify Precedence in `getAnswer`**
Update `getAnswer` in `backend/utils/questionAnswerer.js` to:
1. Retrieve `LLM_FIRST` environment variable.
2. Route "dynamic" questions to the LLM first. A question is dynamic if it contains keywords like `experience`, `years`, `notice`, `joining`, `salary`, `ctc`, `compensation`, `package`, `lpa`, `sponsorship`, `sponsor`, `relocat`, `remote`, `work from home`, `education`, `degree`, `bachelor`, `master`, `phd`, `graduation`, `certificat`, `cover letter`, `summary`, `about yourself`, `why us`.
3. If `LLM_FIRST === 'true'`, route *all* questions to the LLM first, falling back to rules/fuzzy matching.
4. Pass `userData` as the third parameter to `getAIAnswer`.

Implement in `backend/utils/questionAnswerer.js`:
```javascript
const getAnswer = async (questionText, userData, context = {}) => {
    if (!questionText || !userData) return null;

    const normalized = normalizeText(questionText);
    const llmFirst = process.env.LLM_FIRST === 'true';

    // List of keywords that warrant dynamic LLM reasoning
    const DYNAMIC_KEYWORDS = [
        'experience', 'years', 'notice', 'joining', 'salary', 'ctc',
        'compensation', 'package', 'lpa', 'sponsorship', 'sponsor',
        'relocat', 'remote', 'work from home', 'education', 'degree',
        'bachelor', 'master', 'phd', 'graduation', 'certificat',
        'cover letter', 'summary', 'about yourself', 'why us'
    ];

    const isDynamicQuestion = DYNAMIC_KEYWORDS.some(kw => normalized.includes(kw));

    // Helper to evaluate static rules and fuzzy matches
    const getStaticAnswer = (normQ, uData, ctx) => {
        let ruleAnswer = ruleBasedMatch(normQ, uData, ctx);
        if (ruleAnswer !== null && ctx.options && ctx.options.length > 0) {
            const lowerOpts = ctx.options.map(o => o.toLowerCase());
            const isYesNoField = lowerOpts.includes('yes') && lowerOpts.includes('no') && ctx.options.length <= 3;
            if (isYesNoField) {
                const ruleAnswerLower = ruleAnswer.toLowerCase();
                if (!lowerOpts.includes(ruleAnswerLower)) {
                    ruleAnswer = null;
                }
            }
        }
        if (ruleAnswer !== null) return ruleAnswer;

        const fuzzyAnswer = getBestFuzzyMatch(normQ, uData);
        if (fuzzyAnswer !== null) return fuzzyAnswer;

        return null;
    };

    // Flow 1: LLM First override
    if (llmFirst) {
        const aiAnswer = await getAIAnswer(questionText, context, userData);
        if (aiAnswer !== null) return aiAnswer;

        // Fallback to rules/fuzzy
        const staticAnswer = getStaticAnswer(normalized, userData, context);
        if (staticAnswer !== null) return staticAnswer;
    } else {
        // Flow 2: Smart Hybrid
        // If it's a dynamic question, try LLM first
        if (isDynamicQuestion) {
            const aiAnswer = await getAIAnswer(questionText, context, userData);
            if (aiAnswer !== null) return aiAnswer;
        }

        // Try static/rules + fuzzy matching
        const staticAnswer = getStaticAnswer(normalized, userData, context);
        if (staticAnswer !== null) return staticAnswer;

        // If not matched yet, and it wasn't dynamic, try LLM as fallback
        if (!isDynamicQuestion) {
            const aiAnswer = await getAIAnswer(questionText, context, userData);
            if (aiAnswer !== null) return aiAnswer;
        }
    }

    // 4. Final safety-net: obvious yes/no questions default to "Yes"
    const isYesNo = /\b(are you|do you|have you|can you|will you|would you|is your|were you|did you)\b/i.test(questionText) && !/\b(how many|how much|what|who|where|when|why|describe|explain)\b/i.test(questionText);
    if (isYesNo) return 'Yes';

    return null;
};
```

**Step 2: Commit**
```bash
git add backend/utils/questionAnswerer.js
git commit -m "feat: restructure question answering precedence logic for Smart Hybrid and LLM_FIRST modes"
```

---

### Task 4: Add Unit Tests and Verify

**Files:**
- Modify: [questionAnswerer.test.js](file:///c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/__tests__/questionAnswerer.test.js)

**Step 1: Fix notice period test assertion and add new tests**
Update `backend/__tests__/questionAnswerer.test.js` to:
1. Fix the assertion for `'returns notice period'` to expect `"30"` (since it is loaded from the mock `sampleUser` which overrides loaded config).
2. Add a test suite verifying `<think>` block stripping.
3. Add a test verifying `LLM_FIRST = true` logic flows.

**Step 2: Run all tests**
Run: `npm test --prefix backend`
Expected: All tests pass.

**Step 3: Commit**
```bash
git add backend/__tests__/questionAnswerer.test.js
git commit -m "test: fix existing notice period test and add new coverage for LLM thinking and custom precedence modes"
```

---

## Verification Plan

### Automated Tests
- `npm test --prefix backend` to verify the entire test suite passes.

### Manual Verification
- Check generated prompts and stripped outputs in `backend/qa_logs.txt` after a dry run.
