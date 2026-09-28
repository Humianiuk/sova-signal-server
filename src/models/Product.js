const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Product', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  version: { type: DataTypes.STRING, defaultValue: '1.0.0' },
  description: { type: DataTypes.TEXT },
  referral_url: { type: DataTypes.STRING },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'products', underscored: true });