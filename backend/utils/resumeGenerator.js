const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const baseData = require("../data/resumeData");
const { getLLMClient, invokeWithBackoff } = require("./resumeQA");
const { invokeGemini } = require("./geminiClient");

const MARGIN = 40;
const PAGE_WIDTH = 612; // US Letter width in points (8.5in * 72)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#444444";
const COLOR_RULE = "#999999";

// Only summary + skills are tailored; experience, projects, education stay as in the base resume.
const TAILOR_PROMPT_TEMPLATE = `Tailor a resume summary and skills section to a job description.

RULES:
- "summary": 3-4 sentences, max 70 words. Mirror JD keywords that genuinely match the candidate.
- "skills": return EVERY input skill group with the SAME "label". Order groups and the " | "-separated items inside each value so the most JD-relevant come first.
- You may add a JD skill to a group ONLY if the candidate's background below clearly shows it. Never invent skills, tools, employers, years or metrics.
- Output ONLY this JSON, no markdown: {"summary": "...", "skills": [{"label": "...", "value": "a | b | c"}]}

CANDIDATE TITLES: {TITLES}
CANDIDATE PROJECT STACKS: {STACKS}

CURRENT SUMMARY:
{SUMMARY}

CURRENT SKILLS:
{SKILLS}

JOB DESCRIPTION:
{JD_TEXT}`;

const JD_CHAR_LIMIT = 2500;
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'onkar_resume.pdf');

const buildTailorPrompt = (jdText) => TAILOR_PROMPT_TEMPLATE
    .replace('{TITLES}', (baseData.experience || []).map(e => e.title).filter(Boolean).join('; ') || 'n/a')
    .replace('{STACKS}', (baseData.projects || []).map(p => p.stack).filter(Boolean).join('; ') || 'n/a')
    .replace('{SUMMARY}', baseData.summary || '')
    .replace('{SKILLS}', JSON.stringify(baseData.skills || []))
    .replace('{JD_TEXT}', String(jdText).replace(/\s+/g, ' ').trim().slice(0, JD_CHAR_LIMIT));

// Extract + validate {summary, skills} from an LLM reply; throws on anything unusable
const parseTailored = (raw) => {
    const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object in response');
    const obj = JSON.parse(text.slice(start, end + 1));
    if (typeof obj.summary !== 'string' || obj.summary.trim().length < 40) throw new Error('summary missing/too short');
    if (!Array.isArray(obj.skills) || obj.skills.length === 0) throw new Error('skills missing');
    return obj;
};

