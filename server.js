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

// Маршрут для приёма сигналов от советника
app.post('/api/receive_signal', (req, res) => {
    try {
        const { asset, signal } = req.body;
        
        if (!asset || !signal) {
            return res.status(400).json({ error: 'Missing asset or signal' });
        }

        const newSignal = {
            id: ++signalCount,
            asset,
            signal,
            timestamp: new Date(),
            source: 'MT4 Advisor'
        };

        signals.push(newSignal);
        
        // Сохраняем только последние 1000 сигналов
        if (signals.length > 1000) {
            signals = signals.slice(-1000);
        }

        console.log('📨 Received signal:', newSignal);
        res.status(200).json({ 
            message: 'Signal received successfully',
            signal: newSignal
        });

    } catch (error) {
        console.error('Error processing signal:', error);
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

// Маршрут для проверки работы сервера
app.get('/', (req, res) => {
    res.json({ 
        message: 'SOVA Signal Server is running! 🚀',
        endpoints: {
            receive_signal: 'POST /api/receive_signal',
            get_signals: 'GET /api/get_signals',
            stats: 'GET /api/stats'
        },
        stats: {
            total_signals: signals.length,
            last_signal: signals.length > 0 ? signals[signals.length-1] : null
        }
    });
});

// Статистика
app.get('/api/stats', (req, res) => {
    const buySignals = signals.filter(s => s.signal === 'buy').length;
    const sellSignals = signals.filter(s => s.signal === 'sell').length;
    
    res.json({
        total_signals: signals.length,
        buy_signals: buySignals,
        sell_signals: sellSignals,
        last_signals: signals.slice(-10).reverse()
    });
});

// Запуск сервера
app.listen(port, () => {
    console.log(`🚀 SOVA Signal Server running on port ${port}`);
    console.log(`📍 Endpoint for MT4: http://localhost:${port}/api/receive_signal`);
    console.log(`📊 Dashboard: http://localhost:${port}/`);
});

// Добавьте этот код после других маршрутов
app.get('/api/receive_signal', (req, res) => {
    try {
        const { asset, signal } = req.query; // GET параметры
        
        if (!asset || !signal) {
            return res.status(400).json({ error: 'Missing asset or signal parameters' });
        }

        const newSignal = {
            id: ++signalCount,
            asset,
            signal,
            timestamp: new Date(),
            source: 'GET Request'
        };

        signals.push(newSignal);
        
        console.log('📨 GET Signal received:', newSignal);
        res.status(200).json({ 
            message: 'GET Signal received successfully',
            signal: newSignal
        });

    } catch (error) {
        console.error('Error processing GET signal:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
