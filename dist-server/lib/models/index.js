"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteItem = exports.Quote = exports.sequelize = void 0;
const sequelize_1 = __importDefault(require("../../db/sequelize"));
exports.sequelize = sequelize_1.default;
const associations_1 = require("./associations");
Object.defineProperty(exports, "Quote", { enumerable: true, get: function () { return associations_1.Quote; } });
Object.defineProperty(exports, "QuoteItem", { enumerable: true, get: function () { return associations_1.QuoteItem; } });
