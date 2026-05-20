const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { runSequence, runSingleAgent, stopSequence, getStatus } = require('../controller/sequentialController');
const { launchChrome, getChromeStatus } = require('../services/chromeService');

/** ISO timestamp of when the server process started — used in /health. */
const SERVER_START_TIME = new Date();

/** Package version read once at import time. */
const { version: APP_VERSION } = (() => {
    try { return require('../../package.json'); } catch { return { version: 'unknown' }; }
})();

/**
 * Middleware: attaches X-Response-Time header (ms) to every response.
 * Useful for basic latency observability without a full APM setup.
 */
router.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    });
    next();
});

router.post('/open-chrome', async (req, res) => {
    try {
        const result = await launchChrome();
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

router.get('/chrome-status', async (req, res) => {
    const reachable = await getChromeStatus();
    res.json({ reachable });
});


/**
 * GET /api/health
 * Returns service health, uptime, and version — useful for monitoring and deploy checks.
 */
router.get('/health', (req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME.getTime()) / 1000);
    res.json({
        status:     'ok',
        version:    APP_VERSION,
        uptime:     `${uptimeSeconds}s`,
        startedAt:  SERVER_START_TIME.toISOString(),
        timestamp:  new Date().toISOString(),
        message:    'Universal Job Agent backend is running',
    });
});

/**
 * POST /api/start
 * Starts either a single agent (if agentId provided) or the full sequence.
 * Body: { agentId?: string, ...prefs }
 */
router.post('/start', (req, res) => {
    const prefs = req.body || {};

    // Validate agentId if provided — must be a non-empty string
    if ('agentId' in prefs && (typeof prefs.agentId !== 'string' || !prefs.agentId.trim())) {
        return res.status(400).json({ ok: false, message: '"agentId" must be a non-empty string.' });
    }

    if (prefs.agentId) {
        console.log(`[${new Date().toLocaleTimeString()}] POST /api/start for ${prefs.agentId} with params:`, prefs);
        runSingleAgent(prefs.agentId, prefs);
    } else {
        console.log(`[${new Date().toLocaleTimeString()}] POST /api/start - Initiating full sequence with params:`, prefs);
        runSequence(prefs);
    }
    res.json({ ok: true, message: 'Sequence initiated' });
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

/**
 * DELETE /api/failed-jobs
 * Clears the persisted failed-jobs list. Uses async I/O to avoid blocking the event loop.
 */
router.delete('/failed-jobs', async (req, res) => {
    const failedJobsPath = path.join(__dirname, '..', 'data', 'failed_jobs.json');
    try {
        await fs.promises.writeFile(failedJobsPath, '[]');
        res.json({ ok: true, message: 'Failed jobs list cleared.' });
    } catch (e) {
        res.status(500).json({ ok: false, message: `Could not clear failed jobs: ${e.message}` });
    }
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

/**
 * DELETE /api/hiring-posts
 * Clears the persisted hiring-posts list. Uses async I/O to avoid blocking the event loop.
 */
router.delete('/hiring-posts', async (req, res) => {
    const hiringPostsPath = path.join(__dirname, '..', 'data', 'hiring_posts.json');
    try {
        await fs.promises.writeFile(hiringPostsPath, '[]');
        res.json({ ok: true, message: 'Hiring posts list cleared.' });
    } catch (e) {
        res.status(500).json({ ok: false, message: `Could not clear hiring posts: ${e.message}` });
    }
});

router.get('/profile', async (req, res) => {
    const profilePath = path.join(__dirname, '..', 'data', 'user_profile.json');
    try {
        const raw = await fs.promises.readFile(profilePath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Failed to read profile' });
    }
});

router.post('/profile', async (req, res) => {
    const profilePath = path.join(__dirname, '..', 'data', 'user_profile.json');
    try {
        const profile = req.body;
        await fs.promises.writeFile(profilePath, JSON.stringify(profile, null, 2));
        res.json({ ok: true, message: 'Profile updated successfully' });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Failed to update profile' });
    }
});

module.exports = router;
