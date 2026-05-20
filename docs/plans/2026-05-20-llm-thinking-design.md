# Design Document: LLM Thinking & Answering Integration

This document outlines the design for upgrading the AI Q&A engine in Auto-Apply Pro to use a reasoning LLM (e.g. DeepSeek-R1 Distill on Groq) utilizing both the user's parsed resume and the structured profile data (`answers.json`).

## Goal
Improve the accuracy and dynamic reasoning of the auto-apply form filler. Currently, the system relies almost exclusively on static keyword matching (`answers.json`), rarely triggering the LLM. When it does trigger, the LLM uses a standard model without a reasoning/thinking process and lacks the context of the user's structured profile data.

## Proposed Changes

### 1. Configuration
We will introduce two new optional environment variables:
- `GROQ_MODEL`: Specifies the Groq API model. Defaults to `deepseek-r1-distill-llama-70b` for deep reasoning.
- `LLM_FIRST`: Boolean toggle (`true`/`false`). If set to `true`, the engine runs the LLM *first* for all fields, using rules and fuzzy match only as a fallback. If `false` (default), it uses a smart hybrid flow.

### 2. Prompt Enhancement (`backend/utils/resumeQA.js`)
We will pass both the parsed resume PDF and the keys/values from `answers.json` to the LLM.
The prompt will structure these as:
- `PROFILE DATA`: A formatted list of keys and values from the user profile.
- `RESUME TEXT`: Raw text extracted from the user's resume.

### 3. Smart Hybrid Precedence (`backend/utils/questionAnswerer.js`)
We will rewrite the precedence logic in `getAnswer`:
- **If `LLM_FIRST = false`**:
  1. Rule-based Match (fast path for obvious keys like name, email, phone).
  2. Fuzzy Match (simple string similarity for exact profile keys).
  3. LLM Reasoning (passes question + resume + full answers profile as context).
- **If `LLM_FIRST = true`**:
  1. LLM Reasoning.
  2. Rule-based Match (fallback).
  3. Fuzzy Match (fallback).

### 4. Thinking Parser (`backend/utils/resumeQA.js`)
Since reasoning models wrap their thinking process inside `<think>...</think>` tags, we will implement a clean-up utility to strip these blocks and extract only the final answer.

```javascript
let answer = (response.content || '').trim();
answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
answer = answer.split('\n')[0].trim();
answer = answer.replace(/\.$/, '').trim();
```

## Verification Plan

### Automated Verification
We will update `backend/__tests__/questionAnswerer.test.js` to ensure:
1. Precedence logic handles `LLM_FIRST` flags correctly.
2. The prompt format contains the profile data block.
3. The thinking parser correctly extracts answers and strips `<think>` blocks.

### Manual Verification
1. Run a test job application run with the debug command.
2. Inspect `backend/qa_logs.txt` to verify that the LLM is invoked and that reasoning tags are correctly parsed.
