const { fork } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const engineEvents = new EventEmitter();

let activeProcesses = [];
// Set by stopSequence so a gracefully-stopped agent (exit 0) doesn't start the next one
let stopRequested = false;
const MAX_LOG_ENTRIES = 500;

let currentState = {
    status: 'Idle',
    currentAgent: null,
    logs: [],
    appliedCount: 0,
    lastRunTimes: {}
};

// Use an event emitter format or simply export the state/run sequence
const addLog = (message) => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const logStr = `[${timestamp}] ${message}`;
    currentState.logs.push(logStr);
    if (currentState.logs.length > MAX_LOG_ENTRIES) {
        currentState.logs = currentState.logs.slice(-MAX_LOG_ENTRIES);
    }
    console.log(message);
    engineEvents.emit('log', logStr);
};

const setStatus = (status, agent = null) => {
    currentState.status = status;
    if (agent) currentState.currentAgent = agent;
    engineEvents.emit('statusUpdate', currentState);
};

const runAgent = async (agentName, scriptPath, prefs = {}) => {
    return new Promise((resolve, reject) => {
        addLog(`Starting ${agentName}...`);
        setStatus('Running', agentName);
        
        // Pass frontend preferences to child processes so they can override .env
        const env = { 
            ...process.env,
            FRONTEND_JOB_TITLE:          prefs.jobTitle          || '',
            FRONTEND_LOCATION:           prefs.location          || '',
            FRONTEND_SKILLS:             prefs.skills            || '',
            FRONTEND_EXCLUDE_COMPANIES:  prefs.excludeCompanies  || '',
            FRONTEND_EXCLUDE_KEYWORDS:   prefs.excludeKeywords   || '',
            FRONTEND_MIN_MATCH_SCORE:    String(prefs.minMatchScore ?? 60),
            FRONTEND_JOB_TYPE:           prefs.jobType           || 'any',
            FRONTEND_WORK_MODE:          prefs.workMode          || 'any',
        };

        const childProcess = fork(scriptPath, [], { 
            env, 
            stdio: 'pipe' 
        });
        
        activeProcesses.push(childProcess);

        // Agents that announce ipcOutcomes report applications over IPC instead of log text
        let countsViaIpc = false;
        childProcess.on('message', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'ready' && msg.ipcOutcomes) {
                countsViaIpc = true;
                childProcess.supportsIpcStop = true;
            }
            if (msg.type === 'outcome' && msg.status === 'applied') {
                currentState.appliedCount += 1;
                setStatus(currentState.status, currentState.currentAgent);
            }
        });

        childProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => {
                // Intercept applied messages to increment count
                if (!countsViaIpc && (line.includes('✅ Application submitted for:') || line.includes('✓ Applied!'))) {
                    currentState.appliedCount += 1;
                    setStatus(currentState.status, currentState.currentAgent);
                }
                addLog(`[${agentName}] ${line}`);
            });
        });

        childProcess.stderr.on('data', (data) => {
             const lines = data.toString().split('\n').filter(line => line.trim() !== '');
             lines.forEach(line => addLog(`[${agentName} ERROR] ${line}`));
        });

        childProcess.on('close', (code) => {
            activeProcesses = activeProcesses.filter(p => p !== childProcess);
            if (stopRequested) {
                reject(new Error(`${agentName} stopped by user`));
            } else if (code === 0) {
                addLog(`✓ ${agentName} completed successfully.`);
                currentState.lastRunTimes[agentName] = new Date().toISOString();
                setStatus(currentState.status, currentState.currentAgent); // Trigger state update
                resolve();
            } else {
                addLog(`✗ ${agentName} exited with code ${code}.`);
                reject(new Error(`${agentName} failed`));
            }
        });
    });
};

const runSequence = async (prefs = {}) => {
    if (currentState.status === 'Running') {
        addLog('Sequence is already running.');
        return;
    }

    stopRequested = false;
    setStatus('Running', 'LinkedIn Agent');
    addLog('─────────────────────────────────────────────────');
    addLog('--- Starting Universal Job Agent Sequence ---');

    try {
        await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        await runAgent('Post Scraper', path.join(__dirname, '..', 'agents', 'linkedinPostScraper.js'), prefs);
        await runAgent('Hirist Agent', path.join(__dirname, '..', 'agents', 'hiristAgent.js'), prefs);
        await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
        await runAgent('Indeed Agent', path.join(__dirname, '..', '..', 'run-indeed.js'), prefs);
        await runAgent('Glassdoor Agent', path.join(__dirname, '..', 'agents', 'glassdoorAgent.js'), prefs);
        await runAgent('Wellfound Agent', path.join(__dirname, '..', 'agents', 'wellfoundAgent.js'), prefs);

        setStatus('Success');
        addLog('--- Sequence Completed Successfully ---');
    } catch (error) {
        if (stopRequested) return; // stopSequence already set Idle
        setStatus('Failed');
        addLog(`--- Sequence Failed: ${error.message} ---`);
    }
};

const runSingleAgent = async (agentId, prefs = {}) => {
    if (currentState.status === 'Running') {
        addLog('Sequence is already running.');
        return;
    }

    addLog('─────────────────────────────────────────────────');
    stopRequested = false;
    addLog(`--- Starting Single Agent: ${agentId} ---`);

    try {
        if (agentId === 'LinkedIn Agent') {
            await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        } else if (agentId === 'LinkedIn Post Scraper') {
            await runAgent('Post Scraper', path.join(__dirname, '..', 'agents', 'linkedinPostScraper.js'), prefs);
        } else if (agentId === 'Hirist Agent') {
            await runAgent('Hirist Agent', path.join(__dirname, '..', 'agents', 'hiristAgent.js'), prefs);
        } else if (agentId === 'Naukri Agent') {
            await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
        } else if (agentId === 'Indeed Agent') {
            await runAgent('Indeed Agent', path.join(__dirname, '..', '..', 'run-indeed.js'), prefs);
        } else if (agentId === 'Glassdoor Agent') {
            await runAgent('Glassdoor Agent', path.join(__dirname, '..', 'agents', 'glassdoorAgent.js'), prefs);
        } else if (agentId === 'Wellfound Agent') {
            await runAgent('Wellfound Agent', path.join(__dirname, '..', 'agents', 'wellfoundAgent.js'), prefs);
        } else {
            addLog(`Unknown agent: ${agentId}`);
            return;
        }

        setStatus('Success');
        addLog(`--- ${agentId} Completed Successfully ---`);
    } catch (error) {
        if (currentState.status !== 'Idle') { // Avoid marking failed if purposely stopped
            setStatus('Failed');
            addLog(`--- ${agentId} Failed: ${error.message} ---`);
        }
    }
};

const stopSequence = () => {
    if (activeProcesses.length > 0) {
        addLog('Interrupting process...');
        stopRequested = true;
        // Ask for a graceful stop over IPC (SIGINT can't be handled on Windows),
        // then force-kill anything still running after 15s
        activeProcesses.forEach(p => {
            try {
                if (p.supportsIpcStop && p.connected) p.send({ type: 'stop' });
                else p.kill('SIGINT');
            } catch (_) {}
            setTimeout(() => { if (p.exitCode === null && p.signalCode === null) { try { p.kill(); } catch (_) {} } }, 15000);
        });
        activeProcesses = [];
    }
    setStatus('Idle');
    addLog('--- Automation Stopped by User ---');
};

const getStatus = () => currentState;

module.exports = { runSequence, runSingleAgent, stopSequence, getStatus, engineEvents };
