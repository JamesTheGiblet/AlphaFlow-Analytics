// alphaflow-server.js
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware to debug requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 1. Serve the Dashboard HTML on root (Priority over static index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'AlphaFlow.html'), (err) => {
        if (err) {
            console.error('Error serving AlphaFlow.html:', err);
            res.status(err.status || 500).end();
        }
    });
});

// 2. Handle favicon to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 3. Serve specific frontend files from PARENT directory
const parentDir = path.resolve(__dirname, '..');

app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(parentDir, 'styles.css'), (err) => {
        if (err) {
            console.error('Error serving styles.css:', err);
            res.status(err.status || 404).end();
        }
    });
});
app.get('/script.js', (req, res) => {
    res.sendFile(path.join(parentDir, 'script.js'), (err) => {
        if (err) {
            console.error('Error serving script.js:', err);
            res.status(err.status || 404).end();
        }
    });
});
app.get('/alphaflow-backtesting.html', (req, res) => {
    res.sendFile(path.join(parentDir, 'alphaflow-backtesting.html'), (err) => {
        if (err) console.error('Error serving alphaflow-backtesting.html:', err);
    });
});

// 4. Serve static files from public directory (assets, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const COINS = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'MATIC-USD', 'AVAX-USD', 
    'LINK-USD', 'DOT-USD', 'ATOM-USD', 'DOGE-USD', 'SHIB-USD',
    'UNI-USD', 'AAVE-USD', 'CRV-USD', 'SUSHI-USD', 'MANA-USD',
    'SAND-USD', 'AXS-USD', 'ENJ-USD', 'GRT-USD', 'ALGO-USD',
    'LTC-USD', '1INCH-USD', 'BAT-USD', 'COMP-USD'
];

const MOVE_THRESHOLD = 2.0; // 2.0% move threshold (Increased to reduce noise)
const LAG_WINDOW = 300000; // 5 minutes
const SAVE_INTERVAL = 60000; // Save data every 60 seconds
const BROADCAST_INTERVAL = 500; // Batch updates every 500ms

// Data storage
let marketData = {
    prices: {},
    priceHistory: {},
    leaderEvents: [],
    causalityMatrix: {},
    statistics: {
        totalTicks: 0,
        divergenceEvents: 0,
        startTime: Date.now()
    },
    coinConfig: COINS
};

let pendingUpdates = {}; // Buffer for batched updates

// Initialize data structures
function initializeData() {
    COINS.forEach(coin => {
        marketData.prices[coin] = { price: 0, change: 0, changePercent: 0, lastUpdate: 0 };
        marketData.priceHistory[coin] = [];
        
        // Initialize causality matrix
        marketData.causalityMatrix[coin] = {};
        COINS.forEach(follower => {
            if (coin !== follower) {
                marketData.causalityMatrix[coin][follower] = {
                    lagTimes: [],
                    magnitudeRatios: [],
                    successfulFollows: 0,
                    missedFollows: 0,
                    avgLag: 0,
                    avgMagnitude: 0,
                    followRate: 0
                };
            }
        });
    });
}

initializeData();

// WebSocket connection to Coinbase
let coinbaseWS = null;
let reconnectTimeout = null;

