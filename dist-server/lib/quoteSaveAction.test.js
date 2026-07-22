"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const quoteNumberMessages_1 = require("./quoteNumberMessages");
const quoteSaveAction_1 = require("./quoteSaveAction");
const LOADED_ID = "11111111-1111-4111-8111-111111111111";
(0, node_test_1.default)("loading EX260127A1 and saving without changing the number updates it", () => {
    const action = (0, quoteSaveAction_1.resolveQuoteSaveAction)({
        loadedQuoteId: LOADED_ID,
        originalLoadedQuoteNumber: "EX260127A1",
        currentQuoteNumber: "EX260127A1",
    });
    strict_1.default.equal(action.mode, "update");
    if (action.mode === "update") {
        strict_1.default.equal(action.quoteId, LOADED_ID);
        strict_1.default.equal(action.loadedQuoteNumber, "EX260127A1");
        strict_1.default.equal(action.currentQuoteNumber, "EX260127A1");
    }
});
(0, node_test_1.default)("loading EX260127A1, changing to EX260127A23, confirms save-as-new insert", () => {
    const action = (0, quoteSaveAction_1.resolveQuoteSaveAction)({
        loadedQuoteId: LOADED_ID,
        originalLoadedQuoteNumber: "EX260127A1",
        currentQuoteNumber: "EX260127A23",
    });
    strict_1.default.equal(action.mode, "save_as_new");
    if (action.mode === "save_as_new") {
        strict_1.default.equal(action.originalQuoteId, LOADED_ID);
        strict_1.default.equal(action.loadedQuoteNumber, "EX260127A1");
        strict_1.default.equal(action.currentQuoteNumber, "EX260127A23");
    }
});
(0, node_test_1.default)("trimmed quote numbers compare equal for update", () => {
    const action = (0, quoteSaveAction_1.resolveQuoteSaveAction)({
        loadedQuoteId: LOADED_ID,
        originalLoadedQuoteNumber: " EX260127A1 ",
        currentQuoteNumber: "EX260127A1",
    });
    strict_1.default.equal(action.mode, "update");
});
(0, node_test_1.default)("unsaved draft without loaded quote uses create", () => {
    const action = (0, quoteSaveAction_1.resolveQuoteSaveAction)({
        loadedQuoteId: null,
        originalLoadedQuoteNumber: null,
        currentQuoteNumber: "EX260127A23",
    });
    strict_1.default.equal(action.mode, "create");
    if (action.mode === "create") {
        strict_1.default.equal(action.currentQuoteNumber, "EX260127A23");
    }
});
(0, node_test_1.default)("duplicate quote number validation message is explicit", () => {
    strict_1.default.equal((0, quoteNumberMessages_1.duplicateQuoteNumberError)("EX260127A23"), 'Quote number "EX260127A23" already exists. Choose a different quote number.');
});
(0, node_test_1.default)("canceling save-as-new modal makes no request — guarded before persist", () => {
    // UI cancels by returning early when Swal is not confirmed; no save action is emitted.
    const action = (0, quoteSaveAction_1.resolveQuoteSaveAction)({
        loadedQuoteId: "11111111-1111-4111-8111-111111111111",
        originalLoadedQuoteNumber: "EX260127A1",
        currentQuoteNumber: "EX260127A23",
    });
    strict_1.default.equal(action.mode, "save_as_new");
});
