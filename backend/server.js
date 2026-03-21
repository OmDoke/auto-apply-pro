const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const http = require('http');
const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const { runSequence, runSingleAgent, stopSequence, getStatus, engineEvents } = require('./controller/sequentialController');

// Socket.io integration
io.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleTimeString()}] Socket connected: ${socket.id}`);
    
    // Send initial status
    socket.emit('statusUpdate', getStatus());

    socket.on('start', (prefs) => {
        if (prefs && prefs.agentId) {
            console.log(`[${new Date().toLocaleTimeString()}] Socket start for ${prefs.agentId} with params:`, prefs);
            runSingleAgent(prefs.agentId, prefs);
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Socket start - Initiating full sequence with params:`, prefs);
            runSequence(prefs || {});
        }
    });

    socket.on('stop', () => {
        console.log(`[${new Date().toLocaleTimeString()}] Socket stop - Stopping processes.`);
        stopSequence();
    });

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleTimeString()}] Socket disconnected: ${socket.id}`);
    });
});

// Broadcast from engineEvents to all connected sockets
engineEvents.on('statusUpdate', (status) => {
    io.emit('statusUpdate', status);
});

engineEvents.on('log', (logMessage) => {
    io.emit('log', logMessage);
});

// API Routes will be here
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Universal Job Agent backend is running' });
});

// Start the sequence manually
app.post('/api/start', (req, res) => {
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

// Stop the currently running sequence/agent
app.post('/api/stop', (req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] POST /api/stop - Stopping processes.`);
    stopSequence();
    res.json({ message: 'Processes stopped' });
});

// Get the current status and logs 
app.get('/api/status', (req, res) => {
    const status = getStatus();
    const logSummary = `status: ${status.status}, current agent: ${status.currentAgent}, log count: ${status.logs.length}`;
    console.log(`[${new Date().toLocaleTimeString()}] GET /api/status - Responding with: { ${logSummary} }`);
    res.json(status);
});

// Get the list of jobs that could not be auto-applied
app.get('/api/failed-jobs', (req, res) => {
    const failedJobsPath = path.join(__dirname, 'data', 'failed_jobs.json');
    if (!require('fs').existsSync(failedJobsPath)) {
        return res.json([]);
    }
    try {
        const jobs = JSON.parse(require('fs').readFileSync(failedJobsPath, 'utf8'));
        res.json(jobs);
    } catch (e) {
        res.json([]);
    }
});

// Clear the failed jobs list
app.delete('/api/failed-jobs', (req, res) => {
    const failedJobsPath = path.join(__dirname, 'data', 'failed_jobs.json');
    require('fs').writeFileSync(failedJobsPath, '[]');
    res.json({ message: 'Failed jobs list cleared.' });
});

// Serve frontend dist
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