// Merge tailored summary/skills into the base resume. Skill items that appear nowhere
// in the base resume are dropped (anti-fabrication); original items are never lost.
const mergeTailored = (base, tailored) => {
    const baseText = JSON.stringify(base).toLowerCase();
    const byLabel = new Map(tailored.skills.map(s => [String(s.label || '').trim().toLowerCase(), s]));
    const order = tailored.skills.map(s => String(s.label || '').trim().toLowerCase());
    const rank = (label) => { const i = order.indexOf(label.toLowerCase()); return i < 0 ? Infinity : i; };

    const skills = (base.skills || []).map(orig => {
        const t = byLabel.get(String(orig.label).toLowerCase());
        if (!t || !t.value) return orig;
        const origItems = String(orig.value).split('|').map(x => x.trim()).filter(Boolean);
        const tailoredItems = String(t.value).split('|').map(x => x.trim()).filter(Boolean)
            .filter(item => baseText.includes(item.toLowerCase()));
        const seen = new Set();
        const merged = [...tailoredItems, ...origItems].filter(item => {
            const k = item.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        return { label: orig.label, value: merged.join(' | ') };
    }).sort((a, b) => rank(a.label) - rank(b.label));

    return { ...base, summary: tailored.summary.trim(), skills };
};

// Try Groq, then each Gemini model; first response that parses + validates wins
const tailorSummaryAndSkills = async (jdText) => {
    const prompt = buildTailorPrompt(jdText);

    if (process.env.GROQ_API_KEY) {
        try {
            const response = await invokeWithBackoff(getLLMClient(), prompt);
            const tailored = parseTailored(response.content);
            console.log('  (Used Groq for resume tailoring)');
            return tailored;
        } catch (err) {
            console.log(`  ⚠️ Groq tailoring failed (${err.message}) — trying Gemini...`);
        }
    }

    if (process.env.GEMINI_API_KEY) {
        const raw = await invokeGemini(prompt, { json: true, timeoutMs: 20000 });
        if (raw) {
            try {
                const tailored = parseTailored(raw);
                console.log('  (Used Gemini for resume tailoring)');
                return tailored;
            } catch (err) {
                console.log(`  ⚠️ Gemini tailoring response unusable (${err.message})`);
            }
        }
    }
    return null;
};

// outputPath: where to write the PDF (per-job tailored copies go in their own folder)
async function generateTailoredResume(jdText, outputPath = DEFAULT_OUTPUT_PATH) {
    let resumeData = { ...baseData };

    if (jdText && (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)) {
        console.log("  Tailoring resume summary + skills based on JD...");
        try {
            const tailored = await tailorSummaryAndSkills(jdText);
            if (tailored) {
                resumeData = mergeTailored(baseData, tailored);
                console.log("  ✔ Tailored summary + skills.");
                console.log("  [Tailored Summary Preview]:", resumeData.summary.substring(0, 150) + "...");
            } else {
                console.log("  ⚠️ No usable LLM response — using base resume.");
            }
        } catch (err) {
            console.log("  ⚠️ Error tailoring resume (using base resume):", err.message);
        }
    } else {
        console.log("  Using base resume data (no JD or no API keys available).");
    }

    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            const doc = new PDFDocument({ size: "LETTER", margin: MARGIN });
            const writeStream = fs.createWriteStream(outputPath);
            doc.pipe(writeStream);

            // ---------- helpers ----------

            function sectionHeading(title) {
              doc
                .moveDown(0.4)
                .font("Helvetica-Bold")
                .fontSize(11)
                .fillColor(COLOR_TEXT)
                .text(title.toUpperCase());

              const y = doc.y + 1;
              doc
                .moveTo(MARGIN, y)
                .lineTo(PAGE_WIDTH - MARGIN, y)
                .lineWidth(0.75)
                .strokeColor(COLOR_RULE)
                .stroke();
              doc.moveDown(0.5);
            }

            function bulletList(items) {
              doc.font("Helvetica").fontSize(9.5).fillColor(COLOR_TEXT);
              if (Array.isArray(items)) {
                  items.forEach((item) => {
                    doc.text(`•  ${item}`, {
                      width: CONTENT_WIDTH,
                      align: "left",
                      indent: 0,
                    });
                    doc.moveDown(0.15);
                  });
              }
            }

            // ---------- header ----------
            doc
              .font("Helvetica-Bold")
              .fontSize(18)
              .fillColor(COLOR_TEXT)
              .text(resumeData.name || "", { align: "center" });

            doc
              .font("Helvetica")
              .fontSize(9)
              .fillColor(COLOR_MUTED)
              .text(resumeData.contact || "", { align: "center" });

            doc.moveDown(0.6);

            // ---------- summary ----------
            if (resumeData.summary) {
                sectionHeading("Professional Summary");
                doc.font("Helvetica").fontSize(9.5).fillColor(COLOR_TEXT).text(resumeData.summary, {
                  width: CONTENT_WIDTH,
                  align: "justify",
                });
            }

            // ---------- skills ----------
            if (resumeData.skills && Array.isArray(resumeData.skills)) {
                sectionHeading("Technical Skills");
                resumeData.skills.forEach((skill) => {
                  doc
                    .font("Helvetica-Bold")
                    .fontSize(9.5)
                    .fillColor(COLOR_TEXT)
                    .text(`${skill.label || ""}: `, { continued: true })
                    .font("Helvetica")
                    .fillColor(COLOR_MUTED)
                    .text(skill.value || "");
                  doc.moveDown(0.1);
                });
            }

            // ---------- experience ----------
            if (resumeData.experience && Array.isArray(resumeData.experience)) {
                sectionHeading("Professional Experience");
                resumeData.experience.forEach((job) => {
                  doc
                    .font("Helvetica-Bold")
                    .fontSize(10)
                    .fillColor(COLOR_TEXT)
                    .text(job.title || "", { continued: true })
                    .font("Helvetica")
                    .fillColor(COLOR_MUTED)
                    .text(`   ${job.dates || ""}`, { align: "left" });
                  doc.moveDown(0.2);
                  bulletList(job.bullets);
                  doc.moveDown(0.3);
                });
            }

            // ---------- projects ----------
            if (resumeData.projects && Array.isArray(resumeData.projects)) {
                sectionHeading("Projects");
                resumeData.projects.forEach((proj) => {
                  doc
                    .font("Helvetica-Bold")
                    .fontSize(10)
                    .fillColor(COLOR_TEXT)
                    .text(proj.title || "", { continued: true })
                    .font("Helvetica-Oblique")
                    .fontSize(9)
                    .fillColor(COLOR_MUTED)
                    .text(`   |  ${proj.stack || ""}`);
                  doc.moveDown(0.2);
                  bulletList(proj.bullets);
                  doc.moveDown(0.3);
                });
            }

            // ---------- education ----------
            if (resumeData.education && Array.isArray(resumeData.education)) {
                sectionHeading("Education");
                resumeData.education.forEach((edu) => {
                  doc
                    .font("Helvetica-Bold")
                    .fontSize(9.5)
                    .fillColor(COLOR_TEXT)
                    .text(`${edu.degree || ""} | ${edu.school || ""}`, { continued: true })
                    .font("Helvetica")
                    .fillColor(COLOR_MUTED)
                    .text(`   ${edu.dates || ""}`);
                  doc.moveDown(0.15);
                });
            }

            // ---------- certifications ----------
            if (resumeData.certifications) {
                sectionHeading("Certifications & Additional Info");
                doc.font("Helvetica").fontSize(9.5).fillColor(COLOR_TEXT).text(resumeData.certifications, {
                  width: CONTENT_WIDTH,
                });
            }

            doc.end();

            writeStream.on('finish', () => {
                console.log(`  ✔ Resume PDF generated at ${outputPath}`);
                resolve(outputPath);
            });
            writeStream.on('error', (err) => {
                console.log(`  ⚠️ Error generating ${outputPath}:`, err.message);
                reject(err);
            });
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = { generateTailoredResume, buildTailorPrompt, parseTailored, mergeTailored };
