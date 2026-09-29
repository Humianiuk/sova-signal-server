require('dotenv').config();
const { sequelize, Plan } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    const plan = await Plan.findOne({ where: { code: 'pro' } });
    await plan.update({ price: 1 });
    console.log(`✅ Цена pro: ${plan.price} ${plan.currency}`);
    process.exit(0);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
})();