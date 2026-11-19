"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const LIMIT = 100;
const ORDER = ["budi", "andi", "cici"];

test("contoh PRD: Budi 120 dilangkahi Andi yang naik ke 130", () => {
  const before = { budi: 120, andi: 90, cici: 80 };
  const result = core.applyScoreStep(before, "andi", 40, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.after.andi, 130);
  assert.equal(result.after.budi, 0);
  assert.equal(result.bombAmount, -120);
});

test("contoh PRD: hanya pemain tertinggi yang meledak saat dua pemain dilewati", () => {
  const before = { budi: 120, andi: 110, cici: 100 };
  const result = core.applyScoreStep(before, "cici", 25, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.after.budi, 0);
  assert.equal(result.after.andi, 110);
  assert.equal(result.after.cici, 125);
});

test("contoh PRD: skor sama persis tidak memicu bom", () => {
  const before = { budi: 120, andi: 110, cici: 80 };
  const result = core.applyScoreStep(before, "andi", 10, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, null);
  assert.deepEqual(result.after, { budi: 120, andi: 120, cici: 80 });
});

test("contoh PRD: tepat 100 belum berada di zona bom", () => {
  const before = { budi: 100, andi: 90, cici: 70 };
  const result = core.applyScoreStep(before, "andi", 20, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, null);
  assert.equal(result.after.budi, 100);
  assert.equal(result.after.andi, 110);
});

test("contoh PRD: pengurangan sendiri bisa memicu bom", () => {
  const before = { budi: 120, andi: 110, cici: 90 };
  const result = core.applyScoreStep(before, "budi", -20, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.after.budi, 0);
  assert.equal(result.after.andi, 110);
  // Bom harus menghanguskan total 100 yang tersisa, bukan 120 sebelum
  // pengurangan, supaya total akhir tepat 0.
  assert.equal(result.bombAmount, -100);
});

test("pemain yang sudah berada di atas tidak dilaporkan sebagai tersalip", () => {
  const before = { budi: 150, andi: 160, cici: 50 };
  const result = core.applyScoreStep(before, "andi", 10, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, null);
  assert.equal(result.after.andi, 170);
});

test("hanya yang total sebelum perubahan tertinggi yang meledak", () => {
  const before = { budi: 130, andi: 120, cici: 100 };
  const result = core.applyScoreStep(before, "cici", 50, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.after.budi, 0);
  assert.equal(result.after.andi, 120);
});

test("evaluateBomb memakai tie-break urutan pemain yang deterministik", () => {
  const before = { a: 120, b: 120, c: 50 };
  const after = { a: 120, b: 120, c: 130 };

  assert.equal(core.evaluateBomb(before, after, LIMIT, ["a", "b", "c"]), "a");
  assert.equal(core.evaluateBomb(before, after, LIMIT, ["b", "a", "c"]), "b");
});

test("skor negatif diperbolehkan dan tidak merusak perhitungan", () => {
  const before = { budi: 120, andi: 110, cici: -30 };
  const result = core.applyScoreStep(before, "cici", -20, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, null);
  assert.equal(result.after.cici, -50);
  assert.equal(core.calculateTotals(
    [{ id: "a" }, { id: "b" }],
    [
      { playerId: "a", amount: 10 },
      { playerId: "a", amount: -30 },
      { playerId: "b", amount: 5 }
    ]
  ).a, -20);
});

test("ambang dapat dikonfigurasi dan tetap menggunakan perbandingan ketat", () => {
  const before = { a: 50, b: 20 };
  const result = core.applyScoreStep(before, "b", 32, {
    threshold: 50,
    order: ["a", "b"]
  });

  assert.equal(result.bombPlayerId, null);
  assert.equal(result.after.b, 52);

  const resultAtLimit = core.applyScoreStep(
    { a: 50, b: 51 },
    "a",
    -1,
    { threshold: 50, order: ["a", "b"] }
  );
  // a: 50 -> 49, b: 51. a tidak pernah "di atas" ambang sebelum perubahan.
  assert.equal(resultAtLimit.bombPlayerId, null);
});

test("satu langkah bisa dikelompokkan dan dibatalkan secara atomik", () => {
  const startingEvents = [
    { id: "e1", stepId: "s1", playerId: "budi", type: "add", amount: 120 },
    { id: "e2", stepId: "s1", playerId: "andi", type: "add", amount: 90 },
    { id: "e3", stepId: "s2", playerId: "andi", type: "add", amount: 40 },
    { id: "e4", stepId: "s2", playerId: "budi", type: "bomb", amount: -120 }
  ];
  const players = [{ id: "budi" }, { id: "andi" }, { id: "cici" }];

  assert.deepEqual(core.calculateTotals(players, startingEvents), {
    budi: 0,
    andi: 130,
    cici: 0
  });
  assert.equal(core.getLastStepId(startingEvents), "s2");

  const undone = core.removeLastStep(startingEvents);
  assert.equal(undone.stepId, "s2");
  assert.deepEqual(core.calculateTotals(players, undone.events), {
    budi: 120,
    andi: 90,
    cici: 0
  });
});

test("bom tetap konsisten saat total korban sudah 0 setelah pengurangan", () => {
  const before = { budi: 150, andi: 20, cici: 0 };
  const result = core.applyScoreStep(before, "budi", -150, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.bombAmount, 0);
  assert.equal(result.after.budi, 0);
  assert.equal(Object.is(result.bombAmount, -0), false);
});

test("bom mengembalikan total negatif ke 0 secara konsisten", () => {
  const before = { budi: 150, andi: 20, cici: 0 };
  const result = core.applyScoreStep(before, "budi", -220, {
    threshold: LIMIT,
    order: ORDER
  });

  assert.equal(result.bombPlayerId, "budi");
  assert.equal(result.after.budi, 0);
  assert.equal(result.bombAmount, 70);
});

test("jumlah seluruh entri selalu sama dengan total papan", () => {
  const before = { budi: 120, andi: 110, cici: 90 };
  const result = core.applyScoreStep(before, "budi", -20, {
    threshold: LIMIT,
    order: ORDER
  });
  const startingEvents = [
    { playerId: "budi", amount: 120 },
    { playerId: "andi", amount: 110 },
    { playerId: "cici", amount: 90 }
  ];
  const newEvents = [
    { playerId: "budi", amount: -20 },
    { playerId: "budi", amount: result.bombAmount }
  ];
  const totals = core.calculateTotals(
    [{ id: "budi" }, { id: "andi" }, { id: "cici" }],
    startingEvents.concat(newEvents)
  );

  assert.equal(totals.budi, 0);
  assert.deepEqual(totals, result.after);
});

test("isSafeAmount menolak nol, pecahan, dan nilai di luar batas", () => {
  assert.equal(core.isSafeAmount(10), true);
  assert.equal(core.isSafeAmount(-10), true);
  assert.equal(core.isSafeAmount(0), false);
  assert.equal(core.isSafeAmount(1.5), false);
  assert.equal(core.isSafeAmount(1000001, 1000000), false);
});
