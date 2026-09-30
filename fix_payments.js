require('dotenv').config();
const { sequelize, Payment } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ БД подключена');

    // 1. Найти платёж на 10 BYN от 11:44 (lecha12111@gmail.com)
    const payment10 = await Payment.findOne({
      where: {
        status: 'pending',
        amount: 10,
      },
      order: [['createdAt', 'DESC']],
    });

    if (payment10) {
      await payment10.update({ status: 'paid' });
      console.log(`✅ Платёж ${payment10.id} (10 BYN) помечен как paid`);
    } else {
      console.log('⚠️ Платёж на 10 BYN не найден');
    }

    // 2. Все остальные pending — пометить как expired
    const expiredCount = await Payment.update(
      { status: 'expired' },
      { where: { status: 'pending' } }
    );
    console.log(`✅ Остальные pending помечены как expired: ${expiredCount[0]}`);

    // 3. Показать итог
    const all = await Payment.findAll({ order: [['createdAt', 'DESC']] });
    console.log('\n📋 Итоговое состояние:');
    all.forEach(p => {
      console.log(`  #${p.id} | ${p.amount} ${p.currency} | ${p.status} | ${p.createdAt.toISOString().slice(0, 16)}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();