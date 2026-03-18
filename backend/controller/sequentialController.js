// backend/controller/sequentialController.js
const { fork } = require('child_process');
const path = require('path');

let activeProcess = null;

let currentState = {
    status: 'Idle',
    currentAgent: null,
    logs: []
};

// Use an event emitter format or simply export the state/run sequence
const addLog = (message) => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    currentState.logs.push(`[${timestamp}] ${message}`);
    console.log(message);
};

const setStatus = (status, agent = null) => {
    currentState.status = status;
    if (agent) currentState.currentAgent = agent;
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
        
        activeProcess = childProcess;

        childProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => addLog(`[${agentName}] ${line}`));
        });

        childProcess.stderr.on('data', (data) => {
             const lines = data.toString().split('\n').filter(line => line.trim() !== '');
             lines.forEach(line => addLog(`[${agentName} ERROR] ${line}`));
        });

        childProcess.on('close', (code) => {
            activeProcess = null;
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

    currentState.logs = []; // clear previous logs
    setStatus('Running', 'LinkedIn Agent');
    addLog('--- Starting Universal Job Agent Sequence ---');

    try {
        await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        
        setStatus('Running', 'Naukri Agent');
        await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
        
        setStatus('Running', 'Aggregator Agent');
        await runAgent('Aggregator Agent', path.join(__dirname, '..', 'agents', 'aggregatorAgent.js'), prefs);

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

    currentState.logs = [];
    addLog(`--- Starting Single Agent: ${agentId} ---`);

    try {
        if (agentId === 'LinkedIn Agent') {
            await runAgent('LinkedIn Agent', path.join(__dirname, '..', 'agents', 'linkedinAgent.js'), prefs);
        } else if (agentId === 'Naukri Agent') {
            await runAgent('Naukri Agent', path.join(__dirname, '..', 'agents', 'naukriAgent.js'), prefs);
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
    if (activeProcess) {
        addLog('Interrupting process...');
        activeProcess.kill('SIGINT');
        activeProcess = null;
    }
    setStatus('Idle');
    addLog('--- Automation Stopped by User ---');
};

const getStatus = () => currentState;

module.exports = { runSequence, runSingleAgent, stopSequence, getStatus };
