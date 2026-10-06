const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  filterCartSummariesByEmail,
  looksLikeCartId,
  looksLikeEmail,
  mapCartContentsRow,
  mapCartIdLogListRow,
  parseAbandonedCartContentsHtml,
  parseOptionIdsCsv,
} = require("../dist-server/lib/abandonedCart");

test("parseOptionIdsCsv splits comma-separated option ids", () => {
  assert.deepEqual(parseOptionIdsCsv("6651,6349,6323,6341"), [6651, 6349, 6323, 6341]);
  assert.deepEqual(parseOptionIdsCsv("6651, 6349;6323"), [6651, 6349, 6323]);
  assert.deepEqual(parseOptionIdsCsv(""), []);
  assert.deepEqual(parseOptionIdsCsv("abc,0,-1"), []);
});

test("mapCartContentsRow maps ProductCode OptionIDs Price QTY", () => {
  const line = mapCartContentsRow(
    ["ProductCode", "OptionIDs", "Price", "QTY", "LastModified"],
    ["KS106", "6651,6349,6323,6341", "2686", "1", "10/06/2026 01:51PM"],
  );
  assert.ok(line);
  assert.equal(line.productCode, "KS106");
  assert.deepEqual(line.optionIds, [6651, 6349, 6323, 6341]);
  assert.equal(line.qty, 1);
  assert.equal(line.price, 2686);
});

test("mapCartContentsRow defaults qty and skips empty product", () => {
  assert.equal(mapCartContentsRow(["ProductCode", "QTY"], ["", "2"]), null);
  const line = mapCartContentsRow(["ProductCode", "OptionIDs", "QTY"], ["AB1", "", ""]);
  assert.ok(line);
  assert.equal(line.qty, 1);
  assert.deepEqual(line.optionIds, []);
});

test("parseAbandonedCartContentsHtml reads Shopping Cart Contents table", () => {
  const html = `
    <h3>Cart Info</h3>
    <h3>Shopping Cart Contents</h3>
    <table>
      <tr><th>ProductCode</th><th>OptionIDs</th><th>Price</th><th>QTY</th><th>LastModified</th></tr>
      <tr><td><a>KS106</a></td><td>6651,6349,6323,6341</td><td>2686</td><td>1</td><td>10/06/2026</td></tr>
      <tr><td>NV902</td><td>100</td><td>50</td><td>2</td><td>10/06/2026</td></tr>
    </table>
  `;
  const lines = parseAbandonedCartContentsHtml(html);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].productCode, "KS106");
  assert.deepEqual(lines[0].optionIds, [6651, 6349, 6323, 6341]);
  assert.equal(lines[1].productCode, "NV902");
  assert.equal(lines[1].qty, 2);
});

test("mapCartIdLogListRow extracts cart summary fields", () => {
  const summary = mapCartIdLogListRow([
    "3cb19d9d-2d17-47c9-a8d8-a68180ede3b9",
    "",
    "",
    "tonyjoss1990@gmail.com",
    "76.211.180.255",
    "1",
    "10/06/2026 01:51PM",
  ]);
  assert.ok(summary);
  assert.equal(summary.cartId, "3cb19d9d-2d17-47c9-a8d8-a68180ede3b9");
  assert.equal(summary.email, "tonyjoss1990@gmail.com");
  assert.equal(summary.itemCount, 1);
  assert.equal(summary.lastModified, "10/06/2026 01:51PM");
});

test("looksLikeCartId and looksLikeEmail helpers", () => {
  assert.equal(looksLikeCartId("3cb19d9d-2d17-47c9-a8d8-a68180ede3b9"), true);
  assert.equal(looksLikeCartId("07387C5E1E344F7DB151AE80E9894EE7"), true);
  assert.equal(looksLikeCartId("not-a-cart"), false);
  assert.equal(looksLikeEmail("a@b.com"), true);
  assert.equal(looksLikeEmail("nope"), false);
});

test("isAbandonedCartGuid requires dashed UUID used by CartIDLog", () => {
  const {
    isAbandonedCartGuid,
    extractAbandonedCartGuidFromText,
  } = require("../dist-server/lib/abandonedCart");
  assert.equal(isAbandonedCartGuid("3cb19d9d-2d17-47c9-a8d8-a68180ede3b9"), true);
  assert.equal(isAbandonedCartGuid("07387C5E1E344F7DB151AE80E9894EE7"), false);
  assert.equal(
    extractAbandonedCartGuidFromText("foo=3cb19d9d-2d17-47c9-a8d8-a68180ede3b9; path=/"),
    "3cb19d9d-2d17-47c9-a8d8-a68180ede3b9",
  );
});

test("filterCartSummariesByEmail is case-insensitive exact match", () => {
  const carts = [
    { cartId: "a", email: "A@B.com", itemCount: 1, lastModified: null },
    { cartId: "b", email: "other@x.com", itemCount: 2, lastModified: null },
  ];
  const filtered = filterCartSummariesByEmail(carts, "a@b.com");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].cartId, "a");
});
