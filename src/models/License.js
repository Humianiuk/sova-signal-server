const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('License', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING, unique: true, allowNull: false },
  user_id: { type: DataTypes.INTEGER },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_code: { type: DataTypes.STRING, defaultValue: 'demo' },
  device_id: { type: DataTypes.STRING },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  expires_at: { type: DataTypes.DATE },
  last_check_at: { type: DataTypes.DATE },
}, { tableName: 'licenses', underscored: true });