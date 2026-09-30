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
      payment = await Payment.findOne({
        where: { provider_payment_id: transaction.token },
      });
      if (payment) console.log('✅ Payment found by token');
    }

    if (!payment) {
      payment = await Payment.findOne({
        where: { provider_payment_id: transaction.uid },
      });
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

// ============ АДМИНКА: DATA ENDPOINTS ============

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
  .header .secret { display: flex; gap: 8px; }
  .header input { padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #2a2a3e; color: #fff; width: 280px; font-size: 13px; }
  .header button { padding: 8px 16px; border-radius: 6px; border: none; background: #ff9500; color: #fff; font-weight: 600; cursor: pointer; }
  .header button:hover { background: #e08600; }
  .tabs { background: #fff; padding: 0 24px; border-bottom: 1px solid #e0e0e0; display: flex; gap: 4px; }
  .tab { padding: 14px 20px; cursor: pointer; border-bottom: 3px solid transparent; font-weight: 500; color: #666; font-size: 14px; }
  .tab.active { color: #1a1a2e; border-bottom-color: #ff9500; }
  .tab:hover { color: #1a1a2e; }
  .content { padding: 24px; }
  .panel { display: none; }
  .panel.active { display: block; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #fff; padding: 20px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .card .label { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .card .value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
  table { width: 100%; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-collapse: collapse; }
  table th { text-align: left; padding: 12px 14px; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; background: #fafafa; border-bottom: 1px solid #eee; }
  table td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  table tr:last-child td { border-bottom: none; }
  table tr:hover td { background: #fafafa; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge.ok { background: #d4f5d4; color: #1a7a1a; }
  .badge.warn { background: #fff4d4; color: #8a6a00; }
  .badge.err { background: #ffd4d4; color: #8a1a1a; }
  .badge.gray { background: #eee; color: #666; }
  .empty { text-align: center; padding: 40px; color: #999; }
  .key { font-family: monospace; font-size: 12px; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
  .refresh { margin-bottom: 16px; }
  .refresh button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 13px; }
  .refresh button:hover { background: #f5f5f5; }
  .status-msg { font-size: 13px; color: #888; margin-left: 12px; }
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
    <div class="refresh"><button onclick="loadLicenses()">🔄 Обновить</button></div>
    <div id="licensesTable"></div>
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

<script>
let secret = localStorage.getItem('sova_secret') || '';
document.getElementById('secretInput').value = secret;

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
  if (currentTab === 'payments') loadPayments();
  if (currentTab === 'users') loadUsers();
  if (currentTab === 'signals') loadSignals();
}

async function api(path) {
  const r = await fetch(path, { headers: { 'x-admin-secret': secret } });
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

async function loadLicenses() {
  try {
    const d = await api('/api/license/list?limit=200');
    const rows = (d.licenses || []).map(l => \`
      <tr>
        <td><span class="key">\${esc(l.key)}</span></td>
        <td>\${esc(l.Product ? l.Product.name : '—')}</td>
        <td>\${esc(l.plan_code)}</td>
        <td>\${l.is_active ? '<span class="badge ok">Активна</span>' : '<span class="badge gray">Отключена</span>'}</td>
        <td>\${fmtDate(l.expires_at)}</td>
        <td>\${fmtDate(l.createdAt)}</td>
      </tr>
    \`).join('');
    document.getElementById('licensesTable').innerHTML = rows
      ? \`<table><thead><tr><th>Ключ</th><th>Продукт</th><th>Тариф</th><th>Статус</th><th>До</th><th>Создана</th></tr></thead><tbody>\${rows}</tbody></table>\`
      : '<div class="empty">Лицензий пока нет</div>';
  } catch (e) { console.error(e); }
}

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

// Автозагрузка, если secret уже сохранён
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
        license_deactivate: 'POST /api/license/deactivate',
        payment_create: 'POST /api/payment/create',
        payment_webhook: 'POST /api/payment/webhook',
        referral_track: 'POST /api/referral/track',
        admin_panel: 'GET /admin',
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
    console.error('Проверь DATABASE_URL в .env или в Environment на Render');
    process.exit(1);
  }
})();