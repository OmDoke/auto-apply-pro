const { fork } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const engineEvents = new EventEmitter();

let activeProcesses = [];
const MAX_LOG_ENTRIES = 500;

let currentState = {
    status: 'Idle',
    currentAgent: null,
    logs: []
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
            FRONTEND_JOB_TITLE: prefs.jobTitle || '',
            FRONTEND_LOCATION: prefs.location || ''
        };

        const childProcess = fork(scriptPath, [], { 
            env, 
            stdio: 'pipe' 
        });
        
        activeProcesses.push(childProcess);

        childProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => addLog(`[${agentName}] ${line}`));
        });

        childProcess.stderr.on('data', (data) => {
             const lines = data.toString().split('\n').filter(line => line.trim() !== '');
             lines.forEach(line => addLog(`[${agentName} ERROR] ${line}`));
        });

        childProcess.on('close', (code) => {
            activeProcesses = activeProcesses.filter(p => p !== childProcess);
            if (code === 0) {
                addLog(`✓ ${agentName} completed successfully.`);
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

    setStatus('Running', 'LinkedIn Agent');
    addLog('─────────────────────────────────────────────────');
    addLog('--- Starting Universal Job Agent Sequence ---');

    try {
        await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        await runAgent('Post Scraper', path.join(__dirname, '..', 'agents', 'linkedinPostScraper.js'), prefs);
        await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
        await runAgent('Indeed Agent', path.join(__dirname, '..', 'agents', 'indeedAgent.js'), prefs);
        await runAgent('Glassdoor Agent', path.join(__dirname, '..', 'agents', 'glassdoorAgent.js'), prefs);
        await runAgent('Wellfound Agent', path.join(__dirname, '..', 'agents', 'wellfoundAgent.js'), prefs);

        setStatus('Success');
        addLog('--- Sequence Completed Successfully ---');
    } catch (error) {
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
    addLog(`--- Starting Single Agent: ${agentId} ---`);

    try {
        if (agentId === 'LinkedIn Agent') {
            await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        } else if (agentId === 'LinkedIn Post Scraper') {
            await runAgent('Post Scraper', path.join(__dirname, '..', 'agents', 'linkedinPostScraper.js'), prefs);
        } else if (agentId === 'Naukri Agent') {
            await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
        } else if (agentId === 'Indeed Agent') {
            await runAgent('Indeed Agent', path.join(__dirname, '..', 'agents', 'indeedAgent.js'), prefs);
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
        activeProcesses.forEach(p => { try { p.kill('SIGINT'); } catch (_) {} });
        activeProcesses = [];
    }
    setStatus('Idle');
    addLog('--- Automation Stopped by User ---');
};

const getStatus = () => currentState;

module.exports = { runSequence, runSingleAgent, stopSequence, getStatus, engineEvents };
