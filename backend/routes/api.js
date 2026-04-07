const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { runSequence, runSingleAgent, stopSequence, getStatus } = require('../controller/sequentialController');

router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Universal Job Agent backend is running' });
});

router.post('/start', (req, res) => {
    const prefs = req.body || {};
    if (prefs.agentId) {
        console.log(`[${new Date().toLocaleTimeString()}] POST /api/start for ${prefs.agentId} with params:`, prefs);
        runSingleAgent(prefs.agentId, prefs);
    } else {
        console.log(`[${new Date().toLocaleTimeString()}] POST /api/start - Initiating full sequence with params:`, prefs);
        runSequence(prefs);
    }
    res.json({ message: 'Sequence initiated' });
});

router.post('/stop', (req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] POST /api/stop - Stopping processes.`);
    stopSequence();
    res.json({ message: 'Processes stopped' });
});

router.get('/status', (req, res) => {
    const status = getStatus();
    const logSummary = `status: ${status.status}, current agent: ${status.currentAgent}, log count: ${status.logs.length}`;
    console.log(`[${new Date().toLocaleTimeString()}] GET /api/status - Responding with: { ${logSummary} }`);
    res.json(status);
});

router.get('/failed-jobs', async (req, res) => {
    const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
    try {
        const raw = await fs.promises.readFile(failedJobsPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        // File missing (ENOENT) or invalid JSON — return empty list
        res.json([]);
    }
});

router.delete('/failed-jobs', (req, res) => {
    const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
    fs.writeFileSync(failedJobsPath, '[]');
    res.json({ message: 'Failed jobs list cleared.' });
});

router.get('/hiring-posts', async (req, res) => {
    const hiringPostsPath = path.join(__dirname, '..', 'data', 'hiring_posts.json');
    try {
        const raw = await fs.promises.readFile(hiringPostsPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.json([]);
    }
});

router.delete('/hiring-posts', (req, res) => {
    const hiringPostsPath = path.join(__dirname, '..', 'data', 'hiring_posts.json');
    fs.writeFileSync(hiringPostsPath, '[]');
    res.json({ message: 'Hiring posts list cleared.' });
});

module.exports = router;
