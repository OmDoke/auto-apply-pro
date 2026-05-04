const path = require('path');
const fs = require('fs');
const IndeedAgent = require('./backend/agents/indeedAgent');

(async () => {


    const agent = new IndeedAgent();

    try {
        await agent.run();
        console.log('✅ Indeed script finished successfully.');
    } catch (e) {
        console.error('❌ Error running Indeed script:', e);
    } finally {
        await agent.closeBrowser();
        process.exit(0);
    }
})();
