'use strict';

const { invokeGemini } = require('./geminiClient');
const { getResumeText } = require('./resumeQA');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const norm = function(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
};

// ---------------------------------------------------------------------------
// TIER 1: Fast rule-based filter — zero LLM tokens
// Returns { pass: false, reason: string } or { pass: true }
// ---------------------------------------------------------------------------
const tier1Filter = function(jobInfo, prefs) {
    const jdLower  = norm(jobInfo.jobDescription || '');
    const company  = norm(jobInfo.company || '');
    const title    = norm(jobInfo.title   || '');

    // 1. Excluded companies (case-insensitive substring match)
    var excludeCompanies = prefs.excludeCompanies || [];
    for (var ci = 0; ci < excludeCompanies.length; ci++) {
        var c = norm(excludeCompanies[ci]);
        if (c && company.includes(c)) {
            return { pass: false, reason: 'Excluded company: ' + jobInfo.company };
        }
    }

    // 2. Excluded keywords in title or JD
    var excludeKeywords = prefs.excludeKeywords || [];
    for (var ki = 0; ki < excludeKeywords.length; ki++) {
        var kw = norm(excludeKeywords[ki]);
        if (kw && (jdLower.includes(kw) || title.includes(kw))) {
            return { pass: false, reason: 'Excluded keyword found: "' + excludeKeywords[ki] + '"' };
        }
    }

    // 3. Job type mismatch
    if (prefs.jobType && prefs.jobType !== 'any') {
        var type = norm(prefs.jobType);
        if (type === 'full-time' && /\b(internship|intern|part[- ]time)\b/.test(jdLower)) {
            return { pass: false, reason: 'Job type mismatch: internship/part-time vs full-time preference' };
        }
        if (type === 'internship' && /\b(full[- ]time|permanent position)\b/.test(jdLower)) {
            return { pass: false, reason: 'Job type mismatch: full-time vs internship preference' };
        }
    }

    // 4. Work mode mismatch
    if (prefs.workMode && prefs.workMode !== 'any') {
        var mode = norm(prefs.workMode);
        if (mode === 'remote' && /\b(onsite|on-site|in[- ]office|no remote|work from office|wfo)\b/.test(jdLower)) {
            return { pass: false, reason: 'Work mode mismatch: onsite required vs remote preference' };
        }
    }

    return { pass: true };
};

// ---------------------------------------------------------------------------
// TIER 2: Gemini LLM match scoring (0–100)
// Only called when Tier 1 passes AND threshold > 0 AND GEMINI_API_KEY set
// ---------------------------------------------------------------------------
const tier2Score = async function(jobInfo, prefs, resumeText) {
    var skills     = (prefs.skills || []).join(', ') || 'Not specified';
    var jdSnippet  = (jobInfo.jobDescription || '').substring(0, 3000);
    var resumeSnip = (resumeText || '').substring(0, 2000);

    var prompt = 'You are a job-match evaluator. Score this resume against the job description.\n\n' +
        'CANDIDATE MUST-HAVE SKILLS: ' + skills + '\n\n' +
        'RESUME (first 2000 chars):\n' + resumeSnip + '\n\n' +
        'JOB DESCRIPTION (first 3000 chars):\n' + jdSnippet + '\n\n' +
        'Respond ONLY with valid JSON (no markdown, no extra text):\n' +
        '{\n' +
        '  "score": <integer 0-100>,\n' +
        '  "matchedSkills": ["skill1"],\n' +
        '  "missingSkills": ["skill2"],\n' +
        '  "reason": "<one short sentence>"\n' +
        '}\n\n' +
        'SCORING:\n' +
        '85-100: Strong match - all required skills present\n' +
        '70-84:  Good match - minor gaps only\n' +
        '50-69:  Partial match - some required skills missing\n' +
        '0-49:   Poor match - significant skill gaps';

    try {
        var raw = await invokeGemini(prompt, { json: true });
        if (!raw) return { score: null };

        // Strip markdown wrapper if present
        var cleaned = raw
            .replace(/```json\n?/gi, '')
            .replace(/```/g, '')
            .trim();

        var parsed = JSON.parse(cleaned);
        return {
            score:         typeof parsed.score === 'number' ? parsed.score : null,
            matchedSkills: parsed.matchedSkills  || [],
            missingSkills: parsed.missingSkills  || [],
            reason:        parsed.reason         || ''
        };
    } catch (err) {
        console.log('  Warning: Job match score parse error:', err.message);
        return { score: null };
    }
};

// ---------------------------------------------------------------------------
// shouldApplyToJob — main export
// Returns { shouldApply: boolean, matchScore: number|null, reason: string }
//
// prefs shape:
//   skills:           string[]  — e.g. ['React', 'TypeScript']
//   excludeCompanies: string[]  — e.g. ['HT Media']
//   excludeKeywords:  string[]  — e.g. ['Senior', 'Lead']
//   minMatchScore:    number    — 0-100; 0 = no scoring (apply all)
//   jobType:          string    — 'full-time'|'internship'|'contract'|'any'
//   workMode:         string    — 'remote'|'hybrid'|'onsite'|'any'
// ---------------------------------------------------------------------------
const shouldApplyToJob = async function(jobInfo, prefs, resumeText) {
    // --- Tier 1: zero-token fast filter ---
    var t1 = tier1Filter(jobInfo, prefs);
    if (!t1.pass) {
        return { shouldApply: false, matchScore: 0, reason: t1.reason };
    }

    // --- If threshold = 0 or no Gemini key: skip LLM, apply all that pass Tier 1 ---
    var threshold = typeof prefs.minMatchScore === 'number' ? prefs.minMatchScore : 60;
    if (!process.env.GEMINI_API_KEY || threshold === 0) {
        var noScoreReason = threshold === 0
            ? 'Tier 1 passed; scoring disabled (threshold=0 — applying all)'
            : 'Tier 1 passed; no GEMINI_API_KEY — applying without score';
        return { shouldApply: true, matchScore: null, reason: noScoreReason };
    }

    // --- Tier 2: Gemini LLM scoring ---
    var t2 = await tier2Score(jobInfo, prefs, resumeText);

    // Gemini unavailable: fail-open so we don't miss jobs
    if (t2.score === null) {
        return {
            shouldApply: true,
            matchScore:  null,
            reason:      'Gemini unavailable — applying without score (fail-open)'
        };
    }

    var pass    = t2.score >= threshold;
    var matched = (t2.matchedSkills || []).join(', ') || 'none';
    var missing = (t2.missingSkills || []).join(', ') || 'none';

    return {
        shouldApply: pass,
        matchScore:  t2.score,
        reason:      pass
            ? ('Score ' + t2.score + '% >= ' + threshold + '% | Matched: ' + matched)
            : ('Score ' + t2.score + '% < '  + threshold + '% | Missing: ' + missing)
    };
};

module.exports = { shouldApplyToJob: shouldApplyToJob };
