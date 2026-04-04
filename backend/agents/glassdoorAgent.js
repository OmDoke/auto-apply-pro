require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const BaseAgent = require('./BaseAgent');

class GlassdoorAgent extends BaseAgent {
    constructor() {
        super('Glassdoor Agent', 'glassdoor_profile');
    }

    async run() {
        try {
            await this.initializeBrowser();
            
            await this.search('https://www.glassdoor.com/');
            console.log(`[${this.agentName}] Implementation logic to be added...`);
            
            this.saveFailedJobs();
            console.log(`[${this.agentName}] Finished tasks.`);
        } catch (e) {
            console.error(`[${this.agentName}] Error:`, e);
            process.exit(1);
        } finally {
            await this.closeBrowser();
        }
    }
}

const agent = new GlassdoorAgent();
agent.run().catch(err => {
    console.error('Glassdoor Agent Fatal Error:', err);
    process.exit(1);
});
