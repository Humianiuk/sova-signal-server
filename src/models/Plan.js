const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Plan', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, unique: true },
  name: { type: DataTypes.STRING },
  price: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  currency: { type: DataTypes.STRING, defaultValue: 'BYN' },
  duration_days: { type: DataTypes.INTEGER, defaultValue: 30 },
  is_demo: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'plans', underscored: true });