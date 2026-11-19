/*
 * Papan Skor Remi RT — logika inti yang murni dan mudah diuji.
 * Dimuat sebagai script biasa di browser (window.ScoreCore) dan sebagai
 * modul CommonJS oleh Node untuk pengujian.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScoreCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULT_BOMB_THRESHOLD = 100;

  // Warna aksen pemain. Dipilih agar tetap terbaca di tema terang maupun gelap.
  var PLAYER_COLORS = [
    "#C9573B", // bata
    "#B78326", // kunyit
    "#2F7D72", // teh hijau
    "#5973B8"  // biru dongker
  ];

  var PLAYER_SUITS = ["♠", "♥", "♦", "♣"];

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function normaliseOrder(before, order) {
    if (Array.isArray(order) && order.length) {
      return order.filter(function (id) {
        return Object.prototype.hasOwnProperty.call(before, id);
      });
    }
    return Object.keys(before);
  }

  /**
   * Aturan bom. Hanya menerima angka total, bukan DOM atau state aplikasi.
   *
   * @param {Object<string, number>} before total sebelum perubahan skor
   * @param {Object<string, number>} after total sesudah perubahan skor
   * @param {number} [threshold=100] ambang; pemain harus BENAR-BENAR di atasnya
   * @param {string[]} [order] urutan pemain untuk tie-break deterministik
   * @returns {string|null} id pemain yang meledak, atau null
   */
  function evaluateBomb(before, after, threshold, order) {
    var limit = isFiniteNumber(threshold) ? threshold : DEFAULT_BOMB_THRESHOLD;
    var ids = normaliseOrder(before, order);
    var victim = null;
    var highestBefore = -Infinity;

    for (var i = 0; i < ids.length; i += 1) {
      var x = ids[i];
      if (!isFiniteNumber(before[x]) || !isFiniteNumber(after[x])) continue;
      if (before[x] <= limit) continue;

      var crossed = false;
      for (var j = 0; j < ids.length; j += 1) {
        var y = ids[j];
        if (y === x) continue;
        if (!isFiniteNumber(before[y]) || !isFiniteNumber(after[y])) continue;
        if (before[y] <= before[x] && after[y] > after[x]) {
          crossed = true;
          break;
        }
      }

      if (crossed && (victim === null || before[x] > highestBefore)) {
        victim = x;
        highestBefore = before[x];
      }
    }

    return victim;
  }

  /**
   * Menjalankan satu langkah skor: tambah/kurang satu pemain lalu evaluasi bom.
   * Bom tidak berantai karena evaluasi hanya sekali.
   *
   * Nilai entri bom adalah negatif dari total korban SESUDAH perubahan skor,
   * supaya total akhir benar-benar 0 dan tetap sama dengan jumlah entri.
   */
  function applyScoreStep(before, playerId, delta, options) {
    var opts = options || {};
    var threshold = isFiniteNumber(opts.threshold)
      ? opts.threshold
      : DEFAULT_BOMB_THRESHOLD;
    var ids = normaliseOrder(before, opts.order || Object.keys(before));

    if (ids.indexOf(playerId) === -1) {
      throw new Error("Pemain tidak ditemukan.");
    }
    if (!isFiniteNumber(delta) || delta === 0) {
      throw new Error("Perubahan skor harus berupa angka bukan nol.");
    }

    var beforeCopy = {};
    var after = {};
    ids.forEach(function (id) {
      beforeCopy[id] = isFiniteNumber(before[id]) ? before[id] : 0;
      after[id] = beforeCopy[id];
    });
    after[playerId] = after[playerId] + delta;

    var bombPlayerId = evaluateBomb(beforeCopy, after, threshold, ids);
    var bombAmount = 0;

    if (bombPlayerId) {
      // Hindari -0 pada entri bom ketika total korban sudah 0.
      bombAmount = after[bombPlayerId] === 0 ? 0 : -after[bombPlayerId];
      after[bombPlayerId] = 0;
    }

    return {
      before: beforeCopy,
      after: after,
      bombPlayerId: bombPlayerId,
      bombAmount: bombAmount
    };
  }

  /** Jumlahkan entri secara manual. Number dapat berupa string pemain. */
  function sumEvents(events) {
    if (!Array.isArray(events)) return 0;
    return events.reduce(function (total, event) {
      return total + (isFiniteNumber(event.amount) ? event.amount : 0);
    }, 0);
  }

  function calculateTotals(players, events) {
    var totals = {};
    var playersById = {};

    (Array.isArray(players) ? players : []).forEach(function (player) {
      totals[player.id] = 0;
      playersById[player.id] = true;
    });

    (Array.isArray(events) ? events : []).forEach(function (event) {
      if (!Object.prototype.hasOwnProperty.call(totals, event.playerId)) return;
      if (!isFiniteNumber(event.amount)) return;
      totals[event.playerId] += event.amount;
    });

    return totals;
  }

  function getLastStepId(events) {
    if (!Array.isArray(events) || events.length === 0) return null;
    var last = events[events.length - 1];
    return last && typeof last.stepId === "string" ? last.stepId : null;
  }

  function getStepEvents(events, stepId) {
    if (!Array.isArray(events) || !stepId) return [];
    return events.filter(function (event) {
      return event.stepId === stepId;
    });
  }

  function removeStep(events, stepId) {
    if (!Array.isArray(events) || !stepId) return (events || []).slice();
    return events.filter(function (event) {
      return event.stepId !== stepId;
    });
  }

  function removeLastStep(events) {
    var stepId = getLastStepId(events);
    return {
      stepId: stepId,
      events: stepId ? removeStep(events, stepId) : (events || []).slice()
    };
  }

  function countEvents(events, type) {
    if (!Array.isArray(events)) return 0;
    return events.filter(function (event) {
      return event.type === type;
    }).length;
  }

  function isSafeAmount(amount, max) {
    var ceiling = isFiniteNumber(max) ? max : 1000000;
    return (
      isFiniteNumber(amount) &&
      Number.isSafeInteger(amount) &&
      amount !== 0 &&
      Math.abs(amount) <= ceiling
    );
  }

  return {
    DEFAULT_BOMB_THRESHOLD: DEFAULT_BOMB_THRESHOLD,
    PLAYER_COLORS: PLAYER_COLORS,
    PLAYER_SUITS: PLAYER_SUITS,
    evaluateBomb: evaluateBomb,
    applyScoreStep: applyScoreStep,
    sumEvents: sumEvents,
    calculateTotals: calculateTotals,
    getLastStepId: getLastStepId,
    getStepEvents: getStepEvents,
    removeStep: removeStep,
    removeLastStep: removeLastStep,
    countEvents: countEvents,
    isSafeAmount: isSafeAmount
  };
});
