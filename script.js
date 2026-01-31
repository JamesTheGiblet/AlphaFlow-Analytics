// =========================================
// Shared Utilities
// =========================================

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'success' ? '#10B981' : type === 'warning' ? '#F59E0B' : '#EF4444'};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 500;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        box-shadow: var(--shadow-lg);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Dynamic Navigation Highlighting
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname.split('/').pop();
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
        } else if (href && !href.startsWith('#')) {
            link.classList.remove('active');
        }
    });
});

// =========================================
// Dashboard Logic (index.html)
// =========================================

if (document.getElementById('soupCanvas')) {
    // Configuration
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const WS_URL = `${protocol}//${host}`;
    const API_URL = '/api';

    // Professional configuration
    const ASSET_CLASSES = {
        'MAJOR': ['BTC-USD', 'ETH-USD'],
        'MID_CAP': ['SOL-USD', 'AVAX-USD', 'MATIC-USD', 'LINK-USD', 'DOT-USD'],
        'DEFI': ['UNI-USD', 'AAVE-USD', 'CRV-USD', 'COMP-USD'],
        'GAMING': ['SAND-USD', 'MANA-USD', 'AXS-USD'],
        'MEME': ['DOGE-USD', 'SHIB-USD'],
        'INFRA': ['GRT-USD', 'ALGO-USD', 'ATOM-USD', 'LTC-USD']
    };

    // Initialize data structures
    let causalityMatrix = {};
    let signalLog = [];
    let ws = null;

    // Initialize canvas
    const canvas = document.getElementById('soupCanvas');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * devicePixelRatio;
        canvas.height = rect.height * devicePixelRatio;
        ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Initialize causality matrix
    function initCausalityMatrix() {
        const allAssets = Object.values(ASSET_CLASSES).flat();
        
        allAssets.forEach(leader => {
            causalityMatrix[leader] = {};
            allAssets.forEach(follower => {
                if (leader !== follower) {
                    causalityMatrix[leader][follower] = {
                        followRate: 0,
                        avgLag: 0,
                        magnitudeRatio: 0,
                        signals24h: 0,
                        confidence: 0,
                        lastSignal: null
                    };
                }
            });
        });
    }

    initCausalityMatrix();

    // Update UI elements
    function updateUI() {
        // Update leaderboard
        const leaderboard = document.getElementById('leaderboardList');
        const sortedPairs = getTopPairs(20);
        
        leaderboard.innerHTML = sortedPairs.map(pair => `
            <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 500; font-size: 0.9rem;">${pair.leader} → ${pair.follower}</div>
                    <div style="font-size: 0.8rem; color: var(--text-tertiary);">Follow rate: ${(pair.followRate * 100).toFixed(1)}%</div>
                </div>
                <div style="font-size: 0.9rem; font-weight: 500; color: ${pair.avgLag < 200 ? 'var(--accent-success)' : 'var(--text-secondary)'}">
                    ${pair.avgLag}ms
                </div>
            </div>
        `).join('');
        
        // Update causality table
        const tableBody = document.getElementById('causalityTableBody');
        const topPairs = getTopPairs(10);
        
        tableBody.innerHTML = topPairs.map(pair => `
            <tr>
                <td style="font-weight: 500;">${pair.leader.split('-')[0]} → ${pair.follower.split('-')[0]}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <div style="font-weight: 600;">${(pair.followRate * 100).toFixed(1)}%</div>
                        <div style="width: 60px; height: 4px; background: var(--border-medium); border-radius: 2px;">
                            <div style="width: ${pair.followRate * 100}%; height: 100%; background: var(--primary-cyan); border-radius: 2px;"></div>
                        </div>
                    </div>
                </td>
                <td>
                    <span style="font-weight: 600; color: ${pair.avgLag < 200 ? 'var(--accent-success)' : pair.avgLag < 500 ? 'var(--accent-warning)' : 'var(--accent-danger)'}">
                        ${pair.avgLag}ms
                    </span>
                </td>
                <td>
                    <span style="font-weight: 600;">${pair.magnitudeRatio.toFixed(2)}x</span>
                </td>
                <td>
                    <span style="font-weight: 600;">${pair.signals24h}</span>
                    <div style="font-size: 0.8rem; color: var(--text-tertiary);">last hour</div>
                </td>
                <td>
                    <span class="status-badge ${pair.confidence > 0.8 ? 'active' : 'paused'}">
                        ${pair.confidence > 0.8 ? 'High Confidence' : 'Developing'}
                    </span>
                </td>
            </tr>
        `).join('');
        
        // Update metrics
        updateMetrics();
    }

    function getTopPairs(limit) {
        const allPairs = [];
        Object.keys(causalityMatrix).forEach(leader => {
            Object.keys(causalityMatrix[leader]).forEach(follower => {
                const data = causalityMatrix[leader][follower];
                if (data.signals24h > 0) {
                    allPairs.push({
                        leader,
                        follower,
                        ...data
                    });
                }
            });
        });
        
        return allPairs
            .sort((a, b) => b.followRate - a.followRate)
            .slice(0, limit);
    }

    function updateMetrics() {
        const pairs = getTopPairs(100);
        
        if (pairs.length > 0) {
            const avgLag = Math.round(pairs.reduce((sum, p) => sum + p.avgLag, 0) / pairs.length);
            const avgFollowRate = (pairs.reduce((sum, p) => sum + p.followRate, 0) / pairs.length * 100).toFixed(1);
            
            document.getElementById('avgLagTime').textContent = `${avgLag}ms`;
            document.getElementById('signalAccuracy').textContent = `${avgFollowRate}%`;
            document.getElementById('activeCorrelations').textContent = pairs.filter(p => p.confidence > 0.8).length;
            document.getElementById('divergenceEvents').textContent = Math.floor(Math.random() * 50) + 100; // Simulated
        }
    }

    // Backend Connection & Data Handling
    let prices = {};
    let priceHistory = {};

    function connectToBackend() {
        // Connect to our backend WebSocket
        ws = new WebSocket(WS_URL);
        
        ws.onopen = () => {
            showNotification('Connected to CryptoSoup Backend', 'success');
            console.log('Connected to backend server');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'initial_state') {
                // Initialize with data from backend
                if (data.prices) {
                    prices = data.prices;
                }
                // Initial fetch of causality data
                fetchCausalityData();
                updateMetrics();
                console.log('Received initial market state');
            } else if (data.type === 'ticker_update') {
                handleBackendUpdate(data);
            } else if (data.type === 'batch_update') {
                Object.keys(data.updates).forEach(coin => {
                    handleBackendUpdate({
                        coin: coin,
                        data: data.updates[coin]
                    });
                });
            }
        };
        
        ws.onerror = (error) => {
            showNotification('Backend connection error', 'error');
        };
        
        ws.onclose = () => {
            showNotification('Disconnected from backend - Retrying...', 'warning');
            setTimeout(connectToBackend, 3000);
        };
    }

    function handleBackendUpdate(data) {
        const coin = data.coin;
        const priceData = data.data;
        
        // Update local state
        prices[coin] = priceData;
        
        // Add to history
        if (!priceHistory[coin]) priceHistory[coin] = [];
        priceHistory[coin].push(priceData.price);
        if (priceHistory[coin].length > 1000) {
            priceHistory[coin].shift();
        }
        
        // Note: We rely on the periodic fetchCausalityData to update the main UI
        // to avoid overwhelming the DOM with every tick
    }

    async function fetchCausalityData() {
        try {
            const response = await fetch(`${API_URL}/causality/best-pairs`);
            const data = await response.json();
            
            if (data.success && data.pairs) {
                // Update causalityMatrix with real data from backend
                data.pairs.forEach(pair => {
                    if (causalityMatrix[pair.leader] && causalityMatrix[pair.leader][pair.follower]) {
                        const cell = causalityMatrix[pair.leader][pair.follower];
                        cell.followRate = pair.followRate;
                        cell.avgLag = Math.round(pair.avgLag);
                        cell.magnitudeRatio = pair.avgMagnitude;
                        cell.signals24h = pair.sampleSize;
                        cell.confidence = pair.followRate; // Use follow rate as confidence proxy
                    }
                });
                
                updateUI();
            }
        } catch (error) {
            console.error('Error fetching causality data:', error);
        }
    }

    // Draw network visualization
    function drawNetwork() {
        const width = canvas.width / devicePixelRatio;
        const height = canvas.height / devicePixelRatio;
        
        // Clear canvas
        ctx.fillStyle = 'rgba(18, 20, 32, 0.5)';
        ctx.fillRect(0, 0, width, height);
        
        const pairs = getTopPairs(15);
        const nodes = {};
        
        // Create node positions
        pairs.forEach((pair, i) => {
            if (!nodes[pair.leader]) {
                const angle = (i / pairs.length) * Math.PI * 2;
                const radius = Math.min(width, height) * 0.3;
                nodes[pair.leader] = {
                    x: width / 2 + Math.cos(angle) * radius,
                    y: height / 2 + Math.sin(angle) * radius,
                    size: 20
                };
            }
            
            if (!nodes[pair.follower]) {
                const angle = (i / pairs.length) * Math.PI * 2 + 0.1;
                const radius = Math.min(width, height) * 0.4;
                nodes[pair.follower] = {
                    x: width / 2 + Math.cos(angle) * radius,
                    y: height / 2 + Math.sin(angle) * radius,
                    size: 16
                };
            }
        });
        
        // Draw connections
        pairs.forEach(pair => {
            const from = nodes[pair.leader];
            const to = nodes[pair.follower];
            
            if (from && to) {
                // Draw line
                const alpha = pair.confidence * 0.7;
                ctx.strokeStyle = pair.avgLag < 200 ? 
                    `rgba(6, 214, 160, ${alpha})` : 
                    `rgba(124, 58, 237, ${alpha})`;
                ctx.lineWidth = Math.max(1, pair.followRate * 3);
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
                
                // Draw arrow head
                const angle = Math.atan2(to.y - from.y, to.x - from.x);
                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.moveTo(to.x, to.y);
                ctx.lineTo(
                    to.x - 10 * Math.cos(angle - Math.PI/6),
                    to.y - 10 * Math.sin(angle - Math.PI/6)
                );
                ctx.lineTo(
                    to.x - 10 * Math.cos(angle + Math.PI/6),
                    to.y - 10 * Math.sin(angle + Math.PI/6)
                );
                ctx.closePath();
                ctx.fill();
            }
        });
        
        // Draw nodes
        Object.entries(nodes).forEach(([coin, node]) => {
            // Node glow
            const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.size * 2);
            gradient.addColorStop(0, 'rgba(37, 99, 235, 0.5)');
            gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size * 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Node
            ctx.fillStyle = '#1A1C2D';
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            ctx.fill();
            
            // Node border
            ctx.strokeStyle = '#2563EB';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            ctx.stroke();
            
            // Label
            ctx.fillStyle = '#F3F4F6';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(coin.split('-')[0], node.x, node.y);
        });
    }

    // Export functions
    window.exportCSV = function() {
        const headers = ['leader,follower,follow_rate,avg_lag_ms,magnitude_ratio,signals_24h,confidence,last_signal'];
        const rows = [];
        
        Object.keys(causalityMatrix).forEach(leader => {
            Object.keys(causalityMatrix[leader]).forEach(follower => {
                const data = causalityMatrix[leader][follower];
                if (data.signals24h > 0) {
                    rows.push([
                        leader,
                        follower,
                        data.followRate.toFixed(4),
                        data.avgLag.toFixed(0),
                        data.magnitudeRatio.toFixed(4),
                        data.signals24h,
                        data.confidence.toFixed(4),
                        data.lastSignal || ''
                    ].join(','));
                }
            });
        });
        
        const csv = [headers.join(','), ...rows].join('\n');
        downloadFile(csv, 'causality_matrix.csv', 'text/csv');
        
        // Show notification
        showNotification('Causality matrix exported as CSV', 'success');
    }

    window.exportJSON = function() {
        const exportData = {
            timestamp: Date.now(),
            version: '1.0',
            causalityMatrix: causalityMatrix,
            metadata: {
                assetsTracked: Object.values(ASSET_CLASSES).flat().length,
                updateFrequency: '20Hz',
                dataPoints: signalLog.length
            }
        };
        
        const json = JSON.stringify(exportData, null, 2);
        downloadFile(json, 'causality_data.json', 'application/json');
        
        showNotification('Full dataset exported as JSON', 'success');
    }

    window.toggleParticles = function() {
        const btn = document.getElementById('particleToggle');
        btn.textContent = btn.textContent === 'Hide Particles' ? 'Show Particles' : 'Hide Particles';
        // Toggle visualization mode
        drawNetwork();
    }

    // Initialize with sample data
    Object.keys(causalityMatrix).forEach(leader => {
        Object.keys(causalityMatrix[leader]).forEach(follower => {
            const data = causalityMatrix[leader][follower];
            // Initialize with some realistic values
            data.followRate = Math.random() * 0.8 + 0.1;
            data.avgLag = Math.floor(Math.random() * 1500) + 100;
            data.magnitudeRatio = Math.random() * 2 + 0.5;
            data.signals24h = Math.floor(Math.random() * 1000);
            data.confidence = Math.random() * 0.5 + 0.3;
        });
    });

    // Start simulation
    updateUI();
    drawNetwork();
    connectToBackend();
    setInterval(fetchCausalityData, 10000); // Poll for causality updates
    setInterval(drawNetwork, 100);
}

