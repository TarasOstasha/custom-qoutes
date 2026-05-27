"use strict";

const Quote = require("./Quote");
const QuoteItem = require("./QuoteItem");

Quote.hasMany(QuoteItem, {
  foreignKey: "quoteId",
  as: "items",
  onDelete: "CASCADE",
});

QuoteItem.belongsTo(Quote, {
  foreignKey: "quoteId",
  as: "quote",
});

module.exports = { Quote, QuoteItem };
