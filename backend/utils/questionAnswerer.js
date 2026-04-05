'use strict';

const stringSimilarity = require('string-similarity');
const { getAIAnswer } = require('./resumeQA');

// ---------------------------------------------------------------------------
// Normalise a raw question string for consistent comparison
// ---------------------------------------------------------------------------
const normalizeText = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

// ---------------------------------------------------------------------------
// Known skill tokens – extend as needed
// ---------------------------------------------------------------------------
const SKILL_TOKENS = [
    'java', 'python', 'javascript', 'js', 'typescript', 'ts',
    'react', 'angular', 'vue', 'node', 'nodejs', 'express',
    'spring', 'django', 'flask', 'sql', 'mysql', 'postgres',
    'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'azure', 'gcp',
    'c', 'cpp', 'c++', 'golang', 'go', 'rust', 'kotlin', 'swift',
    'html', 'css', 'tailwind', 'graphql', 'git', 'linux', 'bash',
    'ruby', 'php', 'c#', 'csharp', '.net', 'dotnet', 'scala', 'dart',
    'flutter', 'react native', 'android', 'ios', 'machine learning',
    'ml', 'artificial intelligence', 'ai', 'data science', 'pandas',
    'numpy', 'tensorflow', 'pytorch', 'next.js', 'nextjs',
    'nest', 'nestjs', 'spring boot', 'kafka', 'rabbitmq', 'jenkins',
    'ci/cd', 'terraform', 'ansible', 'elasticsearch'
];

// ---------------------------------------------------------------------------
// Detect if a question is asking about CURRENT vs EXPECTED salary/CTC
// Returns: 'current', 'expected', or 'unknown'
// ---------------------------------------------------------------------------
const detectSalaryType = (normalizedQ) => {
    const hasCurrent = /\b(current|present|existing|now|lpa now|current lpa|drawing)\b/.test(normalizedQ);
    const hasExpected = /\b(expected|expect|desired|desired|what do you expect|looking for|asking)\b/.test(normalizedQ);
    if (hasCurrent && !hasExpected) return 'current';
    if (hasExpected && !hasCurrent) return 'expected';
    return 'unknown';
};

