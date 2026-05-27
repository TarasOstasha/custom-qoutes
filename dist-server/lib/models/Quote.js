"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Quote = void 0;
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../sequelize");
class Quote extends sequelize_1.Model {
}
exports.Quote = Quote;
Quote.init({
    id: {
        type: sequelize_1.DataTypes.UUID,
        defaultValue: sequelize_1.DataTypes.UUIDV4,
        primaryKey: true,
    },
    quoteNumber: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: "quote_number",
    },
    quoteDate: {
        type: sequelize_1.DataTypes.DATEONLY,
        allowNull: true,
        field: "quote_date",
    },
    status: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        defaultValue: "draft",
    },
    version: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    customerName: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        field: "customer_name",
    },
    company: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
    },
    email: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
    },
    phone: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
    },
    address: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
    },
    notes: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
    },
    subtotal: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
    },
    shipping: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
    },
    taxRate: {
        type: sequelize_1.DataTypes.DECIMAL(5, 3),
        allowNull: true,
        field: "tax_rate",
    },
    taxAmount: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "tax_amount",
    },
    total: {
        type: sequelize_1.DataTypes.DECIMAL(10, 2),
        allowNull: true,
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
    sequelize: sequelize_2.sequelize,
    modelName: "Quote",
    tableName: "quotes",
    underscored: true,
    timestamps: true,
});
