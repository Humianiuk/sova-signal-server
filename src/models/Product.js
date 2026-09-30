const { DataTypes } = require('sequelize');
const sequelize = require('../db');

module.exports = sequelize.define('Product', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  // ===== Основное =====
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  version: { type: DataTypes.STRING, defaultValue: '1.0.0' },
  tag: { type: DataTypes.STRING },              // "Крипта", "Трейдинг"
  cat: { type: DataTypes.STRING },              // trade | crypto | leadgen | tools | service
  icon: { type: DataTypes.STRING },             // fa-bitcoin-sign (Font Awesome)
  platform: { type: DataTypes.STRING },         // Windows 10/11
  product_type: { type: DataTypes.STRING, defaultValue: 'product' }, // product | service

  // ===== Описания =====
  short_description: { type: DataTypes.STRING(500) },
  description: { type: DataTypes.TEXT },

  // ===== Видео / Превью =====
  video_url: { type: DataTypes.STRING },        // основное видео для карточки
  poster_url: { type: DataTypes.STRING },       // превью
  duration: { type: DataTypes.STRING },         // "3:45"

  // ===== B2C (частным) =====
  private_desc: { type: DataTypes.TEXT },
  private_features: { type: DataTypes.JSONB, defaultValue: [] },
  private_price_usd: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  private_prefix: { type: DataTypes.STRING },   // "от "
  private_suffix: { type: DataTypes.STRING },   // " / мес"
  private_note: { type: DataTypes.STRING },     // "14 дней бесплатно"

  // ===== B2B (бизнесу) =====
  business_desc: { type: DataTypes.TEXT },
  business_features: { type: DataTypes.JSONB, defaultValue: [] },
  business_price_usd: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  business_prefix: { type: DataTypes.STRING },
  business_suffix: { type: DataTypes.STRING },
  business_note: { type: DataTypes.STRING },

  // ===== Для услуг =====
  service_desc: { type: DataTypes.TEXT },
  packages: { type: DataTypes.JSONB, defaultValue: [] },

  // ===== Ссылки =====
  price_usd: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  referral_url: { type: DataTypes.STRING },
  social_url: { type: DataTypes.STRING },
  download_url: { type: DataTypes.STRING },
  faq_url: { type: DataTypes.STRING },

  // ===== Инструкции (видео + текст) =====
  video_preview_url: { type: DataTypes.STRING },
  video_payment_url: { type: DataTypes.STRING },
  video_install_url: { type: DataTypes.STRING },
  video_usage_url: { type: DataTypes.STRING },
  install_text: { type: DataTypes.TEXT },
  usage_text: { type: DataTypes.TEXT },
  payment_text: { type: DataTypes.TEXT },

  // ===== Альтернативные платежи =====
  payment_crypto: { type: DataTypes.TEXT },
  payment_yoomoney: { type: DataTypes.STRING },
  payment_sber: { type: DataTypes.STRING },

  // ===== Статус =====
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'products', underscored: true });