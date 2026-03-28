'use strict';

const fs = require('fs');
const path = require('path');
// pdf-parse v1.1.x exports the parse function directly; newer builds
// wrap it under .default. Support both shapes.
const _pdfParse = require('pdf-parse');
const pdf = typeof _pdfParse === 'function' ? _pdfParse : _pdfParse.default;
const { ChatGroq } = require('@langchain/groq');
const { PromptTemplate } = require('@langchain/core/prompts');

// Cache the parsed resume text to avoid re-reading the PDF
let cachedResumeText = null;

// Singleton LLM client — instantiated once, reused across all getAIAnswer calls
let _llmClient = null;
const getLLMClient = () => {
    if (!_llmClient) {
        _llmClient = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
        });
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
            fs.appendFileSync(
                path.join(__dirname, '..', 'qa_logs.txt'),
                `[${new Date().toISOString()}] Groq rate limit hit (attempt ${attempt}). Retrying in ${delay}ms...\n`
            );
            await new Promise(r => setTimeout(r, delay));
        }
    }
};

async function getResumeText() {
    if (cachedResumeText) return cachedResumeText;

    const resumePath = path.join(__dirname, '..', 'data', 'resume.pdf');
    if (!fs.existsSync(resumePath)) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] Resume PDF not found at: ${resumePath}\n`);
        return '';
    }

    try {
        const dataBuffer = fs.readFileSync(resumePath);
        const data = await pdf(dataBuffer);
        
        if (!data.text || data.text.trim().length === 0) {
            fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] PDF was parsed but the text is empty. It might be a scanned image containing no text layers.\n`);
            return '';
        }
        
        cachedResumeText = data.text;
        return cachedResumeText;
    } catch (error) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] Error parsing resume PDF: ${error.stack || error}\n`);
        return '';
    }
}

async function getAIAnswer(questionText, context = {}) {
    if (!process.env.GROQ_API_KEY) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] No GROQ_API_KEY set.\n`);
        return null;
    }

    const resumeText = await getResumeText();
    if (!resumeText) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] No resume text found.\n`);
        return null;
    }

    let optionsPrompt = '';
    if (context.options && context.options.length > 0) {
        optionsPrompt = `\n5. DROPDOWN/RADIO OPTIONS:\nYou MUST choose exactly ONE of the following options: [${context.options.join(', ')}]\nDo not invent a new answer. Return ONLY the exact text of the best matching option.`;
    }

    try {
        const llm = getLLMClient();

        const prompt = PromptTemplate.fromTemplate(`
You are helping a job applicant fill out application forms to secure interviews.
Use the resume text below to answer the question. FOLLOW ALL RULES STRICTLY.

RULES:
1. NUMERIC FIELDS (years, decimal, days, number): Output ONLY a single number. No text, no units.
   - Notice period or can you start immediately → "0"
   - Total years of relevant experience (sum internships + full-time roles from dates to today)
2. YES/NO QUESTIONS: Output only "Yes" or "No".
   - Comfortable / willing / open to / available / agree → "Yes" (even if resume doesn't mention it)
   - Prior employment at a company NOT in the resume → "No"
   - Anything else uncertain for a yes/no question → "Yes" (benefit of the doubt to get a callback)
3. SHORT OPEN TEXT: One short phrase or sentence. NO paragraphs, NO preamble, NO "Based on resume...".
   - If answer is in resume, use it directly.
   - If not in resume but a positive/professional answer would help, give a sensible short answer.
4. UNKNOWN TEXT: Only if you have absolutely NO idea and no sensible default exists, output exactly: I don't know${optionsPrompt}

Current Date: {current_date}

Resume Text:
{resume_text}

Question:
{question}

Answer:`);

        const formattedPrompt = await prompt.format({
            current_date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            resume_text: resumeText,
            question: questionText
        });

        const response = await invokeWithBackoff(llm, formattedPrompt);
        const answer = response.content.trim();

        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] Q: "${questionText}" -> A: "${answer}"\n`);

        // Detect any "I don't know" variant (may appear after a spurious number on a new line)
        const cleanAnswer = answer.trim();
        if (/i\s+don'?t\s+know/i.test(cleanAnswer)) {
            return null;
        }

        return answer;
    } catch (error) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] Error invoking Groq LLM: ${error}\n`);
        return null;
    }
}

module.exports = {
    getAIAnswer
};
