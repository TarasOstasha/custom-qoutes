"use strict";

const { Model, DataTypes } = require("sequelize");
const sequelize = require("../db/sequelize");

class QuoteItem extends Model {}

QuoteItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quoteId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "quote_id",
    },
    productCode: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "product_code",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    optionalDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "optional_description",
    },
    qty: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image_url",
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "unit_price",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    optionsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "options_json",
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
    modelName: "QuoteItem",
    tableName: "quote_items",
    underscored: true,
    timestamps: true,
  },
);

module.exports = QuoteItem;
