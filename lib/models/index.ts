const sequelize = require("../../server/db/sequelize");
const { Quote, QuoteItem } = require("../../server/models/associations");

export { sequelize, Quote, QuoteItem };
