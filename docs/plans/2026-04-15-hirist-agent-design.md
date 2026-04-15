# Hirist Agent Automation Design

## 1. Architecture & Integration
*   **Dependency:** Playwright added to the `backend` via `npm install playwright`.
*   **Agent Script:** Core logic in `backend/agents/hiristAgent.js`.
*   **Pipeline Setup:** Agent integrated into `backend/controller/sequentialController.js` inside both `runSequence` and `runSingleAgent`.
*   **Frontend UI:** `Hirist Agent` entry appended to `agents` array in `frontend/src/types/index.ts`.

## 2. Core Execution Flow (hiristAgent.js)
*   **Initialization:** Start Playwright browser with `headless: false` for visual monitoring.
*   **Login Wait:** Go to `https://www.hirist.tech/` and execute `page.waitForTimeout(60000)` to freeze for exactly 60 seconds (manual login window).
*   **Targeting:** Navigate to search endpoint populated with specific filters via URL parameters (Experience: 0-1 years, Locations: Maharashtra, India, Remote).

## 3. Application Loop & Error Handling
*   **Extraction:** Find and extract all job card container elements/links on the current page.
*   **Iterate:** Loop over each link sequentially.
*   **Action:** Locate and click the "Apply" button on the job page.
*   **Boundary Checks:** 
    *   **Easy Apply:** If it relies on a local form or simple native submit, complete it.
    *   **External Redirect:** If the job redirects to an external ATS (Workday, Lever, etc.), intercept or detect the redirect, log the external URL, mark as skipped, and exit early to proceed to the next job.
*   **Resilience:** Wrap actions inside a `try/catch`. Output failure details to standard logs (piped back to sequential tracker) and jump to the next loop iteration without halting the process.
*   **Pagination:** After all jobs on the page are processed, click the "Next" pagination element and repeat.