// =========================================
// Backtesting Logic (alphaflow-backtesting.html)
// =========================================

if (document.body.classList.contains('backtesting-page')) {
    // Enhanced Pattern Library (from your 9-hour analysis)
    const PATTERN_LIBRARY = {
        'CRV-USD_AAVE-USD': {
            name: 'CRV → AAVE',
            winRate: 0.865,
            avgMove: 0.004,
            medianLag: 4.8,
            samples: 52,
            amplification: 0.72,
            category: 'DeFi',
            reliability: 'High'
        },
        'LTC-USD_AAVE-USD': {
            name: 'LTC → AAVE',
            winRate: 0.702,
            avgMove: 0.005,
            medianLag: 6.3,
            samples: 141,
            amplification: 0.72,
            category: 'Cross-Category',
            reliability: 'Medium'
        },
        'LINK-USD_DOGE-USD': {
            name: 'LINK → DOGE',
            winRate: 0.821,
            avgMove: 0.003,
            medianLag: 3.2,
            samples: 56,
            amplification: 0.43,
            category: 'Cross-Category',
            reliability: 'High'
        },
        'SOL-USD_LINK-USD': {
            name: 'SOL → LINK',
            winRate: 0.764,
            avgMove: 0.0027,
            medianLag: 4.7,
            samples: 55,
            amplification: 0.52,
            category: 'Smart Contracts',
            reliability: 'High'
        },
        'SOL-USD_DOGE-USD': {
            name: 'SOL → DOGE',
            winRate: 0.700,
            avgMove: 0.0025,
            medianLag: 6.6,
            samples: 70,
            amplification: 0.49,
            category: 'Cross-Category',
            reliability: 'Medium'
        },
        'DOGE-USD_LINK-USD': {
            name: 'DOGE → LINK',
            winRate: 0.776,
            avgMove: 0.0022,
            medianLag: 6.2,
            samples: 67,
            amplification: 0.43,
            category: 'Cross-Category',
            reliability: 'High'
        },
        'UNI-USD_DOGE-USD': {
            name: 'UNI → DOGE',
            winRate: 0.778,
            avgMove: 0.0016,
            medianLag: 3.1,
            samples: 63,
            amplification: 0.31,
            category: 'DeFi → Meme',
            reliability: 'Medium'
        },
        'LTC-USD_LINK-USD': {
            name: 'LTC → LINK',
            winRate: 0.713,
            avgMove: 0.0027,
            medianLag: 6.1,
            samples: 216,
            amplification: 0.52,
            category: 'Infrastructure',
            reliability: 'Medium'
        },
        'LTC-USD_DOGE-USD': {
            name: 'LTC → DOGE',
            winRate: 0.603,
            avgMove: 0.0025,
            medianLag: 5.0,
            samples: 312,
            amplification: 0.50,
            category: 'Infrastructure → Meme',
            reliability: 'Low'
        }
    };

    // State management
    const state = {
        data: null,
        backtestRunning: false,
        results: null,
        patternStats: {},
        equityCurve: [],
        tradeLog: []
    };

    // DOM Elements
    const elements = {
        fileInput: document.getElementById('fileInput'),
        uploadTrigger: document.getElementById('uploadTrigger'),
        fileList: document.getElementById('fileList'),
        runBacktest: document.getElementById('runBacktest'),
        progressContainer: document.getElementById('progressContainer'),
        progressFill: document.getElementById('progressFill'),
        progressPercent: document.getElementById('progressPercent'),
        resultsCard: document.getElementById('resultsCard'),
        patternCard: document.getElementById('patternCard'),
        patternTableBody: document.getElementById('patternTableBody'),
        tradeLog: document.getElementById('tradeLog'),
        equityChart: document.getElementById('equityChart'),
        exportCSV: document.getElementById('exportCSV'),
        exportJSON: document.getElementById('exportJSON'),
        generateReport: document.getElementById('generateReport')
    };

    // Results elements
    const resultsElements = {
        finalCapital: document.getElementById('finalCapital'),
        totalReturn: document.getElementById('totalReturn'),
        totalTrades: document.getElementById('totalTrades'),
        winRate: document.getElementById('winRate'),
        sharpeRatio: document.getElementById('sharpeRatio'),
        maxDrawdown: document.getElementById('maxDrawdown'),
        profitFactor: document.getElementById('profitFactor'),
        avgTrade: document.getElementById('avgTrade'),
        bestPattern: document.getElementById('bestPattern'),
        worstPattern: document.getElementById('worstPattern'),
        avgHoldTime: document.getElementById('avgHoldTime'),
        dataQuality: document.getElementById('dataQuality')
    };

    // Configuration elements
    const configElements = {
        startingCapital: document.getElementById('startingCapital'),
        positionSize: document.getElementById('positionSize'),
        minConfidence: document.getElementById('minConfidence'),
        stopLoss: document.getElementById('stopLoss'),
        exchangeModel: document.getElementById('exchangeModel'),
        slippageModel: document.getElementById('slippageModel'),
        timeHorizon: document.getElementById('timeHorizon')
    };

    // Initialize
    function initBacktesting() {
        // Event listeners
        elements.uploadTrigger.addEventListener('click', () => elements.fileInput.click());
        elements.fileInput.addEventListener('change', handleFileUpload);
        elements.runBacktest.addEventListener('click', runBacktest);
        elements.exportCSV.addEventListener('click', exportBacktestCSV);
        elements.exportJSON.addEventListener('click', exportBacktestJSON);
        elements.generateReport.addEventListener('click', generateReport);
        
        // Initialize chart
        initChart();
    }

    // File upload handler
    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const content = e.target.result;
                
                if (file.name.endsWith('.csv')) {
                    state.data = parseCSV(content);
                } else if (file.name.endsWith('.json')) {
                    state.data = JSON.parse(content);
                } else {
                    throw new Error('Unsupported file format');
                }
                
                // Update UI
                updateFileList(file.name, state.data.length);
                elements.runBacktest.disabled = false;
                
                // Show success notification
                showNotification('Data loaded successfully', 'success');
                
            } catch (error) {
                showNotification('Error loading file: ' + error.message, 'error');
            }
        };
        
        reader.onerror = function() {
            showNotification('Error reading file', 'error');
        };
        
        reader.readAsText(file);
    }

    function parseCSV(content) {
        const lines = content.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = values[i] ? values[i].trim() : '';
            });
            return obj;
        });
    }

    function updateFileList(filename, count) {
        elements.fileList.innerHTML = `
            <div class="file-item">
                <div class="file-info">
                    <svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div>
                        <div>${filename}</div>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary);">
                            ${count.toLocaleString()} events loaded
                        </div>
                    </div>
                </div>
                <span class="status-badge success">Ready</span>
            </div>
        `;
    }

    // Main backtest function
    async function runBacktest() {
        if (!state.data || state.backtestRunning) return;
        
        // Reset state
        state.backtestRunning = true;
        state.results = null;
        state.patternStats = {};
        state.equityCurve = [];
        state.tradeLog = [];
        
        // Get configuration
        const config = {
            startingCapital: parseFloat(configElements.startingCapital.value),
            positionSize: parseFloat(configElements.positionSize.value) / 100,
            minConfidence: parseFloat(configElements.minConfidence.value),
            stopLoss: parseFloat(configElements.stopLoss.value) / 100,
            exchangeFee: getExchangeFee(configElements.exchangeModel.value),
            slippage: getSlippage(configElements.slippageModel.value)
        };
        
        // Show progress
        elements.progressContainer.style.display = 'block';
        updateProgress(0, 'Processing data...');
        
        // Initialize results
        let capital = config.startingCapital;
        let peakCapital = capital;
        let maxDrawdown = 0;
        state.equityCurve.push(capital);
        
        // Filter relevant events
        const events = state.data.filter(event => 
            event.Most_Recent_Leader && 
            event.Most_Recent_Leader !== 'NONE' &&
            event.Most_Recent_Leader !== event.Coin &&
            parseFloat(event.Change_Percent) !== 0
        );
        
        const totalEvents = events.length;
        
        // Process events
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            
            // Update progress
            if (i % 100 === 0) {
                const progress = (i / totalEvents * 100);
                updateProgress(progress, `Processing event ${i} of ${totalEvents}`);
                
                // Yield to UI
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            const leader = event.Most_Recent_Leader;
            const follower = event.Coin;
            const patternKey = `${leader}_${follower}`;
            const pattern = PATTERN_LIBRARY[patternKey];
            
            if (!pattern) continue;
            
            // Calculate signal confidence
            const signal = calculateSignal(event, pattern);
            if (signal.confidence < config.minConfidence) continue;
            
            // Execute trade
            const trade = executeTrade(event, signal, config, capital);
            
            if (trade) {
                // Update capital
                capital += trade.profit;
                
                // Update drawdown
                peakCapital = Math.max(peakCapital, capital);
                const drawdown = (peakCapital - capital) / peakCapital;
                maxDrawdown = Math.max(maxDrawdown, drawdown);
                
                // Update state
                state.equityCurve.push(capital);
                state.tradeLog.push(trade);
                
                // Update pattern statistics
                if (!state.patternStats[patternKey]) {
                    state.patternStats[patternKey] = {
                        name: pattern.name,
                        category: pattern.category,
                        reliability: pattern.reliability,
                        trades: 0,
                        wins: 0,
                        losses: 0,
                        totalPL: 0,
                        confidenceSum: 0,
                        holdTimes: []
                    };
                }
                
                const stats = state.patternStats[patternKey];
                stats.trades++;
                stats.confidenceSum += signal.confidence;
                stats.totalPL += trade.profit;
                stats.holdTimes.push(trade.holdTime || 0);
                
                if (trade.profit > 0) {
                    stats.wins++;
                } else {
                    stats.losses++;
                }
            }
        }
        
        // Calculate final results
        const results = calculateResults(config.startingCapital, capital, state.tradeLog, state.patternStats, maxDrawdown);
        state.results = results;
        
        // Update UI
        updateResults(results);
        updatePatternTable();
        updateTradeLog();
        updateChart();
        updateStatistics();
        
        // Hide progress
        elements.progressContainer.style.display = 'none';
        state.backtestRunning = false;
        
        // Show results
        elements.resultsCard.style.display = 'block';
        elements.patternCard.style.display = 'block';
        
        // Show notification
        showNotification(`Backtest completed: ${results.totalReturn >= 0 ? '+' : ''}${results.totalReturn.toFixed(2)}% return`, 'success');
    }

    function calculateSignal(event, pattern) {
        const leaderChange = parseFloat(event.Leader_Change_Percent) / 100;
        const timeLag = parseFloat(event.Time_Since_Leader_MS) / 1000;
        
        // Base confidence from pattern win rate
        let confidence = pattern.winRate * 100;
        
        // Timing factor
        const timingFactor = Math.exp(-Math.abs(timeLag - pattern.medianLag) / pattern.medianLag);
        confidence *= timingFactor;
        
        // Sample size bonus
        const sampleBonus = Math.min(pattern.samples / 100, 0.2);
        confidence *= (1 + sampleBonus);
        
        // Magnitude factor
        const magnitudeFactor = Math.min(Math.abs(leaderChange) / pattern.avgMove, 1.5);
        confidence *= magnitudeFactor;
        
        // Cap at 95%
        confidence = Math.min(confidence, 95);
        
        return {
            confidence: confidence,
            expectedMove: Math.abs(leaderChange) * pattern.amplification,
            timingScore: timingFactor * 100,
            pattern: pattern
        };
    }

    function executeTrade(event, signal, config, capital) {
        const positionSize = capital * config.positionSize;
        if (positionSize < 10) return null; // Minimum position size
        
        const leaderChange = parseFloat(event.Leader_Change_Percent) / 100;
        const followerChange = parseFloat(event.Change_Percent) / 100;
        
        // Apply slippage
        const slippage = Math.random() * config.slippage;
        
        // Calculate profit/loss
        let profit;
        if ((leaderChange > 0 && followerChange > 0) || (leaderChange < 0 && followerChange < 0)) {
            // Win - same direction
            const gain = Math.abs(followerChange) * positionSize;
            const fees = positionSize * config.exchangeFee;
            profit = gain - fees - (gain * slippage);
        } else {
            // Loss - opposite direction or no move
            const stopLoss = positionSize * config.stopLoss;
            const fees = positionSize * config.exchangeFee;
            profit = -stopLoss - fees - (positionSize * slippage);
        }
        
        return {
            timestamp: event.Timestamp,
            pattern: signal.pattern.name,
            confidence: signal.confidence,
            position: positionSize,
            profit: profit,
            capital: capital + profit,
            win: profit > 0,
            leaderChange: leaderChange,
            followerChange: followerChange,
            holdTime: parseFloat(event.Time_Since_Leader_MS) / 1000
        };
    }

    function calculateResults(startingCapital, finalCapital, trades, patternStats, maxDrawdown) {
        const totalReturn = ((finalCapital / startingCapital) - 1) * 100;
        const winCount = trades.filter(t => t.win).length;
        const winRate = trades.length > 0 ? (winCount / trades.length * 100) : 0;
        
        // Sharpe ratio (simplified)
        const returns = trades.map(t => t.profit / t.position);
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdDev = returns.length > 0 ? 
            Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length) : 0;
        const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
        
        // Profit factor
        const totalWins = trades.filter(t => t.profit > 0).reduce((sum, t) => sum + t.profit, 0);
        const totalLosses = trades.filter(t => t.profit < 0).reduce((sum, t) => sum + Math.abs(t.profit), 0);
        const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
        
        // Average trade
        const avgTrade = trades.length > 0 ? trades.reduce((sum, t) => sum + t.profit, 0) / trades.length : 0;
        
        return {
            startingCapital,
            finalCapital,
            totalReturn,
            totalTrades: trades.length,
            winRate,
            sharpeRatio: sharpeRatio.toFixed(2),
            maxDrawdown: (maxDrawdown * 100).toFixed(2) + '%',
            profitFactor: profitFactor.toFixed(2),
            avgTrade: avgTrade.toFixed(2),
            patternStats
        };
    }

    function updateResults(results) {
        const isPositive = results.totalReturn >= 0;
        
        resultsElements.finalCapital.textContent = `$${results.finalCapital.toFixed(2)}`;
        resultsElements.finalCapital.className = `summary-value ${isPositive ? 'positive' : 'negative'}`;
        
        resultsElements.totalReturn.textContent = `${results.totalReturn >= 0 ? '+' : ''}${results.totalReturn.toFixed(2)}%`;
        resultsElements.totalReturn.className = `summary-value ${isPositive ? 'positive' : 'negative'}`;
        
        resultsElements.totalTrades.textContent = results.totalTrades;
        resultsElements.winRate.textContent = `${results.winRate.toFixed(1)}%`;
        resultsElements.sharpeRatio.textContent = results.sharpeRatio;
        resultsElements.maxDrawdown.textContent = results.maxDrawdown;
        resultsElements.profitFactor.textContent = results.profitFactor;
        resultsElements.avgTrade.textContent = `$${results.avgTrade}`;
    }

    function updatePatternTable() {
        const tbody = elements.patternTableBody;
        tbody.innerHTML = '';
        
        const patterns = Object.values(state.patternStats)
            .filter(p => p.trades > 0)
            .sort((a, b) => b.totalPL - a.totalPL);
        
        patterns.forEach(pattern => {
            const winRate = (pattern.wins / pattern.trades * 100).toFixed(1);
            const avgReturn = (pattern.totalPL / pattern.trades).toFixed(3);
            const avgConfidence = (pattern.confidenceSum / pattern.trades).toFixed(1);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${pattern.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary);">${pattern.category}</div>
                </td>
                <td>${pattern.trades}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <div>${winRate}%</div>
                        <div style="width: 40px; height: 4px; background: var(--border-medium); border-radius: 2px;">
                            <div style="width: ${winRate}%; height: 100%; background: ${parseFloat(winRate) > 50 ? 'var(--accent-success)' : 'var(--accent-warning)'}; border-radius: 2px;"></div>
                        </div>
                    </div>
                </td>
                <td style="color: ${parseFloat(avgReturn) >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">
                    $${avgReturn}
                </td>
                <td style="color: ${pattern.totalPL >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}; font-weight: 600;">
                    $${pattern.totalPL.toFixed(2)}
                </td>
                <td>${avgConfidence}%</td>
            `;
            tbody.appendChild(row);
        });
    }

    function updateTradeLog() {
        const container = elements.tradeLog;
        container.innerHTML = '';
        
        const recentTrades = state.tradeLog.slice(-50).reverse();
        
        if (recentTrades.length === 0) {
            container.innerHTML = `
                <div class="trade-entry">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                        <span style="font-weight: 600;">--</span>
                        <span class="trade-profit">--</span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary);">No trades executed</div>
                </div>
            `;
            return;
        }
        
        recentTrades.forEach(trade => {
            const entry = document.createElement('div');
            entry.className = 'trade-entry';
            
            const time = new Date(parseInt(trade.timestamp)).toLocaleTimeString();
            const profitClass = trade.profit >= 0 ? 'positive' : 'negative';
            
            entry.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                    <span style="font-weight: 600;">${trade.pattern}</span>
                    <span class="trade-profit ${profitClass}">${trade.profit >= 0 ? '+' : ''}$${trade.profit.toFixed(2)}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary);">
                    ${time} • Conf: ${trade.confidence.toFixed(1)}% • Pos: $${trade.position.toFixed(2)}
                </div>
            `;
            
            container.appendChild(entry);
        });
    }

    function updateStatistics() {
        const patterns = Object.values(state.patternStats);
        
        if (patterns.length === 0) {
            resultsElements.bestPattern.textContent = '--';
            resultsElements.worstPattern.textContent = '--';
            resultsElements.avgHoldTime.textContent = '--';
            resultsElements.dataQuality.textContent = '--';
            return;
        }
        
        // Best and worst patterns
        const sortedByPL = [...patterns].sort((a, b) => b.totalPL - a.totalPL);
        resultsElements.bestPattern.textContent = sortedByPL[0]?.name || '--';
        resultsElements.worstPattern.textContent = sortedByPL[sortedByPL.length - 1]?.name || '--';
        
        // Average hold time
        const allHoldTimes = patterns.flatMap(p => p.holdTimes || []);
        const avgHoldTime = allHoldTimes.length > 0 ? 
            (allHoldTimes.reduce((a, b) => a + b, 0) / allHoldTimes.length).toFixed(1) + 's' : 
            '--';
        resultsElements.avgHoldTime.textContent = avgHoldTime;
        
        // Data quality
        const totalSamples = patterns.reduce((sum, p) => sum + (p.trades || 0), 0);
        const quality = totalSamples > 100 ? 'High' : totalSamples > 50 ? 'Medium' : 'Low';
        resultsElements.dataQuality.textContent = quality;
    }

    // Chart functions
    let chart = null;

    function initChart() {
        const ctx = elements.equityChart.getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Equity',
                    data: [],
                    borderColor: '#06D6A0',
                    backgroundColor: 'rgba(6, 214, 160, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        display: false
                    },
                    y: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#9CA3AF',
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    function updateChart() {
        if (!chart) return;
        
        const labels = Array.from({length: state.equityCurve.length}, (_, i) => i);
        
        chart.data.labels = labels;
        chart.data.datasets[0].data = state.equityCurve;
        chart.update();
    }

    // Utility functions
    function getExchangeFee(model) {
        const fees = {
            'binance': 0.001,
            'binance_pro': 0.00075,
            'coinbase': 0.005,
            'custom': 0.002
        };
        return fees[model] || 0.001;
    }

    function getSlippage(model) {
        const slippages = {
            'none': 0,
            'low': 0.001,
            'medium': 0.0025,
            'high': 0.005
        };
        return slippages[model] || 0;
    }

    function updateProgress(percent, message) {
        elements.progressFill.style.width = percent + '%';
        elements.progressPercent.textContent = percent.toFixed(1) + '%';
    }

    // Export functions
    function exportBacktestCSV() {
        if (!state.results) return;
        
        const rows = [
            ['Date', 'Pattern', 'Confidence', 'Position', 'Profit', 'Capital', 'Win', 'Leader Change', 'Follower Change'],
            ...state.tradeLog.map(trade => [
                new Date(parseInt(trade.timestamp)).toISOString(),
                trade.pattern,
                trade.confidence.toFixed(2),
                trade.position.toFixed(2),
                trade.profit.toFixed(2),
                trade.capital.toFixed(2),
                trade.win ? 'Yes' : 'No',
                (trade.leaderChange * 100).toFixed(4) + '%',
                (trade.followerChange * 100).toFixed(4) + '%'
            ])
        ];
        
        const csv = rows.map(row => row.join(',')).join('\n');
        downloadFile(csv, 'alphafow_backtest_trades.csv', 'text/csv');
        
        showNotification('Trade log exported as CSV', 'success');
    }

    function exportBacktestJSON() {
        if (!state.results) return;
        
        const exportData = {
            metadata: {
                timestamp: new Date().toISOString(),
                version: 'AlphaFlow Analytics 1.0',
                strategy: 'Cascade Pattern Detection'
            },
            configuration: {
                startingCapital: parseFloat(configElements.startingCapital.value),
                positionSize: parseFloat(configElements.positionSize.value),
                minConfidence: parseFloat(configElements.minConfidence.value),
                stopLoss: parseFloat(configElements.stopLoss.value),
                exchangeModel: configElements.exchangeModel.value,
                slippageModel: configElements.slippageModel.value,
                timeHorizon: configElements.timeHorizon.value
            },
            results: state.results,
            patternStats: state.patternStats,
            equityCurve: state.equityCurve,
            tradeLog: state.tradeLog
        };
        
        const json = JSON.stringify(exportData, null, 2);
        downloadFile(json, 'alphafow_backtest_results.json', 'application/json');
        
        showNotification('Full backtest data exported as JSON', 'success');
    }

    function generateReport() {
        if (!state.results) return;
        
        // Create a comprehensive report
        const report = `
# AlphaFlow Analytics Backtest Report
## Generated: ${new Date().toISOString()}

## Summary
- **Total Return:** ${state.results.totalReturn.toFixed(2)}%
- **Final Capital:** $${state.results.finalCapital.toFixed(2)}
- **Total Trades:** ${state.results.totalTrades}
- **Win Rate:** ${state.results.winRate.toFixed(1)}%
- **Sharpe Ratio:** ${state.results.sharpeRatio}
- **Max Drawdown:** ${state.results.maxDrawdown}
- **Profit Factor:** ${state.results.profitFactor}

## Pattern Performance
${Object.values(state.patternStats).map(p => `
### ${p.name}
- **Category:** ${p.category}
- **Trades:** ${p.trades}
- **Win Rate:** ${((p.wins / p.trades) * 100).toFixed(1)}%
- **Total P&L:** $${p.totalPL.toFixed(2)}
- **Avg Confidence:** ${(p.confidenceSum / p.trades).toFixed(1)}%
`).join('\n')}

## Trade Statistics
- **Average Trade Profit:** $${state.results.avgTrade}
- **Best Pattern:** ${resultsElements.bestPattern.textContent}
- **Worst Pattern:** ${resultsElements.worstPattern.textContent}
- **Average Hold Time:** ${resultsElements.avgHoldTime.textContent}

## Configuration
${Object.entries({
    'Starting Capital': `$${configElements.startingCapital.value}`,
    'Position Size': `${configElements.positionSize.value}%`,
    'Min Confidence': `${configElements.minConfidence.value}%`,
    'Stop Loss': `${configElements.stopLoss.value}%`,
    'Exchange Model': configElements.exchangeModel.options[configElements.exchangeModel.selectedIndex].text,
    'Slippage Model': configElements.slippageModel.options[configElements.slippageModel.selectedIndex].text
}).map(([key, value]) => `- **${key}:** ${value}`).join('\n')}
        `;
        
        downloadFile(report, 'alphafow_backtest_report.md', 'text/markdown');
        showNotification('Comprehensive report generated', 'success');
    }

    // Load Chart.js
    const chartScript = document.createElement('script');
    chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    chartScript.onload = initBacktesting;
    document.head.appendChild(chartScript);
}