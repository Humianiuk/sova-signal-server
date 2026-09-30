require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const { Op } = require('sequelize');
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
app.use(express.json({ limit: '1mb' }));
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

// ============ ЛИЦЕНЗИИ: ПРОВЕРКА ============

app.post('/api/license/check', async (req, res) => {
  try {
    const { key, device_id, account_number, product_code } = req.body;
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

    // Привязка: первый запуск — привязываем; последующие — проверяем
    if (!license.device_id && !license.account_number) {
      const updates = {};
      if (device_id) updates.device_id = device_id;
      if (account_number) updates.account_number = account_number;
      if (Object.keys(updates).length) await license.update(updates);
    } else {
      if (license.device_id && device_id && license.device_id !== device_id) {
        return res.json({ status: 'blocked', message: 'Лицензия привязана к другому устройству' });
      }
      if (license.account_number && account_number && license.account_number !== account_number) {
        return res.json({ status: 'blocked', message: 'Лицензия привязана к другому счёту' });
      }
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

// ============ ЛИЦЕНЗИИ: АДМИН ============

app.post('/api/license/create', checkAdmin, async (req, res) => {
  try {
    const {
      product_code, plan_code = 'demo', email, telegram_id,
      duration_days, device_id, account_number, expires_at,
    } = req.body;
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

    let expiresAt;
    if (expires_at) {
      expiresAt = new Date(expires_at);
    } else {
      const days = duration_days || plan.duration_days;
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);
    }

    const key = generateKey();
    const license = await License.create({
      key,
      user_id: user ? user.id : null,
      product_id: product.id,
      plan_code: plan.code,
      expires_at: expiresAt,
      device_id: device_id || null,
      account_number: account_number || null,
      is_active: true,
    });

    res.json({ status: 'ok', license });
  } catch (error) {
    console.error('License create error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/api/license/list', checkAdmin, async (req, res) => {
  try {
    const { product_code, limit = 200 } = req.query;
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

app.post('/api/license/activate', checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const license = await License.findOne({ where: { key } });
    if (!license) return res.status(404).json({ error: 'License not found' });

    await license.update({ is_active: true });
    res.json({ status: 'ok', message: 'Лицензия активирована' });
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

app.post('/api/license/update', checkAdmin, async (req, res) => {
  try {
    const { key, expires_at, device_id, account_number, plan_code, is_active } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const license = await License.findOne({ where: { key } });
    if (!license) return res.status(404).json({ error: 'License not found' });

    const updates = {};
    if (expires_at) updates.expires_at = new Date(expires_at);
    if (plan_code) updates.plan_code = plan_code;
    if (is_active !== undefined) updates.is_active = is_active;
    if (device_id !== undefined) updates.device_id = device_id || null;
    if (account_number !== undefined) updates.account_number = account_number || null;

    await license.update(updates);
    res.json({ status: 'ok', license });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/license/unbind', checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const license = await License.findOne({ where: { key } });
    if (!license) return res.status(404).json({ error: 'License not found' });

    await license.update({ device_id: null, account_number: null });
    res.json({ status: 'ok', message: 'Привязки сняты' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ ПРОДУКТЫ (для админки) ============

app.get('/api/admin/products', checkAdmin, async (req, res) => {
  try {
    const products = await Product.findAll({ order: [['id', 'ASC']] });
    res.json({ total: products.length, products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/product/update', checkAdmin, async (req, res) => {
  try {
    const { code, referral_url, is_active, name, description } = req.body;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const product = await Product.findOne({ where: { code } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const updates = {};
    if (referral_url !== undefined) updates.referral_url = referral_url || null;
    if (is_active !== undefined) updates.is_active = is_active;
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description || null;

    await product.update(updates);
    res.json({ status: 'ok', product });
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

    let payment = null;

    if (transaction.tracking_id) {
      payment = await Payment.findOne({
        where: {
          raw_payload: {
            [Op.contains]: { tracking_id: transaction.tracking_id },
          },
        },
      });
      if (payment) console.log('✅ Payment found by tracking_id');
    }

    if (!payment && transaction.token) {
      payment = await Payment.findOne({ where: { provider_payment_id: transaction.token } });
      if (payment) console.log('✅ Payment found by token');
    }

    if (!payment) {
      payment = await Payment.findOne({ where: { provider_payment_id: transaction.uid } });
      if (payment) console.log('✅ Payment found by uid');
    }

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

// ============ АДМИН: ДАННЫЕ ============

app.get('/api/admin/stats', checkAdmin, async (req, res) => {
  try {
    const usersCount = await User.count();
    const licensesCount = await License.count();
    const activeLicenses = await License.count({ where: { is_active: true } });
    const paymentsCount = await Payment.count();
    const paidPayments = await Payment.findAll({ where: { status: 'paid' } });
    const revenue = paidPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const signalsCount = await Signal.count();

    res.json({
      users: usersCount,
      licenses: licensesCount,
      active_licenses: activeLicenses,
      payments: paymentsCount,
      paid_payments: paidPayments.length,
      revenue_byn: revenue.toFixed(2),
      signals: signalsCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users', checkAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 200,
      include: [{ model: License, attributes: ['key', 'plan_code', 'expires_at', 'is_active'] }],
    });
    res.json({ total: users.length, users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/payments', checkAdmin, async (req, res) => {
  try {
    const payments = await Payment.findAll({
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    res.json({ total: payments.length, payments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ АДМИНКА: HTML ============

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>SOVA Core — Админка</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f5f7; color: #1a1a1a; }
  .header { background: #1a1a2e; color: #fff; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { margin: 0; font-size: 20px; }
  .header .secret { display: flex; gap: 8px; align-items: center; }
  .header input { padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #2a2a3e; color: #fff; width: 260px; font-size: 13px; }
  .header button { padding: 8px 16px; border-radius: 6px; border: none; background: #ff9500; color: #fff; font-weight: 600; cursor: pointer; }
  .header button:hover { background: #e08600; }
  .tabs { background: #fff; padding: 0 24px; border-bottom: 1px solid #e0e0e0; display: flex; gap: 4px; }
  .tab { padding: 14px 20px; cursor: pointer; border-bottom: 3px solid transparent; font-weight: 500; color: #666; font-size: 14px; }
  .tab.active { color: #1a1a2e; border-bottom-color: #ff9500; }
  .tab:hover { color: #1a1a2e; }
  .content { padding: 24px; }
  .panel { display: none; }
  .panel.active { display: block; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #fff; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .card .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .card .value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
  table { width: 100%; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-collapse: collapse; }
  table th { text-align: left; padding: 12px 14px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; background: #fafafa; border-bottom: 1px solid #eee; }
  table td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: middle; }
  table tr:last-child td { border-bottom: none; }
  table tr:hover td { background: #fafafa; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge.ok { background: #d4f5d4; color: #1a7a1a; }
  .badge.warn { background: #fff4d4; color: #8a6a00; }
  .badge.err { background: #ffd4d4; color: #8a1a1a; }
  .badge.gray { background: #eee; color: #666; }
  .empty { text-align: center; padding: 40px; color: #999; background: #fff; border-radius: 10px; }
  .key { font-family: monospace; font-size: 12px; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
  .refresh { margin-bottom: 16px; display: flex; gap: 8px; }
  .refresh button, .btn { padding: 8px 14px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 13px; }
  .refresh button:hover, .btn:hover { background: #f5f5f5; }
 .btn-primary:hover, .refresh .btn-primary:hover { background: #e08600; }
  .btn-primary:hover { background: #e08600; }
  .btn-sm { padding: 4px 10px; font-size: 12px; border-radius: 4px; }
  .btn-danger { color: #8a1a1a; }
  .btn-success { color: #1a7a1a; }
  .status-msg { font-size: 13px; color: #888; margin-left: 12px; }
  .modal-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
  .modal-bg.active { display: flex; }
  .modal { background: #fff; border-radius: 12px; padding: 24px; width: 100%; max-width: 500px; }
  .modal h2 { margin: 0 0 16px 0; font-size: 18px; }
  .modal .field { margin-bottom: 14px; }
  .modal .field label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .modal .field input, .modal .field textarea, .modal .field select { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; font-family: inherit; }
  .modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .modal .actions button { padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; border: 1px solid #ddd; background: #fff; }
  .modal .actions button.primary { background: #ff9500; color: #fff; border-color: #ff9500; }
  .modal .actions button:hover { opacity: 0.9; }
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; color: #fff; font-size: 14px; z-index: 2000; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.ok { background: #1a7a1a; }
  .toast.err { background: #8a1a1a; }
  .bind-info { font-size: 11px; color: #888; font-family: monospace; }
  /* ============ MOBILE / ADAPTIVE ============ */

  @media (max-width: 900px) {
    .cards { grid-template-columns: repeat(3, 1fr); }
  }

  @media (max-width: 768px) {
    /* Шапка */
    .header { flex-direction: column; gap: 10px; align-items: stretch; padding: 12px 14px; }
    .header h1 { font-size: 17px; text-align: center; }
    .header .secret { width: 100%; }
    .header input { flex: 1; width: auto; min-width: 0; }
    .header button { padding: 8px 14px; }
    .status-msg { display: none; }

    /* Табы — скролл по горизонтали */
    .tabs {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      padding: 0 12px;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tab { padding: 12px 14px; font-size: 13px; white-space: nowrap; }

    /* Контент */
    .content { padding: 12px; }

    /* Карточки дашборда — 2 в ряд */
    .cards { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
    .card { padding: 14px; }
    .card .label { font-size: 10px; }
    .card .value { font-size: 22px; }

    /* Кнопки над таблицей */
    .refresh { flex-wrap: wrap; gap: 6px; }
    .refresh button, .btn { padding: 7px 12px; font-size: 12px; }

    /* Таблицы — горизонтальный скролл */
    #licensesTable, #paymentsTable, #usersTable, #signalsTable, #productsTable {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border-radius: 10px;
    }
    #licensesTable table, #paymentsTable table, #usersTable table,
    #signalsTable table, #productsTable table {
      min-width: 720px;
    }
    table th { padding: 10px 8px; font-size: 10px; }
    table td { padding: 10px 8px; font-size: 12px; }

    /* Модалки */
    .modal-bg { padding: 12px; align-items: flex-start; padding-top: 40px; overflow-y: auto; }
    .modal { max-width: 100%; padding: 18px; border-radius: 10px; }
    .modal h2 { font-size: 16px; }
    .modal .field input, .modal .field select { padding: 10px 12px; font-size: 14px; }
    .modal .actions { flex-direction: column-reverse; gap: 6px; }
    .modal .actions button { width: 100%; padding: 10px; }

    /* Toast */
    .toast { left: 12px; right: 12px; bottom: 12px; text-align: center; font-size: 13px; }
  }

  @media (max-width: 380px) {
    .cards { grid-template-columns: 1fr; }
    .header h1 { font-size: 15px; }
  }  
</style>
</head>
<body>
<div class="header">
  <h1>🦉 SOVA Core — Админка</h1>
  <div class="secret">
    <input type="password" id="secretInput" placeholder="ADMIN_SECRET" />
    <button onclick="login()">Войти</button>
    <span class="status-msg" id="statusMsg"></span>
  </div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="dashboard" onclick="switchTab('dashboard')">Дашборд</div>
  <div class="tab" data-tab="licenses" onclick="switchTab('licenses')">Лицензии</div>
  <div class="tab" data-tab="products" onclick="switchTab('products')">Продукты</div>
  <div class="tab" data-tab="payments" onclick="switchTab('payments')">Платежи</div>
  <div class="tab" data-tab="users" onclick="switchTab('users')">Клиенты</div>
  <div class="tab" data-tab="signals" onclick="switchTab('signals')">Сигналы</div>
</div>

<div class="content">
  <div class="panel active" id="panel-dashboard">
    <div class="refresh"><button onclick="loadDashboard()">🔄 Обновить</button></div>
    <div class="cards" id="dashboardCards"></div>
  </div>

  <div class="panel" id="panel-licenses">
    <div class="refresh">
      <button onclick="loadLicenses()">🔄 Обновить</button>
      <button class="btn-primary" onclick="openLicenseModal()">+ Создать лицензию</button>
    </div>
    <div id="licensesTable"></div>
  </div>

  <div class="panel" id="panel-products">
    <div class="refresh"><button onclick="loadProducts()">🔄 Обновить</button></div>
    <div id="productsTable"></div>
  </div>

  <div class="panel" id="panel-payments">
    <div class="refresh"><button onclick="loadPayments()">🔄 Обновить</button></div>
    <div id="paymentsTable"></div>
  </div>

  <div class="panel" id="panel-users">
    <div class="refresh"><button onclick="loadUsers()">🔄 Обновить</button></div>
    <div id="usersTable"></div>
  </div>

  <div class="panel" id="panel-signals">
    <div class="refresh"><button onclick="loadSignals()">🔄 Обновить</button></div>
    <div id="signalsTable"></div>
  </div>
</div>

<!-- Модалка: Лицензия -->
<div class="modal-bg" id="licenseModal">
  <div class="modal">
    <h2 id="licenseModalTitle">Создать лицензию</h2>
    <div class="field" id="fieldKey" style="display:none;">
      <label>Ключ</label>
      <input type="text" id="inpKey" readonly />
    </div>
    <div class="field" id="fieldProduct">
      <label>Продукт</label>
      <select id="inpProduct"></select>
    </div>
    <div class="field" id="fieldPlan">
      <label>Тариф</label>
      <select id="inpPlan">
        <option value="demo">Demo</option>
        <option value="pro">Pro</option>
        <option value="vip">VIP</option>
      </select>
    </div>
    <div class="field" id="fieldEmail">
      <label>Email клиента</label>
      <input type="email" id="inpEmail" placeholder="client@example.com" />
    </div>
    <div class="field">
      <label>Дата окончания</label>
      <input type="date" id="inpExpires" />
    </div>
    <div class="field">
      <label>Device ID (железо)</label>
      <input type="text" id="inpDeviceId" placeholder="оставь пустым, если привязка с клиента" />
    </div>
    <div class="field">
      <label>Account Number (номер счёта)</label>
      <input type="text" id="inpAccount" placeholder="оставь пустым, если привязка с клиента" />
    </div>
    <div class="actions">
      <button onclick="closeLicenseModal()">Отмена</button>
      <button class="primary" onclick="saveLicense()" id="saveLicenseBtn">Создать</button>
    </div>
  </div>
</div>

<!-- Модалка: Продукт -->
<div class="modal-bg" id="productModal">
  <div class="modal">
    <h2>Редактировать продукт</h2>
    <div class="field">
      <label>Код</label>
      <input type="text" id="prodCode" readonly />
    </div>
    <div class="field">
      <label>Название</label>
      <input type="text" id="prodName" />
    </div>
    <div class="field">
      <label>Реферальная ссылка</label>
      <input type="text" id="prodRef" placeholder="https://..." />
    </div>
    <div class="actions">
      <button onclick="closeProductModal()">Отмена</button>
      <button class="primary" onclick="saveProduct()">Сохранить</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let secret = localStorage.getItem('sova_secret') || '';
document.getElementById('secretInput').value = secret;
let allProducts = [];

function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast ' + type, 2500);
}

function login() {
  secret = document.getElementById('secretInput').value.trim();
  localStorage.setItem('sova_secret', secret);
  document.getElementById('statusMsg').textContent = 'Проверка...';
  fetch('/api/admin/stats', { headers: { 'x-admin-secret': secret } })
    .then(r => r.ok ? r.json() : Promise.reject('Неверный secret'))
    .then(() => {
      document.getElementById('statusMsg').textContent = '✅ OK';
      setTimeout(() => document.getElementById('statusMsg').textContent = '', 2000);
      loadCurrentTab();
    })
    .catch(err => {
      document.getElementById('statusMsg').textContent = '❌ ' + err;
    });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  loadCurrentTab();
}

let currentTab = 'dashboard';
function loadCurrentTab() {
  const active = document.querySelector('.tab.active');
  if (!active) return;
  currentTab = active.dataset.tab;
  if (currentTab === 'dashboard') loadDashboard();
  if (currentTab === 'licenses') loadLicenses();
  if (currentTab === 'products') loadProducts();
  if (currentTab === 'payments') loadPayments();
  if (currentTab === 'users') loadUsers();
  if (currentTab === 'signals') loadSignals();
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'x-admin-secret': secret, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function dateToInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ===== Дашборд =====
async function loadDashboard() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('dashboardCards').innerHTML = \`
      <div class="card"><div class="label">Клиентов</div><div class="value">\${s.users}</div></div>
      <div class="card"><div class="label">Лицензий</div><div class="value">\${s.licenses}</div></div>
      <div class="card"><div class="label">Активных</div><div class="value">\${s.active_licenses}</div></div>
      <div class="card"><div class="label">Платежей</div><div class="value">\${s.paid_payments} / \${s.payments}</div></div>
      <div class="card"><div class="label">Доход, BYN</div><div class="value">\${s.revenue_byn}</div></div>
      <div class="card"><div class="label">Сигналов</div><div class="value">\${s.signals}</div></div>
    \`;
  } catch (e) { console.error(e); }
}

// ===== Лицензии =====
async function loadLicenses() {
  try {
    const d = await api('/api/license/list?limit=200');
    const rows = (d.licenses || []).map(l => {
      const bindDevice = l.device_id ? \`<div class="bind-info">device: \${esc(l.device_id.slice(0, 16))}...</div>\` : '';
      const bindAccount = l.account_number ? \`<div class="bind-info">acc: \${esc(l.account_number)}</div>\` : '';
      const bind = (bindDevice || bindAccount) ? (bindDevice + bindAccount) : '<span style="color:#aaa">—</span>';
      return \`
        <tr>
          <td><span class="key">\${esc(l.key)}</span></td>
          <td>\${esc(l.Product ? l.Product.name : '—')}</td>
          <td>\${esc(l.plan_code)}</td>
          <td>\${l.is_active ? '<span class="badge ok">Активна</span>' : '<span class="badge gray">Отключена</span>'}</td>
          <td>\${fmtDate(l.expires_at)}</td>
          <td>\${bind}</td>
          <td>
            <button class="btn btn-sm" onclick='openLicenseModal(\${JSON.stringify(l).replace(/'/g, "&#39;")})'>✏️</button>
            \${l.is_active
              ? \`<button class="btn btn-sm btn-danger" onclick="deactivateLicense('\${l.key}')">🔒</button>\`
              : \`<button class="btn btn-sm btn-success" onclick="activateLicense('\${l.key}')">🔓</button>\`
            }
            <button class="btn btn-sm" onclick="copyKey('\${l.key}')">📋</button>
          </td>
        </tr>
      \`;
    }).join('');
    document.getElementById('licensesTable').innerHTML = rows
      ? \`<table><thead><tr><th>Ключ</th><th>Продукт</th><th>Тариф</th><th>Статус</th><th>До</th><th>Привязка</th><th>Действия</th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Лицензий пока нет</div>';
  } catch (e) { console.error(e); }
}

let currentLicense = null;

async function openLicenseModal(license) {
  await ensureProducts();
  const modal = document.getElementById('licenseModal');
  const title = document.getElementById('licenseModalTitle');
  const saveBtn = document.getElementById('saveLicenseBtn');
  const selProduct = document.getElementById('inpProduct');
  const fieldKey = document.getElementById('fieldKey');
  const fieldProduct = document.getElementById('fieldProduct');
  const fieldEmail = document.getElementById('fieldEmail');

  selProduct.innerHTML = allProducts.map(p => \`<option value="\${p.code}">\${esc(p.name)} (\${esc(p.code)})</option>\`).join('');

  if (license) {
    currentLicense = license;
    title.textContent = 'Редактировать лицензию';
    saveBtn.textContent = 'Сохранить';
    fieldKey.style.display = 'block';
    fieldProduct.style.display = 'none';
    fieldEmail.style.display = 'none';
    document.getElementById('inpKey').value = license.key;
    document.getElementById('inpPlan').value = license.plan_code;
    document.getElementById('inpExpires').value = dateToInput(license.expires_at);
    document.getElementById('inpDeviceId').value = license.device_id || '';
    document.getElementById('inpAccount').value = license.account_number || '';
    document.getElementById('inpEmail').value = '';
  } else {
    currentLicense = null;
    title.textContent = 'Создать лицензию';
    saveBtn.textContent = 'Создать';
    fieldKey.style.display = 'none';
    fieldProduct.style.display = 'block';
    fieldEmail.style.display = 'block';
    document.getElementById('inpKey').value = '';
    document.getElementById('inpPlan').value = 'pro';
    const def = new Date(); def.setDate(def.getDate() + 30);
    document.getElementById('inpExpires').value = dateToInput(def);
    document.getElementById('inpDeviceId').value = '';
    document.getElementById('inpAccount').value = '';
    document.getElementById('inpEmail').value = '';
  }
  modal.classList.add('active');
}

function closeLicenseModal() {
  document.getElementById('licenseModal').classList.remove('active');
  currentLicense = null;
}

async function saveLicense() {
  try {
    const payload = {
      plan_code: document.getElementById('inpPlan').value,
      expires_at: document.getElementById('inpExpires').value || null,
      device_id: document.getElementById('inpDeviceId').value.trim(),
      account_number: document.getElementById('inpAccount').value.trim(),
    };
    if (currentLicense) {
      payload.key = currentLicense.key;
      await api('/api/license/update', { method: 'POST', body: JSON.stringify(payload) });
      toast('Лицензия обновлена');
    } else {
      payload.product_code = document.getElementById('inpProduct').value;
      payload.email = document.getElementById('inpEmail').value.trim();
      const r = await api('/api/license/create', { method: 'POST', body: JSON.stringify(payload) });
      toast('Лицензия создана: ' + r.license.key);
    }
    closeLicenseModal();
    loadLicenses();
  } catch (e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

async function activateLicense(key) {
  try {
    await api('/api/license/activate', { method: 'POST', body: JSON.stringify({ key }) });
    toast('Лицензия активирована');
    loadLicenses();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

async function deactivateLicense(key) {
  if (!confirm('Деактивировать лицензию ' + key + '?')) return;
  try {
    await api('/api/license/deactivate', { method: 'POST', body: JSON.stringify({ key }) });
    toast('Лицензия деактивирована');
    loadLicenses();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

function copyKey(key) {
  navigator.clipboard.writeText(key).then(() => toast('Скопировано: ' + key));
}

// ===== Продукты =====
async function ensureProducts() {
  if (allProducts.length) return;
  const d = await api('/api/admin/products');
  allProducts = d.products || [];
}

let currentProduct = null;

async function loadProducts() {
  try {
    await ensureProducts();
    const rows = allProducts.map(p => \`
      <tr>
        <td><span class="key">\${esc(p.code)}</span></td>
        <td>\${esc(p.name)}</td>
        <td>\${p.referral_url ? \`<a href="\${esc(p.referral_url)}" target="_blank" style="font-size:11px">\${esc(p.referral_url.slice(0, 40))}...</a>\` : '<span style="color:#aaa">—</span>'}</td>
        <td>\${p.is_active ? '<span class="badge ok">Вкл</span>' : '<span class="badge gray">Выкл</span>'}</td>
        <td><button class="btn btn-sm" onclick='openProductModal(\${JSON.stringify(p).replace(/'/g, "&#39;")})'>✏️ Редактировать</button></td>
      </tr>
    \`).join('');
    document.getElementById('productsTable').innerHTML = rows
      ? \`<table><thead><tr><th>Код</th><th>Название</th><th>Реф-ссылка</th><th>Статус</th><th></th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Продуктов нет</div>';
  } catch (e) { console.error(e); }
}

function openProductModal(p) {
  currentProduct = p;
  document.getElementById('prodCode').value = p.code;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodRef').value = p.referral_url || '';
  document.getElementById('productModal').classList.add('active');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('active');
  currentProduct = null;
}

async function saveProduct() {
  if (!currentProduct) return;
  try {
    await api('/api/admin/product/update', {
      method: 'POST',
      body: JSON.stringify({
        code: currentProduct.code,
        name: document.getElementById('prodName').value.trim(),
        referral_url: document.getElementById('prodRef').value.trim(),
      }),
    });
    toast('Продукт обновлён');
    closeProductModal();
    allProducts = [];
    await ensureProducts();
    loadProducts();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ===== Платежи =====
async function loadPayments() {
  try {
    const d = await api('/api/admin/payments');
    const rows = (d.payments || []).map(p => {
      const meta = p.raw_payload || {};
      const cls = p.status === 'paid' ? 'ok' : (p.status === 'pending' ? 'warn' : 'err');
      return \`
        <tr>
          <td><span class="badge \${cls}">\${esc(p.status)}</span></td>
          <td>\${esc(p.amount)} \${esc(p.currency)}</td>
          <td>\${esc(meta.email || '—')}</td>
          <td>\${esc(meta.product_code || '—')}</td>
          <td>\${esc(meta.plan_code || '—')}</td>
          <td>\${fmtDate(p.createdAt)}</td>
        </tr>
      \`;
    }).join('');
    document.getElementById('paymentsTable').innerHTML = rows
      ? \`<table><thead><tr><th>Статус</th><th>Сумма</th><th>Email</th><th>Продукт</th><th>Тариф</th><th>Создан</th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Платежей пока нет</div>';
  } catch (e) { console.error(e); }
}

// ===== Клиенты =====
async function loadUsers() {
  try {
    const d = await api('/api/admin/users');
    const rows = (d.users || []).map(u => \`
      <tr>
        <td>\${u.id}</td>
        <td>\${esc(u.email || '—')}</td>
        <td>\${esc(u.telegram_id || '—')}</td>
        <td>\${esc(u.country || '—')}</td>
        <td>\${(u.Licenses || []).length}</td>
        <td>\${fmtDate(u.createdAt)}</td>
      </tr>
    \`).join('');
    document.getElementById('usersTable').innerHTML = rows
      ? \`<table><thead><tr><th>ID</th><th>Email</th><th>Telegram</th><th>Страна</th><th>Лицензий</th><th>Создан</th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Клиентов пока нет</div>';
  } catch (e) { console.error(e); }
}

// ===== Сигналы =====
async function loadSignals() {
  try {
    const d = await api('/api/get_signals');
    const rows = (d.signals || []).slice(0, 200).map(s => {
      const cls = s.signal === 'buy' ? 'ok' : 'err';
      return \`
        <tr>
          <td>\${s.id}</td>
          <td>\${esc(s.asset)}</td>
          <td><span class="badge \${cls}">\${esc(s.signal)}</span></td>
          <td>\${esc(s.price || '—')}</td>
          <td>\${esc(s.source || '—')}</td>
          <td>\${fmtDate(s.createdAt)}</td>
        </tr>
      \`;
    }).join('');
    document.getElementById('signalsTable').innerHTML = rows
      ? \`<table><thead><tr><th>ID</th><th>Актив</th><th>Сигнал</th><th>Цена</th><th>Источник</th><th>Дата</th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Сигналов пока нет</div>';
  } catch (e) { console.error(e); }
}

// Автозагрузка
if (secret) {
  fetch('/api/admin/stats', { headers: { 'x-admin-secret': secret } })
    .then(r => r.ok ? loadCurrentTab() : null)
    .catch(() => {});
}
</script>
</body>
</html>`;

app.get('/admin', (req, res) => {
  res.send(ADMIN_HTML);
});

// ============ HEALTH ============

app.get('/', async (req, res) => {
  try {
    const total = await Signal.count();
    res.json({
      message: 'SOVA Signal Server is running! 🚀',
      db: 'connected',
      admin: 'https://sova-signal-server.onrender.com/admin',
      endpoints: {
        receive_signal: 'POST /api/receive_signal',
        get_signals: 'GET /api/get_signals',
        stats: 'GET /api/stats',
        license_check: 'POST /api/license/check',
        license_create: 'POST /api/license/create',
        license_list: 'GET /api/license/list',
        license_activate: 'POST /api/license/activate',
        license_deactivate: 'POST /api/license/deactivate',
        license_update: 'POST /api/license/update',
        license_unbind: 'POST /api/license/unbind',
        payment_create: 'POST /api/payment/create',
        payment_webhook: 'POST /api/payment/webhook',
        referral_track: 'POST /api/referral/track',
        admin_panel: 'GET /admin',
        admin_products: 'GET /api/admin/products',
        admin_product_update: 'POST /api/admin/product/update',
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
      console.log(`🦉 Admin panel: /admin`);
    });
  } catch (err) {
    console.error('❌ Не удалось подключиться к БД:', err.message);
    process.exit(1);
  }
})();