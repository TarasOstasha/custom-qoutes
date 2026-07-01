"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteItem = void 0;
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../sequelize");
class QuoteItem extends sequelize_1.Model {
}
exports.QuoteItem = QuoteItem;
QuoteItem.init({
    id: {
        type: sequelize_1.DataTypes.UUID,
        defaultValue: sequelize_1.DataTypes.UUIDV4,
        primaryKey: true,
    },
    quoteId: {
        type: sequelize_1.DataTypes.UUID,
        allowNull: false,
        field: "quote_id",
    },
    productCode: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        field: "product_code",
    },
    description: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
    },
    optionalDescription: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
        field: "optional_description",
    },
    qty: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: true,
    },
    unitPrice: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "unit_price",
    },
    amount: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
    },
    optionsJson: {
        type: sequelize_1.DataTypes.JSONB,
        allowNull: true,
        field: "options_json",
    },
    createdAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
        field: "created_at",
    },
    updatedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
        field: "updated_at",
    },
}, {
    sequelize: (0, sequelize_2.getActiveSequelize)(),
    modelName: "QuoteItem",
    tableName: "quote_items",
    underscored: true,
    timestamps: true,
});
