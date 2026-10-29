require('dotenv').config();
const { sequelize, Product, Plan } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('✅ БД подключена и синхронизирована');

    // 1. Создаем главный продукт
    const [product, created] = await Product.findOrCreate({
      where: { code: 'intradebar' },
      defaults: {
        name: 'SOVA TRADE BOT InTradeBar',
        private_price_usd: 30.40, 
        price_usd: 38.00,
        is_active: true,
        short_description: 'Автоматическая торговля на InTradeBar',
        referral_url: 'https://intrade36.bar/216136',
        download_url: 'https://sovabot.com'
      }
    });
    console.log(created ? '✅ Продукт создан' : 'ℹ️ Продукт уже существует');

    // 2. Создаем тарифы
    await Plan.findOrCreate({ 
      where: { code: 'demo' }, 
      defaults: { name: 'Demo', price: 0, duration_days: 7, currency: 'BYN' } 
    });
    
    await Plan.findOrCreate({ 
      where: { code: 'pro' }, 
      defaults: { name: 'Pro', price: 92, duration_days: 30, currency: 'BYN' } 
    });

    console.log('✅ Тарифы (Demo, Pro) успешно добавлены!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();