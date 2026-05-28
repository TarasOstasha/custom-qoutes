import { Quote } from "./Quote";
import { QuoteItem } from "./QuoteItem";

Quote.hasMany(QuoteItem, {
  foreignKey: "quoteId",
  as: "items",
  onDelete: "CASCADE",
});

QuoteItem.belongsTo(Quote, {
  foreignKey: "quoteId",
  as: "quote",
});

export { Quote, QuoteItem };
