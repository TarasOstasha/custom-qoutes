"use strict";

const Sequelize = require("sequelize");
const sequelize = require("../server/db/sequelize");
const { Quote, QuoteItem } = require("../server/models/associations");

module.exports = {
  sequelize,
  Sequelize,
  Quote,
  QuoteItem,
};
