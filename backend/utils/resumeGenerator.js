const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const baseData = require("../data/resumeData");
const { getLLMClient, invokeWithBackoff } = require("./resumeQA");
const { PromptTemplate } = require('@langchain/core/prompts');

const MARGIN = 40;
const PAGE_WIDTH = 612; // US Letter width in points (8.5in * 72)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#444444";
const COLOR_RULE = "#999999";

async function generateTailoredResume(jdText) {
    let resumeData = { ...baseData };
    
    // If we have a JD, ask LLM to tailor the resume data
    if (jdText && process.env.GROQ_API_KEY) {
        try {
            console.log("  Tailoring resume based on JD...");
            const llm = getLLMClient();
            const prompt = PromptTemplate.fromTemplate(`
You are an expert resume writer and ATS optimization specialist. 
Your goal is to tailor the following Base Resume Data to PERFECTLY match the provided Job Description (JD) to achieve a 100% ATS score.

INSTRUCTIONS:
1. Extract the most critical keywords and skills from the JD.
2. Naturally integrate these keywords into the "summary", "skills", "experience", and "projects" sections of the Base Resume Data.
3. Re-frame or slightly rewrite the bullet points so they directly address the JD's requirements, while remaining truthful to the candidate's actual experience.
4. Return the result EXACTLY as a valid JSON object matching the EXACT structure of the Base Resume Data. 
5. Do NOT include any markdown formatting (like \`\`\`json) or conversational text. Output ONLY the raw, parsable JSON string.

Base Resume Data:
{baseData}

Job Description:
{jdText}

Tailored JSON Resume:`);

            const formattedPrompt = await prompt.format({
                baseData: JSON.stringify(baseData, null, 2),
                jdText: jdText
            });

            const response = await invokeWithBackoff(llm, formattedPrompt);
            let content = (response.content || '').trim();
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            // In case it's wrapped in markdown
            if (content.startsWith('```json')) {
                content = content.replace(/^```json\n?/, '').replace(/```$/, '').trim();
            } else if (content.startsWith('```')) {
                content = content.replace(/^```\n?/, '').replace(/```$/, '').trim();
            }

            const tailoredData = JSON.parse(content);
            // Quick sanity check to ensure we got back valid fields
            if (tailoredData.name && tailoredData.experience) {
                resumeData = tailoredData;
                console.log("  ✔ Successfully tailored resume data.");
                console.log("  [Tailored Summary Preview]:", resumeData.summary.substring(0, 150) + "...");
            } else {
                console.log("  ⚠️ Parsed JSON was invalid structure, falling back to base resume.");
            }
        } catch (err) {
            console.log("  ⚠️ Error tailoring resume (falling back to base data):", err.message);
        }
    } else {
        console.log("  Using base resume data (no JD or GROQ_API_KEY missing).");
    }

    return new Promise((resolve, reject) => {
        try {
            const outputPath = path.join(__dirname, '..', 'data', 'onkar_resume.pdf');
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
                console.log(`  ✔ onkar_resume.pdf generated successfully at backend/data/onkar_resume.pdf`);
                resolve(outputPath);
            });
            writeStream.on('error', (err) => {
                console.log(`  ⚠️ Error generating onkar_resume.pdf:`, err.message);
                reject(err);
            });
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = { generateTailoredResume };
