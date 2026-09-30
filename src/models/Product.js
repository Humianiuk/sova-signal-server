const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Product', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  version: { type: DataTypes.STRING, defaultValue: '1.0.0' },
  category: { type: DataTypes.STRING },              // bot / api / parser / advisor
  platform: { type: DataTypes.STRING },              // Windows / Mac / Linux / Web
  short_description: { type: DataTypes.STRING(500) },// для карточки
  description: { type: DataTypes.TEXT },             // полное описание
  price_usd: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  referral_url: { type: DataTypes.STRING },

  // Видео
  video_preview_url: { type: DataTypes.STRING },
  video_payment_url: { type: DataTypes.STRING },
  video_install_url: { type: DataTypes.STRING },
  video_usage_url: { type: DataTypes.STRING },

  // Ссылки
  social_url: { type: DataTypes.STRING },
  download_url: { type: DataTypes.STRING },
  faq_url: { type: DataTypes.STRING },

  // Альтернативные способы оплаты
  payment_crypto: { type: DataTypes.TEXT },
  payment_yoomoney: { type: DataTypes.STRING },
  payment_sber: { type: DataTypes.STRING },

  // Инструкции
  install_text: { type: DataTypes.TEXT },
  usage_text: { type: DataTypes.TEXT },
  payment_text: { type: DataTypes.TEXT },

  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'products', underscored: true });