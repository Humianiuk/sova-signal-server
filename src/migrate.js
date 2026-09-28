require('dotenv').config();
const { sequelize } = require('./models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Подключение к БД установлено');

    await sequelize.sync({ alter: true });
    console.log('✅ Таблицы созданы/обновлены');

    const Plan = require('./models/Plan');
    const plans = [
      { code: 'demo', name: 'Demo', price: 0, duration_days: 7, is_demo: true },
      { code: 'pro', name: 'Pro', price: 29, duration_days: 30 },
      { code: 'vip', name: 'VIP', price: 79, duration_days: 30 },
    ];
    for (const p of plans) {
      await Plan.findOrCreate({ where: { code: p.code }, defaults: p });
    }
    console.log('✅ Тарифы созданы');

    const Product = require('./models/Product');
    const products = [
      { code: 'intradebar_bot', name: 'SOVA TRADE BOT InTradeBar' },
      { code: 'pocketoption_bot', name: 'SOVA TRADE BOT PocketOption' },
      { code: 'luckyjet_bot', name: 'LUCKY JET BOT 3.0' },
      { code: 'intradebar_api', name: 'API InTradeBar' },
      { code: 'pocketoption_api', name: 'API PocketOption' },
      { code: 'bybit_api', name: 'API ByBit' },
      { code: 'ftm_advisor', name: 'SOVA Советник FTM BROKER' },
      { code: 'free2ex_api', name: 'API Free2EX' },
      { code: 'fonbet_bot', name: 'SOVA SPORT STAVKA' },
      { code: 'parser_links', name: 'Universal Parser Links' },
      { code: 'parser_contacts', name: 'Universal Parser Contacts' },
      { code: 'parser_risk', name: 'Universal Parser Risk' },
      { code: 'parser_sender', name: 'Universal Parser Sender' },
    ];
    for (const p of products) {
      await Product.findOrCreate({ where: { code: p.code }, defaults: p });
    }
    console.log('✅ Продукты созданы');

    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка миграции:', err);
    process.exit(1);
  }
})();