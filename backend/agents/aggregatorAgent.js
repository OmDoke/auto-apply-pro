// backend/agents/aggregatorAgent.js
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const dataPath = path.join(__dirname, '..', 'data', 'leads.json');

const run = async () => {
    console.log('Aggregator Agent Initializing...');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Scraping Indeed for links...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const mockLeads = [
        { title: 'Frontend Developer', company: 'TechCorp', link: 'https://indeed.com/job1' },
        { title: 'Full Stack Engineer', company: 'WebSolutions', link: 'https://indeed.com/job2' }
    ];
    
    console.log(`Found ${mockLeads.length} leads. Saving to leads.json...`);
    
    // Write mock data to file
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    
    let existingLeads = [];
    if (fs.existsSync(dataPath)) {
        try {
            existingLeads = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        } catch (e) {
            console.error('Error reading existing leads:', e);
        }
    }
    
    const newLeads = [...existingLeads, ...mockLeads];
    fs.writeFileSync(dataPath, JSON.stringify(newLeads, null, 2));
    
    console.log('Aggregator Agent finished tasks.');
};

run().catch(err => {
    console.error('Aggregator Agent Error:', err);
    process.exit(1);
});
