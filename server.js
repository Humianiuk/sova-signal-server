require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize, Signal, License, Product, Referral, Plan } = require('./src/models');

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

// ============ ГЕНЕРАЦИЯ ЛИЦЕНЗИЙ (только для админа) ============

const crypto = require('crypto');

function generateKey() {
  // Формат: SOVA-XXXX-XXXX-XXXX-XXXX
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SOVA-${part()}-${part()}-${part()}-${part()}`;
}

function checkAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.admin_secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Создать лицензию
app.post('/api/license/create', checkAdmin, async (req, res) => {
  try {
    const { product_code, plan_code = 'demo', email, telegram_id, duration_days } = req.body;
    if (!product_code) {
      return res.status(400).json({ error: 'Missing product_code' });
    }

    const product = await Product.findOne({ where: { code: product_code } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const plan = await Plan.findOne({ where: { code: plan_code } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Найти или создать пользователя
    let user = null;
    if (email || telegram_id) {
      const { User } = require('./src/models');
      [user] = await User.findOrCreate({
        where: email ? { email } : { telegram_id },
        defaults: { email, telegram_id, name: email || telegram_id },
      });
    }

    // Расчёт срока действия
    const days = duration_days || plan.duration_days;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    // Создать лицензию
    const key = generateKey();
    const license = await License.create({
      key,
      user_id: user ? user.id : null,
      product_id: product.id,
      plan_code: plan.code,
      expires_at: expiresAt,
      is_active: true,
    });

    res.json({
      status: 'ok',
      license: {
        key: license.key,
        product: product.code,
        plan: plan.code,
        expires_at: license.expires_at,
        user_id: license.user_id,
      },
    });
  } catch (error) {
    console.error('License create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Список лицензий
app.get('/api/license/list', checkAdmin, async (req, res) => {
  try {
    const { product_code, limit = 100 } = req.query;
    const where = {};
    if (product_code) {
      const product = await Product.findOne({ where: { code: product_code } });
      if (product) where.product_id = product.id;
    }

    const licenses = await License.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      include: [{ model: Product, attributes: ['code', 'name'] }],
    });

    res.json({ total: licenses.length, licenses });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Деактивировать лицензию
app.post('/api/license/deactivate', checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const license = await License.findOne({ where: { key } });
    if (!license) return res.status(404).json({ error: 'License not found' });

    await license.update({ is_active: false });
    res.json({ status: 'ok', message: 'Лицензия деактивирована' });
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