const sequelize = require('../db');
const User = require('./User');
const Product = require('./Product');
const Plan = require('./Plan');
const Subscription = require('./Subscription');
const License = require('./License');
const Payment = require('./Payment');
const Referral = require('./Referral');
const Signal = require('./Signal');
const Telemetry = require('./Telemetry');

User.hasMany(Subscription, { foreignKey: 'user_id' });
Subscription.belongsTo(User, { foreignKey: 'user_id' });

Product.hasMany(Subscription, { foreignKey: 'product_id' });
Subscription.belongsTo(Product, { foreignKey: 'product_id' });

Plan.hasMany(Subscription, { foreignKey: 'plan_id' });
Subscription.belongsTo(Plan, { foreignKey: 'plan_id' });

User.hasMany(License, { foreignKey: 'user_id' });
License.belongsTo(User, { foreignKey: 'user_id' });

Product.hasMany(License, { foreignKey: 'product_id' });
License.belongsTo(Product, { foreignKey: 'product_id' });

User.hasMany(Payment, { foreignKey: 'user_id' });
Payment.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Referral, { foreignKey: 'user_id' });
Referral.belongsTo(User, { foreignKey: 'user_id' });

Product.hasMany(Signal, { foreignKey: 'product_id' });
Signal.belongsTo(Product, { foreignKey: 'product_id' });

Product.hasMany(Telemetry, { foreignKey: 'product_id' });
Telemetry.belongsTo(Product, { foreignKey: 'product_id' });

module.exports = {
  sequelize,
  User,
  Product,
  Plan,
  Subscription,
  License,
  Payment,
  Referral,
  Signal,
  Telemetry,
};