require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize, Signal, License, Product, Referral } = require('./src/models');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ СИГНАЛЫ ============

app.post('/api/receive_signal', async (req, res) => {
  try {
    const { asset, signal, price, product_code } = req.body;
    if (!asset || !signal) {
      return res.status(400).json({ error: 'Missing asset or signal' });
    }

    let product_id = null;
    if (product_code) {
      const p = await Product.findOne({ where: { code: product_code } });
      if (p) product_id = p.id;
    }

    const newSignal = await Signal.create({
      asset, signal, price, product_id, source: 'MT4 Advisor',
    });

    console.log('📨 Signal saved:', newSignal.id, asset, signal);
    res.status(200).json({ message: 'Signal received', signal: newSignal });
  } catch (error) {
    console.error('Error processing signal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/get_signals', async (req, res) => {
  try {
    const signals = await Signal.findAll({
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    res.json({ total: signals.length, signals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const total = await Signal.count();
    const buy = await Signal.count({ where: { signal: 'buy' } });
    const sell = await Signal.count({ where: { signal: 'sell' } });
    const last = await Signal.findAll({ order: [['createdAt', 'DESC']], limit: 10 });
    res.json({ total_signals: total, buy_signals: buy, sell_signals: sell, last_signals: last });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ ЛИЦЕНЗИИ ============

app.post('/api/license/check', async (req, res) => {
  try {
    const { key, device_id, product_code } = req.body;
    if (!key || !product_code) {
      return res.status(400).json({ error: 'Missing key or product_code' });
    }

    const product = await Product.findOne({ where: { code: product_code } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const license = await License.findOne({
      where: { key, product_id: product.id, is_active: true },
    });

    if (!license) {
      return res.json({ status: 'invalid', message: 'Лицензия не найдена' });
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      await license.update({ is_active: false });
      return res.json({ status: 'expired', message: 'Лицензия истекла' });
    }

    if (!license.device_id && device_id) {
      await license.update({ device_id });
    } else if (license.device_id && device_id && license.device_id !== device_id) {
      return res.json({ status: 'blocked', message: 'Лицензия привязана к другому устройству' });
    }

    await license.update({ last_check_at: new Date() });

    res.json({
      status: 'ok',
      plan: license.plan_code,
      expires_at: license.expires_at,
      referral_url: product.referral_url,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ РЕФЕРАЛЫ ============

app.post('/api/referral/track', async (req, res) => {
  try {
    const { partner, program, click_id, utm_source, utm_campaign } = req.body;
    if (!partner) return res.status(400).json({ error: 'Missing partner' });

    const ref = await Referral.create({
      partner, program, click_id, utm_source, utm_campaign,
    });
    res.json({ status: 'ok', referral_id: ref.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ HEALTH ============

app.get('/', async (req, res) => {
  try {
    const total = await Signal.count();
    res.json({
      message: 'SOVA Signal Server is running! 🚀',
      db: 'connected',
      endpoints: {
        receive_signal: 'POST /api/receive_signal',
        get_signals: 'GET /api/get_signals',
        stats: 'GET /api/stats',
        license_check: 'POST /api/license/check',
        referral_track: 'POST /api/referral/track',
      },
      stats: { total_signals: total },
    });
  } catch (error) {
    res.status(500).json({ error: 'DB error', message: error.message });
  }
});

// ============ START ============

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ БД подключена');
    app.listen(port, () => {
      console.log(`🚀 SOVA Server on port ${port}`);
    });
  } catch (err) {
    console.error('❌ Не удалось подключиться к БД:', err.message);
    console.error('Проверь DATABASE_URL в .env или в Environment на Render');
    process.exit(1);
  }
})();