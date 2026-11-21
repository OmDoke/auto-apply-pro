'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME_PATHS = [
    process.env.CHROME_PATH || '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

// Chrome refuses remote debugging on the default profile, so use a dedicated one (log in to LinkedIn
// there once). The throttling flags stop Chrome from freezing the agent's tab when the window is hidden.
const CHROME_DEBUG_ARGS = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${process.env.CHROME_DEBUG_PROFILE || 'C:\\chrome-debug'}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
];

let chromeProcess = null;

/**
 * Launches Chrome with remote debugging enabled.
 */
async function launchChrome() {
    const chromePath = CHROME_PATHS.find(p => fs.existsSync(p));
    
    if (!chromePath) {
        throw new Error('Chrome binary not found. Please set CHROME_PATH in .env');
    }

    if (chromeProcess && !chromeProcess.killed) {
        return { ok: true, message: 'Chrome is already running.', pid: chromeProcess.pid };
    }

    try {
        chromeProcess = spawn(chromePath, CHROME_DEBUG_ARGS, { detached: true, stdio: 'ignore' });
        
        chromeProcess.unref();
        console.log(`[ChromeService] Launched with remote debugging on port 9222 (pid ${chromeProcess.pid})`);
        
        return { ok: true, message: `Chrome launched (pid ${chromeProcess.pid})`, pid: chromeProcess.pid };
    } catch (e) {
        console.error(`[ChromeService] Error launching Chrome: ${e.message}`);
        throw e;
    }
}

/**
 * Checks if Chrome remote debugging port is reachable.
 */
async function getChromeStatus() {
    return new Promise((resolve) => {
        const options = { 
            hostname: 'localhost', 
            port: 9222, 
            path: '/json/version', 
            timeout: 2000 
        };
        
        const probe = http.get(options, (res) => {
            resolve(res.statusCode === 200);
            probe.destroy();
        });
        
        probe.on('error', () => resolve(false));
        probe.on('timeout', () => { 
            probe.destroy(); 
            resolve(false); 
        });
    });
}

/**
 * Forcefully stops the launched Chrome process.
 */
function stopChrome() {
    if (chromeProcess && !chromeProcess.killed) {
        chromeProcess.kill();
        chromeProcess = null;
        return true;
    }
    return false;
}

module.exports = {
    CHROME_DEBUG_ARGS,
    launchChrome,
    getChromeStatus,
    stopChrome
};
