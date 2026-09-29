require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const {
  sequelize,
  Signal,
  License,
  Product,
  Referral,
  Plan,
  Payment,
  User,
} = require('./src/models');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ УТИЛИТЫ ============

function generateKey() {
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

    let user = null;
    if (email || telegram_id) {
      [user] = await User.findOrCreate({
        where: email ? { email } : { telegram_id },
        defaults: { email, telegram_id, name: email || telegram_id },
      });
    }

    const days = duration_days || plan.duration_days;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

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

// ============ ПЛАТЕЖИ (BePaid) ============

app.post('/api/payment/create', async (req, res) => {
  try {
    const { product_code, plan_code, email, telegram_id } = req.body;

    if (!product_code || !plan_code || (!email && !telegram_id)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const product = await Product.findOne({ where: { code: product_code } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const plan = await Plan.findOne({ where: { code: plan_code } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const amount = Math.round(plan.price * 100);
    const trackingId = `${product_code}_${plan_code}_${Date.now()}`;

    const bepaidResponse = await axios.post(
      'https://checkout.bepaid.by/ctp/api/checkouts',
      {
        checkout: {
          transaction_type: 'payment',
          attempts: 3,
          test: false,
          order: {
            currency: plan.currency,
            amount: amount,
            description: `${product.name} - ${plan.name}`,
            tracking_id: trackingId,
          },
          settings: {
            notification_url: 'https://sova-signal-server.onrender.com/api/payment/webhook',
            return_url: 'https://sovabot.com/payment/success',
            agreement_toggle: {
              value: true,
              text: 'Я согласен с условиями предоставления услуг',
            },
          },
          payment_method: {
            types: ['credit_card'],
          },
          customer: {
            email: email || undefined,
          },
        },
      },
      {
        auth: {
          username: process.env.BEPAID_SHOP_ID,
          password: process.env.BEPAID_SECRET_KEY,
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-API-Version': '2',
        },
      }
    );

    const paymentUrlRaw = bepaidResponse.data?.checkout?.redirect_url;
    const token = bepaidResponse.data?.checkout?.token;

    if (!paymentUrlRaw) {
      console.error('BePaid response missing redirect_url:', bepaidResponse.data);
      return res.status(500).json({ error: 'Payment gateway error', details: bepaidResponse.data });
    }

    // Преобразуем ссылку виджета в ссылку страницы оплаты
    let paymentUrl = paymentUrlRaw;
    if (paymentUrl.includes('/widget/hpp.html')) {
      paymentUrl = `https://checkout.bepaid.by/v2/checkout?token=${token}`;
      console.log('🔄 Widget URL converted to:', paymentUrl);
    }

    const payment = await Payment.create({
      amount: plan.price,
      currency: plan.currency,
      status: 'pending',
      provider: 'bepaid',
      provider_payment_id: token,
      raw_payload: {
        tracking_id: trackingId,
        product_code,
        plan_code,
        email,
        telegram_id,
      },
    });

    res.json({
      status: 'ok',
      payment_url: paymentUrl,
      payment_url_raw: paymentUrlRaw,
      payment_id: payment.id,
      tracking_id: trackingId,
    });
  } catch (error) {
    console.error('BePaid create payment error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Internal server error', details: error.response?.data });
  }
});

app.post('/api/payment/webhook', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [shopId, secretKey] = credentials.split(':');

    if (shopId !== process.env.BEPAID_SHOP_ID || secretKey !== process.env.BEPAID_SECRET_KEY) {
      console.warn('❌ Webhook: Invalid credentials');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { transaction } = req.body;
    if (!transaction) {
      return res.status(200).json({ status: 'ok', warning: 'no transaction' });
    }

    console.log('📨 BePaid Webhook:', transaction.uid, '| status:', transaction.status);

    const payment = await Payment.findOne({
      where: { provider_payment_id: transaction.uid },
    });

    if (!payment) {
      console.warn('⚠️ Payment not found for uid:', transaction.uid);
      return res.status(200).json({ status: 'ok', warning: 'payment not found' });
    }

    await payment.update({
      status: transaction.status === 'successful' ? 'paid' : transaction.status,
      raw_payload: { ...payment.raw_payload, webhook: transaction },
    });

    if (transaction.status !== 'successful') {
      console.log('ℹ️ Non-successful payment, license not issued');
      return res.status(200).json({ status: 'ok' });
    }

    const meta = payment.raw_payload || {};
    const { product_code, plan_code, email, telegram_id } = meta;

    if (!product_code || !plan_code) {
      console.error('❌ Missing product_code/plan_code in payment meta');
      return res.status(200).json({ status: 'ok', warning: 'missing meta' });
    }

    const product = await Product.findOne({ where: { code: product_code } });
    const plan = await Plan.findOne({ where: { code: plan_code } });

    if (!product || !plan) {
      console.error('❌ Product or Plan not found');
      return res.status(200).json({ status: 'ok', warning: 'product/plan not found' });
    }

    let user = null;
    if (email || telegram_id) {
      [user] = await User.findOrCreate({
        where: email ? { email } : { telegram_id },
        defaults: { email, telegram_id, name: email || telegram_id },
      });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

    const key = generateKey();
    const license = await License.create({
      key,
      user_id: user ? user.id : null,
      product_id: product.id,
      plan_code: plan.code,
      expires_at: expiresAt,
      is_active: true,
    });

    await payment.update({
      user_id: user ? user.id : null,
      product_id: product.id,
      plan_id: plan.id,
    });

    console.log('✅ ЛИЦЕНЗИЯ ВЫДАНА:', key, '| email:', email, '| product:', product_code);

    res.status(200).json({ status: 'ok', license_key: key });
  } catch (error) {
    console.error('Webhook error:', error);
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
        license_create: 'POST /api/license/create',
        license_list: 'GET /api/license/list',
        license_deactivate: 'POST /api/license/deactivate',
        payment_create: 'POST /api/payment/create',
        payment_webhook: 'POST /api/payment/webhook',
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