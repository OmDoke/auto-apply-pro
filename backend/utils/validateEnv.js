'use strict';

const REQUIRED_VARS = ['GROQ_API_KEY'];
const RECOMMENDED_VARS = ['JOB_TITLE', 'RESUME_NAME'];

function validateEnv() {
    const missing = REQUIRED_VARS.filter(v => !process.env[v]);
    const missingRec = RECOMMENDED_VARS.filter(v => !process.env[v]);

    if (missing.length > 0) {
        console.error('\n❌ Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('\nPlease copy .env.example to .env and fill in the missing values.\n');
        process.exit(1);
    }

    if (missingRec.length > 0) {
        console.warn('\n⚠️  Missing recommended environment variables (will use defaults):');
        missingRec.forEach(v => console.warn(`   - ${v}`));
        console.warn('');
    }
}

module.exports = { validateEnv };
