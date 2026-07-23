const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildStableCartLineId,
  collectOptionsForCartLine,
  deserializeQuoteItemFromDb,
  findCartRowForQuoteItem,
  isImportableVolusionCartRow,
  mapCartRowsToQuoteItems,
  removeQuoteLineById,
  serializeQuoteItemsForDb,
  updateQuoteLineQty,
} = require("../dist-server/lib/cartImport");

const NOW = "2026-07-23T12:00:00.000Z";
const QUOTE_ID = "q_test_1";

function nv902CartRows() {
  return [
    {
      cartLineId: "volusion_101",
      productCode: "nv902",
      name: "NV902 Product",
      qty: 1,
      unitPrice: 1224,
      lineTotal: 1224,
      options: ["Color: Red", "Size: Large"],
    },
    {
      cartLineId: "volusion_102",
      productCode: "nv902",
      name: "NV902 Product",
      qty: 1,
      unitPrice: 1370,
      lineTotal: 1370,
      options: ["Color: Blue", "Size: Medium"],
    },
    {
      cartLineId: "volusion_103",
      productCode: "nv902",
      name: "NV902 Product",
      qty: 1,
      unitPrice: 1511,
      lineTotal: 1511,
      options: ["Color: Green", "Size: Small"],
    },
  ];
}

test("same product code imports as three separate quote lines with distinct prices", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
    idPrefix: "qi_scrape",
  });

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.unitPrice),
    [1224, 1370, 1511],
  );
  assert.deepEqual(
    items.map((item) => item.sku),
    ["nv902", "nv902", "nv902"],
  );
  assert.deepEqual(
    items.map((item) => item.importLineId),
    ["volusion_101", "volusion_102", "volusion_103"],
  );
});

test("each imported line exposes its own cart options without pre-selecting them", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  assert.equal(items[0].chosenOptions, null);
  assert.equal(items[1].chosenOptions, null);
  assert.equal(items[2].chosenOptions, null);

  const cartRows = nv902CartRows();
  assert.deepEqual(collectOptionsForCartLine(items[1], cartRows), ["Color: Blue", "Size: Medium"]);
  assert.equal(findCartRowForQuoteItem(items[0], cartRows)?.unitPrice, 1224);
});

test("removing the middle imported row leaves the first and third rows unchanged", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  const middleId = items[1].id;
  const remaining = removeQuoteLineById(items, middleId);

  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].unitPrice, 1224);
  assert.equal(remaining[1].unitPrice, 1511);
  assert.equal(remaining[0].importLineId, "volusion_101");
  assert.equal(remaining[1].importLineId, "volusion_103");
});

test("updating quantity on one row does not modify the others", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  const updated = updateQuoteLineQty(items, items[1].id, 4);

  assert.equal(updated[0].qty, 1);
  assert.equal(updated[1].qty, 4);
  assert.equal(updated[2].qty, 1);
  assert.equal(updated[0].unitPrice, 1224);
  assert.equal(updated[2].unitPrice, 1511);
});

test("save and reopen preserves all duplicate-product rows", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  const serialized = serializeQuoteItemsForDb(items);
  assert.equal(serialized.length, 3);

  const restored = serialized.map((row, index) =>
    deserializeQuoteItemFromDb(
      {
        id: items[index].id,
        product_code: row.product_code,
        description: row.description,
        optional_description: row.optional_description,
        qty: row.qty,
        unit_price: row.unit_price,
        amount: row.amount,
        options_json: row.options_json,
      },
      index,
      QUOTE_ID,
      NOW,
    ),
  );

  assert.equal(restored.length, 3);
  assert.deepEqual(
    restored.map((item) => item.unitPrice),
    [1224, 1370, 1511],
  );
  assert.deepEqual(
    restored.map((item) => item.importLineId),
    ["volusion_101", "volusion_102", "volusion_103"],
  );
  assert.equal(restored[2].chosenOptions, null);
});

