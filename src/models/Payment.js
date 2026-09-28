const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER },
  product_id: { type: DataTypes.INTEGER },
  plan_id: { type: DataTypes.INTEGER },
  amount: { type: DataTypes.DECIMAL(10, 2) },
  currency: { type: DataTypes.STRING, defaultValue: 'BYN' },
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  provider: { type: DataTypes.STRING, defaultValue: 'bepaid' },
  provider_payment_id: { type: DataTypes.STRING },
  raw_payload: { type: DataTypes.JSONB },
}, { tableName: 'payments', underscored: true });
