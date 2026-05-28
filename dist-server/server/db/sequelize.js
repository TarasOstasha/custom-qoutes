"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports.sequelize = void 0;
var sequelize_1 = require("../../db/sequelize");
Object.defineProperty(exports, "sequelize", { enumerable: true, get: function () { return sequelize_1.sequelize; } });
var sequelize_2 = require("../../db/sequelize");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(sequelize_2).default; } });
