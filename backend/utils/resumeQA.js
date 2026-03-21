'use strict';

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { ChatGroq } = require('@langchain/groq');
const { PromptTemplate } = require('@langchain/core/prompts');

// Cache the parsed resume text to avoid re-reading the PDF
let cachedResumeText = null;

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

async function getAIAnswer(questionText) {
    if (!process.env.GROQ_API_KEY) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] No GROQ_API_KEY set.\n`);
        return null;
    }

    const resumeText = await getResumeText();
    if (!resumeText) {
        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] No resume text found.\n`);
        return null;
    }

    try {
        const llm = new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: "llama-3.1-8b-instant",
            modelName: "llama-3.1-8b-instant",
            temperature: 0.1,
        });

        const prompt = PromptTemplate.fromTemplate(`
You are helping an applicant fill out a job application.
Based ONLY on the resume text provided below, answer the following question concisely.
CRITICAL RULES:
1. If the question asks for "years of experience", calculate total duration across ALL relevant roles based on the dates and the current date (Internships COUNT as experience).
2. If the question explicitly asks for a number, decimal, or days (e.g., "Enter a decimal number", "How many days is your notice period"), YOUR ANSWER MUST BE A SINGLE NUMBER. 
   - Example: For an immediate notice period, output "0".
   - Example: For 1 year of experience, output "1".
   - Do NOT output text, equations, or units like "days" or "years".
3. For all other text-based questions, provide the definitive concise answer directly without conversational fluff.
4. If the exact answer cannot be definitively deduced, reply with exactly "I don't know" (unless it's a numeric field where a safe default like "0" makes more sense, like notice period).

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

        const response = await llm.invoke(formattedPrompt);
        const answer = response.content.trim();

        fs.appendFileSync(path.join(__dirname, '..', 'qa_logs.txt'), `[${new Date().toISOString()}] Q: "${questionText}" -> A: "${answer}"\n`);

        if (answer.toLowerCase().includes("i don't know")) {
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
