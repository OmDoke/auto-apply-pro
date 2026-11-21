'use strict';

// ---------------------------------------------------------------------------
// Application tracking — every job outcome is persisted the moment it happens,
// so a crash or Stop never loses results.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

// Read a JSON file. Missing → fallback. Corrupt → back it up (never silently
// overwrite history) and return fallback.
const readJson = (filePath, fallback = []) => {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        const backup = `${filePath}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(filePath, backup); } catch (_) {}
        console.log(`  ⚠️ ${path.basename(filePath)} is corrupt (${e.message}) — backed up to ${path.basename(backup)}`);
        return fallback;
    }
};

// Write via temp file + rename so a crash mid-write can't truncate the file
const writeJsonAtomic = (filePath, data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
};

// Extract LinkedIn job id from any job URL (search pane or /jobs/view/)
const jobIdFromUrl = (url) => {
    const m = String(url || '').match(/currentJobId=(\d+)|\/jobs\/view\/(\d+)/);
    return m ? (m[1] || m[2]) : null;
};

const jobViewUrl = (jobId) => `https://www.linkedin.com/jobs/view/${jobId}/`;

const isLinkedInEntry = (j) => j.source === 'linkedin' || String(j.url || '').includes('linkedin.com');

// History + daily-limit counter (already-applied detection relies on LinkedIn's Easy Apply button)
const recordAppliedJob = ({ jobId, title, company }) => {
    try {
        const all = readJson(cfg.appliedJobsPath);
        if (all.some(j => j.jobId === jobId || jobIdFromUrl(j.url) === jobId)) return;
        all.push({ jobId, title, company, url: jobViewUrl(jobId), source: 'linkedin', appliedAt: new Date().toISOString() });
        writeJsonAtomic(cfg.appliedJobsPath, all);
    } catch (e) {
        console.log('  Could not save applied_jobs.json:', e.message);
    }
};

// LinkedIn applications already made today (local date) — shared file with other agents
const appliedTodayCount = () => {
    const today = new Date().toLocaleDateString('en-CA');
    return readJson(cfg.appliedJobsPath)
        .filter(j => isLinkedInEntry(j) && j.appliedAt && new Date(j.appliedAt).toLocaleDateString('en-CA') === today)
        .length;
};

// Dashboard counter: confirmed LinkedIn applications, all-time and today
const appliedCounts = () => ({
    total: readJson(cfg.appliedJobsPath).filter(isLinkedInEntry).length,
    today: appliedTodayCount(),
    dailyLimit: cfg.dailyLimit,
});

// failed_jobs.json feeds the Manual Review page — keep its {title, company, url, reason} shape
const appendFailedJob = ({ jobId, title, company, url, reason }) => {
    try {
        const all = readJson(cfg.failedJobsPath);
        const jobUrl = jobId ? jobViewUrl(jobId) : url;
        if (all.some(j => j.url === jobUrl)) return;
        all.push({ jobId, title, company, url: jobUrl, reason, source: 'linkedin', failedAt: new Date().toISOString() });
        writeJsonAtomic(cfg.failedJobsPath, all);
    } catch (e) {
        console.log('  Could not save failed_jobs.json:', e.message);
    }
};

// One line per job in linkedin_outcomes.jsonl + IPC event for the dashboard
// status: applied | unconfirmed | skipped | needs_answer | failed
const recordOutcome = (outcome) => {
    const entry = { ts: new Date().toISOString(), ...outcome };
    try {
        fs.mkdirSync(path.dirname(cfg.outcomesPath), { recursive: true });
        fs.appendFileSync(cfg.outcomesPath, JSON.stringify(entry) + '\n');
    } catch (e) {
        console.log('  Could not append linkedin_outcomes.jsonl:', e.message);
    }
    if (process.send && process.connected) {
        try { process.send({ type: 'outcome', ...entry }); } catch (_) {}
    }
};

// Collect questions the bot could not answer so they can be added to answers.json
const logUnanswered = (questions, jobInfo) => {
    if (!questions || questions.length === 0) return;
    try {
        const all = readJson(cfg.unansweredPath);
        for (const q of questions) {
            const key = q.questionText.toLowerCase().trim();
            let entry = all.find(e => e.question.toLowerCase().trim() === key);
            if (!entry) {
                entry = { question: q.questionText, type: q.type, options: q.options || [], count: 0 };
                all.push(entry);
            }
            entry.count += 1;
            entry.required = !!q.required;
            if (q.attempted) entry.lastAttemptedAnswer = q.attempted;
            entry.lastSeen = new Date().toISOString();
            entry.lastJob = `${jobInfo.title} @ ${jobInfo.company}`;
        }
        writeJsonAtomic(cfg.unansweredPath, all);
    } catch (e) {
        console.log('  Could not save unanswered_questions.json:', e.message);
    }
};

module.exports = {
    readJson,
    writeJsonAtomic,
    jobIdFromUrl,
    jobViewUrl,
    recordAppliedJob,
    appliedTodayCount,
    appliedCounts,
    appendFailedJob,
    recordOutcome,
    logUnanswered,
};