test("products with different codes continue to import normally", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: [
      ...nv902CartRows(),
      {
        cartLineId: "volusion_200",
        productCode: "abc100",
        name: "ABC Product",
        qty: 2,
        unitPrice: 99.5,
        lineTotal: 199,
        options: ["Finish: Matte"],
      },
    ],
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  assert.equal(items.length, 4);
  assert.equal(items[3].sku, "abc100");
  assert.equal(items[3].qty, 2);
  assert.equal(items[3].unitPrice, 99.5);
});

test("stable fallback cart line ids differ when options and prices differ", () => {
  const rowA = {
    productCode: "nv902",
    name: "NV902 Product",
    qty: 1,
    unitPrice: 1224,
    lineTotal: 1224,
    options: ["Color: Red"],
  };
  const rowB = {
    productCode: "nv902",
    name: "NV902 Product",
    qty: 1,
    unitPrice: 1370,
    lineTotal: 1370,
    options: ["Color: Blue"],
  };

  const idA = buildStableCartLineId(rowA, 0);
  const idB = buildStableCartLineId(rowB, 1);

  assert.notEqual(idA, idB);
});

test("option sub-rows without qty or price are not importable cart lines", () => {
  assert.equal(isImportableVolusionCartRow({ unitPrice: 0, lineTotal: 0 }), false);
  assert.equal(isImportableVolusionCartRow({ unitPrice: 1224, lineTotal: 1224 }), true);
  assert.equal(isImportableVolusionCartRow({ unitPrice: 0, lineTotal: 99 }), true);
});

test("findCartRowForQuoteItem matches by sku and unit price when importLineId differs", () => {
  const cartRows = nv902CartRows();
  const item = {
    importLineId: "stale_or_missing_id",
    sku: "nv902",
    sourceProductId: "nv902",
    unitPrice: 1370,
    chosenOptions: null,
  };
  const matched = findCartRowForQuoteItem(item, cartRows);
  assert.equal(matched?.cartLineId, "volusion_102");
  assert.deepEqual(collectOptionsForCartLine(item, cartRows), ["Color: Blue", "Size: Medium"]);
});

test("findCartRowForQuoteItem matches stored cartLineId without index ambiguity", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: nv902CartRows(),
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });
  const cartRows = nv902CartRows();
  assert.equal(findCartRowForQuoteItem(items[2], cartRows)?.cartLineId, "volusion_103");
  assert.deepEqual(collectOptionsForCartLine(items[2], cartRows), ["Color: Green", "Size: Small"]);
});

test("scrape payload with priced rows and zero-price option sub-rows imports only priced lines", () => {
  const scrapedRows = [
    {
      cartLineId: "volusion_1",
      productCode: "mk90720",
      name: "MK90720",
      qty: 1,
      unitPrice: 1830,
      lineTotal: 1830,
    },
    {
      cartLineId: "volusion_1_options",
      productCode: "mk90720",
      name: "MK90720",
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      options: ["Finish: Gloss"],
    },
    {
      cartLineId: "volusion_2",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 1224,
      lineTotal: 1224,
      options: ["Color: Red"],
    },
    {
      cartLineId: "volusion_2_options",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      options: ["Color: Red"],
    },
    {
      cartLineId: "volusion_3",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 1370,
      lineTotal: 1370,
      options: ["Color: Blue"],
    },
    {
      cartLineId: "volusion_3_options",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      options: ["Color: Blue"],
    },
    {
      cartLineId: "volusion_4",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 1511,
      lineTotal: 1511,
      options: ["Color: Green"],
    },
    {
      cartLineId: "volusion_4_options",
      productCode: "nv902",
      name: "NV902",
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      options: ["Color: Green"],
    },
  ];

  const importable = scrapedRows.filter((row) =>
    isImportableVolusionCartRow({
      unitPrice: row.unitPrice,
      lineTotal: row.lineTotal,
    }),
  );

  const items = mapCartRowsToQuoteItems({
    cartItems: importable,
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });

  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => item.unitPrice),
    [1830, 1224, 1370, 1511],
  );
});
