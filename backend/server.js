const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const { validateEnv } = require('./utils/validateEnv');
validateEnv();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const http = require('http');
const server = http.createServer(app);

// Initialize Socket.io
const { initializeSocket } = require('./socket');
initializeSocket(server);

const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS: origin not allowed'));
        }
    },
    methods: ['GET', 'POST', 'DELETE']
}));
app.use(express.json());

// API Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Serve frontend dist
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

app.get(/^\/(?!api)/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
