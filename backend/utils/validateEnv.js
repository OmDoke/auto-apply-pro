'use strict';

/**
 * Environment variables that MUST be present for the app to start.
 * The process will exit(1) if any are missing.
 */
const REQUIRED_VARS = ['GROQ_API_KEY'];

/**
 * Environment variables that are optional but strongly recommended.
 * Missing values fall back to safe defaults; a warning is printed.
 */
const RECOMMENDED_VARS = ['JOB_TITLE', 'RESUME_NAME', 'CHROME_PATH', 'PORT', 'LINKEDIN_EMAIL'];

/**
 * Validates environment variables on startup.
 * Exits the process if required variables are missing.
 * Prints a warning for missing recommended variables.
 *
 * @returns {{ missing: string[], missingRecommended: string[] }}
 */
function validateEnv() {
    const missing = REQUIRED_VARS.filter(v => !process.env[v]);
    const missingRecommended = RECOMMENDED_VARS.filter(v => !process.env[v]);

    if (missing.length > 0) {
        console.error('\n❌ Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('\nPlease copy .env.example to .env and fill in the missing values.\n');
        process.exit(1);
    }

    if (missingRecommended.length > 0) {
        console.warn('\n⚠️  Missing recommended environment variables (will use defaults):');
        missingRecommended.forEach(v => console.warn(`   - ${v}`));
        console.warn('');
    }

    return { missing, missingRecommended };
}

/**
 * Returns a typed config object built from validated environment variables.
 * Import this instead of reading process.env directly across modules.
 *
 * @returns {object} Parsed application configuration.
 */
function getEnvConfig() {
    return {
        groqApiKey:   process.env.GROQ_API_KEY,
        jobTitle:     process.env.JOB_TITLE     || 'Software Engineer',
        resumeName:   process.env.RESUME_NAME   || '',
        chromePath:   process.env.CHROME_PATH   || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        port:         parseInt(process.env.PORT || '5000', 10),
        linkedInEmail: process.env.LINKEDIN_EMAIL || '',
    };
}

module.exports = { validateEnv, getEnvConfig };