// ---------------------------------------------------------------------------
// Rule-based matcher — fast, deterministic, highest priority
// Returns an answer string or null.
// ---------------------------------------------------------------------------
const ruleBasedMatch = (normalizedQ, userData) => {

    // ---------- Notice period (ALWAYS "15") ----------
    if (normalizedQ.includes('notice') || normalizedQ.includes('joining') || normalizedQ.includes('how soon can you join')) {
        return '15';
    }

    // ---------- Salary / CTC / compensation — current vs expected ----------
    if (
        normalizedQ.includes('salary') ||
        normalizedQ.includes('ctc') ||
        normalizedQ.includes('compensation') ||
        normalizedQ.includes('remuneration') ||
        normalizedQ.includes('package') ||
        normalizedQ.includes('lpa')
    ) {
        const salaryType = detectSalaryType(normalizedQ);
        if (salaryType === 'current') return '2';
        if (salaryType === 'expected') return '6';
        // If question has ONLY "expected" wording in title
        if (normalizedQ.includes('expected')) return '6';
        if (normalizedQ.includes('current')) return '2';
        // Default: treat as current CTC
        return '2';
    }

    // ---------- Experience / years of experience ----------
    if (normalizedQ.includes('experience') || normalizedQ.includes('years')) {
        for (const skill of SKILL_TOKENS) {
            const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\b${escaped}\\b`);
            if (pattern.test(normalizedQ)) {
                const skillKey = Object.keys(userData).find(k =>
                    normalizeText(k).includes(skill)
                );
                if (skillKey !== undefined && userData[skillKey] !== undefined) {
                    return String(userData[skillKey]);
                }
                const generalExp = userData['experience'] ?? userData['years'] ?? null;
                return generalExp !== null ? String(generalExp) : '0';
            }
        }
        const exp = userData['experience'] ?? userData['years'] ?? null;
        if (exp !== null) return String(exp);
    }

    // ---------- Authorization / work permit ----------
    if (
        normalizedQ.includes('authorized') ||
        normalizedQ.includes('authorization') ||
        normalizedQ.includes('legally authorized') ||
        normalizedQ.includes('eligible to work') ||
        normalizedQ.includes('work permit') ||
        normalizedQ.includes('work visa')
    ) {
        const val = userData['authorized to work']
            ?? userData['legally authorized']
            ?? userData['authorized']
            ?? 'Yes';
        return String(val);
    }

    // ---------- Sponsorship ----------
    if (
        normalizedQ.includes('sponsorship') ||
        normalizedQ.includes('sponsor') ||
        normalizedQ.includes('visa sponsorship') ||
        normalizedQ.includes('require sponsorship')
    ) {
        const val = userData['sponsorship']
            ?? userData['require sponsorship']
            ?? 'No';
        return String(val);
    }

    // ---------- Relocation ----------
    if (
        normalizedQ.includes('relocat') ||
        normalizedQ.includes('willing to move') ||
        normalizedQ.includes('open to reloc')
    ) {
        const val = userData['relocate'] ?? userData['relocation'] ?? 'Yes';
        return String(val);
    }

    // ---------- Remote / hybrid ----------
    if (
        normalizedQ.includes('remote') ||
        normalizedQ.includes('work from home') ||
        normalizedQ.includes('hybrid')
    ) {
        const val = userData['remote'] ?? 'Yes';
        return String(val);
    }

    // ---------- Gender ----------
    if (normalizedQ.includes('gender')) {
        return String(userData['gender'] ?? 'Decline to self-identify');
    }

    // ---------- Disability ----------
    if (normalizedQ.includes('disabilit')) {
        return String(userData['disability'] ?? "No, I don't have a disability");
    }

    // ---------- Veteran ----------
    if (normalizedQ.includes('veteran') || normalizedQ.includes('military')) {
        return String(userData['veteran'] ?? 'I am not a protected veteran');
    }

    // ---------- Race / ethnicity ----------
    if (normalizedQ.includes('race') || normalizedQ.includes('ethnic')) {
        return String(userData['race'] ?? 'Decline to self-identify');
    }

    // ---------- Pincode / Zip / Postal code ----------
    if (
        normalizedQ.includes('pincode') ||
        normalizedQ.includes('pin code') ||
        normalizedQ.includes('postal code') ||
        normalizedQ.includes('zip code') ||
        normalizedQ.includes('zip') ||
        normalizedQ.includes('postal')
    ) {
        return String(userData['pincode'] ?? userData['zip'] ?? '412207');
    }

    // ---------- Street / Address ----------
    if (
        normalizedQ.includes('street') ||
        normalizedQ.includes('address line') ||
        normalizedQ.includes('address1') ||
        normalizedQ.includes('house') ||
        normalizedQ.includes('flat') ||
        normalizedQ.includes('society')
    ) {
        return String(userData['street'] ?? userData['address'] ?? 'Sai Park Society, Wagholi');
    }

    // ---------- Full address ----------
    if (normalizedQ === 'address' || normalizedQ.includes('full address') || normalizedQ.includes('current address')) {
        return String(userData['address'] ?? 'Sai Park Society, Wagholi, Pune, Maharashtra, India - 412207');
    }

    // ---------- City (return just "Pune" for city inputs) ----------
    if (normalizedQ.includes('city') && !normalizedQ.includes('address')) {
        return String(userData['city'] ?? 'Pune');
    }

    // ---------- State ----------
    if (normalizedQ.includes('state') && !normalizedQ.includes('united states') && !normalizedQ.includes('us state')) {
        return String(userData['state'] ?? 'Maharashtra');
    }

    // ---------- Country ----------
    if (normalizedQ.includes('country') || normalizedQ.includes('nation')) {
        return String(userData['country'] ?? 'India');
    }

    // ---------- Education / Degree ----------
    if (
        normalizedQ.includes('degree') ||
        normalizedQ.includes('bachelor') ||
        normalizedQ.includes('master') ||
        normalizedQ.includes('phd') ||
        normalizedQ.includes('graduation') ||
        normalizedQ.includes('qualification')
    ) {
        const val = userData['education'] ?? userData['degree'] ?? 'Post Graduate Diploma in Advanced Computing (PG-DAC)';
        return String(val);
    }

    // ---------- English / language proficiency ----------
    if (
        normalizedQ.includes('english') ||
        normalizedQ.includes('language') ||
        normalizedQ.includes('fluent') ||
        normalizedQ.includes('proficiency')
    ) {
        const val = userData['english'] ?? userData['language'] ?? 'Professional / Fluent';
        return String(val);
    }

    // ---------- Security clearance ----------
    if (normalizedQ.includes('clearance') || normalizedQ.includes('security clearance')) {
        return String(userData['clearance'] ?? 'No');
    }

    // ---------- Website / Portfolio / Github / LinkedIn ----------
    if (
        normalizedQ.includes('portfolio') ||
        normalizedQ.includes('website') ||
        normalizedQ.includes('github') ||
        normalizedQ.includes('linkedin') ||
        normalizedQ.includes('link') ||
        normalizedQ.includes('url')
    ) {
        if (normalizedQ.includes('github')) return String(userData['github'] ?? userData['portfolio'] ?? '');
        if (normalizedQ.includes('linkedin')) return String(userData['linkedin'] ?? userData['portfolio'] ?? '');
        return String(userData['portfolio'] ?? userData['website'] ?? userData['link'] ?? '');
    }

    // ---------- Pronouns ----------
    if (normalizedQ.includes('pronoun')) {
        return String(userData['pronouns'] ?? 'He/Him');
    }

    // ---------- Drug test ----------
    if (normalizedQ.includes('drug test')) {
        return 'Yes';
    }

    // ---------- Consent / acknowledgement / privacy / terms checkboxes ----------
    if (
        normalizedQ.includes('i understand') ||
        normalizedQ.includes('i certify') ||
        normalizedQ.includes('i declare') ||
        normalizedQ.includes('i agree') ||
        normalizedQ.includes('i acknowledge') ||
        normalizedQ.includes('i confirm') ||
        normalizedQ.includes('privacy policy') ||
        normalizedQ.includes('terms of use') ||
        normalizedQ.includes('terms and conditions') ||
        normalizedQ.includes('by checking this box') ||
        normalizedQ.includes('checking this box') ||
        normalizedQ.includes('application will not be considered') ||
        normalizedQ.includes('true and correct')
    ) {
        return 'Yes';
    }

    // ---------- Family / close friend at company ----------
    if (
        (normalizedQ.includes('family') || normalizedQ.includes('close friend')) &&
        (normalizedQ.includes('employed') || normalizedQ.includes('relationship') || normalizedQ.includes('work'))
    ) {
        return String(userData['family at company'] ?? 'No');
    }

    return null;
};

// ---------------------------------------------------------------------------
// Fuzzy matcher using string-similarity
// Returns the best-matching value from userData, or null.
// ---------------------------------------------------------------------------
const getBestFuzzyMatch = (normalizedQ, userData) => {
    const keys = Object.keys(userData);
    if (keys.length === 0) return null;

    const normalizedKeys = keys.map(k => normalizeText(k));

    const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(
        normalizedQ,
        normalizedKeys
    );

    if (bestMatch.rating >= 0.4) {
        return String(userData[keys[bestMatchIndex]]);
    }

    // Secondary pass: check if any key is a substring of the question
    for (let i = 0; i < normalizedKeys.length; i++) {
        if (normalizedKeys[i].length > 2 && normalizedQ.includes(normalizedKeys[i])) {
            return String(userData[keys[i]]);
        }
    }

    return null;
};

// ---------------------------------------------------------------------------
// Main exported function — async (supports AI fallback)
// ---------------------------------------------------------------------------
const getAnswer = async (questionText, userData, context = {}) => {
    if (!questionText || !userData) return null;

    const normalized = normalizeText(questionText);

    // 1. Rule-based (deterministic, highest priority)
    const ruleAnswer = ruleBasedMatch(normalized, userData);
    if (ruleAnswer !== null) return ruleAnswer;

    // 2. Fuzzy matching (flexible fallback)
    const fuzzyAnswer = getBestFuzzyMatch(normalized, userData);
    if (fuzzyAnswer !== null) return fuzzyAnswer;

    // 3. AI fallback via Groq + resume context
    const aiAnswer = await getAIAnswer(questionText, context);
    if (aiAnswer !== null) return aiAnswer;

    // 4. Final safety-net: obvious yes/no questions default to "Yes"
    const isYesNo = /\b(are you|do you|have you|can you|will you|would you|is your|were you|did you)\b/i.test(questionText);
    if (isYesNo) return 'Yes';

    return null;
};

module.exports = {
    getAnswer,
    normalizeText,
    getBestFuzzyMatch,
};
