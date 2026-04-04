# Base Agent Architecture and Expanded Reach Design

**Date:** 2026-03-28
**Goal:** Improve project architecture for massive code reuse and expand job application reach by sequentially adding Indeed, Glassdoor, and Wellfound agents.

## 1. Overview and Approach
Currently, `linkedinAgent.js` and `naukriAgent.js` contain massive duplication. Both independently launch Puppeteer, configure `userDataDir`, handle `SIGINT` (stop) signals, manage the `failedJobs` array, and interact with `failed_jobs.json`.

Following **Approach 2 (Base Agent Class)**, we will create a unified `BaseAgent` class that abstracts all of this boilerplate away. Future platforms like Indeed, Glassdoor, and Wellfound will inherit from this class and only need to implement page-specific interaction logic (search + apply iterations).

## 2. Architecture & Components
*   **`backend/agents/BaseAgent.js` (NEW):**
    *   **Methods:** `initializeBrowser()`, `closeBrowser()`, `saveFailedJobs()`, `handleGracefulShutdown()`.
    *   **State:** Holds the `browser`, `page`, `failedJobs` array, and `stopped` flag.
*   **Refactored Existing Agents:** 
    *   `linkedinAgent.js` and `naukriAgent.js` will be converted to ES6 Classes (`class LinkedinAgent extends BaseAgent`).
    *   Their `run()` method will simply call `super.initializeBrowser()`, execute custom scraping logic, and catch fatal errors to `super.closeBrowser()`.
*   **New Expanded Agents:**
    *   `indeedAgent.js`, `glassdoorAgent.js`, and `wellfoundAgent.js` will be scaffolded as stub classes extending `BaseAgent`, ready for their specific DOM traversal logic to be filled in.
*   **Controller Updates:**
    *   `sequentialController.js` and `frontend/src/types/index.ts` will be updated to include the 3 new platforms in the execution pipeline and dashboard UI.

## 3. Data Flow
1.  The user clicks **Start** on the Dashboard for multiple platforms.
2.  `sequentialController.js` sequentially forks child processes: `node linkedinAgent.wrapper.js`, then Naukri, Indeed, Glassdoor, Wellfound.
3.  Inside each child process, the `Agent` class instantiates, calling `BaseAgent.initializeBrowser()`.
4.  The bot navigates, answers questions via the unified `questionAnswerer.js`, and logs output to `stdout` (piped back to the UI).

## 4. Error Handling & Testing
*   **Crashes / Captchas:** If a platform like Glassdoor blocks the agent with a hard Captcha, the `BaseAgent` wrapper catches the error, logs the skipped jobs via `saveFailedJobs()`, and ensures the browser closes cleanly without leaving zombie processes.
*   **Validation:** Creating the `BaseAgent` class ensures all future error handling improvements are instantly inherited by all 5 job boards.
