const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  started_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  expires_at: { type: DataTypes.DATE },
  auto_renew: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'subscriptions', underscored: true });