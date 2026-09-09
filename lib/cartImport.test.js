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
const { parseVolusionCartItemOptionsHtml, extractVolusionCartItemDetailsPath } = require("../dist-server/lib/parseVolusionCartItemOptions");

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

test("get options falls back to same sku when exact cart line has no options", () => {
  const cartRows = [
    {
      cartLineId: "volusion_na1000",
      productCode: "na1000",
      name: "5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)",
      qty: 1,
      unitPrice: 853,
      lineTotal: 853,
    },
    {
      cartLineId: "volusion_na1000_opts",
      productCode: "na1000",
      name: "5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)",
      qty: 1,
      unitPrice: 0,
      lineTotal: 0,
      options: [
        "Inside Fabric Color: White Inside Fabric",
        "NA Options: 1 x Xhibit Case (na20600)",
        "Add Hanging Rotating Motor: No Rotating Motor",
      ],
    },
  ];
  const item = {
    importLineId: "volusion_na1000",
    sku: "na1000",
    sourceProductId: "na1000",
    name: "5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)",
    unitPrice: 853,
    chosenOptions: null,
  };
  assert.deepEqual(collectOptionsForCartLine(item, cartRows), [
    "Inside Fabric Color: White Inside Fabric",
    "NA Options: 1 x Xhibit Case (na20600)",
    "Add Hanging Rotating Motor: No Rotating Motor",
  ]);
});

