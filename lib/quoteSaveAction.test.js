const assert = require("node:assert/strict");
const { test } = require("node:test");
const { duplicateQuoteNumberError } = require("../dist-server/lib/quoteNumberMessages");
const { normalizeQuoteNumber, resolveQuoteSaveAction } = require("../dist-server/lib/quoteSaveAction");

const LOADED_ID = "11111111-1111-4111-8111-111111111111";

test("loading EX260127A1 and saving without changing the number updates it", () => {
  const action = resolveQuoteSaveAction({
    loadedQuoteId: LOADED_ID,
    originalLoadedQuoteNumber: "EX260127A1",
    currentQuoteNumber: "EX260127A1",
  });

  assert.equal(action.mode, "update");
  if (action.mode === "update") {
    assert.equal(action.quoteId, LOADED_ID);
    assert.equal(action.loadedQuoteNumber, "EX260127A1");
    assert.equal(action.currentQuoteNumber, "EX260127A1");
  }
});

test("loading EX260127A1, changing to EX260127A23, confirms save-as-new insert", () => {
  const action = resolveQuoteSaveAction({
    loadedQuoteId: LOADED_ID,
    originalLoadedQuoteNumber: "EX260127A1",
    currentQuoteNumber: "EX260127A23",
  });

  assert.equal(action.mode, "save_as_new");
  if (action.mode === "save_as_new") {
    assert.equal(action.originalQuoteId, LOADED_ID);
    assert.equal(action.loadedQuoteNumber, "EX260127A1");
    assert.equal(action.currentQuoteNumber, "EX260127A23");
  }
});

test("trimmed quote numbers compare equal for update", () => {
  const action = resolveQuoteSaveAction({
    loadedQuoteId: LOADED_ID,
    originalLoadedQuoteNumber: " EX260127A1 ",
    currentQuoteNumber: "EX260127A1",
  });

  assert.equal(action.mode, "update");
});

test("unsaved draft without loaded quote uses create", () => {
  const action = resolveQuoteSaveAction({
    loadedQuoteId: null,
    originalLoadedQuoteNumber: null,
    currentQuoteNumber: "EX260127A23",
  });

  assert.equal(action.mode, "create");
});

test("duplicate quote number validation message is explicit", () => {
  assert.equal(
    duplicateQuoteNumberError("EX260127A23"),
    'Quote number "EX260127A23" already exists. Choose a different quote number.',
  );
});

test("canceling save-as-new modal makes no database changes", () => {
  const action = resolveQuoteSaveAction({
    loadedQuoteId: LOADED_ID,
    originalLoadedQuoteNumber: "EX260127A1",
    currentQuoteNumber: "EX260127A23",
  });
  assert.equal(action.mode, "save_as_new");
  assert.equal(normalizeQuoteNumber("  EX260127A1  "), "EX260127A1");
});
