const { Server } = require('socket.io');
const { runSequence, runSingleAgent, stopSequence, getStatus, engineEvents } = require('../controller/sequentialController');

function initializeSocket(server) {
    const allowedOrigins = process.env.ALLOWED_ORIGIN
        ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3000'];

    const io = new Server(server, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST']
        }
    });

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

    return io;
}

module.exports = { initializeSocket };
