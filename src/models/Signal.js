const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Signal', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  product_id: { type: DataTypes.INTEGER },
  asset: { type: DataTypes.STRING, allowNull: false },
  signal: { type: DataTypes.STRING, allowNull: false },
  source: { type: DataTypes.STRING, defaultValue: 'MT4 Advisor' },
  price: { type: DataTypes.DECIMAL(20, 8) },
  payload: { type: DataTypes.JSONB },
}, { tableName: 'signals', underscored: true });