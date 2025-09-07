const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Хранилище сигналов в памяти
let signals = [];
let signalCount = 0;

// Маршрут для приёма сигналов через POST (JSON)
app.post('/api/receive_signal', (req, res) => {
    try {
        const { asset, signal } = req.body;
        
        if (!asset || !signal) {
            return res.status(400).json({ error: 'Missing asset or signal in JSON body' });
        }

        const newSignal = {
            id: ++signalCount,
            asset: asset.toUpperCase(),
            signal: signal.toLowerCase(),
            timestamp: new Date(),
            source: 'POST Request'
        };

        signals.push(newSignal);
        
        // Сохраняем только последние 1000 сигналов
        if (signals.length > 1000) {
            signals = signals.slice(-1000);
        }

        console.log('📨 POST Signal received:', newSignal);
        res.status(200).json({ 
            message: 'Signal received successfully',
            signal: newSignal
        });

    } catch (error) {
        console.error('Error processing POST signal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Маршрут для приёма сигналов через GET (параметры URL)
app.get('/api/receive_signal', (req, res) => {
    try {
        const { asset, signal } = req.query;
        
        if (!asset || !signal) {
            return res.status(400).json({ 
                error: 'Missing parameters',
                example: '/api/receive_signal?asset=BTCUSD&signal=buy'
            });
        }

        const newSignal = {
            id: ++signalCount,
            asset: asset.toUpperCase(),
            signal: signal.toLowerCase(),
            timestamp: new Date(),
            source: 'GET Request'
        };

        signals.push(newSignal);
        
        if (signals.length > 1000) {
            signals = signals.slice(-1000);
        }

        console.log('📨 GET Signal received:', newSignal);
        res.status(200).json({ 
            message: 'GET signal received successfully',
            signal: newSignal
        });

    } catch (error) {
        console.error('Error processing GET signal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Маршрут для получения всех сигналов
app.get('/api/get_signals', (req, res) => {
    res.json({
        total: signals.length,
        signals: signals.reverse() // Новые сначала
    });
});

// Маршрут для статистики
app.get('/api/stats', (req, res) => {
    const buySignals = signals.filter(s => s.signal === 'buy').length;
    const sellSignals = signals.filter(s => s.signal === 'sell').length;
    
    res.json({
        total_signals: signals.length,
        buy_signals: buySignals,
        sell_signals: sellSignals,
        last_signals: signals.slice(-10).reverse() // Последние 10 сигналов
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.json({ 
        message: 'SOVA Signal Server is running! 🚀',
        endpoints: {
            receive_signal_post: 'POST /api/receive_signal (JSON)',
            receive_signal_get: 'GET /api/receive_signal?asset=X&signal=Y',
            get_signals: 'GET /api/get_signals',
            stats: 'GET /api/stats'
        },
        examples: {
            post_curl: 'curl -X POST -H "Content-Type: application/json" -d \'{"asset":"BTCUSD","signal":"buy"}\' https://your-server.com/api/receive_signal',
            get_browser: 'https://your-server.com/api/receive_signal?asset=BTCUSD&signal=buy'
        }
    });
});

// Обработка несуществующих маршрутов
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        available_routes: [
            'GET /',
            'POST /api/receive_signal',
            'GET /api/receive_signal?asset=X&signal=Y', 
            'GET /api/get_signals',
            'GET /api/stats'
        ]
    });
});

// Запуск сервера
app.listen(port, () => {
    console.log(`🚀 SOVA Signal Server running on port ${port}`);
    console.log(`📍 Главная: http://localhost:${port}`);
    console.log(`📊 Статистика: http://localhost:${port}/api/stats`);
    console.log(`📨 GET пример: http://localhost:${port}/api/receive_signal?asset=BTCUSD&signal=test`);
});
