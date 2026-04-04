require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const BaseAgent = require('./BaseAgent');

class WellfoundAgent extends BaseAgent {
    constructor() {
        super('Wellfound Agent', 'wellfound_profile');
    }

    async run() {
        try {
            await this.initializeBrowser();
            
            await this.search('https://wellfound.com/');
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

const agent = new WellfoundAgent();
agent.run().catch(err => {
    console.error('Wellfound Agent Fatal Error:', err);
    process.exit(1);
});
