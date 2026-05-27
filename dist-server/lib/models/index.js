"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteItem = exports.Quote = exports.sequelize = void 0;
const sequelize = require("../../server/db/sequelize");
exports.sequelize = sequelize;
const { Quote, QuoteItem } = require("../../server/models/associations");
exports.Quote = Quote;
exports.QuoteItem = QuoteItem;
