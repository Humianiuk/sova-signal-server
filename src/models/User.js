const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, unique: true, allowNull: true },
  telegram_id: { type: DataTypes.STRING, unique: true, allowNull: true },
  name: { type: DataTypes.STRING },
  country: { type: DataTypes.STRING, defaultValue: 'BY' },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  is_admin: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'users', underscored: true });