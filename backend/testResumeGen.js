const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { generateTailoredResume } = require('../backend/utils/resumeGenerator');

const dummyJD = `
We are looking for a Software Engineer to join our team.
Requirements:
- 1+ years of experience with React.js and Node.js
- Experience with Spring Boot is a huge plus
- Familiarity with CI/CD tools like Jenkins or GitHub Actions
- Strong problem-solving skills
- Agile methodology experience
Responsibilities:
- Build reusable UI components using React
- Develop scalable backend microservices
- Work with product team to deliver new features
`;

async function run() {
    try {
        console.log("Starting generation...");
        // Also capture the output of generation to see the LLM response
        const outputPath = await generateTailoredResume(dummyJD);
        console.log("Success. Output at:", outputPath);
    } catch (err) {
        console.error("Error:", err);
    }
}

run();
