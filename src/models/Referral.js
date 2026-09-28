const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Referral', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER },
  partner: { type: DataTypes.STRING, allowNull: false },
  program: { type: DataTypes.STRING },
  click_id: { type: DataTypes.STRING },
  utm_source: { type: DataTypes.STRING },
  utm_campaign: { type: DataTypes.STRING },
  registered: { type: DataTypes.BOOLEAN, defaultValue: false },
  deposited: { type: DataTypes.BOOLEAN, defaultValue: false },
  payout_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
}, { tableName: 'referrals', underscored: true });