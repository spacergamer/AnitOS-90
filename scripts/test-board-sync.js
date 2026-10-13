const assert = require("node:assert/strict");
const {normalizeBoardCharacters} = require("../auth");

const snapshot = [
  {id: "char-1", nome: "  Aline   Valença ", hp: 12},
  {id: "char-2", name: "Second Character", tags: ["light", "fade"]},
  {id: "char-3"},
  null,
  "not a character",
  [],
  {id: "", nome: "Missing stable key"},
  {id: "char-4", nome: "   "},
  {id: "x".repeat(180), nome: "Y".repeat(120)}
];

const normalized = normalizeBoardCharacters(snapshot);
assert.equal(normalized.length, 4, "ignores invalid entries and missing keys/names");
assert.deepEqual(normalized[0], {
  sourceKey: "char-1",
  name: "Aline   Valença",
  data: snapshot[0]
});
assert.equal(normalized[1].name, "Second Character");
assert.equal(normalized[2].name, "char-3", "falls back to stable source key");
assert.equal(normalized[3].sourceKey.length, 160, "limits source key length");
assert.equal(normalized[3].name.length, 100, "limits display name length");
assert.throws(() => normalizeBoardCharacters({not: "an array"}), TypeError);
assert.deepEqual(normalizeBoardCharacters([]), []);
console.log("Board character sync normalization tests passed.");
