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
    'ci/cd', 'terraform', 'ansible', 'elasticsearch',
    'software engineering', 'software development',
    // QA / Testing / DevOps
    'manual testing', 'manual test', 'automation testing', 'automation test',
    'testing', 'qa', 'quality assurance', 'selenium', 'appium', 'cypress',
    'postman', 'rest assured', 'jmeter', 'testng', 'junit',
    'jira', 'agile', 'scrum', 'kanban', 'devops', 'cloud',
    // Data / BI
    'tableau', 'power bi', 'excel', 'spark', 'hadoop', 'hive',
    // Mobile / Other
    'xamarin', 'unity', 'unreal', 'blender',
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
// Load User Data from JSON profile
// ---------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');

let loadedUserData = {};
try {
    const profilePath = process.env.USER_DATA_PATH 
        ? path.resolve(process.env.USER_DATA_PATH)
        : path.join(__dirname, '..', 'data', 'user_profile.json');
    
    if (fs.existsSync(profilePath)) {
        loadedUserData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    }
} catch (e) {
    console.error('[QuestionAnswerer] Could not load user profile:', e.message);
}

// ---------------------------------------------------------------------------
// Rule-based matcher — fast, deterministic, highest priority
// Returns an answer string or null.
// ---------------------------------------------------------------------------
const ruleBasedMatch = (normalizedQ, userData, context = {}) => {
    // Merge provided userData with loaded profile (provided takes precedence)
    const data = { ...loadedUserData, ...userData };

    // ---------- Names ----------
    if (normalizedQ.includes('name') &&
        !/\b(company|employer|institution|university|school|college|degree)\b/.test(normalizedQ)) {
        if (normalizedQ.includes('middle')) return ''; // no middle name
        if (normalizedQ.includes('first')) return String(data['first name'] ?? 'Onkar');
        if (normalizedQ.includes('last') || normalizedQ.includes('surname')) return String(data['last name'] ?? 'Doke');
        if (normalizedQ.includes('preferred')) return String(data['preferred name'] ?? data['first name'] ?? 'Onkar');
        return String(data['full name'] ?? data['name'] ?? 'Onkar Doke');
    }

    // ---------- Notice period / Can you start immediately ----------
    if (normalizedQ.includes('notice') || normalizedQ.includes('joining') || normalizedQ.includes('how soon') ||
        normalizedQ.includes('start immediately') || normalizedQ.includes('immediate') || normalizedQ.includes('can you start') ||
        normalizedQ.includes('available to join')) {
        // For dropdowns/radio: return a text label that can match options like '15 days', '0-1 month'
        if (context && (context.type === 'select' || context.type === 'custom-dropdown' || context.type === 'radio')) {
            // Yes/No radio: "Can you start immediately?" → No (we have 15-day notice)
            if (context.options && context.options.length > 0) {
                const opts = context.options.map(o => o.toLowerCase());
                if (opts.includes('yes') && opts.includes('no')) {
                    // "Can you start immediately?" → controlled by 'immediate start' in user_profile.json (default: 'Yes')
                    if (normalizedQ.includes('immediately') || normalizedQ.includes('immediate') || normalizedQ.includes('instant')) {
                        return String(data['immediate start'] ?? 'Yes');
                    }
                    if (normalizedQ.includes('serving')) {
                        return String(data['serving notice'] ?? data['currently serving notice'] ?? 'No');
                    }
                    // Generic yes/no for notice period → Yes (we are available)
                    return 'Yes';
                }
                // Try to match 15-day-ish option
                for (const opt of opts) {
                    if (opt.includes('15') || opt.includes('two week') || opt.includes('2 week')) return context.options[opts.indexOf(opt)];
                }
                // Fallback: first month-ish option
                for (const opt of opts) {
                    if (opt.includes('month') || opt.includes('30') || opt.includes('less than')) return context.options[opts.indexOf(opt)];
                }
                // Ultimate fallback: first option
                return context.options[0];
            }
            return '15 days';
        }
        let noticeVal = String(data['notice period'] ?? '15');
        if (context && context.source === 'linkedin') {
            if (normalizedQ.includes('weeks')) {
                const num = parseInt(noticeVal);
                if (!isNaN(num)) {
                    if (noticeVal.toLowerCase().includes('day') || num > 5) {
                        return String(Math.round(num / 7));
                    }
                    return String(num);
                }
            } else if (normalizedQ.includes('in days')) {
                const num = parseInt(noticeVal);
                if (!isNaN(num)) {
                    return String(num);
                }
            }
        }
        return noticeVal;
    }

    // ---------- Salary / CTC / compensation — current vs expected ----------
    if (
        normalizedQ.includes('salary') ||
        normalizedQ.includes('ctc') ||
        normalizedQ.includes('compensation') ||
        normalizedQ.includes('remuneration') ||
        normalizedQ.includes('package') ||
        normalizedQ.includes('lpa') ||
        normalizedQ.includes('stipend')
    ) {
        if (context && context.options && context.options.length > 0) {
            const lowerOpts = context.options.map(o => o.toLowerCase());
            if (lowerOpts.includes('yes') && lowerOpts.includes('no')) {
                return 'Yes';
            }
        }
        const salaryType = detectSalaryType(normalizedQ);
        let ansVal = '2';
        if (salaryType === 'current') ansVal = String(data['current salary'] ?? '2');
        else if (salaryType === 'expected') ansVal = String(data['expected salary'] ?? '6');
        else if (normalizedQ.includes('expected')) ansVal = String(data['expected salary'] ?? '6');
        else if (normalizedQ.includes('current')) ansVal = String(data['current salary'] ?? '2');
        else ansVal = String(data['current salary'] ?? '2');

        // Scale to raw INR if the question explicitly asks "in INR", "in Rs", or "rupee"
        if (normalizedQ.includes('inr') || normalizedQ.includes('in rs') || normalizedQ.includes('rupee')) {
            const num = parseFloat(ansVal);
            if (!isNaN(num) && num < 100) {
                ansVal = String(Math.round(num * 100000));
            }
        }
        return ansVal;
    }

    // ---------- Relevant experience job / Enter a job that shows relevant experience ----------
    if (
        normalizedQ.includes('job that shows') ||
        (normalizedQ.includes('job') && normalizedQ.includes('relevant experience'))
    ) {
        return String(data['relevant experience job'] ?? data['job that shows relevant experience'] ?? 'ht labs and role intern');
    }

    // ---------- Company / Employer ----------
    if (
        normalizedQ === 'company' ||
        normalizedQ === 'employer' ||
        normalizedQ.includes('company name') ||
        normalizedQ.includes('name of company') ||
        normalizedQ.includes('current company') ||
        normalizedQ.includes('previous company') ||
        normalizedQ.includes('most recent company')
    ) {
        return String(data['company'] ?? data['employer'] ?? 'ht labs');
    }

    // ---------- Job Title / Role ----------
    if (
        normalizedQ === 'job title' ||
        normalizedQ === 'title' ||
        normalizedQ === 'role' ||
        normalizedQ === 'your title' ||
        normalizedQ.includes('job title') ||
        normalizedQ.includes('your title') ||
        normalizedQ.includes('current job title') ||
        normalizedQ.includes('most recent job title')
    ) {
        if (!context.options || !context.options.some(o => /mr|ms|dr/i.test(o))) {
            return String(data['job title'] ?? data['role'] ?? 'intern');
        }
    }

    // ---------- Experience / years of experience ----------
    if (normalizedQ.includes('experience') || normalizedQ.includes('years') || normalizedQ.includes('months')) {
        let answerVal = null;
        let foundSkill = false;
        for (const skill of SKILL_TOKENS) {
            const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\b${escaped}\\b`);
            if (pattern.test(normalizedQ)) {
                foundSkill = true;
                // CRITICAL FIX: use word-boundary match on the KEY too, not just includes().
                // This prevents 'git' from matching 'github', 'node' from matching 'nodejs', etc.
                const skillPattern = new RegExp(`^${escaped}$|\\b${escaped}\\b`);
                const skillKey = Object.keys(data).find(k => {
                    const normK = normalizeText(k);
                    // For very short tokens (<=2 chars), use strict equality or word boundary
                    if (skill.length <= 2) {
                        return normK === skill || new RegExp(`\\b${escaped}\\b`).test(normK);
                    }
                    // For longer tokens: use word boundary, NOT includes() — avoids git→github
                    return skillPattern.test(normK);
                });
                if (skillKey !== undefined && data[skillKey] !== undefined) {
                    const candidate = String(data[skillKey]);
                    // SAFETY: only use it if it's a number, not a URL / text
                    const isNumeric = /^\d+(\.\d+)?$/.test(candidate.trim());
                    if (isNumeric) {
                        answerVal = candidate;
                    } else {
                        // Value is a URL or text — fall back to general experience
                        const generalExp = data['experience'] ?? data['years'] ?? null;
                        answerVal = generalExp !== null ? String(generalExp) : '1';
                    }
                } else {
                    const generalExp = data['experience'] ?? data['years'] ?? null;
                    answerVal = generalExp !== null ? String(generalExp) : '1';
                }
                break;
            }
        }
        if (!foundSkill) {
            if (normalizedQ.includes('frontend') || normalizedQ.includes('front end') || normalizedQ.includes('front-end')) {
                answerVal = String(data['frontend'] ?? data['react'] ?? data['experience'] ?? '1');
            } else if (normalizedQ.includes('backend') || normalizedQ.includes('back end') || normalizedQ.includes('back-end')) {
                answerVal = String(data['backend'] ?? data['node'] ?? data['experience'] ?? '1');
            } else if (normalizedQ.includes('full stack') || normalizedQ.includes('fullstack')) {
                answerVal = String(data['full stack'] ?? data['experience'] ?? '1');
            } else {
                const exp = data['experience'] ?? data['years'] ?? '1';
                answerVal = String(exp);
            }
        }

        // If the question explicitly asks for months, convert years to months
        if (answerVal !== null && normalizedQ.includes('months')) {
            if (context && context.source === 'linkedin' && (normalizedQ.includes('additional') || normalizedQ.includes('remaining') || normalizedQ.includes('extra') || normalizedQ.includes('excess'))) {
                return '0';
            }
            const parsedVal = parseFloat(answerVal);
            if (!isNaN(parsedVal) && parsedVal < 5) {
                return String(Math.round(parsedVal * 12));
            }
        }
        return answerVal;
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
        const val = data['authorized to work']
            ?? data['legally authorized']
            ?? data['authorized']
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
        const val = data['sponsorship']
            ?? data['require sponsorship']
            ?? 'No';
        return String(val);
    }

    // ---------- Relocation ----------
    if (
        normalizedQ.includes('relocat') ||
        normalizedQ.includes('willing to move') ||
        normalizedQ.includes('open to reloc')
    ) {
        const val = data['relocate'] ?? data['relocation'] ?? 'Yes';
        return String(val);
    }

    // ---------- Remote / hybrid ----------
    if (
        normalizedQ.includes('remote') ||
        normalizedQ.includes('work from home') ||
        normalizedQ.includes('hybrid')
    ) {
        const val = data['remote'] ?? 'Yes';
        return String(val);
    }

    // ---------- Gender ----------
    if (normalizedQ.includes('gender')) {
        return String(data['gender'] ?? 'Decline to self-identify');
    }

    // ---------- Disability ----------
    if (normalizedQ.includes('disabilit')) {
        return String(data['disability'] ?? "No, I don't have a disability");
    }

    // ---------- Veteran ----------
    if (normalizedQ.includes('veteran') || normalizedQ.includes('military')) {
        return String(data['veteran'] ?? 'I am not a protected veteran');
    }

    // ---------- Race / ethnicity ----------
    if (normalizedQ.includes('race') || normalizedQ.includes('ethnic')) {
        // If options are present (full description radio buttons), find best match
        if (context.options && context.options.length > 0) {
            // Prefer "I don't wish to answer" / "Decline" option
            const declineOpt = context.options.find(o =>
                o.toLowerCase().includes("don't wish") ||
                o.toLowerCase().includes('decline') ||
                o.toLowerCase().includes('prefer not to')
            );
            if (declineOpt) return declineOpt;
            // Fallback: Asian option (closest to Indian)
            const asianOpt = context.options.find(o => o.toLowerCase().includes('asian'));
            if (asianOpt) return asianOpt;
        }
        return String(data['race'] ?? 'Decline to self-identify');
    }

    // ---------- Phone Type (must come before generic phone rule) ----------
    if (normalizedQ.includes('phone') && normalizedQ.includes('type') && context.options && context.options.length > 0) {
        const mobileOpt = context.options.find(o => /mobile/i.test(o));
        if (mobileOpt) return mobileOpt;
        return context.options[0];
    }

    // ---------- Address Type (dropdown: Home/Work/Other) ----------
    if (normalizedQ.includes('address') && normalizedQ.includes('type') && context.options && context.options.length > 0) {
        const homeOpt = context.options.find(o => /home/i.test(o));
        if (homeOpt) return homeOpt;
        return context.options[0];
    }

    // ---------- Phone / Mobile number (must come BEFORE fuzzy to avoid surname match) ----------
    if (
        normalizedQ.includes('phone') ||
        normalizedQ.includes('mobile') ||
        normalizedQ.includes('contact number') ||
        normalizedQ.includes('cell') ||
        normalizedQ.includes('telephone') ||
        normalizedQ === 'number'
    ) {
        // Country code dropdowns: if options are present and look like country code labels,
        // return the matching country label (e.g. "India (+91)") not the raw phone number
        if (context.options && context.options.length > 0) {
            const countryOpt = context.options.find(o => /india|\+91/i.test(o));
            if (countryOpt) return countryOpt;
            // generic country-code dropdown: first non-empty option
            return context.options[0];
        }
        return String(data['phone'] ?? data['mobile'] ?? data['contact'] ?? '');
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
        return String(data['pincode'] ?? data['zip'] ?? '412207');
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
        return String(data['street'] ?? data['address'] ?? 'Sai Park Society, Wagholi');
    }

    // ---------- Full address ----------
    if (normalizedQ === 'address' || normalizedQ.includes('full address') || normalizedQ.includes('current address')) {
        return String(data['address'] ?? 'Sai Park Society, Wagholi, Pune, Maharashtra, India - 412207');
    }

    // ---------- City (return just "Pune" for city inputs) ----------
    // Handles "City", "Legal Address - City", "Current City" — always return city, not full address
    if (normalizedQ.includes('city')) {
        return String(data['city'] ?? 'Pune');
    }

    // ---------- State ----------
    if (
        normalizedQ.includes('state') &&
        !normalizedQ.includes('united states') &&
        !normalizedQ.includes('us state') &&
        !normalizedQ.includes('state management') &&
        !normalizedQ.includes('manage') &&
        !normalizedQ.includes('statement') &&
        !normalizedQ.includes('understanding')
    ) {
        return String(data['state'] ?? 'Maharashtra');
    }

    // ---------- County (administrative county — irrelevant in India, return empty) ----------
    if (normalizedQ === 'county' || (normalizedQ.includes('county') && !normalizedQ.includes('country'))) {
        return '';
    }

    // ---------- Country ----------
    if (normalizedQ.includes('country') || normalizedQ.includes('nation')) {
        return String(data['country'] ?? 'India');
    }

    // ---------- 10th / SSC percentage (must come BEFORE generic education check) ----------
    if (
        normalizedQ.includes('10th') ||
        normalizedQ.includes('ssc') ||
        normalizedQ.includes('class 10') ||
        normalizedQ.includes('tenth') ||
        (normalizedQ.includes('10') && normalizedQ.includes('percentage') && !normalizedQ.includes('12') && !normalizedQ.includes('btech'))
    ) {
        return String(data['10th percentage'] ?? data['10th marks'] ?? data['ssc percentage'] ?? '89.20');
    }

    // ---------- 12th / HSC percentage (must come BEFORE generic education check) ----------
    if (
        normalizedQ.includes('12th') ||
        normalizedQ.includes('hsc') ||
        normalizedQ.includes('class 12') ||
        normalizedQ.includes('twelfth') ||
        (normalizedQ.includes('12') && normalizedQ.includes('percentage') && !normalizedQ.includes('btech'))
    ) {
        return String(data['12th percentage'] ?? data['12th marks'] ?? data['hsc percentage'] ?? '73.54');
    }

    // ---------- BTech / graduation CGPA / GPA ----------
    if (
        normalizedQ.includes('cgpa') ||
        normalizedQ.includes('gpa') ||
        (normalizedQ.includes('btech') && normalizedQ.includes('percentage')) ||
        (normalizedQ.includes('b tech') && normalizedQ.includes('percentage')) ||
        (normalizedQ.includes('graduation') && normalizedQ.includes('percentage'))
    ) {
        if (normalizedQ.includes('cgpa') || normalizedQ.includes('gpa')) {
            return String(data['cgpa'] ?? data['gpa'] ?? '7.65');
        }
        return String(data['btech percentage'] ?? data['percentage'] ?? '70');
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
        // If the question is a yes/no form ("Have you completed Bachelor's Degree?")
        // with options Yes/No, always answer Yes
        if (context.options && context.options.length > 0) {
            const lowerOpts = context.options.map(o => o.toLowerCase());
            if (lowerOpts.includes('yes') && lowerOpts.includes('no')) {
                return 'Yes';
            }
        }
        const val = data['education'] ?? data['degree'] ?? 'Post Graduate Diploma in Advanced Computing (PG-DAC)';
        return String(val);
    }

    // ---------- English / language proficiency ----------
    if (
        (normalizedQ.includes('english') ||
        normalizedQ.includes('language') ||
        normalizedQ.includes('fluent') ||
        normalizedQ.includes('proficiency')) &&
        !normalizedQ.includes('programming') &&
        !normalizedQ.includes('how many')
    ) {
        if (normalizedQ.includes('scale of') || normalizedQ.includes('1 to 10') || normalizedQ.includes('out of 10')) {
            return '10';
        }
        const val = data['english'] ?? data['language'] ?? 'Professional / Fluent';
        return String(val);
    }

    // ---------- Security clearance ----------
    if (normalizedQ.includes('clearance') || normalizedQ.includes('security clearance')) {
        return String(data['clearance'] ?? 'No');
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
        if (normalizedQ.includes('github')) return String(data['github'] ?? data['portfolio'] ?? '');
        if (normalizedQ.includes('linkedin')) return String(data['linkedin'] ?? data['portfolio'] ?? '');
        return String(data['portfolio'] ?? data['website'] ?? data['link'] ?? '');
    }

    // ---------- Pronouns ----------
    if (normalizedQ.includes('pronoun')) {
        return String(data['pronouns'] ?? 'He/Him');
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
        normalizedQ.includes('you agree') ||
        normalizedQ.includes('i acknowledge') ||
        normalizedQ.includes('i confirm') ||
        normalizedQ.includes('privacy policy') ||
        normalizedQ.includes('terms of use') ||
        normalizedQ.includes('terms and conditions') ||
        normalizedQ.includes('data processing') ||
        normalizedQ.includes('by checking this box') ||
        normalizedQ.includes('checking this box') ||
        normalizedQ.includes('by clicking yes') ||
        normalizedQ.includes('clicking yes') ||
        normalizedQ.includes('accurate information') ||
        normalizedQ.includes('dishonesty') ||
        normalizedQ.includes('rejection of') ||
        normalizedQ.includes('application will not be considered') ||
        normalizedQ.includes('true and correct')
    ) {
        return 'Yes';
    }

    // ---------- References ----------
    if (normalizedQ.includes('reference')) {
        return String(data['references'] ?? data['employment references'] ?? 'Available upon request');
    }

    // ---------- Family / close friend at company ----------
    if (
        (normalizedQ.includes('family') || normalizedQ.includes('close friend') || (context && context.source === 'linkedin' && normalizedQ.includes('relative'))) &&
        (normalizedQ.includes('employed') || normalizedQ.includes('relationship') || normalizedQ.includes('work') || normalizedQ.includes('organization') || normalizedQ.includes('company'))
    ) {
        return String(data['family at company'] ?? 'No');
    }

    // ---------- Highest education level (dropdown) ----------
    if (
        normalizedQ.includes('highest level of education') ||
        normalizedQ.includes('highest education') ||
        normalizedQ.includes('level of education') ||
        normalizedQ.includes('educational background') ||
        normalizedQ.includes('highest qualification')
    ) {
        return String(data['education level'] ?? data['education'] ?? "Bachelor's Degree");
    }

    // ---------- Graduation year ----------
    if (
        normalizedQ.includes('graduation year') ||
        normalizedQ.includes('year of graduation') ||
        normalizedQ.includes('when did you graduate') ||
        normalizedQ.includes('year of passing')
    ) {
        return String(data['graduation year'] ?? '2024');
    }

    // ---------- Start date / available from ----------
    if (
        normalizedQ.includes('start date') ||
        normalizedQ.includes('available from') ||
        normalizedQ.includes('earliest start') ||
        normalizedQ.includes('when can you start')
    ) {
        return String(data['start date'] ?? '15 days');
    }

    // ---------- Currently employed / working / currently work here ----------
    if (
        (normalizedQ.includes('currently') && normalizedQ.includes('employ')) ||
        (normalizedQ.includes('currently') && normalizedQ.includes('working')) ||
        normalizedQ.includes('currently work here') ||
        normalizedQ.includes('current employment status') ||
        normalizedQ.includes('are you currently working')
    ) {
        return String(data['currently employed'] ?? 'No');
    }

    // ---------- Total / overall years of experience ----------
    if (
        (normalizedQ.includes('total') && normalizedQ.includes('experience')) ||
        normalizedQ.includes('overall experience') ||
        normalizedQ.includes('total work experience') ||
        normalizedQ.includes('years of professional experience') ||
        normalizedQ.includes('years of professional software') ||
        normalizedQ.includes('how many years of experience') ||
        (normalizedQ.includes('years') && normalizedQ.includes('experience'))
    ) {
        return String(data['experience'] ?? data['years'] ?? '1');
    }

    // ---------- Relevant experience for THIS role ----------
    if (
        normalizedQ.includes('relevant experience') ||
        normalizedQ.includes('directly relevant') ||
        (normalizedQ.includes('experience') && normalizedQ.includes('this role')) ||
        (normalizedQ.includes('experience') && normalizedQ.includes('this position'))
    ) {
        return String(data['experience'] ?? '1');
    }

    // ---------- Full Stack / Frontend / Backend ----------
    if (normalizedQ.includes('full stack') || normalizedQ.includes('fullstack')) {
        return String(data['full stack'] ?? data['experience'] ?? '1');
    }
    if (normalizedQ.includes('frontend') || normalizedQ.includes('front end') || normalizedQ.includes('front-end')) {
        return String(data['frontend'] ?? data['react'] ?? '1');
    }
    if (normalizedQ.includes('backend') || normalizedQ.includes('back end') || normalizedQ.includes('back-end')) {
        return String(data['backend'] ?? data['node'] ?? '1');
    }

    // ---------- Willing to work on-site / in office ----------
    if (
        (normalizedQ.includes('willing') && normalizedQ.includes('office')) ||
        (normalizedQ.includes('open') && normalizedQ.includes('office')) ||
        normalizedQ.includes('on-site') ||
        normalizedQ.includes('onsite') ||
        normalizedQ.includes('work from office') ||
        normalizedQ.includes('wfo')
    ) {
        return String(data['onsite'] ?? 'Yes');
    }

    // ---------- Shift / timing flexibility ----------
    if (
        normalizedQ.includes('shift') ||
        (normalizedQ.includes('flexible') && normalizedQ.includes('timing')) ||
        normalizedQ.includes('rotational shift') ||
        normalizedQ.includes('night shift') ||
        normalizedQ.includes('us shift') ||
        normalizedQ.includes('us hours')
    ) {
        return String(data['shift'] ?? 'Yes');
    }

    // ---------- Unpaid internship (must come before generic intern handler) ----------
    if (
        normalizedQ.includes('unpaid') ||
        (normalizedQ.includes('intern') && normalizedQ.includes('comfort'))
    ) {
        return String(data['unpaid internships'] ?? data['unpaid internship'] ?? 'No');
    }

    // ---------- Internship / fresher ----------
    if (
        normalizedQ.includes('intern') ||
        normalizedQ.includes('fresher') ||
        normalizedQ.includes('fresh graduate')
    ) {
        // If this is a Yes/No question (e.g. "Are you an intern?"),
        // return Yes (we are applying as an intern/fresher candidate)
        if (context.options && context.options.length > 0) {
            const lowerOpts = context.options.map(o => o.toLowerCase());
            if (lowerOpts.includes('yes') && lowerOpts.includes('no')) {
                return 'Yes';
            }
        }
        return String(data['experience'] ?? '1');
    }

    // ---------- Previously applied / worked at this company ----------
    if (
        (normalizedQ.includes('previously') || normalizedQ.includes('before') || normalizedQ.includes('before this') || (context && context.source === 'linkedin' && (normalizedQ.includes('ever been') || normalizedQ.includes('former employee')))) &&
        (normalizedQ.includes('applied') || normalizedQ.includes('worked') || normalizedQ.includes('employed') || normalizedQ.includes('employment'))
    ) {
        return String(data['previously applied'] ?? 'No');
    }

    // ---------- PRs Shipped / AI Coding Agent ----------
    if (normalizedQ.includes('prs') || normalizedQ.includes('pull requests') || (normalizedQ.includes('how many') && normalizedQ.includes('shipped'))) {
        return String(data['prs shipped'] ?? '50');
    }
    if (
        normalizedQ.includes('ai coding agent') || 
        normalizedQ.includes('ai generated') ||
        normalizedQ.includes('copilot') ||
        normalizedQ.includes('cursor') ||
        (normalizedQ.includes('ai') && normalizedQ.includes('implementation'))
    ) {
        return 'Yes';
    }
    
    // ---------- AI Products / Products built with AI tools ----------
    if (normalizedQ.includes('product') && normalizedQ.includes('ai')) {
        return String(data['products built with ai tools'] ?? data['ai products'] ?? '5');
    }

    if (normalizedQ.includes('programming language') && normalizedQ.includes('how many')) {
        return String(data['programming languages'] ?? 'JavaScript, Java, SQL');
    }

    // ---------- Referral / referred by ----------
    if (
        /\b(referred|referral)\b/.test(normalizedQ) ||
        (normalizedQ.includes('how did you hear') && normalizedQ.includes('this job')) ||
        normalizedQ.includes('source of application')
    ) {
        return String(data['referral'] ?? 'LinkedIn');
    }

    // ---------- Cover letter ----------
    if (normalizedQ.includes('cover letter') || (normalizedQ.includes('additional information') && normalizedQ.includes('yourself'))) {
        return String(data['cover letter'] ??
            'I am a motivated Full Stack Developer with hands-on experience in React.js, Node.js, Spring Boot, and MySQL. ' +
            'I am eager to contribute to your team and grow with the company.');
    }

    // ---------- Summary / about yourself / tell us about yourself ----------
    if (
        normalizedQ.includes('tell us about yourself') ||
        normalizedQ.includes('about yourself') ||
        normalizedQ.includes('brief introduction') ||
        (normalizedQ.includes('summary') && !normalizedQ.includes('salary'))
    ) {
        return String(data['summary'] ??
            'Full Stack Developer with 1 year of experience in React.js, Node.js, Spring Boot, and MySQL. ' +
            'CDAC certified. Passionate about building scalable, secure applications.');
    }

    // ---------- Why do you want to work here ----------
    if (
        normalizedQ.includes('why do you want') ||
        normalizedQ.includes('why this company') ||
        normalizedQ.includes('why are you interested') ||
        normalizedQ.includes('why should we hire')
    ) {
        return String(data['why us'] ??
            'I am impressed by your company\'s work and believe my skills in full-stack development align well with this role. ' +
            'I am eager to contribute and grow within your team.');
    }

    // ---------- Preferred job type (full-time, part-time, contract) ----------
    if (
        normalizedQ.includes('job type') ||
        normalizedQ.includes('employment type') ||
        normalizedQ.includes('full time') ||
        normalizedQ.includes('full-time') ||
        normalizedQ.includes('contract') ||
        normalizedQ.includes('permanent')
    ) {
        return String(data['job type'] ?? 'Full-time');
    }

    // ---------- Headline ----------
    if (normalizedQ.includes('headline')) {
        return String(data['headline'] ?? 'Full Stack Developer');
    }

    // ---------- Date of birth ----------
    if (
        normalizedQ.includes('date of birth') ||
        normalizedQ.includes('dob') ||
        normalizedQ.includes('birth date')
    ) {
        return String(data['dob'] ?? data['date of birth'] ?? '');
    }

    // ---------- Nationality ----------
    if (normalizedQ.includes('nationalit')) {
        return String(data['nationality'] ?? 'Indian');
    }

    // ---------- Marital status ----------
    if (normalizedQ.includes('marital')) {
        return String(data['marital status'] ?? 'Single');
    }

    // ---------- Languages known ----------
    if (
        (normalizedQ.includes('language') && normalizedQ.includes('know')) ||
        (normalizedQ.includes('language') && normalizedQ.includes('speak')) ||
        normalizedQ.includes('languages you know')
    ) {
        return String(data['languages known'] ?? 'English, Hindi, Marathi');
    }

    // ---------- Passport ----------
    if (normalizedQ.includes('passport')) {
        return String(data['passport'] ?? 'Yes');
    }

    // ---------- Background check consent ----------
    if (
        normalizedQ.includes('background check') ||
        normalizedQ.includes('background verification') ||
        normalizedQ.includes('bgv')
    ) {
        return 'Yes';
    }

    // ---------- Bond / service agreement ----------
    if (
        normalizedQ.includes('bond') ||
        normalizedQ.includes('service agreement') ||
        normalizedQ.includes('sign a bond')
    ) {
        return String(data['bond'] ?? 'Yes');
    }

    // ---------- Overtime / extended hours ----------
    if (
        normalizedQ.includes('overtime') ||
        normalizedQ.includes('extended hours') ||
        normalizedQ.includes('work extra hours')
    ) {
        return String(data['overtime'] ?? 'Yes');
    }

    // ---------- Travel required ----------
    if (
        normalizedQ.includes('travel') &&
        (normalizedQ.includes('willing') || normalizedQ.includes('open') || normalizedQ.includes('require'))
    ) {
        return String(data['travel'] ?? 'Yes');
    }

    // ---------- LinkedIn profile URL (standalone field) ----------
    if (normalizedQ === 'linkedin' || normalizedQ === 'linkedin profile' || normalizedQ === 'linkedin url') {
        return String(data['linkedin'] ?? 'https://www.linkedin.com/in/onkar-doke');
    }

    // ---------- GitHub profile URL (standalone field) ----------
    if (normalizedQ === 'github' || normalizedQ === 'github profile' || normalizedQ === 'github url') {
        return String(data['github'] ?? 'https://github.com/OmDoke');
    }

    // ---------- CTC in hand (take home) ----------
    if (normalizedQ.includes('in hand') || normalizedQ.includes('take home') || normalizedQ.includes('net salary')) {
        return String(data['in hand salary'] ?? '1.7');
    }

    // ---------- Hike / increment expected ----------
    if (
        normalizedQ.includes('hike') ||
        normalizedQ.includes('increment') ||
        (normalizedQ.includes('salary') && normalizedQ.includes('increase'))
    ) {
        return String(data['expected hike'] ?? '30');
    }

    // ---------- Number of offers / current offers ----------
    if (
        normalizedQ.includes('offer') && (normalizedQ.includes('hand') || normalizedQ.includes('current'))
    ) {
        return String(data['offers in hand'] ?? '0');
    }

    // ---------- Certifications ----------
    if (
        normalizedQ.includes('certification') ||
        normalizedQ.includes('certified') ||
        normalizedQ.includes('certificate')
    ) {
        return String(data['certifications'] ?? 'PG-DAC from CDAC Pune');
    }

    // ---------- Preferred work location ----------
    if (
        normalizedQ.includes('preferred location') ||
        normalizedQ.includes('preferred work location') ||
        normalizedQ.includes('preferred city') ||
        normalizedQ.includes('location preference')
    ) {
        return String(data['preferred location'] ?? 'Pune, Mumbai, Bangalore, Remote');
    }

    // ---------- Email address ----------
    if (normalizedQ.includes('email')) {
        // If it's a select/dropdown with options, pick the matching email or first available
        if (context.options && context.options.length > 0) {
            const ourEmail = String(data['email'] ?? '').toLowerCase();
            const match = context.options.find(o =>
                o.toLowerCase() === ourEmail ||
                (ourEmail.split('@')[0] && o.toLowerCase().split('@')[0] === ourEmail.split('@')[0])
            );
            return match || context.options[0];
        }
        return String(data['email'] ?? '');
    }

    // ---------- Work arrangement / work model / hybrid ----------
    if (
        normalizedQ.includes('work arrangement') ||
        normalizedQ.includes('work model') ||
        normalizedQ.includes('in-office') ||
        normalizedQ.includes('hybrid work') ||
        normalizedQ.includes('mode of work') ||
        normalizedQ.includes('work mode')
    ) {
        if (context.options && context.options.length > 0) {
            const opts = context.options.map(o => o.toLowerCase());
            if (opts.some(o => o.includes('hybrid')))
                return context.options.find(o => o.toLowerCase().includes('hybrid'));
            if (opts.some(o => o.includes('remote')))
                return context.options.find(o => o.toLowerCase().includes('remote'));
        }
        return String(data['work arrangement'] ?? 'Hybrid');
    }

    // ---------- Age verification / 18+ ----------
    if (
        (normalizedQ.includes('18') && (normalizedQ.includes('age') || normalizedQ.includes('year'))) ||
        normalizedQ.includes('age eligible') ||
        (normalizedQ.includes('you are') && normalizedQ.includes('years old'))
    ) {
        return 'Yes';
    }

    // ---------- CGPA / GPA / percentage / marks ----------
    if (
        normalizedQ.includes('percentage') ||
        normalizedQ.includes('aggregate percentage')
    ) {
        return String(data['percentage'] ?? '75');
    }
    if (
        normalizedQ.includes('cgpa') ||
        normalizedQ.includes('gpa') ||
        normalizedQ.includes('aggregate') ||
        (normalizedQ.includes('score') || normalizedQ.includes('achiev') || normalizedQ.includes('marks'))
    ) {
        return String(data['cgpa'] ?? data['gpa'] ?? '7.5');
    }

    // ---------- Field of study / major / area of study ----------
    if (
        normalizedQ.includes('field of study') ||
        normalizedQ.includes('area of study') ||
        (normalizedQ.includes('major') && (normalizedQ.includes('your') || normalizedQ.includes('what'))) ||
        (normalizedQ.includes('stream') && normalizedQ.includes('studied'))
    ) {
        return String(data['field of study'] ?? 'Computer Engineering');
    }

    // ---------- University / College / Institution / School ----------
    if (
        normalizedQ.includes('university') ||
        normalizedQ.includes('college') ||
        normalizedQ.includes('institution') ||
        (normalizedQ.includes('school') && !normalizedQ.includes('high school') && !normalizedQ.includes('secondary'))
    ) {
        return String(data['university'] ?? 'Savitribai Phule Pune University');
    }

    // ---------- Current location / current city ----------
    if (
        (normalizedQ.includes('current') && normalizedQ.includes('location')) ||
        (normalizedQ.includes('current') && normalizedQ.includes('city')) ||
        (normalizedQ.includes('where') && normalizedQ.includes('currently') && normalizedQ.includes('live'))
    ) {
        return String(data['city'] ?? 'Pune');
    }

    // ---------- NDA / Non-compete / Confidentiality ----------
    if (
        normalizedQ.includes('nda') ||
        normalizedQ.includes('non-compete') ||
        normalizedQ.includes('non compete') ||
        normalizedQ.includes('confidentiality') ||
        normalizedQ.includes('non disclosure')
    ) {
        return String(data['nda'] ?? 'Yes');
    }

    // ---------- Hours per week ----------
    if (
        (normalizedQ.includes('hours') && normalizedQ.includes('week')) ||
        normalizedQ.includes('hours per week') ||
        normalizedQ.includes('weekly hours')
    ) {
        return String(data['hours per week'] ?? '40');
    }

    // ---------- Professional association / membership ----------
    if (
        normalizedQ.includes('association') ||
        normalizedQ.includes('membership') ||
        normalizedQ.includes('professional organization') ||
        normalizedQ.includes('member of any')
    ) {
        return String(data['association'] ?? 'No');
    }

    // ---------- Industry ----------
    if (normalizedQ === 'industry' || (normalizedQ.includes('industry') && normalizedQ.length < 20)) {
        return String(data['industry'] ?? 'Information Technology and Services');
    }

    // ---------- Project / portfolio description ----------
    if (
        (normalizedQ.includes('project') && (normalizedQ.includes('describe') || normalizedQ.includes('notable') || normalizedQ.includes('best') || normalizedQ.includes('recent'))) ||
        normalizedQ.includes('portfolio project')
    ) {
        return String(data['project description'] ??
            'Built a full-stack job application tracker using React.js, Node.js, and MySQL with JWT authentication, real-time updates via WebSocket, and automated email notifications.');
    }

    // ---------- Achievement / accomplishment ----------
    if (
        normalizedQ.includes('achievement') ||
        normalizedQ.includes('accomplishment') ||
        normalizedQ.includes('proud of') ||
        (normalizedQ.includes('greatest') && normalizedQ.includes('achievement'))
    ) {
        return String(data['achievement'] ??
            'Reduced API response time by 40% through query optimization and Redis caching in a production Node.js application.');
    }

    // ---------- Strength / value add ----------
    if (
        (normalizedQ.includes('strength') && !normalizedQ.includes('password')) ||
        normalizedQ.includes('your best quality') ||
        (normalizedQ.includes('value') && normalizedQ.includes('bring'))
    ) {
        return String(data['strength'] ??
            'Strong problem-solving skills and ability to quickly learn new technologies. I thrive in collaborative environments and consistently deliver clean, maintainable code.');
    }

    // ---------- Weakness ----------
    if (normalizedQ.includes('weakness') || normalizedQ.includes('area of improvement')) {
        return String(data['weakness'] ??
            'I sometimes over-engineer solutions, but I have learned to balance thoroughness with delivery speed by setting timebox limits for myself.');
    }

    // ---------- Currently interviewing / other offers ----------
    if (
        (normalizedQ.includes('currently') && normalizedQ.includes('interview')) ||
        normalizedQ.includes('interview process') ||
        normalizedQ.includes('other interviews')
    ) {
        return String(data['interviewing'] ?? 'No');
    }

    // ---------- Open to contract / freelance ----------
    if (
        (normalizedQ.includes('contract') || normalizedQ.includes('freelance')) &&
        (normalizedQ.includes('open') || normalizedQ.includes('willing') || normalizedQ.includes('comfortable'))
    ) {
        return String(data['contract'] ?? 'Yes');
    }

    // ---------- Immediate joining / available immediately ----------
    if (
        normalizedQ.includes('immediate joining') ||
        normalizedQ.includes('join immediately') ||
        (normalizedQ.includes('available') && normalizedQ.includes('immediately'))
    ) {
        if (context.options && context.options.length > 0) {
            const opts = context.options.map(o => o.toLowerCase());
            if (opts.includes('yes') && opts.includes('no')) return String(data['immediate joining'] ?? 'No');
        }
        return String(data['immediate joining'] ?? 'No');
    }

    // ---------- How did you hear / source of application ----------
    if (
        normalizedQ.includes('how did you hear') ||
        normalizedQ.includes('where did you find') ||
        normalizedQ.includes('how did you learn about') ||
        normalizedQ.includes('source of application') ||
        (normalizedQ.includes('how') && normalizedQ.includes('find') && normalizedQ.includes('job'))
    ) {
        return String(data['referral'] ?? 'LinkedIn');
    }

    // ---------- Expected joining date ----------
    if (
        normalizedQ.includes('expected joining') ||
        normalizedQ.includes('joining date') ||
        (normalizedQ.includes('when') && normalizedQ.includes('join') && !normalizedQ.includes('immediately'))
    ) {
        return String(data['start date'] ?? '15 days');
    }

    // ---------- Reason for leaving / leaving current job / reason for change ----------
    if (
        normalizedQ.includes('reason for leaving') ||
        normalizedQ.includes('why are you looking') ||
        normalizedQ.includes('why do you want to leave') ||
        normalizedQ.includes('why leaving') ||
        normalizedQ.includes('reason for change') ||
        normalizedQ.includes('reason for switch')
    ) {
        return String(data['reason for change'] ?? data['reason for leaving'] ??
            'Seeking better growth opportunities and a role that fully leverages my full-stack development skills in a dynamic team.');
    }

    // ---------- Last working day / last service date ----------
    // Triggered when: "If yes, please mention your last working day" or similar
    if (
        normalizedQ.includes('last working day') ||
        normalizedQ.includes('last service date') ||
        normalizedQ.includes('last day of work') ||
        normalizedQ.includes('end date') ||
        (normalizedQ.includes('last') && normalizedQ.includes('day') && (normalizedQ.includes('mention') || normalizedQ.includes('work')))
    ) {
        return String(data['last working day'] ?? data['last service date'] ?? '15/06/2026');
    }

    // ---------- Founder's office / ambiguous environment comfort (scale of 1-10) ----------
    if (
        normalizedQ.includes('founder') ||
        normalizedQ.includes('scale of 1') ||
        normalizedQ.includes('scale of 110') ||
        (normalizedQ.includes('scale') && normalizedQ.includes('comfort')) ||
        (normalizedQ.includes('ambiguous') && normalizedQ.includes('environment')) ||
        (normalizedQ.includes('comfort') && (normalizedQ.includes('working') || normalizedQ.includes('environment')))
    ) {
        return String(data['founder comfort scale'] ?? data['comfort scale'] ?? '8');
    }

    // ---------- Ethnic Identity (full description radio options) ----------
    if (
        normalizedQ.includes('ethnic identity') ||
        normalizedQ.includes('ethnic background') ||
        (normalizedQ.includes('ethnic') && (normalizedQ.includes('identify') || normalizedQ.includes('origin')))
    ) {
        // If presented as radio with full descriptions, pick "I don't wish to answer"
        if (context.options && context.options.length > 0) {
            const noWishOpt = context.options.find(o =>
                o.toLowerCase().includes("don't wish") ||
                o.toLowerCase().includes('decline') ||
                o.toLowerCase().includes('prefer not')
            );
            if (noWishOpt) return noWishOpt;
            // Fallback to Asian option if available (closest to Indian origin)
            const asianOpt = context.options.find(o => o.toLowerCase().includes('asian'));
            if (asianOpt) return asianOpt;
        }
        return String(data['race'] ?? 'Decline to self-identify');
    }

    // ---------- Gender identity ("Do you think of yourself as?") ----------
    if (
        (normalizedQ.includes('think of yourself') && normalizedQ.includes('as')) ||
        normalizedQ.includes('identify as')
    ) {
        if (context.options && context.options.length > 0) {
            const maleOpt = context.options.find(o => o.toLowerCase() === 'male' || o.toLowerCase().includes('man'));
            if (maleOpt) return maleOpt;
        }
        return String(data['gender'] ?? 'Male');
    }

    // ---------- How soon can you start? (checkbox group) ----------
    if (
        (normalizedQ.includes('how soon') && normalizedQ.includes('start')) ||
        (normalizedQ.includes('how soon') && normalizedQ.includes('can you'))
    ) {
        if (context.options && context.options.length > 0) {
            const opts = context.options.map(o => o.toLowerCase());
            // Prefer 15-day-ish options
            for (const opt of opts) {
                if (opt.includes('15') || opt.includes('two week') || opt.includes('2 week')) {
                    return context.options[opts.indexOf(opt)];
                }
            }
            // Prefer 30 days (1 month)
            for (const opt of opts) {
                if (opt.includes('30') || opt.includes('month') || opt.includes('less than')) {
                    return context.options[opts.indexOf(opt)];
                }
            }
            return context.options[0];
        }
        return '30 days';
    }

    // ---------- Why are you a good fit / Why should we hire you ----------
    if (
        normalizedQ.includes('good fit') ||
        normalizedQ.includes('why do you think you are') ||
        (normalizedQ.includes('fit') && normalizedQ.includes('role')) ||
        (normalizedQ.includes('fit') && normalizedQ.includes('position'))
    ) {
        return String(data['why good fit'] ?? data['why us'] ??
            'I am a Full Stack Developer with hands-on experience in React.js, Node.js, and MySQL. My CDAC certification and 1 year of industry experience make me a strong candidate for this role.');
    }

    // ---------- Tech stack / current tech stack ----------
    if (
        (normalizedQ.includes('tech') && normalizedQ.includes('stack')) ||
        normalizedQ.includes('technology stack') ||
        normalizedQ.includes('technologies you use') ||
        normalizedQ.includes('tools and technologies')
    ) {
        return String(data['tech stack'] ?? data['current tech stack'] ??
            'React.js, Node.js, Spring Boot, MySQL, MongoDB, JavaScript, Java');
    }

    // ---------- Based in Pune / location confirmation ----------
    if (
        (normalizedQ.includes('based in pune') || normalizedQ.includes('based in') && normalizedQ.includes('pune')) ||
        (normalizedQ.includes('pune') && normalizedQ.includes('candidates')) ||
        (normalizedQ.includes('pune') && normalizedQ.includes('preferred'))
    ) {
        if (context.options && context.options.length > 0) {
            const yesOpt = context.options.find(o => o.toLowerCase() === 'yes');
            if (yesOpt) return yesOpt;
        }
        return String(data['based in pune'] ?? data['city'] ?? 'Pune');
    }

    // ---------- Startup culture / startup hustle ----------
    if (
        normalizedQ.includes('startup') ||
        normalizedQ.includes('hustle') ||
        (normalizedQ.includes('highgrowth') || normalizedQ.includes('high-growth') || normalizedQ.includes('high growth'))
    ) {
        if (context.options && context.options.length > 0) {
            const yesOpt = context.options.find(o => o.toLowerCase() === 'yes');
            if (yesOpt) return yesOpt;
        }
        return 'Yes';
    }

    // ---------- Education completed / pre-placement offer confirmation ----------
    if (
        normalizedQ.includes('completed their education') ||
        normalizedQ.includes('completed your education') ||
        normalizedQ.includes('completed education') ||
        (normalizedQ.includes('preplacement') || normalizedQ.includes('pre-placement'))
    ) {
        if (context.options && context.options.length > 0) {
            const yesOpt = context.options.find(o => o.toLowerCase() === 'yes');
            if (yesOpt) return yesOpt;
        }
        return String(data['education completed'] ?? 'Yes');
    }

    // ---------- Build / deployed functional tech project (MVP) ----------
    if (
        (normalizedQ.includes('built') && (normalizedQ.includes('product') || normalizedQ.includes('project') || normalizedQ.includes('mvp'))) ||
        (normalizedQ.includes('build') && normalizedQ.includes('software')) ||
        (normalizedQ.includes('deployed') && normalizedQ.includes('project'))
    ) {
        if (context.options && context.options.length > 0) {
            const yesOpt = context.options.find(o => o.toLowerCase() === 'yes');
            if (yesOpt) return yesOpt;
        }
        return 'Yes';
    }

    // ---------- Available to travel internationally ----------
    if (
        (normalizedQ.includes('travel') && normalizedQ.includes('international')) ||
        normalizedQ.includes('available to travel')
    ) {
        return String(data['country'] ?? 'India');
    }

    return null;
};

// ---------------------------------------------------------------------------
// Fuzzy matcher using string-similarity
// Returns the best-matching value from userData, or null.
// ---------------------------------------------------------------------------
const getBestFuzzyMatch = (normalizedQ, userData) => {
    // Merge with loaded profile
    const data = { ...loadedUserData, ...userData };
    
    const keys = Object.keys(data);
    if (keys.length === 0) return null;

    const normalizedKeys = keys.map(k => normalizeText(k));

    const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(
        normalizedQ,
        normalizedKeys
    );

    // Raised threshold to 0.6 to prevent wrong answers (e.g. surname filling phone field)
    if (bestMatch.rating >= 0.6) {
        const matchedKey = keys[bestMatchIndex];
        // Safety: never return a personal name value for a non-name question
        const isNameKey = ['first name', 'last name', 'full name'].includes(matchedKey.toLowerCase());
        const isNameQuestion = normalizedQ.includes('name');
        if (isNameKey && !isNameQuestion) return null;
        return String(data[matchedKey]);
    }

    // Secondary pass: check if any key is a substring of the question
    for (let i = 0; i < normalizedKeys.length; i++) {
        if (normalizedKeys[i].length > 3 && normalizedQ.includes(normalizedKeys[i])) {
            // Safety: skip name keys for non-name questions
            const isNameKey = ['first name', 'last name', 'full name'].includes(normalizedKeys[i]);
            if (isNameKey && !normalizedQ.includes('name')) continue;
            return String(data[keys[i]]);
        }
    }

    return null;
};


// ---------------------------------------------------------------------------
// Direct answers.json lookup — tries normalized key, then substring, then
// word-overlap match. This runs BEFORE rules and LLM to maximise cache hits.
// ---------------------------------------------------------------------------
const getDirectAnswer = (normalizedQ, userData) => {
    const data = { ...loadedUserData, ...userData };
    // 1. Exact match on normalized key
    const exactKey = Object.keys(data).find(k => normalizeText(k) === normalizedQ);
    if (exactKey !== undefined) return String(data[exactKey]);

    // 2. Normalized question CONTAINS a key (e.g. question has extra words around a known key)
    const containedKey = Object.keys(data).find(k => {
        const nk = normalizeText(k);
        return nk.length > 4 && normalizedQ.includes(nk);
    });
    if (containedKey !== undefined) return String(data[containedKey]);

    // 3. Key contains the normalized question (shorter question matches longer key)
    const reverseKey = Object.keys(data).find(k => {
        const nk = normalizeText(k);
        return nk.length > 4 && nk.includes(normalizedQ);
    });
    if (reverseKey !== undefined) return String(data[reverseKey]);

    return null;
};

// ---------------------------------------------------------------------------
// Main exported function — async (supports AI fallback)
// ---------------------------------------------------------------------------
const getAnswer = async (questionText, userData, context = {}) => {
    if (!questionText || !userData) return null;

    const normalized = normalizeText(questionText);
    const llmFirst = process.env.LLM_FIRST === 'true';

    // ── Step 0: Direct answers.json lookup (fastest, zero LLM tokens) ──
    // Check before anything else — if the question or a close variant is already in
    // answers.json, return it instantly without touching LLM or heavy rule chains.
    const directAnswer = getDirectAnswer(normalized, userData);
    if (directAnswer !== null) {
        // Validate against dropdown options if present
        if (context.options && context.options.length > 0) {
            const lowerOpts = context.options.map(o => o.toLowerCase());
            const directLower = directAnswer.toLowerCase();
            // If it's a Yes/No dropdown, check validity
            const isYesNo = lowerOpts.includes('yes') && lowerOpts.includes('no') && context.options.length <= 3;
            if (!isYesNo || lowerOpts.includes(directLower)) {
                return directAnswer;
            }
            // Fall through to rules if the direct answer isn't a valid option
        } else {
            return directAnswer;
        }
    }

    // ── DYNAMIC_KEYWORDS: only truly open-ended questions need LLM ──
    // Removed: 'what is your', 'experience', 'years', 'how many', 'skill' etc.
    // The rule engine + answers.json handles all of these deterministically.
    // LLM is only valuable for free-text creative answers: describe/explain/why/cover letter.
    const DYNAMIC_KEYWORDS = [
        'describe', 'explain', 'tell us',
        'cover letter', 'about yourself',
        'why do you want', 'why are you interested', 'why this company',
        'why should we hire', 'why good fit',
        'proud of', 'accomplishment', 'achievement',
        'motivation', 'reason for leaving', 'reason for change',
        'strength', 'weakness', 'area of improvement',
    ];

    const isDynamicQuestion = DYNAMIC_KEYWORDS.some(kw => normalized.includes(kw)) &&
        !/\b(gender|email|name|phone|mobile|contact|address|pincode|zip|linkedin|github|website)\b/.test(normalized);

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

        let fuzzyAnswer = getBestFuzzyMatch(normQ, uData);
        if (fuzzyAnswer !== null && ctx.options && ctx.options.length > 0) {
            const lowerOpts = ctx.options.map(o => o.toLowerCase());
            const isYesNoField = lowerOpts.includes('yes') && lowerOpts.includes('no') && ctx.options.length <= 3;
            if (isYesNoField) {
                const fuzzyAnswerLower = fuzzyAnswer.toLowerCase();
                if (!lowerOpts.includes(fuzzyAnswerLower)) {
                    fuzzyAnswer = null;
                }
            }
            if (normQ === 'title' && ctx.options.some(o => /mr|ms|dr/i.test(o))) {
                fuzzyAnswer = null;
            }
        }
        if (fuzzyAnswer !== null) return fuzzyAnswer;

        return null;
    };

    // ── Step 1: Static rules + fuzzy (deterministic, highest priority) ──
    // Must run BEFORE getDirectAnswer to prevent broad key matches (e.g. "address" key
    // overriding the specific city rule for "Legal Address - City").
    const staticAnswer = getStaticAnswer(normalized, userData, context);
    if (staticAnswer !== null) return staticAnswer;

    // ── Step 3: LLM — only for truly open-ended questions not handled by rules ──
    if (llmFirst || isDynamicQuestion) {
        const aiAnswer = await getAIAnswer(questionText, context, userData);
        if (aiAnswer !== null) return aiAnswer;
    }

    // 3. Final safety nets

    // 3a. Consent / Agreement / Certification statements (e.g., "I certify that...", "By clicking Yes...", "has my consent")
    const isConsent = /\b(consent|agree|certify|acknowledge|privacy policy|terms and conditions|understand that)\b/i.test(questionText);
    if (isConsent && context.options && context.options.map(o => o.toLowerCase()).includes('yes')) {
        return 'Yes';
    }

    // 3b. Obvious yes/no questions default to "Yes"
    const isYesNo = /\b(are you|do you|have you|can you|will you|would you|is your|were you|did you)\b/i.test(questionText) && !/\b(how many|how much|what|who|where|when|why|describe|explain)\b/i.test(questionText);
    const hasYesNoOptions = context.options &&
        context.options.map(o => o.toLowerCase()).includes('yes') &&
        context.options.map(o => o.toLowerCase()).includes('no') &&
        context.options.length <= 3;

    if (isYesNo || hasYesNoOptions) return 'Yes';

    return null;
};

module.exports = {
    getAnswer,
    normalizeText,
    getBestFuzzyMatch,
};