function connectToCoinbase() {
    console.log('🔌 Connecting to Coinbase WebSocket...');
    
    coinbaseWS = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    
    coinbaseWS.on('open', () => {
        console.log('✅ Connected to Coinbase WebSocket');
        
        const subscribeMessage = {
            type: 'subscribe',
            product_ids: COINS,
            channels: ['ticker']
        };
        
        coinbaseWS.send(JSON.stringify(subscribeMessage));
    });
    
    coinbaseWS.on('message', (data) => {
        try {
            const ticker = JSON.parse(data.toString());
            
            if (ticker.type === 'ticker') {
                processTickerUpdate(ticker);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });
    
    coinbaseWS.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    coinbaseWS.on('close', () => {
        console.log('WebSocket disconnected, reconnecting in 3 seconds...');
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectToCoinbase, 3000);
    });
}

function processTickerUpdate(ticker) {
    const coin = ticker.product_id;
    const price = parseFloat(ticker.price);
    const timestamp = Date.now();
    
    // Update price data
    const oldPrice = marketData.prices[coin].price || price;
    const priceChange = price - oldPrice;
    const changePercent = oldPrice > 0 ? (priceChange / oldPrice) * 100 : 0;
    
    marketData.prices[coin] = {
        price: price,
        change: priceChange,
        changePercent: changePercent,
        lastUpdate: timestamp
    };
    
    // Store price history (limit to 1000 entries)
    marketData.priceHistory[coin].push(price);
    if (marketData.priceHistory[coin].length > 1000) {
        marketData.priceHistory[coin].shift();
    }
    
    // ===== CAUSALITY DETECTION =====
    
    // Detect leader events (significant moves)
    if (Math.abs(changePercent) >= MOVE_THRESHOLD) {
        const leaderEvent = {
            timestamp: timestamp,
            leader: coin,
            price: price,
            changePercent: changePercent,
            direction: changePercent > 0 ? 'pump' : 'dump',
            followersResponded: {}
        };
        
        marketData.leaderEvents.push(leaderEvent);
        
        // Clean old events
        marketData.leaderEvents = marketData.leaderEvents.filter(
            e => timestamp - e.timestamp < LAG_WINDOW
        );
        
        console.log(`🚨 ${coin} ${leaderEvent.direction.toUpperCase()}: ${changePercent.toFixed(2)}%`);
    }
    
    // Check for follower events
    marketData.leaderEvents.forEach(leaderEvent => {
        if (leaderEvent.leader !== coin) {
            const lagTime = timestamp - leaderEvent.timestamp;
            
            if (lagTime < LAG_WINDOW && Math.abs(changePercent) >= 0.005) {
                const sameDirection = (changePercent > 0 && leaderEvent.changePercent > 0) ||
                                     (changePercent < 0 && leaderEvent.changePercent < 0);
                
                if (sameDirection) {
                    const magnitudeRatio = Math.abs(changePercent / leaderEvent.changePercent);
                    const relationship = marketData.causalityMatrix[leaderEvent.leader][coin];
                    
                    relationship.lagTimes.push(lagTime);
                    relationship.magnitudeRatios.push(magnitudeRatio);
                    relationship.successfulFollows++;
                    
                    // Update averages
                    relationship.avgLag = relationship.lagTimes.reduce((a, b) => a + b, 0) / relationship.lagTimes.length;
                    relationship.avgMagnitude = relationship.magnitudeRatios.reduce((a, b) => a + b, 0) / relationship.magnitudeRatios.length;
                    relationship.followRate = relationship.successfulFollows / 
                                             (relationship.successfulFollows + relationship.missedFollows);
                    
                    leaderEvent.followersResponded[coin] = {
                        lagTime: lagTime,
                        changePercent: changePercent,
                        magnitudeRatio: magnitudeRatio
                    };
                } else {
                    marketData.causalityMatrix[leaderEvent.leader][coin].missedFollows++;
                    marketData.statistics.divergenceEvents++;
                }
            }
        }
    });
    
    marketData.statistics.totalTicks++;
    
    // Queue update for batch broadcast
    pendingUpdates[coin] = marketData.prices[coin];
}

// WebSocket server for frontend clients
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('New frontend client connected');
    clients.add(ws);
    
    // Send current market state to new client
    ws.send(JSON.stringify({
        type: 'initial_state',
        prices: marketData.prices,
        leaderEvents: marketData.leaderEvents,
        statistics: marketData.statistics,
        coinConfig: COINS
    }));
    
    ws.on('close', () => {
        console.log('Frontend client disconnected');
        clients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('Client WebSocket error:', error);
    });
});

function broadcastToClients(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Data persistence
const DATA_DIR = path.join(__dirname, 'data');

function saveData(skipCleanup = false) {
    const dataToSave = {
        marketData: marketData,
        timestamp: Date.now()
    };
    
    const filename = `cryptosoup_data_${Date.now()}.json`;
    const filePath = path.join(DATA_DIR, filename);
    const tempFilePath = `${filePath}.tmp`;
    
    try {
        // Write to temp file first to prevent corruption
        fs.writeFileSync(tempFilePath, JSON.stringify(dataToSave, null, 2));
        fs.renameSync(tempFilePath, filePath);
        console.log(`💾 Data saved to ${filename}`);
    } catch (error) {
        console.error('Error saving data:', error);
    }
    
    if (skipCleanup) return;

    // Keep only last 24 hours of data files
    if (fs.existsSync(DATA_DIR)) {
        const files = fs.readdirSync(DATA_DIR);
        const now = Date.now();
        files.forEach(file => {
            if (!file.endsWith('.json')) return;
            const filePath = path.join(DATA_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) { // Older than 24 hours
                fs.unlinkSync(filePath);
                console.log(`Deleted old data file: ${file}`);
            }
        });
    }
}

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error(`Error creating data directory at ${DATA_DIR}:`, error);
    }
}

// Set up periodic data saving
setInterval(saveData, SAVE_INTERVAL);

