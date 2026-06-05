"use strict";

const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db/sequelize");

class Quote extends Model {}

Quote.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quoteNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "quote_number",
    },
    quoteDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "quote_date",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "draft",
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_name",
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    shipping: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    shippingLabel: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_label",
    },
    shippingState: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_state",
    },
    shippingZip: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "shipping_zip",
    },
    shippingOptionsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "shipping_options_json",
    },
    selectedShippingValue: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "selected_shipping_value",
    },
    taxRate: {
      type: DataTypes.DECIMAL(5, 3),
      allowNull: true,
      field: "tax_rate",
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "tax_amount",
    },
    taxLabel: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_label",
    },
    taxDescription: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_description",
    },
    total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updated_at",
    },
  },
  {
    sequelize,
    modelName: "Quote",
    tableName: "quotes",
    underscored: true,
    timestamps: true,
  },
);

module.exports = Quote;
