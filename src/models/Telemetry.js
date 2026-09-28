const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Telemetry', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  product_id: { type: DataTypes.INTEGER },
  user_id: { type: DataTypes.INTEGER },
  event: { type: DataTypes.STRING, allowNull: false },
  version: { type: DataTypes.STRING },
  device_id: { type: DataTypes.STRING },
  payload: { type: DataTypes.JSONB },
}, { tableName: 'telemetry', underscored: true });