// Set up periodic client broadcasting
setInterval(() => {
    const coins = Object.keys(pendingUpdates);
    if (coins.length > 0) {
        broadcastToClients({
            type: 'batch_update',
            updates: pendingUpdates,
            timestamp: Date.now(),
            leaderEvents: marketData.leaderEvents.length
        });
        pendingUpdates = {};
    }
}, BROADCAST_INTERVAL);

// REST API Endpoints
app.get('/api/market/prices', (req, res) => {
    res.json({
        success: true,
        timestamp: Date.now(),
        prices: marketData.prices,
        statistics: marketData.statistics
    });
});

app.get('/api/market/history/:coin', (req, res) => {
    const coin = req.params.coin;
    if (marketData.priceHistory[coin]) {
        res.json({
            success: true,
            coin: coin,
            history: marketData.priceHistory[coin].slice(-100) // Last 100 points
        });
    } else {
        res.status(404).json({ success: false, error: 'Coin not found' });
    }
});

app.get('/api/causality/matrix', (req, res) => {
    const simplifiedMatrix = {};
    
    Object.keys(marketData.causalityMatrix).forEach(leader => {
        simplifiedMatrix[leader] = {};
        Object.keys(marketData.causalityMatrix[leader]).forEach(follower => {
            const rel = marketData.causalityMatrix[leader][follower];
            if (rel.successfulFollows > 0) {
                simplifiedMatrix[leader][follower] = {
                    followRate: rel.followRate,
                    avgLag: rel.avgLag,
                    avgMagnitude: rel.avgMagnitude,
                    sampleSize: rel.lagTimes.length
                };
            }
        });
    });
    
    res.json({
        success: true,
        matrix: simplifiedMatrix,
        leaderEvents: marketData.leaderEvents
    });
});

app.get('/api/causality/best-pairs', (req, res) => {
    const minSampleSize = parseInt(req.query.minSamples) || 10;
    const pairs = [];
    
    Object.keys(marketData.causalityMatrix).forEach(leader => {
        Object.keys(marketData.causalityMatrix[leader]).forEach(follower => {
            const rel = marketData.causalityMatrix[leader][follower];
            const totalEvents = rel.successfulFollows + rel.missedFollows;
            
            if (totalEvents >= minSampleSize && rel.followRate > 0.6) {
                pairs.push({
                    leader: leader,
                    follower: follower,
                    followRate: rel.followRate,
                    avgLag: rel.avgLag,
                    avgMagnitude: rel.avgMagnitude,
                    sampleSize: rel.lagTimes.length,
                    successfulFollows: rel.successfulFollows,
                    missedFollows: rel.missedFollows
                });
            }
        });
    });
    
    // Sort by follow rate
    pairs.sort((a, b) => b.followRate - a.followRate);
    
    res.json({
        success: true,
        pairs: pairs.slice(0, 20), // Top 20
        totalPairsAnalyzed: pairs.length
    });
});

app.get('/api/export/csv', (req, res) => {
    // Export causality matrix as CSV
    let csv = 'Leader,Follower,Successful_Follows,Missed_Follows,Follow_Rate,Avg_Lag_MS,Avg_Magnitude_Ratio,Sample_Size\n';
    
    Object.keys(marketData.causalityMatrix).forEach(leader => {
        Object.keys(marketData.causalityMatrix[leader]).forEach(follower => {
            const rel = marketData.causalityMatrix[leader][follower];
            const total = rel.successfulFollows + rel.missedFollows;
            
            if (total > 0) {
                csv += `${leader},${follower},${rel.successfulFollows},${rel.missedFollows},${rel.followRate.toFixed(3)},${rel.avgLag.toFixed(0)},${rel.avgMagnitude.toFixed(3)},${rel.lagTimes.length}\n`;
            }
        });
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=causality_matrix.csv');
    res.send(csv);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        uptime: Date.now() - marketData.statistics.startTime,
        coinsTracked: COINS.length,
        totalTicks: marketData.statistics.totalTicks,
        leaderEvents: marketData.leaderEvents.length,
        connectedClients: clients.size,
        coinbaseConnected: coinbaseWS && coinbaseWS.readyState === WebSocket.OPEN
    });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CryptoSoup Backend running on port ${PORT}`);
    console.log(`� Tracking ${COINS.length} coins`);
    console.log(`🔌 WebSocket server attached to HTTP server`);
    
    // Start Coinbase connection with delay
    console.log('⏳ Waiting 5 seconds before connecting to market data...');
    setTimeout(() => {
        connectToCoinbase();
    }, 5000);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    saveData(true); // Skip cleanup to prevent timeout
    
    if (coinbaseWS) {
        coinbaseWS.close();
    }
    
    wss.close(() => {
        console.log('WebSocket server closed');
        process.exit(0);
    });
});
