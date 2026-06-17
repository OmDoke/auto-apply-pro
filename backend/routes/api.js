const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { runSequence, runSingleAgent, stopSequence, getStatus } = require('../controller/sequentialController');

// ── Chrome launcher for Indeed Agent ──────────────────────────────────────────
// Possible Chrome binary locations on Windows
const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH || '',
].filter(Boolean);

let chromeProcess = null;

router.post('/open-chrome', (req, res) => {
    const chromePath = CHROME_PATHS.find(p => fs.existsSync(p));
    if (!chromePath) {
        return res.status(500).json({ ok: false, message: 'Chrome not found. Set CHROME_PATH in .env' });
    }
    if (chromeProcess && !chromeProcess.killed) {
        return res.json({ ok: true, message: 'Chrome already running.' });
    }
    try {
        chromeProcess = spawn(chromePath, [
            '--remote-debugging-port=9222',
            '--no-first-run',
            '--no-default-browser-check',
        ], { detached: true, stdio: 'ignore' });
        chromeProcess.unref();
        console.log(`[Chrome] Launched with remote debugging on port 9222 (pid ${chromeProcess.pid})`);
        res.json({ ok: true, message: `Chrome launched (pid ${chromeProcess.pid})` });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

router.post('/open-url', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ ok: false, message: 'URL is required' });
    }
    const chromePath = CHROME_PATHS.find(p => fs.existsSync(p));
    if (!chromePath) {
        return res.status(500).json({ ok: false, message: 'Chrome not found. Set CHROME_PATH in .env' });
    }
    try {
        // If we launch Chrome with the URL, it opens a new tab in the existing instance
        const process = spawn(chromePath, [
            '--remote-debugging-port=9222',
            url
        ], { detached: true, stdio: 'ignore' });
        process.unref();
        console.log(`[Chrome] Opened URL: ${url}`);
        res.json({ ok: true, message: `Opened ${url} in Chrome` });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

router.get('/chrome-status', (req, res) => {
    const options = { hostname: 'localhost', port: 9222, path: '/json/version', timeout: 2000 };
    const probe = http.get(options, (r) => {
        res.json({ reachable: r.statusCode === 200 });
        probe.destroy();
    });
    probe.on('error', () => res.json({ reachable: false }));
    probe.on('timeout', () => { probe.destroy(); res.json({ reachable: false }); });
});

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

router.get('/profile', async (req, res) => {
    const profilePath = path.join(__dirname, '..', 'data', 'user_profile.json');
    try {
        const raw = await fs.promises.readFile(profilePath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(404).json({ message: 'Profile not found' });
    }
});

router.post('/profile', async (req, res) => {
    const profilePath = path.join(__dirname, '..', 'data', 'user_profile.json');
    try {
        await fs.promises.writeFile(profilePath, JSON.stringify(req.body, null, 2));
        res.json({ ok: true, message: 'Profile updated successfully' });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

router.get('/answers', async (req, res) => {
    const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
    try {
        const raw = await fs.promises.readFile(answersPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(404).json({ message: 'Answers not found' });
    }
});

router.post('/answers', async (req, res) => {
    const answersPath = path.join(__dirname, '..', 'data', 'answers.json');
    try {
        await fs.promises.writeFile(answersPath, JSON.stringify(req.body, null, 2));
        res.json({ ok: true, message: 'Answers updated successfully' });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

module.exports = router;
