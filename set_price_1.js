require('dotenv').config();
const { sequelize, Plan } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ БД подключена');

    const plan = await Plan.findOne({ where: { code: 'pro' } });
    if (!plan) {
      console.log('❌ План pro не найден');
      process.exit(1);
    }

    const oldPrice = plan.price;
    await plan.update({ price: 1 });
    console.log(`✅ Цена pro: ${oldPrice} → 1 ${plan.currency}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();