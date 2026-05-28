"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteItem = exports.Quote = void 0;
const Quote_1 = require("./Quote");
Object.defineProperty(exports, "Quote", { enumerable: true, get: function () { return Quote_1.Quote; } });
const QuoteItem_1 = require("./QuoteItem");
Object.defineProperty(exports, "QuoteItem", { enumerable: true, get: function () { return QuoteItem_1.QuoteItem; } });
Quote_1.Quote.hasMany(QuoteItem_1.QuoteItem, {
    foreignKey: "quoteId",
    as: "items",
    onDelete: "CASCADE",
});
QuoteItem_1.QuoteItem.belongsTo(Quote_1.Quote, {
    foreignKey: "quoteId",
    as: "quote",
});
