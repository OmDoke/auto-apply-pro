'use strict';

const fs = require('fs');
const path = require('path');

// Use the internal pdf-parse function directly to avoid broken default-export detection
// across different installed versions of the package.
let pdf;
try {
    // pdf-parse v1.1.x: the real parse function lives here
    pdf = require('pdf-parse/lib/pdf-parse');
} catch (_) {
    // Fallback for older layout where default export is the function
    const _pdfParse = require('pdf-parse');
    pdf = typeof _pdfParse === 'function' ? _pdfParse : _pdfParse.default;
}

const { ChatGroq } = require('@langchain/groq');
const { PromptTemplate } = require('@langchain/core/prompts');

// Cache the parsed resume text to avoid re-reading the PDF on every call
let cachedResumeText = null;

// Singleton LLM client — instantiated once, reused across all getAIAnswer calls
let _llmClient = null;
let _llmModel = null;

const qaLogsPath = path.join(__dirname, '..', 'qa_logs.txt');
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB

const logQA = (message) => {
    try {
        fs.appendFileSync(qaLogsPath, message);
        const stats = fs.statSync(qaLogsPath);
        if (stats.size > MAX_LOG_SIZE) {
            const backupPath = path.join(__dirname, '..', 'qa_logs.bak.txt');
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            fs.renameSync(qaLogsPath, backupPath);
        }
    } catch (e) {}
};
const getLLMClient = () => {
    const modelName = process.env.GROQ_MODEL || 'deepseek-r1-distill-llama-70b';
    if (!_llmClient || _llmModel !== modelName) {
        _llmClient = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: modelName,
            temperature: 0.1,
        });
        _llmModel = modelName;
    }
    return _llmClient;
};

// Exponential back-off wrapper for Groq rate limit errors (429)
const invokeWithBackoff = async (llm, prompt, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await llm.invoke(prompt);
        } catch (err) {
            if (attempt === maxRetries) throw err;
            const isRateLimit = err?.status === 429 || (err?.message || '').includes('rate limit');
            if (!isRateLimit) throw err;
            const delay = Math.pow(2, attempt) * 1000;
            logQA(`[${new Date().toISOString()}] Groq rate limit hit (attempt ${attempt}). Retrying in ${delay}ms...\n`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
};

async function getResumeText() {
    if (cachedResumeText) return cachedResumeText;

    const resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');
    if (!fs.existsSync(resumePath)) {
        logQA(`[${new Date().toISOString()}] Resume PDF not found at: ${resumePath}\n`);
        return '';
    }

    try {
        const dataBuffer = fs.readFileSync(resumePath);
        const data = await pdf(dataBuffer);

        if (!data.text || data.text.trim().length === 0) {
            logQA(`[${new Date().toISOString()}] PDF parsed but text is empty — may be a scanned image with no text layer.\n`);
            return '';
        }

        cachedResumeText = data.text;
        logQA(`[${new Date().toISOString()}] Resume loaded successfully (${cachedResumeText.length} chars).\n`);
        return cachedResumeText;
    } catch (error) {
        logQA(`[${new Date().toISOString()}] Error parsing resume PDF: ${error.stack || error}\n`);
        return '';
    }
}

async function getAIAnswer(questionText, context = {}, userData = {}) {
    if (!process.env.GROQ_API_KEY) {
        logQA(`[${new Date().toISOString()}] No GROQ_API_KEY set.\n`);
        return null;
    }

    const resumeText = await getResumeText();

    // Format profile data context from userData
    const mergedProfile = { ...userData };
    let profileDataString = '';
    for (const [key, val] of Object.entries(mergedProfile)) {
        if (val !== undefined && val !== null && val !== '') {
            profileDataString += `${key}: ${val}\n`;
        }
    }
    if (!profileDataString.trim()) {
        profileDataString = 'None available.';
    }

    let optionsPrompt = '';
    if (context.options && context.options.length > 0) {
        optionsPrompt = `\n5. DROPDOWN/RADIO OPTIONS:\nYou MUST choose exactly ONE of the following options: [${context.options.join(', ')}]\nDo not invent a new answer. Return ONLY the exact text of the best matching option.`;
    }

    try {
        const llm = getLLMClient();

        const prompt = PromptTemplate.fromTemplate(`
You are helping a job applicant fill out application forms to secure interviews.
Use the resume text and profile data below to answer the question. FOLLOW ALL RULES STRICTLY.

PROFILE DATA:
{profile_data}

RESUME TEXT:
{resume_text}

RULES:
1. NUMERIC FIELDS (years, decimal, days, number): Output ONLY a single number. No text, no units, no period at end.
   - Notice period / can you start immediately / joining time → "15"  (this candidate has a 15-day notice period)
   - Total years of relevant experience → sum internships + full-time roles from dates on resume to today
   - Years of experience in a specific skill → look at work experience dates, estimate overlap
2. YES/NO QUESTIONS: Output only "Yes" or "No". No period at end.
   - Comfortable / willing / open to / available / agree → "Yes"
   - Prior employment at a company NOT in the resume → "No"
   - Uncertain yes/no → "Yes" (benefit of the doubt)
3. SHORT OPEN TEXT: One short phrase or sentence. No paragraphs, no preamble.
   - Use profile data and resume content directly where available
   - For current/expected salary: current = 2, expected = 6
4. UNKNOWN: If you truly have no idea and no sensible default exists, output exactly: I don't know${optionsPrompt}

Current Date: {current_date}

Question:
{question}

Answer:`);

        const formattedPrompt = await prompt.format({
            profile_data: profileDataString,
            resume_text: resumeText || 'No resume text available.',
            current_date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            question: questionText
        });

        const response = await invokeWithBackoff(llm, formattedPrompt);

        // Clean up the answer: strip <think> blocks, trim whitespace, strip trailing period, take first line only
        let answer = (response.content || '').trim();
        answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        answer = answer.split('\n')[0].trim();  // take first line if multi-line
        answer = answer.replace(/\.$/, '').trim(); // strip trailing period

        logQA(`[${new Date().toISOString()}] Q: "${questionText}" -> A: "${answer}"\n`);

        if (/i\s+don'?t\s+know/i.test(answer)) {
            return null;
        }

        return answer || null;
    } catch (error) {
            logQA(`[${new Date().toISOString()}] Error invoking Groq LLM: ${error}\n`);
        return null;
    }
}

module.exports = {
    getAIAnswer,
    getResumeText,
};
