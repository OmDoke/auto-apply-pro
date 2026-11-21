'use strict';

// ---------------------------------------------------------------------------
// LinkedIn agent configuration — every tunable lives here, read from env with
// safe defaults. Nothing else in the LinkedIn agent should read process.env.
// ---------------------------------------------------------------------------
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const env = process.env;
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const list = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const int = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
};
const bool = (v, def) => (v === undefined || v === '' ? def : v === 'true');

const resumeFileName = env.RESUME_FILENAME || 'onkar_resume.pdf';

module.exports = {
    // ── Paths ───────────────────────────────────────────────────────────────
    dataDir:         DATA_DIR,
    answersPath:     path.join(DATA_DIR, 'answers.json'),
    appliedJobsPath: path.join(DATA_DIR, 'applied_jobs.json'),
    failedJobsPath:  path.join(DATA_DIR, 'failed_jobs.json'),
    outcomesPath:    path.join(DATA_DIR, 'linkedin_outcomes.jsonl'),
    unansweredPath:  path.join(DATA_DIR, 'unanswered_questions.json'),
    screenshotDir:   path.join(DATA_DIR, 'screenshots'),
    tailoredDir:     path.join(DATA_DIR, 'tailored'),
    userDataDir:     path.join(DATA_DIR, 'puppeteer', 'linkedin_profile'),
    resumeFileName,
    // Base resume — regenerated from resumeData.js at startup, never overwritten per job
    baseResumePath:  path.join(DATA_DIR, resumeFileName),
    chromePath:      env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    // e.g. http://localhost:9222 — attach to your own Chrome started with --remote-debugging-port
    cdpUrl:          env.LINKEDIN_CDP_URL || '',

    // ── Search ──────────────────────────────────────────────────────────────
    // Comma-separated list → one search per title
    jobTitles:        list(env.FRONTEND_JOB_TITLE || env.JOB_TITLE || 'Software Engineer'),
    location:         env.FRONTEND_LOCATION || env.JOB_LOCATION || env.LOCATION || 'Remote',
    // LinkedIn f_E codes: 1=Internship 2=Entry 3=Associate 4=Mid-Senior 5=Director 6=Executive
    experienceLevels: env.LINKEDIN_EXPERIENCE_LEVELS || '1,2',
    // Result pages (25 jobs each) to walk per job title
    maxSearchPages:   int(env.LINKEDIN_MAX_SEARCH_PAGES, 5),

    // ── Screening ───────────────────────────────────────────────────────────
    screening: {
        skills:           list(env.FRONTEND_SKILLS),
        // Frontend exclusions + LinkedIn-specific permanent blocklist
        excludeCompanies: [...list(env.FRONTEND_EXCLUDE_COMPANIES), ...list(env.LINKEDIN_EXCLUDE_COMPANIES || 'HT Media,HT Labs')],
        excludeKeywords:  list(env.FRONTEND_EXCLUDE_KEYWORDS),
        minMatchScore:    int(env.FRONTEND_MIN_MATCH_SCORE, 60),
        jobType:          env.FRONTEND_JOB_TYPE || 'any',
        workMode:         env.FRONTEND_WORK_MODE || 'any',
    },

    // ── Limits & pacing (account safety) ────────────────────────────────────
    dailyLimit:            int(env.LINKEDIN_DAILY_LIMIT, 50),
    maxApplicationsPerRun: int(env.MAX_APPLICATIONS, 50),
    applyGapMinMs:         int(env.LINKEDIN_APPLY_GAP_MIN_MS, 45000),
    applyGapMaxMs:         int(env.LINKEDIN_APPLY_GAP_MAX_MS, 120000),
    longBreakEvery:        int(env.LINKEDIN_LONG_BREAK_EVERY, 10),
    longBreakMinMs:        int(env.LINKEDIN_LONG_BREAK_MIN_MS, 5 * 60000),
    longBreakMaxMs:        int(env.LINKEDIN_LONG_BREAK_MAX_MS, 10 * 60000),
    typeDelayMinMs:        int(env.LINKEDIN_TYPE_DELAY_MIN_MS, 40),
    typeDelayMaxMs:        int(env.LINKEDIN_TYPE_DELAY_MAX_MS, 110),
    // Off by default: changes browser launch flags; enable only once login is confirmed unaffected
    hideAutomationFlags:   bool(env.LINKEDIN_HIDE_AUTOMATION, false),

    // ── Apply behaviour ─────────────────────────────────────────────────────
    maxAttempts:          int(env.LINKEDIN_MAX_ATTEMPTS, 2),
    maxSteps:             int(env.LINKEDIN_MAX_STEPS, 20),
    // true → never guess "Yes"/first option on required questions; send job to manual review
    strictAnswers:        bool(env.LINKEDIN_STRICT_ANSWERS, true),
    tailorResume:         bool(env.LINKEDIN_TAILOR_RESUME, true),
    followCompany:        bool(env.LINKEDIN_FOLLOW_COMPANY, false),
    // true → walk the whole form but discard it instead of clicking Submit (for testing)
    dryRun:               bool(env.LINKEDIN_DRY_RUN, false),
    fallbackResumeName:   env.RESUME_NAME || '',
};
