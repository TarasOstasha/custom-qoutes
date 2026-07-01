"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteItem = exports.Quote = exports.getActiveSequelize = void 0;
const sequelize_1 = require("../../db/sequelize");
Object.defineProperty(exports, "getActiveSequelize", { enumerable: true, get: function () { return sequelize_1.getActiveSequelize; } });
const associations_1 = require("./associations");
Object.defineProperty(exports, "Quote", { enumerable: true, get: function () { return associations_1.Quote; } });
Object.defineProperty(exports, "QuoteItem", { enumerable: true, get: function () { return associations_1.QuoteItem; } });
