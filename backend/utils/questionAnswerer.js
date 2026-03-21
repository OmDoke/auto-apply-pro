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
        .replace(/[^a-z0-9\s]/g, '') // strip punctuation
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
    'numpy', 'tensorflow', 'pytorch', 'graphql', 'next.js', 'nextjs',
    'nest', 'nestjs', 'spring boot', 'kafka', 'rabbitmq', 'jenkins',
    'ci/cd', 'terraform', 'ansible', 'elasticsearch'
];

// ---------------------------------------------------------------------------
// Rule-based matcher – fast and deterministic
// Returns an answer string or null.
// ---------------------------------------------------------------------------
const ruleBasedMatch = (normalizedQ, userData) => {
    // "How many years of experience do you have in Java?"
    // → find the skill token in the question, return that skill's value
    if (normalizedQ.includes('experience') || normalizedQ.includes('years')) {
        for (const skill of SKILL_TOKENS) {
            const pattern = new RegExp(`\\b${skill}\\b`);
            if (pattern.test(normalizedQ)) {
                // look for a matching key in userData
                const skillKey = Object.keys(userData).find(k =>
                    normalizeText(k).includes(skill)
                );
                if (skillKey !== undefined && userData[skillKey] !== undefined) {
                    return String(userData[skillKey]);
                }
                // default to general experience
                const generalExp = userData['experience'] ?? userData['years'] ?? null;
                return generalExp !== null ? String(generalExp) : '0';
            }
        }
        // generic experience question with no skill
        const exp = userData['experience'] ?? userData['years'] ?? null;
        if (exp !== null) return String(exp);
    }

    // Authorization / work permit
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

    // Sponsorship
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

    // Relocation
    if (
        normalizedQ.includes('relocat') ||
        normalizedQ.includes('willing to move') ||
        normalizedQ.includes('open to reloc')
    ) {
        const val = userData['relocate'] ?? userData['relocation'] ?? 'Yes';
        return String(val);
    }

    // Salary / CTC / compensation
    if (
        normalizedQ.includes('salary') ||
        normalizedQ.includes('compensation') ||
        normalizedQ.includes('ctc') ||
        normalizedQ.includes('expected ctc') ||
        normalizedQ.includes('remuneration') ||
        normalizedQ.includes('package')
    ) {
        const val = userData['salary']
            ?? userData['compensation']
            ?? userData['ctc']
            ?? '0';
        return String(val);
    }

    // Notice period
    if (normalizedQ.includes('notice') || normalizedQ.includes('joining')) {
        const val = userData['notice period'] ?? userData['notice'] ?? 'Immediate';
        return String(val);
    }

    // Remote
    if (
        normalizedQ.includes('remote') ||
        normalizedQ.includes('work from home') ||
        normalizedQ.includes('hybrid')
    ) {
        const val = userData['remote'] ?? 'Yes';
        return String(val);
    }

    // Gender / diversity
    if (normalizedQ.includes('gender')) {
        return String(userData['gender'] ?? 'Decline to self-identify');
    }

    // Disability
    if (normalizedQ.includes('disabilit')) {
        return String(userData['disability'] ?? "No, I don't have a disability");
    }

    // Veteran
    if (normalizedQ.includes('veteran') || normalizedQ.includes('military')) {
        return String(userData['veteran'] ?? 'I am not a protected veteran');
    }

    // Race / ethnicity
    if (normalizedQ.includes('race') || normalizedQ.includes('ethnic')) {
        return String(userData['race'] ?? 'Decline to self-identify');
    }

    // Education / Degree
    if (
        normalizedQ.includes('degree') ||
        normalizedQ.includes('bachelor') ||
        normalizedQ.includes('master') ||
        normalizedQ.includes('phd') ||
        normalizedQ.includes('graduation')
    ) {
        const val = userData['education'] ?? userData['degree'] ?? 'Yes';
        return String(val);
    }

    // Languages (e.g. English proficiency)
    if (
        normalizedQ.includes('english') ||
        normalizedQ.includes('language') ||
        normalizedQ.includes('fluent') ||
        normalizedQ.includes('proficiency')
    ) {
        const val = userData['english'] ?? userData['language'] ?? 'Professional / Fluent';
        return String(val);
    }

    // Security Clearance
    if (normalizedQ.includes('clearance') || normalizedQ.includes('security clearance')) {
        const val = userData['clearance'] ?? 'No';
        return String(val);
    }

    // Website / Portfolio / Github / LinkedIn
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

    // Pronouns
    if (normalizedQ.includes('pronoun')) {
        return String(userData['pronouns'] ?? 'He/Him');
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
// Main exported function — NOW ASYNC (supports AI fallback)
// ---------------------------------------------------------------------------
const getAnswer = async (questionText, userData) => {
    if (!questionText || !userData) return null;

    const normalized = normalizeText(questionText);

    // 1. Rule-based (deterministic, highest priority)
    const ruleAnswer = ruleBasedMatch(normalized, userData);
    if (ruleAnswer !== null) return ruleAnswer;

    // 2. Fuzzy matching (flexible fallback)
    const fuzzyAnswer = getBestFuzzyMatch(normalized, userData);
    if (fuzzyAnswer !== null) return fuzzyAnswer;

    // 3. AI fallback via Groq + resume (slowest but most intelligent)
    const aiAnswer = await getAIAnswer(questionText);
    if (aiAnswer !== null) return aiAnswer;

    return null;
};

module.exports = {
    getAnswer,
    normalizeText,
    getBestFuzzyMatch,
};
