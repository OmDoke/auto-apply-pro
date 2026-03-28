# LinkedIn Form Wizard Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Implement a robust 'Form Wizard' handler for LinkedIn Easy Apply that iteratively navigates steps, intelligently handles dropdowns/radios with context-aware AI fallback, and correctly detects validation errors.

**Architecture:** We will enhance the existing `fillFormFields` to extract available dropdown options and pass them to the AI engine (`resumeQA.js`) so it can make an informed choice. The iterative loop (`attemptApply`) will be updated to check for validation errors after clicking "Review". We will preserve the existing `questionAnswerer.js` as the primary tier.

**Tech Stack:** Node.js, Puppeteer, Groq LLM (via LangChain)

---

### Task 1: Context-Aware AI Fallback in `resumeQA.js`

**Files:**
- Modify: `c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/utils/resumeQA.js`

**Step 1: Write the failing test**
Instead of a formal test file for the AI (to avoid network calls in standard tests), we will run a targeted manual test or update the prompt string.

**Step 2: Write minimal implementation**
Modify `getAIAnswer` to accept a `context` object containing `options`. If `options` exist, append a strict instruction to the prompt.

```javascript
// In backend/utils/resumeQA.js
// Update the signature:
async function getAIAnswer(questionText, context = {}) {
// ...
        let optionsPrompt = '';
        if (context.options && context.options.length > 0) {
            optionsPrompt = `You MUST choose exactly one of the following options: [${context.options.join(', ')}]. Do not invent a new answer. Return ONLY the exact text of the best matching option.`;
        }

        const prompt = PromptTemplate.fromTemplate(`
You are helping a job applicant fill out application forms to secure interviews.
Question: {question}

Resume details:
{resumeText}

{optionsPrompt}
Answer the question briefly and accurately based on the applicant's resume.
If it is a Yes/No question, answer only "Yes" or "No".
If it asks for a number, return only the number.
Provide only the final answer without any explanation.
`);

        const formattedPrompt = await prompt.format({
            resumeText: resumeText,
            question: questionText,
            optionsPrompt: optionsPrompt
        });
// ...
```

**Step 3: Commit**
```bash
git add backend/utils/resumeQA.js
git commit -m "feat: add context-aware options support to Groq AI fallback"
```

---

### Task 2: Pass Context Through `questionAnswerer.js`

**Files:**
- Modify: `c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/utils/questionAnswerer.js`

**Step 1: Write minimal implementation**
Pass the `context` argument from `getAnswer` down to `getAIAnswer`. No changes needed in rule-based or fuzzy sections, just pass it along at the end. Note: We already have rules for "Yes" to consent/authorization and "No" for sponsorship in the rule-based section.

```javascript
// In backend/utils/questionAnswerer.js
// Update the signature
async function getAnswer(questionText, userData, context = {}) {
// ...
    // 3. Fallback to Groq AI
    try {
        const aiAnswer = await getAIAnswer(questionText, context);
        if (aiAnswer) {
            return aiAnswer;
        }
    } catch (e) {
// ...
```

**Step 2: Commit**
```bash
git add backend/utils/questionAnswerer.js
git commit -m "feat: pass context options through questionAnswerer to AI fallback"
```

---

### Task 3: Extract Options & Improve Radio/Select Filling in `linkedinAgent.js`

**Files:**
- Modify: `c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/agents/linkedinAgent.js`

**Step 1: Write minimal implementation**
Update `fillFormFields` to extract dropdown options from the DOM, pass them to `getAnswer`, and reliably select the AI's choice.

```javascript
// In backend/agents/linkedinAgent.js (Replace the page.evaluate inside fillFormFields and the subsequent loop)

    // Collect all form groups, label texts, and available options for dropdowns/radios
    const formGroups = await page.evaluate(() => {
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
        // Pass context containing options to our answer engine
        const answer = await getAnswer(questionText, answers, { type, options });
        if (!answer) continue;

        await page.evaluate(({ idx, answer }) => {
            const groups = Array.from(document.querySelectorAll(
                '.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element__fields'
            ));
            const group = groups[idx];
            if (!group) return;

            // Handle Text Inputs
            const textInput = group.querySelector('input[type="text"], input[type="number"], input[type="tel"], input[type="email"], textarea, .fb-single-line-text__input');
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

            // Handle Select Dropdowns
            const selectEl = group.querySelector('select');
            if (selectEl && (!selectEl.value || selectEl.value === '' || selectEl.value.toLowerCase().includes('select'))) {
                const opts = Array.from(selectEl.options);
                for (const opt of opts) {
                    if (opt.text.toLowerCase().includes(answer.toLowerCase()) || opt.value.toLowerCase() === answer.toLowerCase()) {
                        selectEl.value = opt.value;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
                return;
            }

            // Handle Radio Buttons
            const radioLabels = Array.from(group.querySelectorAll('label'));
            for (const rLabel of radioLabels) {
                if (rLabel.innerText.toLowerCase().trim() === answer.toLowerCase().trim() || rLabel.innerText.toLowerCase().includes(answer.toLowerCase())) {
                    rLabel.click();
                    break;
                }
            }
        }, { idx, answer });
    }
```

**Step 2: Commit**
```bash
git add backend/agents/linkedinAgent.js
git commit -m "feat: extract and utilize form options for AI fallback in linkedinAgent"
```

---

### Task 4: Error Detection on "Review" Step

**Files:**
- Modify: `c:/Users/Admin/Desktop/tech/auto-apply-pro/backend/agents/linkedinAgent.js`

**Step 1: Write minimal implementation**
In `attemptApply`, the current loop handles clicking 'Review'. We need to add the same validation error check after clicking 'Review' that currently exists after clicking 'Next'.

```javascript
// In backend/agents/linkedinAgent.js (inside attemptApply, specifically the reviewBtn block)

        } else if (reviewBtn) {
            btnToClick = reviewBtn.btn;
            btnType = 'review';
            console.log('  Clicking "Review"...');
            await btnToClick.click();
            clicked = true;
            await new Promise(r => setTimeout(r, 1500));

            // Check for validation errors after clicking Review
            const errors = await page.$$('.artdeco-inline-feedback--error');
            if (errors.length > 0) {
                console.log(`  Validation errors on step after Review (attempt ${attemptNum}).`);
                return 'failed';
            }

```

**Step 2: Commit**
```bash
git add backend/agents/linkedinAgent.js
git commit -m "fix: detect validation errors after clicking Review button"
```