test("get options falls back to same product name when sku prices differ", () => {
  const cartRows = [
    {
      cartLineId: "volusion_na1001",
      productCode: "na1001",
      name: "5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)",
      qty: 1,
      unitPrice: 297,
      lineTotal: 297,
      options: ["Inside Fabric Color: White Inside Fabric"],
    },
  ];
  const item = {
    importLineId: null,
    sku: "na1001",
    sourceProductId: "na1001",
    name: "5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)",
    unitPrice: 320,
    chosenOptions: null,
  };
  assert.deepEqual(collectOptionsForCartLine(item, cartRows), ["Inside Fabric Color: White Inside Fabric"]);
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

test("parses Your options for popup html into labeled option rows", () => {
  const html = `
    <html><body>
      <h1>Your options for: 5ft x 24in Round Wave Tube Hanging Banner (Single-Sided)</h1>
      <ul>
        <li>Inside Fabric Color: White Inside Fabric</li>
        <li>NA Options: 1 x Xhibit Case (na20600)</li>
        <li>Add Hanging Rotating Motor: No Rotating Motor</li>
      </ul>
    </body></html>
  `;
  assert.deepEqual(parseVolusionCartItemOptionsHtml(html), [
    "Inside Fabric Color: White Inside Fabric",
    "NA Options: 1 x Xhibit Case (na20600)",
    "Add Hanging Rotating Motor: No Rotating Motor",
  ]);
});

test("options popup path accepts Help_CartItemDetails.php after Volusion asp-to-php move", () => {
  const phpHref = "javascript:OpenNewWindow('Help_CartItemDetails.php?CartID=abc&ID=12');";
  const aspHref = "javascript:OpenNewWindow('Help_CartItemDetails.asp?CartID=abc&ID=12');";
  assert.equal(
    extractVolusionCartItemDetailsPath(phpHref),
    "Help_CartItemDetails.php?CartID=abc&ID=12",
  );
  assert.equal(
    extractVolusionCartItemDetailsPath(aspHref),
    "Help_CartItemDetails.asp?CartID=abc&ID=12",
  );
  assert.equal(extractVolusionCartItemDetailsPath("ProductDetails.php?ProductCode=na1000"), "");
});

test("void options link falls back to Help_CartItemDetails.php?CartID=line", () => {
  assert.equal(
    extractVolusionCartItemDetailsPath("javascript:void(0); [+] View list of options", "1"),
    "Help_CartItemDetails.php?CartID=1",
  );
});

test("parses modal li options without space after colon", () => {
  const html = `
    <div id="vol-pop-up-to-modal">
      <h4>Your options for: Banner</h4>
      <ul class="vol-chosen-options-list">
        <li>Inside Fabric Color:White Inside Fabric</li>
        <li>NA Options:Carry Bag Only (No Hard Case)</li>
        <li>Add Hanging Rotating Motor:No Rotating Motor</li>
      </ul>
    </div>
  `;
  assert.deepEqual(parseVolusionCartItemOptionsHtml(html), [
    "Inside Fabric Color: White Inside Fabric",
    "NA Options: Carry Bag Only (No Hard Case)",
    "Add Hanging Rotating Motor: No Rotating Motor",
  ]);
});

test("imported cart rows keep availableOptions for Get Options checkboxes", () => {
  const items = mapCartRowsToQuoteItems({
    cartItems: [
      {
        cartLineId: "volusion_1",
        productCode: "na1000",
        name: "Banner",
        qty: 1,
        unitPrice: 853,
        lineTotal: 853,
        options: [
          "Inside Fabric Color: White Inside Fabric",
          "NA Options: 1 x Xhibit Case (na20600)",
        ],
      },
    ],
    quoteId: QUOTE_ID,
    startSortOrder: 0,
    now: NOW,
  });
  assert.deepEqual(items[0].availableOptions, [
    "Inside Fabric Color: White Inside Fabric",
    "NA Options: 1 x Xhibit Case (na20600)",
  ]);
  assert.deepEqual(collectOptionsForCartLine(items[0], []), items[0].availableOptions);
});

test("quote discount amount survives save and reopen", () => {
  const [row] = serializeQuoteItemsForDb([
    {
      sku: null,
      sourceProductId: null,
      name: "Discount",
      description: "Quote discount",
      imageUrl: null,
      extraImageUrls: null,
      qty: 1,
      unitPrice: 0,
      lineTotal: -50,
      chosenOptions: null,
      availableOptions: null,
      importLineId: null,
      discountType: "amount",
      discountValue: 50,
      discountScope: "quote",
    },
  ]);

  assert.equal(row.unit_price, 50);
  assert.equal(row.amount, -50);
  assert.equal(row.options_json.discount_scope, "quote");
  assert.equal(row.options_json.discount_type, "amount");
  assert.equal(row.options_json.discount_value, 50);

  const restored = deserializeQuoteItemFromDb(
    {
      product_code: row.product_code,
      description: row.description,
      optional_description: row.optional_description,
      qty: row.qty,
      unit_price: row.unit_price,
      amount: row.amount,
      options_json: row.options_json,
    },
    0,
    QUOTE_ID,
    NOW,
  );

  assert.equal(restored.discountScope, "quote");
  assert.equal(restored.discountType, "amount");
  assert.equal(restored.discountValue, 50);
  assert.equal(restored.unitPrice, 0);
});

test("quote discount percent survives save and reopen", () => {
  const [row] = serializeQuoteItemsForDb([
    {
      sku: null,
      sourceProductId: null,
      name: "Discount",
      description: "Quote discount",
      imageUrl: null,
      extraImageUrls: null,
      qty: 1,
      unitPrice: 0,
      lineTotal: -52.1,
      chosenOptions: null,
      availableOptions: null,
      importLineId: null,
      discountType: "percent",
      discountValue: 10,
      discountScope: "quote",
    },
  ]);

  assert.equal(row.options_json.discount_type, "percent");
  assert.equal(row.options_json.discount_value, 10);

  const restored = deserializeQuoteItemFromDb(
    {
      product_code: row.product_code,
      description: row.description,
      optional_description: row.optional_description,
      qty: row.qty,
      unit_price: row.unit_price,
      amount: row.amount,
      options_json: row.options_json,
    },
    0,
    QUOTE_ID,
    NOW,
  );

  assert.equal(restored.discountScope, "quote");
  assert.equal(restored.discountType, "percent");
  assert.equal(restored.discountValue, 10);
});

test("legacy discount row without options_json is restored from amount", () => {
  const restored = deserializeQuoteItemFromDb(
    {
      product_code: null,
      description: "Discount",
      optional_description: "Quote discount",
      qty: 1,
      unit_price: 0,
      amount: -40,
      options_json: null,
    },
    0,
    QUOTE_ID,
    NOW,
  );

  assert.equal(restored.discountScope, "quote");
  assert.equal(restored.discountType, "amount");
  assert.equal(restored.discountValue, 40);
});
