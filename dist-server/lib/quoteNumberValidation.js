"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.duplicateQuoteNumberError = void 0;
exports.findQuoteByNumber = findQuoteByNumber;
const sequelize_1 = require("sequelize");
const models_1 = require("./models");
var quoteNumberMessages_1 = require("./quoteNumberMessages");
Object.defineProperty(exports, "duplicateQuoteNumberError", { enumerable: true, get: function () { return quoteNumberMessages_1.duplicateQuoteNumberError; } });
async function findQuoteByNumber(quoteNumber, options) {
    const normalized = quoteNumber.trim();
    if (!normalized)
        return null;
    return models_1.Quote.findOne({
        where: {
            quoteNumber: normalized,
            ...(options?.excludeQuoteId ? { id: { [sequelize_1.Op.ne]: options.excludeQuoteId } } : {}),
        },
        ...(options?.transaction ? { transaction: options.transaction } : {}),
    });
}
