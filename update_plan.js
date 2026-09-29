require('dotenv').config();
const { sequelize, Plan } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ БД подключена');

    const allPlans = await Plan.findAll();
    console.log('\n📋 Текущие тарифы:');
    allPlans.forEach(p => {
      console.log(`  ${p.code}: ${p.price} ${p.currency} / ${p.duration_days} дн.`);
    });

    // Меняем цену плана pro на 10 BYN
    const plan = await Plan.findOne({ where: { code: 'pro' } });
    if (!plan) {
      console.log('❌ План pro не найден');
      process.exit(1);
    }

    const oldPrice = plan.price;
    await plan.update({ price: 10 });
    console.log(`\n✅ Цена pro изменена: ${oldPrice} → 10 ${plan.currency}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();