/* =========================================================
   Papan Skor Remi RT — aplikasi
   Data lokal adalah sumber kebenaran. Total selalu dihitung
   dari daftar entri, tidak pernah disimpan terpisah.
   ========================================================= */

(function () {
  "use strict";

  var Core = window.ScoreCore;

  var STORAGE_KEY = "papan-skor-remi-rt:v1";
  var STORAGE_VERSION = 1;
  var MAX_MANUAL_AMOUNT = 1000000;
  var DEFAULT_BOMB_THRESHOLD = 100;
  var MAX_GAME_NAME = 48;
  var MAX_PLAYER_NAME = 24;
  var THEMES = ["system", "light", "dark"];
  var DEFAULT_PLAYER_NAMES = ["Pemain 1", "Pemain 2", "Pemain 3", "Pemain 4"];

  var BOMB_DURATIONS = {
    normal: { warning: 300, fuse: 600, explosion: 500, settle: 600 },
    reduced: { warning: 90, fuse: 120, explosion: 160, settle: 320 }
  };

  var numberFormatter = new Intl.NumberFormat("id-ID");
  var shortDateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
  var fullDateFormatter = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  var dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  var timeFormatter = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });

  var colorSchemeMedia =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  var reducedMotionMedia =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  var els = {};
  var state = null;
  var activePlayerId = null;
  var isAnimating = false;
  var menuIsOpen = false;
  var renameContext = null;
  var manualContext = null;
  var confirmResolver = null;
  var toastTimer = 0;
  var fitFrame = 0;
  var scrollFrame = 0;
  var storageAvailable = true;
  var initNotice = "";
  var audioContext = null;
  var menuDismissGuard = false;

  /* ----------------------------------------------------------
     Utilitas
     ---------------------------------------------------------- */

  function createId(prefix) {
    var random;
    try {
      var bytes = new Uint32Array(1);
      window.crypto.getRandomValues(bytes);
      random = bytes[0].toString(36);
    } catch (error) {
      random = Math.floor(Math.random() * 0xffffffff).toString(36);
    }
    return prefix + Date.now().toString(36) + "_" + random;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function cleanName(value, fallback, maxLength) {
    var limit = maxLength || MAX_PLAYER_NAME;
    var cleaned = String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
    return cleaned || fallback;
  }

  function cleanOptionalName(value, maxLength) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = 0;
    var safe = Math.abs(number) < 0.5 ? 0 : number;
    return (safe < 0 ? "−" : "") + numberFormatter.format(Math.abs(safe));
  }

  function formatSigned(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number === 0) return "0";
    return (number > 0 ? "+" : "−") + numberFormatter.format(Math.abs(number));
  }

  function parseDate(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateShort(value) {
    var date = value instanceof Date ? value : parseDate(value);
    return date ? shortDateFormatter.format(date) : "—";
  }

  function formatDateFull(value) {
    var date = parseDate(value);
    return date ? fullDateFormatter.format(date) : "Tanggal tidak diketahui";
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    return date ? dateTimeFormatter.format(date) : "Tanggal tidak diketahui";
  }

  function dateStampForFile(date) {
    var day = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    var year = day.getFullYear();
    var month = String(day.getMonth() + 1).padStart(2, "0");
    var dateNumber = String(day.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + dateNumber;
  }

  function formatTime(value) {
    var date = parseDate(value);
    return date ? timeFormatter.format(date) : "";
  }

  function defaultGameName(date) {
    return "Main " + formatDateShort(date || new Date());
  }

  function prefersReducedMotion() {
    return Boolean(reducedMotionMedia && reducedMotionMedia.matches);
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 700px)").matches;
  }

  function isTextEntry(element) {
    if (!element) return false;
    var tag = element.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      element.isContentEditable
    );
  }

  function hasOpenDialog() {
    return Boolean(document.querySelector("dialog[open]"));
  }

  function setLiveMessage(element, message) {
    if (!element) return;
    element.textContent = message;
  }

  function announce(message) {
    setLiveMessage(els.scoreAnnouncer, "");
    window.setTimeout(function () {
      setLiveMessage(els.scoreAnnouncer, message);
    }, 20);
  }

  function announceBomb(message) {
    setLiveMessage(els.bombAnnouncer, "");
    window.setTimeout(function () {
      setLiveMessage(els.bombAnnouncer, message);
    }, 20);
  }

  function showToast(message, duration) {
    if (!els.toast) return;
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, duration || 2300);
  }

  function showStorageBanner(message) {
    if (!els.storageBanner) return;
    els.storageBanner.textContent = message;
    els.storageBanner.hidden = false;
  }

  function updateStorageDetails() {
    if (!els.storageDetails) return;
    var dot = els.storageDetails.querySelector(".status-dot");
    var label = els.storageDetails.querySelector("span:last-child");
    if (!dot || !label) return;
    if (storageAvailable) {
      dot.classList.remove("is-error");
      label.textContent = "Tersimpan otomatis di perangkat ini.";
    } else {
      dot.classList.add("is-error");
      label.textContent =
        "Penyimpanan tidak tersedia — data hanya bertahan selama halaman terbuka.";
    }
  }

  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function getActiveGame() {
    if (!state) return null;
    return (
      state.games.find(function (game) {
        return game.id === state.activeGameId;
      }) || state.games[0] || null
    );
  }

  function getPlayer(game, playerId) {
    if (!game) return null;
    return (
      game.players.find(function (player) {
        return player.id === playerId;
      }) || null
    );
  }

  function getTotals(game) {
    return Core.calculateTotals(game.players, game.events);
  }

  function getPlayerOrder(game) {
    return game.players.map(function (player) {
      return player.id;
    });
  }

  function ensureActivePlayer() {
    var game = getActiveGame();
    if (!game) {
      activePlayerId = null;
      return;
    }
    if (!getPlayer(game, activePlayerId)) {
      activePlayerId = game.players[0] ? game.players[0].id : null;
    }
  }

  /* ----------------------------------------------------------
     Model data
     ---------------------------------------------------------- */

  function makePlayers(names, sourcePlayers) {
    var palette = Core.PLAYER_COLORS;
    return [0, 1, 2, 3].map(function (index) {
      var source = sourcePlayers && sourcePlayers[index];
      var name = source
        ? source.name
        : names && names[index]
          ? names[index]
          : DEFAULT_PLAYER_NAMES[index];
      return {
        id: createId("p_"),
        name: cleanName(name, DEFAULT_PLAYER_NAMES[index], MAX_PLAYER_NAME),
        color: source && isHexColor(source.color)
          ? source.color
          : palette[index % palette.length]
      };
    });
  }

  function buildGame(options) {
    var opts = options || {};
    var now = opts.createdAt ? parseDate(opts.createdAt) : new Date();
    if (!now) now = new Date();
    return {
      id: createId("g_"),
      name: cleanName(opts.name, defaultGameName(now), MAX_GAME_NAME),
      createdAt: now.toISOString(),
      players: makePlayers(opts.playerNames, opts.players),
      events: []
    };
  }

  function createFreshState() {
    var game = buildGame({
      name: "Main Malam Ini",
      playerNames: DEFAULT_PLAYER_NAMES.slice()
    });
    return {
      version: STORAGE_VERSION,
      activeGameId: game.id,
      settings: {
        theme: "system",
        sound: false,
        bomThreshold: DEFAULT_BOMB_THRESHOLD
      },
      games: [game]
    };
  }

  function normaliseSettings(raw) {
    var settings = isObject(raw) ? raw : {};
    var theme = THEMES.indexOf(settings.theme) !== -1 ? settings.theme : "system";
    var threshold = Number(settings.bomThreshold);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100000) {
      threshold = DEFAULT_BOMB_THRESHOLD;
    }
    return {
      theme: theme,
      sound: settings.sound === true,
      bomThreshold: Math.round(threshold)
    };
  }

  function normaliseGame(rawGame, index, strict) {
    if (!isObject(rawGame)) {
      throw new Error("Ada data game yang rusak.");
    }

    var gameName = cleanName(rawGame.name, "Game " + (index + 1), MAX_GAME_NAME);
    var createdAtDate = parseDate(rawGame.createdAt);
    if (!createdAtDate) {
      if (strict) {
        throw new Error('Tanggal game "' + gameName + '" tidak valid.');
      }
      createdAtDate = new Date();
    }

    var gameId = typeof rawGame.id === "string" ? rawGame.id.trim() : "";
    if (!gameId) {
      if (strict) {
        throw new Error('Game "' + gameName + '" tidak memiliki ID.');
      }
      gameId = createId("g_");
    }

    var playersRaw = Array.isArray(rawGame.players) ? rawGame.players.slice() : [];
    if (strict && playersRaw.length !== 4) {
      throw new Error('Game "' + gameName + '" harus memiliki tepat 4 pemain.');
    }
    if (playersRaw.length > 4) playersRaw = playersRaw.slice(0, 4);
    while (playersRaw.length < 4) {
      playersRaw.push({
        name: DEFAULT_PLAYER_NAMES[playersRaw.length],
        color: Core.PLAYER_COLORS[playersRaw.length % Core.PLAYER_COLORS.length]
      });
    }

    var playerIds = new Set();
    var players = playersRaw.map(function (rawPlayer, playerPosition) {
      var playerData = isObject(rawPlayer) ? rawPlayer : {};
      var fallbackName = DEFAULT_PLAYER_NAMES[playerPosition];
      var playerName = cleanName(
        playerData.name,
        fallbackName,
        MAX_PLAYER_NAME
      );
      var playerId =
        typeof playerData.id === "string" ? playerData.id.trim() : "";

      if (!playerId || playerIds.has(playerId)) {
        if (strict) {
          throw new Error(
            'Game "' + gameName + '" punya ID pemain yang tidak valid.'
          );
        }
        playerId = createId("p_");
      }
      playerIds.add(playerId);

      return {
        id: playerId,
        name: playerName,
        color: isHexColor(playerData.color)
          ? playerData.color
          : Core.PLAYER_COLORS[playerPosition % Core.PLAYER_COLORS.length]
      };
    });

    var eventsRaw = Array.isArray(rawGame.events) ? rawGame.events : [];
    var eventIds = new Set();
    var events = [];

    eventsRaw.forEach(function (rawEvent) {
      if (!isObject(rawEvent)) {
        if (strict) throw new Error('Ada entri nilai yang rusak di "' + gameName + '".');
        return;
      }

      if (!playerIds.has(rawEvent.playerId)) {
        if (strict) {
          throw new Error(
            'Entri di "' + gameName + '" merujuk pemain yang tidak dikenal.'
          );
        }
        return;
      }

      if (["add", "sub", "bomb"].indexOf(rawEvent.type) === -1) {
        if (strict) {
          throw new Error('Ada jenis entri yang tidak dikenal di "' + gameName + '".');
        }
        return;
      }

      var amount = Number(rawEvent.amount);
      if (!Number.isSafeInteger(amount)) {
        if (strict) {
          throw new Error('Ada nilai yang bukan bilangan bulat di "' + gameName + '".');
        }
        return;
      }
      if (rawEvent.type === "add" && amount <= 0) {
        if (strict) throw new Error('Nilai tambah harus lebih dari 0.');
        return;
      }
      if (rawEvent.type === "sub" && amount >= 0) {
        if (strict) throw new Error('Nilai kurang harus di bawah 0.');
        return;
      }
      // Entri bom adalah penyesuaian menuju 0. Jika total korban sudah
      // negatif saat bom, penyesuaiannya bisa bernilai positif.


      var stepId =
        typeof rawEvent.stepId === "string" ? rawEvent.stepId.trim() : "";
      if (!stepId) {
        if (strict) {
          throw new Error('Ada entri tanpa kelompok langkah di "' + gameName + '".');
        }
        stepId = createId("s_");
      }

      var eventId =
        typeof rawEvent.id === "string" ? rawEvent.id.trim() : "";
      if (!eventId || eventIds.has(eventId)) {
        if (strict && eventId) {
          throw new Error('Ada ID entri ganda di "' + gameName + '".');
        }
        eventId = createId("e_");
      }
      eventIds.add(eventId);

      var timestamp = Number(rawEvent.ts);
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        timestamp = createdAtDate.getTime();
      }

      events.push({
        id: eventId,
        stepId: stepId,
        playerId: rawEvent.playerId,
        type: rawEvent.type,
        amount: amount,
        ts: timestamp
      });
    });

    return {
      id: gameId,
      name: gameName,
      createdAt: createdAtDate.toISOString(),
      players: players,
      events: events
    };
  }

  function normaliseState(raw, options) {
    var opts = options || {};
    var strict = Boolean(opts.strict);

    if (!isObject(raw)) {
      throw new Error("File cadangan tidak berisi data yang valid.");
    }
    if (strict && raw.version !== STORAGE_VERSION) {
      throw new Error("Versi cadangan tidak didukung. Gunakan cadangan versi 1.");
    }
    if (
      raw.version != null &&
      raw.version !== STORAGE_VERSION &&
      !strict
    ) {
      throw new Error("Versi data tidak dikenal.");
    }
    if (!Array.isArray(raw.games)) {
      throw new Error("Daftar game pada cadangan tidak ditemukan.");
    }
    if (strict && raw.games.length === 0) {
      throw new Error("Cadangan tidak berisi game apa pun.");
    }

    var gameIds = new Set();
    var games = [];
    raw.games.forEach(function (rawGame, index) {
      var game = normaliseGame(rawGame, index, strict);
      if (gameIds.has(game.id)) {
        if (strict) {
          throw new Error("Ada ID game yang ganda di dalam cadangan.");
        }
        game.id = createId("g_");
      }
      gameIds.add(game.id);
      games.push(game);
    });

    if (games.length === 0) {
      var fallbackGame = buildGame({
        name: "Main Malam Ini",
        playerNames: DEFAULT_PLAYER_NAMES.slice()
      });
      games.push(fallbackGame);
    }

    var activeGameId =
      typeof raw.activeGameId === "string" ? raw.activeGameId : "";
    if (!games.some(function (game) { return game.id === activeGameId; })) {
      activeGameId = games[0].id;
    }

    return {
      version: STORAGE_VERSION,
      activeGameId: activeGameId,
      settings: normaliseSettings(raw.settings),
      games: games
    };
  }

  /* ----------------------------------------------------------
     Penyimpanan
     ---------------------------------------------------------- */

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      updateStorageDetails();
      return true;
    } catch (error) {
      storageAvailable = false;
      var quotaError =
        error &&
        (error.name === "QuotaExceededError" ||
          error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          error.code === 22 ||
          error.code === 1014);
      showStorageBanner(
        quotaError
          ? "Penyimpanan perangkat penuh. Ekspor cadangan lalu hapus game lama. Selama halaman ini terbuka, perubahan tetap bisa dilakukan."
          : "Data tidak bisa disimpan di perangkat ini. Selama halaman ini terbuka, perubahan tetap bisa dilakukan — ekspor cadangan dari menu Pengaturan."
      );
      updateStorageDetails();
      return false;
    }
  }

  function loadInitialState() {
    var rawText = null;

    try {
      rawText = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      storageAvailable = false;
      showStorageBanner(
        "Penyimpanan perangkat tidak bisa diakses. Perubahan akan bertahan selama halaman ini terbuka; gunakan Ekspor JSON untuk menyimpan cadangan."
      );
      return createFreshState();
    }

    if (!rawText) {
      var fresh = createFreshState();
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      } catch (error) {
        storageAvailable = false;
        showStorageBanner(
          "Data tidak bisa disimpan otomatis di perangkat ini. Selama halaman ini terbuka, perubahan tetap bisa dilakukan — ekspor cadangan dari menu Pengaturan."
        );
      }
      return fresh;
    }

    try {
      return normaliseState(JSON.parse(rawText), { strict: false });
    } catch (error) {
      try {
        window.localStorage.setItem(
          STORAGE_KEY + ":rusak:" + Date.now(),
          rawText
        );
      } catch (backupError) {
        // Tidak ada ruang untuk cadangan; tetap lanjut tanpa crash.
      }
      var recovered = createFreshState();
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recovered));
      } catch (saveError) {
        storageAvailable = false;
      }
      initNotice =
        "Data tersimpan sebelumnya tidak dapat dibaca dan dimulai ulang dengan game kosong. Salinan data lama disimpan di perangkat bila ruang penyimpanan mencukupi.";
      return recovered;
    }
  }

  /* ----------------------------------------------------------
     Tema
     ---------------------------------------------------------- */

  function applyThemeSetting(themeSetting, options) {
    var opts = options || {};
    var setting = THEMES.indexOf(themeSetting) !== -1 ? themeSetting : "system";
    var resolved =
      setting === "system"
        ? colorSchemeMedia && colorSchemeMedia.matches
          ? "dark"
          : "light"
        : setting;

    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "dark" ? "#0b1311" : "#f2ece0");
    }

    if (state && state.settings.theme !== setting) {
      state.settings.theme = setting;
      if (opts.persist !== false) saveState();
    } else if (state) {
      state.settings.theme = setting;
    }

    var radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach(function (radio) {
      radio.checked = radio.value === setting;
    });
  }

  function handleSystemThemeChange() {
    if (!state) return;
    if (state.settings.theme === "system") {
      applyThemeSetting("system", { persist: false });
    }
  }

  /* ----------------------------------------------------------
     Render
     ---------------------------------------------------------- */

  function scheduleFitsAndScrolls() {
    window.cancelAnimationFrame(fitFrame);
    window.cancelAnimationFrame(scrollFrame);
    fitFrame = window.requestAnimationFrame(function () {
      document.querySelectorAll(".total-value").forEach(fitTotal);
    });
    scrollFrame = window.requestAnimationFrame(function () {
      document.querySelectorAll(".entries").forEach(function (list) {
        list.scrollTop = list.scrollHeight;
      });
    });
  }

  function fitTotal(element) {
    element.style.fontSize = "";
    var size = parseFloat(window.getComputedStyle(element).fontSize);
    if (!Number.isFinite(size)) return;
    var available = element.clientWidth;
    if (!available) return;
    var attempts = 0;
    while (
      element.scrollWidth > available + 0.5 &&
      size > 10 &&
      attempts < 40
    ) {
      size -= 1;
      element.style.fontSize = size + "px";
      attempts += 1;
    }
  }

  function renderHeader() {
    var game = getActiveGame();
    if (!game) return;

    if (els.gameTitleText) {
      els.gameTitleText.textContent = game.name;
    }
    if (els.gameTitleButton) {
      els.gameTitleButton.setAttribute(
        "aria-label",
        "Ubah nama game " + game.name
      );
      els.gameTitleButton.title =
        game.name + " — ketuk untuk mengganti nama game";
    }
    document.title = game.name + " — Remi RT";

    if (els.gameDateText) {
      els.gameDateText.textContent = formatDateFull(game.createdAt);
    }
    if (els.gameStats) {
      var bombs = Core.countEvents(game.events, "bomb");
      els.gameStats.textContent =
        game.players.length +
        " pemain · " +
        game.events.length +
        " entri · " +
        bombs +
        " bom";
    }
    if (els.thresholdValue) {
      els.thresholdValue.textContent = formatNumber(
        state.settings.bomThreshold || DEFAULT_BOMB_THRESHOLD
      );
    }

    if (els.undoButton) {
      var canUndo = game.events.length > 0 && !isAnimating;
      els.undoButton.disabled = !canUndo;
      els.undoButton.setAttribute(
        "aria-label",
        canUndo ? "Batalkan langkah terakhir" : "Belum ada langkah untuk dibatalkan"
      );
      els.undoButton.title = canUndo
        ? "Batalkan langkah terakhir (Ctrl+Z)"
        : "Belum ada langkah untuk dibatalkan";
    }
  }

  function getGameBombCount(game) {
    return Core.countEvents(game.events, "bomb");
  }

  function renderEntry(event, isLatest) {
    var signClass =
      event.type === "bomb"
        ? "entry-bomb"
        : event.type === "sub"
          ? "entry-sub"
          : "entry-add";
    var time = event.ts ? formatTime(event.ts) : "";
    var description;

    if (event.type === "bomb") {
      description =
        "Bom" +
        (event.amount < 0
          ? ", total hangus " + numberFormatter.format(Math.abs(event.amount))
          : event.amount > 0
            ? ", total disesuaikan ke nol"
            : "") +
        (time ? " pukul " + time : "");
      return (
        '<li class="entry entry-bomb' +
        (isLatest ? " entry-latest" : "") +
        '" title="' +
        escapeHtml(description) +
        '">' +
        '<span class="entry-icon" aria-hidden="true">💣</span>' +
        (event.amount !== 0
          ? '<span class="entry-value" aria-hidden="true">' +
            formatSigned(event.amount) +
            "</span>"
          : "") +
        '<span class="sr-only">' +
        escapeHtml(description) +
        "</span>" +
        "</li>"
      );
    }

    description =
      (event.amount > 0 ? "Tambah " : "Kurang ") +
      numberFormatter.format(Math.abs(event.amount)) +
      (time ? " pukul " + time : "");

    return (
      '<li class="entry ' +
      signClass +
      (isLatest ? " entry-latest" : "") +
      '" title="' +
      escapeHtml(description) +
      '">' +
      '<span class="entry-value" aria-hidden="true">' +
      formatSigned(event.amount) +
      "</span>" +
      '<span class="sr-only">' +
      escapeHtml(description) +
      "</span>" +
      "</li>"
    );
  }

  function renderBoard() {
    var game = getActiveGame();
    if (!game || !els.scoreBoard) return;

    var totals = getTotals(game);
    var entriesByPlayer = {};
    game.players.forEach(function (player) {
      entriesByPlayer[player.id] = [];
    });
    game.events.forEach(function (event) {
      if (entriesByPlayer[event.playerId]) {
        entriesByPlayer[event.playerId].push(event);
      }
    });

    var totalsArray = game.players.map(function (player) {
      return totals[player.id] || 0;
    });
    var highest = Math.max.apply(null, totalsArray);
    var hasNonZero = totalsArray.some(function (total) {
      return total !== 0;
    });
    var threshold = state.settings.bomThreshold || DEFAULT_BOMB_THRESHOLD;

    var cards = game.players
      .map(function (player, index) {
        var total = totals[player.id] || 0;
        var isLeader = hasNonZero && total === highest;
        var isRisk = total > threshold;
        var entries = entriesByPlayer[player.id];
        var active = player.id === activePlayerId ? " is-active" : "";
        var entriesHtml = entries
          .map(function (event, eventIndex) {
            return renderEntry(event, eventIndex === entries.length - 1);
          })
          .join("");
        var quickButtons = [5, 10, 50]
          .map(function (amount) {
            return (
              '<button class="score-btn score-btn-add" type="button" data-action="card-score" data-player-id="' +
              escapeHtml(player.id) +
              '" data-amount="' +
              amount +
              '" aria-label="Tambah ' +
              amount +
              " untuk " +
              escapeHtml(player.name) +
              '">+' +
              amount +
              "</button>"
            );
          })
          .join("");
        var subButtons = [-5, -10, -50]
          .map(function (amount) {
            return (
              '<button class="score-btn score-btn-sub" type="button" data-action="card-score" data-player-id="' +
              escapeHtml(player.id) +
              '" data-amount="' +
              amount +
              '" aria-label="Kurang ' +
              Math.abs(amount) +
              " untuk " +
              escapeHtml(player.name) +
              '">−' +
              Math.abs(amount) +
              "</button>"
            );
          })
          .join("");

        return (
          '<article class="player-card' +
          active +
          '" data-player-id="' +
          escapeHtml(player.id) +
          '" style="--pc: ' +
          player.color +
          '" aria-label="Kolom ' +
          escapeHtml(player.name) +
          '">' +
          '<div class="card-head">' +
          (isLeader
            ? '<span class="leader-crown" role="img" aria-label="Total tertinggi sementara" title="Total tertinggi sementara"><svg class="icon" aria-hidden="true"><use href="#i-crown"></use></svg></span>'
            : "") +
          (isRisk
            ? '<span class="risk-badge" role="img" aria-label="Rawan meledak: total di atas ' +
              escapeHtml(threshold) +
              '" title="Rawan meledak: total di atas ' +
              escapeHtml(threshold) +
              '"><svg class="icon" aria-hidden="true"><use href="#i-bomb"></use></svg></span>'
            : "") +
          '<div class="total-line">' +
          '<span class="sr-only">Total ' +
          escapeHtml(player.name) +
          ":</span>" +
          '<span class="total-value' +
          (total === 0 ? " is-zero" : "") +
          '" title="Total ' +
          escapeHtml(player.name) +
          ": " +
          formatNumber(total) +
          '">' +
          formatNumber(total) +
          "</span>" +
          "</div>" +
          '<button class="player-name" type="button" data-action="rename-player" data-player-id="' +
          escapeHtml(player.id) +
          '" aria-label="Ubah nama ' +
          escapeHtml(player.name) +
          '" title="Ubah nama ' +
          escapeHtml(player.name) +
          '"><span class="suit" aria-hidden="true">' +
          Core.PLAYER_SUITS[index % Core.PLAYER_SUITS.length] +
          '</span><span class="name-text">' +
          escapeHtml(player.name) +
          "</span></button>" +
          "</div>" +
          '<ol class="entries" aria-label="Riwayat nilai ' +
          escapeHtml(player.name) +
          '">' +
          entriesHtml +
          "</ol>" +
          '<div class="card-controls" aria-label="Panel nilai ' +
          escapeHtml(player.name) +
          '"><div class="quick-grid">' +
          quickButtons +
          subButtons +
          '</div><button class="keypad-btn" type="button" data-action="card-manual" data-player-id="' +
          escapeHtml(player.id) +
          '" aria-label="Masukkan nilai lain untuk ' +
          escapeHtml(player.name) +
          '"><svg class="icon" aria-hidden="true"><use href="#i-keyboard"></use></svg><span>Nilai lain</span></button></div>' +
          "</article>"
        );
      })
      .join("");

    els.scoreBoard.innerHTML = cards;
    els.scoreBoard.setAttribute(
      "aria-busy",
      isAnimating ? "true" : "false"
    );
    scheduleFitsAndScrolls();
  }

  function renderDock() {
    var game = getActiveGame();
    if (!game || !els.dockPlayers) return;
    var totals = getTotals(game);

    els.dockPlayers.innerHTML = game.players
      .map(function (player) {
        var active = player.id === activePlayerId;
        return (
          '<button class="player-chip" type="button" data-dock-action="select" data-player-id="' +
          escapeHtml(player.id) +
          '" style="--pc: ' +
          player.color +
          '" aria-pressed="' +
          (active ? "true" : "false") +
          '" aria-label="Pilih ' +
          escapeHtml(player.name) +
          ", total " +
          formatNumber(totals[player.id] || 0) +
          '"><span class="chip-dot" aria-hidden="true"></span><span class="chip-name">' +
          escapeHtml(player.name) +
          "</span></button>"
        );
      })
      .join("");

    updateDockActionLabels();
  }

  function updateDockActionLabels() {
    var game = getActiveGame();
    if (!game || !els.dockActions) return;
    var player = getPlayer(game, activePlayerId);
    if (!player) return;

    els.dockActions
      .querySelectorAll("[data-dock-action='score']")
      .forEach(function (button) {
        var amount = Number(button.dataset.amount);
        var verb = amount > 0 ? "Tambah" : "Kurang";
        var label =
          verb + " " + Math.abs(amount) + " untuk " + player.name;
        button.setAttribute("aria-label", label);
        button.title = label;
      });

    var manualButton = els.dockActions.querySelector(
      "[data-dock-action='manual']"
    );
    if (manualButton) {
      var manualLabel = "Masukkan nilai lain untuk " + player.name;
      manualButton.setAttribute("aria-label", manualLabel);
      manualButton.title = manualLabel;
    }
  }

  function renderAll() {
    ensureActivePlayer();
    renderHeader();
    renderBoard();
    renderDock();
    updateStorageDetails();
  }

  function updateActivePlayerUi() {
    if (els.scoreBoard) {
      var cards = els.scoreBoard.querySelectorAll(".player-card");
      cards.forEach(function (card) {
        card.classList.toggle(
          "is-active",
          card.dataset.playerId === activePlayerId
        );
      });
    }
    if (els.dockPlayers) {
      var chips = els.dockPlayers.querySelectorAll(".player-chip");
      chips.forEach(function (chip) {
        var active = chip.dataset.playerId === activePlayerId;
        chip.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    updateDockActionLabels();
  }

  function selectActivePlayer(playerId) {
    var game = getActiveGame();
    if (!game || !getPlayer(game, playerId)) return;
    activePlayerId = playerId;
    updateActivePlayerUi();
  }

  function findPlayerCard(playerId) {
    if (!els.scoreBoard) return null;
    var cards = els.scoreBoard.querySelectorAll(".player-card");
    for (var i = 0; i < cards.length; i += 1) {
      if (cards[i].dataset.playerId === playerId) return cards[i];
    }
    return null;
  }

  function setCardTotal(card, total) {
    if (!card) return;
    var value = card.querySelector(".total-value");
    if (!value) return;
    value.textContent = formatNumber(total);
    value.classList.toggle("is-zero", total === 0);
    value.style.fontSize = "";
    fitTotal(value);
  }

  function buildEntryElement(event) {
    var li = document.createElement("li");
    var isBomb = event.type === "bomb";
    li.className =
      "entry " +
      (isBomb ? "entry-bomb" : event.type === "sub" ? "entry-sub" : "entry-add");

    var value = document.createElement("span");
    value.className = "entry-value";
    value.setAttribute("aria-hidden", "true");
    value.textContent = formatSigned(event.amount);

    if (isBomb) {
      var icon = document.createElement("span");
      icon.className = "entry-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "💣";
      li.appendChild(icon);
      if (event.amount !== 0) li.appendChild(value);
    } else {
      li.appendChild(value);
    }

    var sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = isBomb
      ? "Bom" +
        (event.amount < 0
          ? ", total hangus " + numberFormatter.format(Math.abs(event.amount))
          : event.amount > 0
            ? ", total disesuaikan ke nol"
            : "")
      : (event.amount > 0 ? "Tambah " : "Kurang ") +
        numberFormatter.format(Math.abs(event.amount));
    li.appendChild(sr);

    return li;
  }

  function appendEntryToCard(playerId, event) {
    var card = findPlayerCard(playerId);
    if (!card) return;
    var list = card.querySelector(".entries");
    if (!list) return;
    var item = buildEntryElement(event);
    item.classList.add("bomb-new-entry");
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
  }

  /* ----------------------------------------------------------
     Aksi skor
     ---------------------------------------------------------- */

  function commitScore(playerId, amount, source) {
    if (isAnimating) return;
    var game = getActiveGame();
    if (!game) return;
    var player = getPlayer(game, playerId);
    if (!player) return;

    if (!Core.isSafeAmount(amount, MAX_MANUAL_AMOUNT)) {
      showToast("Nilai harus berupa angka bukan nol.");
      return;
    }

    activePlayerId = playerId;
    updateActivePlayerUi();

    var beforeTotals = getTotals(game);
    var order = getPlayerOrder(game);
    var threshold = state.settings.bomThreshold || DEFAULT_BOMB_THRESHOLD;
    var result;

    try {
      result = Core.applyScoreStep(beforeTotals, playerId, amount, {
        threshold: threshold,
        order: order
      });
    } catch (error) {
      showToast(error.message || "Nilai tidak bisa diterapkan.");
      return;
    }

    var timestamp = Date.now();
    var stepId = createId("s_");
    var scoreEvent = {
      id: createId("e_"),
      stepId: stepId,
      playerId: playerId,
      type: amount > 0 ? "add" : "sub",
      amount: amount,
      ts: timestamp
    };
    game.events.push(scoreEvent);

    var bombEvent = null;
    if (result.bombPlayerId) {
      bombEvent = {
        id: createId("e_"),
        stepId: stepId,
        playerId: result.bombPlayerId,
        type: "bomb",
        amount: result.bombAmount,
        ts: timestamp
      };
      game.events.push(bombEvent);
    }

    saveState();

    if (bombEvent) {
      startBombSequence({
        game: game,
        stepId: stepId,
        changedPlayerId: playerId,
        victimId: result.bombPlayerId,
        amount: amount,
        scoreEvent: scoreEvent,
        bombEvent: bombEvent,
        beforeTotals: result.before,
        totalsBeforeBomb: Object.assign({}, result.before, {
          [playerId]: result.before[playerId] + amount
        }),
        finalTotals: result.after,
        threshold: threshold,
        source: source
      });
      return;
    }

    var afterTotal = result.after[playerId];
    renderAll();
    announce(
      player.name +
        " " +
        formatSigned(amount) +
        ". Total " +
        player.name +
        " " +
        formatNumber(afterTotal) +
        "."
    );
    bumpTotal(playerId);
    focusControlForSource(source);
  }

  function bumpTotal(playerId) {
    if (prefersReducedMotion()) return;
    var card = findPlayerCard(playerId);
    if (!card) return;
    var total = card.querySelector(".total-value");
    if (!total || !total.animate) return;
    total.animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: "translateY(-3px) scale(1.035)", opacity: 0.92 },
        { transform: "translateY(0) scale(1)", opacity: 1 }
      ],
      {
        duration: 190,
        easing: "cubic-bezier(.2,.7,.2,1)"
      }
    );
  }

  function focusControlForSource(source) {
    if (!source) return;
    var scope = source.scope;
    if (scope === "dock" && !isMobileLayout()) {
      scope = "card";
      if (!source.playerId) source.playerId = activePlayerId;
    }

    try {
      if (scope === "dock") {
        if (source.kind === "manual") {
          var manualButton = els.dockActions.querySelector(
            "[data-dock-action='manual']"
          );
          if (manualButton) manualButton.focus({ preventScroll: true });
          return;
        }
        var amount = Number(source.amount);
        var dockButtons = els.dockActions.querySelectorAll(
          "[data-dock-action='score']"
        );
        for (var i = 0; i < dockButtons.length; i += 1) {
          if (Number(dockButtons[i].dataset.amount) === amount) {
            dockButtons[i].focus({ preventScroll: true });
            return;
          }
        }
        return;
      }

      var card = findPlayerCard(source.playerId || activePlayerId);
      if (!card) return;
      if (source.kind === "name") {
        var nameButton = card.querySelector("[data-action='rename-player']");
        if (nameButton) nameButton.focus({ preventScroll: true });
        return;
      }
      if (source.kind === "manual") {
        var keypad = card.querySelector("[data-action='card-manual']");
        if (keypad) keypad.focus({ preventScroll: true });
        return;
      }
      var controls = card.querySelectorAll("[data-action='card-score']");
      for (var j = 0; j < controls.length; j += 1) {
        if (Number(controls[j].dataset.amount) === Number(source.amount)) {
          controls[j].focus({ preventScroll: true });
          return;
        }
      }
    } catch (error) {
      // Fokus bukan hal kritis; abaikan bila browser menolak.
    }
  }

  /* ----------------------------------------------------------
     Animasi bom
     ---------------------------------------------------------- */

  function primeBombAudio() {
    if (!state || !state.settings.sound) return null;
    try {
      var AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return null;
      if (!audioContext) audioContext = new AudioContextConstructor();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(function () {});
      }
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function closeAudioContext() {
    if (!audioContext) return;
    var context = audioContext;
    audioContext = null;
    try {
      context.close().catch(function () {});
    } catch (error) {
      // Abaikan.
    }
  }

  function playBombSound() {
    if (!state || !state.settings.sound) return;
    var context = primeBombAudio();
    if (!context) return;

    try {
      var now = context.currentTime + 0.01;
      var duration = 0.65;
      var frameCount = Math.floor(context.sampleRate * duration);
      var buffer = context.createBuffer(1, frameCount, context.sampleRate);
      var data = buffer.getChannelData(0);

      for (var i = 0; i < frameCount; i += 1) {
        var decay = Math.pow(1 - i / frameCount, 2.4);
        data[i] = (Math.random() * 2 - 1) * decay;
      }

      var noise = context.createBufferSource();
      noise.buffer = buffer;

      var filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(980, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + 0.58);

      var noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.62, now + 0.018);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.64);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(context.destination);
      noise.start(now);
      noise.stop(now + duration);

      var oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(86, now);
      oscillator.frequency.exponentialRampToValueAtTime(32, now + 0.45);

      var bassGain = context.createGain();
      bassGain.gain.setValueAtTime(0.0001, now);
      bassGain.gain.exponentialRampToValueAtTime(0.34, now + 0.02);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

      oscillator.connect(bassGain);
      bassGain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.58);
    } catch (error) {
      // Suara adalah bonus, bukan kebutuhan.
    }
  }

  function spawnBombBurst(card, reduced) {
    if (!card) return null;
    var burst = document.createElement("div");
    burst.className = "bomb-burst";
    burst.setAttribute("aria-hidden", "true");

    var flash = document.createElement("div");
    flash.className = "flash";
    burst.appendChild(flash);

    if (!reduced) {
      var core = document.createElement("div");
      core.className = "blast-core";
      burst.appendChild(core);

      var ring = document.createElement("div");
      ring.className = "blast-ring";
      burst.appendChild(ring);

      var colors = ["#ffe9a6", "#ffc85a", "#f7a03e", "#ef6f3a", "#d94a2c"];
      var width = Math.max(card.clientWidth || 100, 80);
      var maxDistance = Math.min(150, Math.max(45, width * 0.9));

      for (var i = 0; i < 18; i += 1) {
        var particle = document.createElement("span");
        particle.className = "bomb-particle";
        var angle = Math.random() * Math.PI * 2;
        var distance = 24 + Math.random() * maxDistance;
        var size = 3 + Math.random() * 6;
        particle.style.setProperty(
          "--dx",
          (Math.cos(angle) * distance).toFixed(1) + "px"
        );
        particle.style.setProperty(
          "--dy",
          (Math.sin(angle) * distance - 12).toFixed(1) + "px"
        );
        particle.style.setProperty("--size", size.toFixed(1) + "px");
        particle.style.setProperty(
          "--particle-color",
          colors[Math.floor(Math.random() * colors.length)]
        );
        particle.style.setProperty(
          "--particle-radius",
          Math.random() > 0.55 ? "2px" : "50%"
        );
        particle.style.setProperty(
          "--duration",
          (0.45 + Math.random() * 0.28).toFixed(2) + "s"
        );
        particle.style.setProperty(
          "--delay",
          (Math.random() * 0.07).toFixed(2) + "s"
        );
        particle.style.setProperty(
          "--rotate",
          Math.floor(Math.random() * 360) + "deg"
        );
        burst.appendChild(particle);
      }

      for (var j = 0; j < 4; j += 1) {
        var smoke = document.createElement("span");
        smoke.className = "bomb-smoke";
        var smokeAngle = Math.random() * Math.PI * 2;
        var smokeDistance = 20 + Math.random() * maxDistance * 0.5;
        smoke.style.setProperty(
          "--dx",
          (Math.cos(smokeAngle) * smokeDistance).toFixed(1) + "px"
        );
        smoke.style.setProperty(
          "--dy",
          (Math.sin(smokeAngle) * smokeDistance - 15).toFixed(1) + "px"
        );
        smoke.style.setProperty(
          "--delay",
          (0.05 + Math.random() * 0.08).toFixed(2) + "s"
        );
        burst.appendChild(smoke);
      }
    }

    card.appendChild(burst);
    return burst;
  }

  function setAnimationLock(locked) {
    isAnimating = locked;
    document.body.classList.toggle("is-animating", locked);
    if (els.scoreBoard) {
      els.scoreBoard.setAttribute("aria-busy", locked ? "true" : "false");
    }
    if (els.app) {
      try {
        els.app.inert = locked;
      } catch (error) {
        // Browser lama tidak mendukung inert; overlay tetap menutup layar.
      }
    }

    if (els.undoButton) els.undoButton.disabled = locked;
    var buttons = document.querySelectorAll(
      ".dock-score, .dock-keypad, .dock-players button, .score-btn, .keypad-btn"
    );
    buttons.forEach(function (button) {
      button.disabled = locked;
    });
  }

  function startBombSequence(data) {
    if (isAnimating) return;
    var game = data.game;
    var victim = getPlayer(game, data.victimId);
    var changed = getPlayer(game, data.changedPlayerId);
    if (!victim || !changed) {
      renderAll();
      return;
    }

    var victimCard = findPlayerCard(data.victimId);
    var changedCard = findPlayerCard(data.changedPlayerId);
    if (!victimCard || !changedCard) {
      renderAll();
      return;
    }

    var reduced = prefersReducedMotion();
    var durations = reduced ? BOMB_DURATIONS.reduced : BOMB_DURATIONS.normal;
    var totalDuration =
      durations.warning + durations.fuse + durations.explosion + durations.settle;
    var timers = [];
    var burst = null;
    var alert = null;
    var skipLayer = null;
    var countdownFrame = 0;
    var finished = false;

    primeBombAudio();
    window.clearTimeout(toastTimer);
    if (els.toast) els.toast.classList.remove("is-visible");

    // Perubahan skor pemicu langsung terlihat; total korban masih pada nilai
    // sebelum bom, lalu diruntuhkan ke 0 pada tahap hangus.
    setCardTotal(changedCard, data.totalsBeforeBomb[data.changedPlayerId]);
    if (data.victimId !== data.changedPlayerId) {
      setCardTotal(victimCard, data.totalsBeforeBomb[data.victimId]);
    }
    appendEntryToCard(data.changedPlayerId, data.scoreEvent);

    victimCard.classList.add("is-doomed");

    alert = document.createElement("div");
    alert.className = "bomb-alert";
    alert.setAttribute("aria-hidden", "true");
    alert.innerHTML =
      '<div class="bomb-orb"><svg class="icon" aria-hidden="true"><use href="#i-bomb"></use></svg><span class="bomb-fuse-spark"></span></div><span class="bomb-label">Bom!</span>';
    victimCard.appendChild(alert);

    skipLayer = document.createElement("button");
    skipLayer.type = "button";
    skipLayer.className = "bomb-skip-layer";
    skipLayer.setAttribute("aria-label", "Lewati animasi bom");
    skipLayer.innerHTML =
      '<span class="bomb-skip-hint">Ketuk untuk lewati</span>';
    skipLayer.addEventListener("click", function () {
      finishBomb(true);
    });
    document.body.appendChild(skipLayer);

    setAnimationLock(true);
    announceBomb(
      "Bom! " +
        victim.name +
        " tersalip. Total " +
        victim.name +
        " menjadi " +
        formatNumber(0) +
        "."
    );

    try {
      skipLayer.focus({ preventScroll: true });
    } catch (error) {
      // Abaikan.
    }

    function detonate() {
      if (finished) return;
      if (alert && alert.parentNode) alert.remove();
      victimCard.classList.add("is-exploding");
      burst = spawnBombBurst(victimCard, reduced);
      playBombSound();

      if (!reduced) {
        if (els.scoreBoard) {
          els.scoreBoard.classList.add("is-shaking");
          timers.push(
            window.setTimeout(function () {
              if (els.scoreBoard) {
                els.scoreBoard.classList.remove("is-shaking");
              }
            }, 420)
          );
        }
        try {
          if (navigator.vibrate) navigator.vibrate([55, 25, 110]);
        } catch (error) {
          // Getaran tidak didukung.
        }
      }
    }

    function animateVictimTotal() {
      if (finished) return;
      victimCard.classList.add("is-counting", "is-charred");
      appendEntryToCard(data.victimId, data.bombEvent);
      var value = victimCard.querySelector(".total-value");
      if (!value) return;
      var from = data.totalsBeforeBomb[data.victimId];
      var duration = Math.max(180, durations.settle - 60);
      var startedAt = 0;

      function tick(now) {
        if (finished) return;
        if (!startedAt) startedAt = now;
        var progress = Math.min(1, (now - startedAt) / duration);
        var eased = 1 - Math.pow(1 - progress, 3);
        var next = Math.round(from * (1 - eased));
        value.textContent = formatNumber(next);
        if (progress < 1) {
          countdownFrame = window.requestAnimationFrame(tick);
        }
      }

      countdownFrame = window.requestAnimationFrame(tick);
    }

    function finishBomb(wasSkipped) {
      if (finished) return;
      finished = true;
      timers.forEach(function (timer) {
        window.clearTimeout(timer);
      });
      window.cancelAnimationFrame(countdownFrame);
      if (skipLayer && skipLayer.parentNode) skipLayer.remove();
      if (alert && alert.parentNode) alert.remove();
      if (burst && burst.parentNode) burst.remove();
      if (els.scoreBoard) els.scoreBoard.classList.remove("is-shaking");
      closeAudioContext();
      setAnimationLock(false);
      renderAll();
      focusControlForSource(data.source);
      if (wasSkipped) {
        announce(
          "Animasi dilewati. Total " +
            victim.name +
            " sekarang " +
            formatNumber(0) +
            "."
        );
      }
    }

    function schedule(fn, delay) {
      timers.push(window.setTimeout(fn, delay));
    }

    schedule(function () {
      if (alert) alert.classList.add("is-fused");
    }, durations.warning);

    schedule(detonate, durations.warning + durations.fuse);

    schedule(
      animateVictimTotal,
      durations.warning + durations.fuse + durations.explosion
    );

    schedule(function () {
      finishBomb(false);
    }, totalDuration);
  }

  /* ----------------------------------------------------------
     Undo
     ---------------------------------------------------------- */

  function undoLastStep() {
    if (isAnimating) return;
    var game = getActiveGame();
    if (!game || game.events.length === 0) {
      announce("Belum ada langkah untuk dibatalkan.");
      return;
    }

    var lastStepId = Core.getLastStepId(game.events);
    if (!lastStepId) return;
    var stepEvents = Core.getStepEvents(game.events, lastStepId);
    var scoreEvent = stepEvents.find(function (event) {
      return event.type === "add" || event.type === "sub";
    });
    var bombEvent = stepEvents.find(function (event) {
      return event.type === "bomb";
    });
    var player = scoreEvent ? getPlayer(game, scoreEvent.playerId) : null;
    var victim = bombEvent ? getPlayer(game, bombEvent.playerId) : null;

    game.events = Core.removeStep(game.events, lastStepId);
    if (scoreEvent) activePlayerId = scoreEvent.playerId;
    saveState();
    renderAll();

    if (player) {
      focusControlForSource({ scope: "card", kind: "name", playerId: player.id });
    }

    var message;
    if (player && bombEvent && victim) {
      message =
        "Langkah " +
        player.name +
        " dibatalkan. Bom pada " +
        victim.name +
        " juga dipulihkan.";
    } else if (player) {
      message = "Langkah " + player.name + " dibatalkan.";
    } else {
      message = "Langkah terakhir dibatalkan.";
    }
    announce(message);
    showToast(message);
    if (els.undoButton) els.undoButton.focus({ preventScroll: true });
  }

  /* ----------------------------------------------------------
     Pilihan skor manual
     ---------------------------------------------------------- */

  function openManualDialog(playerId) {
    var game = getActiveGame();
    var player = getPlayer(game, playerId);
    if (!player) return;
    activePlayerId = player.id;
    updateActivePlayerUi();
    manualContext = { playerId: player.id };
    var totals = getTotals(game);

    els.manualPlayerDot.style.setProperty("--pc", player.color);
    els.manualPlayerName.textContent = player.name;
    els.manualPlayerTotal.textContent = formatNumber(totals[player.id] || 0);
    els.manualInput.value = "";
    els.manualInput.removeAttribute("aria-invalid");
    els.manualError.textContent = "";
    els.manualDialog.showModal();
    window.requestAnimationFrame(function () {
      els.manualInput.focus();
      els.manualInput.select();
    });
  }

  function applyManualValue(sign) {
    if (!manualContext) return;
    var raw = els.manualInput.value.replace(/\D/g, "");
    var value = Number(raw);

    if (!raw || !Number.isSafeInteger(value) || value <= 0) {
      els.manualInput.setAttribute("aria-invalid", "true");
      els.manualError.textContent = "Masukkan angka lebih dari 0.";
      els.manualInput.focus();
      return;
    }
    if (value > MAX_MANUAL_AMOUNT) {
      els.manualInput.setAttribute("aria-invalid", "true");
      els.manualError.textContent =
        "Nilai maksimal " + numberFormatter.format(MAX_MANUAL_AMOUNT) + ".";
      els.manualInput.focus();
      return;
    }

    var playerId = manualContext.playerId;
    els.manualInput.removeAttribute("aria-invalid");
    els.manualError.textContent = "";
    manualContext = null;
    if (els.manualDialog.open) els.manualDialog.close();
    commitScore(playerId, sign * value, {
      scope: "dock",
      kind: "manual",
      playerId: playerId
    });
  }

  /* ----------------------------------------------------------
     Rename
     ---------------------------------------------------------- */

  function openRenameGame(gameId, options) {
    var opts = options || {};
    var game = gameId
      ? state.games.find(function (item) {
          return item.id === gameId;
        })
      : getActiveGame();
    if (!game) return;
    renameContext = {
      kind: "game",
      id: game.id,
      fromHistory: Boolean(opts.fromHistory)
    };
    els.renameEyebrow.textContent = "Nama meja";
    els.renameTitle.textContent = "Ubah nama game";
    els.renameLabel.textContent = "Nama game";
    els.renameInput.maxLength = MAX_GAME_NAME;
    els.renameInput.value = game.name;
    els.renameError.textContent = "";
    els.renameInput.removeAttribute("aria-invalid");
    els.renameDialog.showModal();
    window.requestAnimationFrame(function () {
      els.renameInput.focus();
      els.renameInput.select();
    });
  }

  function openRenamePlayer(playerId) {
    var game = getActiveGame();
    var player = getPlayer(game, playerId);
    if (!player) return;
    renameContext = {
      kind: "player",
      id: player.id,
      gameId: game.id,
      fromHistory: false
    };
    els.renameEyebrow.textContent = "Di kolom " + player.name;
    els.renameTitle.textContent = "Ubah nama pemain";
    els.renameLabel.textContent = "Nama pemain";
    els.renameInput.maxLength = MAX_PLAYER_NAME;
    els.renameInput.value = player.name;
    els.renameError.textContent = "";
    els.renameInput.removeAttribute("aria-invalid");
    els.renameDialog.showModal();
    window.requestAnimationFrame(function () {
      els.renameInput.focus();
      els.renameInput.select();
    });
  }

  function submitRename(event) {
    event.preventDefault();
    if (!renameContext) return;
    var context = renameContext;
    var cleaned = cleanOptionalName(
      els.renameInput.value,
      context.kind === "game" ? MAX_GAME_NAME : MAX_PLAYER_NAME
    );

    if (!cleaned) {
      els.renameInput.setAttribute("aria-invalid", "true");
      els.renameError.textContent = "Nama tidak boleh kosong.";
      els.renameInput.focus();
      return;
    }

    if (context.kind === "game") {
      var game = state.games.find(function (item) {
        return item.id === context.id;
      });
      if (!game) return;
      game.name = cleanName(cleaned, game.name, MAX_GAME_NAME);
      renameContext = null;
      if (els.renameDialog.open) els.renameDialog.close();
      saveState();
      renderAll();
      if (context.fromHistory && els.historyDialog.open) {
        renderHistory();
      }
      showToast("Nama game diperbarui.");
      try {
        els.gameTitleButton.focus({ preventScroll: true });
      } catch (error) {
        // Abaikan.
      }
      return;
    }

    if (context.kind === "player") {
      var activeGame = getActiveGame();
      var player = getPlayer(activeGame, context.id);
      if (!player) return;
      player.name = cleanName(cleaned, player.name, MAX_PLAYER_NAME);
      renameContext = null;
      if (els.renameDialog.open) els.renameDialog.close();
      saveState();
      renderAll();
      showToast("Nama pemain diperbarui.");
      focusControlForSource({
        scope: "card",
        kind: "name",
        playerId: player.id
      });
    }
  }

  /* ----------------------------------------------------------
     Konfirmasi
     ---------------------------------------------------------- */

  function askConfirm(options) {
    if (!els.confirmDialog) return Promise.resolve(false);
    if (els.confirmDialog.open) {
      return Promise.resolve(false);
    }

    return new Promise(function (resolve) {
      confirmResolver = resolve;
      els.confirmEyebrow.textContent = options.eyebrow || "Konfirmasi";
      els.confirmTitle.textContent = options.title || "Yakin?";
      els.confirmMessage.textContent = options.message || "";
      els.confirmAccept.textContent = options.acceptLabel || "Ya, lanjutkan";
      els.confirmAccept.className = options.danger === false
        ? "button button-primary"
        : "button button-danger";
      els.confirmDialog.showModal();
      window.requestAnimationFrame(function () {
        els.confirmCancel.focus();
      });
    });
  }

  function settleConfirm(value) {
    if (!confirmResolver) return;
    var resolve = confirmResolver;
    confirmResolver = null;
    if (els.confirmDialog.open) els.confirmDialog.close();
    resolve(value);
  }

  function handleConfirmClose() {
    if (!confirmResolver) return;
    var resolve = confirmResolver;
    confirmResolver = null;
    resolve(false);
  }

  /* ----------------------------------------------------------
     Game baru
     ---------------------------------------------------------- */

  function openNewGameDialog() {
    if (!state) return;
    els.newGameForm.reset();
    els.newGameName.placeholder = defaultGameName(new Date());
    var inputs = els.newGameForm.querySelectorAll("[data-player-index]");
    inputs.forEach(function (input, index) {
      input.value = "";
      input.placeholder = DEFAULT_PLAYER_NAMES[index];
    });
    els.newGameDialog.showModal();
    window.requestAnimationFrame(function () {
      els.newGameName.focus();
    });
  }

  function submitNewGame(event) {
    event.preventDefault();
    var inputs = els.newGameForm.querySelectorAll("[data-player-index]");
    var names = Array.prototype.map.call(inputs, function (input, index) {
      return cleanName(
        input.value,
        DEFAULT_PLAYER_NAMES[index],
        MAX_PLAYER_NAME
      );
    });
    var gameName = cleanOptionalName(els.newGameName.value, MAX_GAME_NAME);
    var game = buildGame({
      name: gameName || defaultGameName(new Date()),
      playerNames: names
    });

    state.games.unshift(game);
    state.activeGameId = game.id;
    activePlayerId = game.players[0].id;
    saveState();
    if (els.newGameDialog.open) els.newGameDialog.close();
    renderAll();
    showToast('Game "' + game.name + '" dimulai dari skor 0.');
    focusControlForSource({ scope: "dock", kind: "manual" });
    if (isMobileLayout()) {
      var activeChip = els.dockPlayers.querySelector('[aria-pressed="true"]');
      if (activeChip) activeChip.focus({ preventScroll: true });
    } else {
      var firstCard = findPlayerCard(activePlayerId);
      var firstControl = firstCard
        ? firstCard.querySelector("[data-action='card-score']")
        : null;
      if (firstControl) firstControl.focus({ preventScroll: true });
    }
  }

  /* ----------------------------------------------------------
     Riwayat
     ---------------------------------------------------------- */

  function openHistory() {
    renderHistory();
    els.historyDialog.showModal();
  }

  function renderHistory() {
    if (!els.historyList) return;
    var games = state.games.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    if (games.length === 0) {
      els.historyList.innerHTML =
        '<div class="history-empty"><strong>Belum ada game</strong>Mulai game baru untuk mengisi riwayat.</div>';
      return;
    }

    els.historyList.innerHTML = games
      .map(function (game) {
        var totals = getTotals(game);
        var active = game.id === state.activeGameId;
        var bombs = getGameBombCount(game);
        var playersHtml = game.players
          .map(function (player, index) {
            return (
              '<div class="history-player" style="--pc: ' +
              player.color +
              '"><span class="history-suit" aria-hidden="true">' +
              Core.PLAYER_SUITS[index % Core.PLAYER_SUITS.length] +
              '</span><span class="history-player-name">' +
              escapeHtml(player.name) +
              '</span><span class="history-player-total">' +
              formatNumber(totals[player.id] || 0) +
              "</span></div>"
            );
          })
          .join("");

        return (
          '<article class="history-card' +
          (active ? " is-active" : "") +
          '" data-game-id="' +
          escapeHtml(game.id) +
          '" style="--pc: ' +
          game.players[0].color +
          '">' +
          '<div class="history-top"><div class="history-title-wrap"><h3 class="history-title" title="' +
          escapeHtml(game.name) +
          '">' +
          escapeHtml(game.name) +
          '</h3><span class="history-date">' +
          escapeHtml(formatDateTime(game.createdAt)) +
          "</span></div>" +
          (active
            ? '<span class="current-badge">Dimainkan</span>'
            : "") +
          "</div>" +
          '<div class="history-players">' +
          playersHtml +
          "</div>" +
          '<div class="history-meta">' +
          game.events.length +
          " entri" +
          (bombs
            ? '<span class="bomb-count"><svg class="icon" aria-hidden="true"><use href="#i-bomb"></use></svg>' +
              bombs +
              " bom</span>"
            : " · 0 bom") +
          "</div>" +
          '<div class="history-actions">' +
          '<button class="button button-primary history-open" type="button" data-history-action="open" data-game-id="' +
          escapeHtml(game.id) +
          '" aria-label="' +
          (active ? "Kembali ke " : "Buka ") +
          escapeHtml(game.name) +
          '">' +
          (active ? "Kembali" : "Buka game") +
          "</button>" +
          '<button class="history-icon-button" type="button" data-history-action="duplicate" data-game-id="' +
          escapeHtml(game.id) +
          '" title="Duplikat pemain ke game baru" aria-label="Duplikat pemain dari ' +
          escapeHtml(game.name) +
          ' ke game baru"><svg class="icon" aria-hidden="true"><use href="#i-copy"></use></svg></button>' +
          '<button class="history-icon-button" type="button" data-history-action="rename" data-game-id="' +
          escapeHtml(game.id) +
          '" title="Ganti nama game" aria-label="Ganti nama ' +
          escapeHtml(game.name) +
          '"><svg class="icon" aria-hidden="true"><use href="#i-pencil"></use></svg></button>' +
          '<button class="history-icon-button is-danger" type="button" data-history-action="delete" data-game-id="' +
          escapeHtml(game.id) +
          '" title="Hapus game" aria-label="Hapus ' +
          escapeHtml(game.name) +
          '"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function openHistoryGame(gameId) {
    var game = state.games.find(function (item) {
      return item.id === gameId;
    });
    if (!game) return;
    state.activeGameId = game.id;
    activePlayerId = game.players[0].id;
    saveState();
    if (els.historyDialog.open) els.historyDialog.close();
    renderAll();
    showToast('Game "' + game.name + '" dibuka.');
  }

  function duplicateGame(gameId) {
    var source = state.games.find(function (game) {
      return game.id === gameId;
    });
    if (!source) return;
    var baseName = source.name + " (salinan)";
    var duplicate = buildGame({
      name: baseName,
      players: source.players.map(function (player) {
        return { name: player.name, color: player.color };
      })
    });
    state.games.unshift(duplicate);
    state.activeGameId = duplicate.id;
    activePlayerId = duplicate.players[0].id;
    saveState();
    if (els.historyDialog.open) els.historyDialog.close();
    renderAll();
    showToast("Game baru dibuat dengan pemain yang sama.");
  }

  async function deleteGame(gameId) {
    var game = state.games.find(function (item) {
      return item.id === gameId;
    });
    if (!game) return;

    var confirmed = await askConfirm({
      eyebrow: "Hapus game",
      title: "Hapus game ini?",
      message:
        '"' +
        game.name +
        '" dengan ' +
        game.events.length +
        " entri akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.",
      acceptLabel: "Hapus game",
      danger: true
    });
    if (!confirmed) return;

    state.games = state.games.filter(function (item) {
      return item.id !== gameId;
    });

    if (state.activeGameId === gameId) {
      if (state.games.length === 0) {
        var replacement = buildGame({
          name: defaultGameName(new Date()),
          playerNames: DEFAULT_PLAYER_NAMES.slice()
        });
        state.games.push(replacement);
        state.activeGameId = replacement.id;
        activePlayerId = replacement.players[0].id;
      } else {
        state.activeGameId = state.games[0].id;
        activePlayerId = state.games[0].players[0].id;
      }
    }

    ensureActivePlayer();
    saveState();
    renderAll();
    if (els.historyDialog.open) renderHistory();
    showToast('Game "' + game.name + '" dihapus.');
  }

  function handleHistoryClick(event) {
    var button = event.target.closest("[data-history-action]");
    if (!button) return;
    var action = button.dataset.historyAction;
    var gameId = button.dataset.gameId;
    if (!gameId) return;

    if (action === "open") {
      openHistoryGame(gameId);
    } else if (action === "duplicate") {
      duplicateGame(gameId);
    } else if (action === "rename") {
      openRenameGame(gameId, { fromHistory: true });
    } else if (action === "delete") {
      deleteGame(gameId);
    }
  }

  /* ----------------------------------------------------------
     Pengaturan, ekspor, impor
     ---------------------------------------------------------- */

  function openSettings() {
    els.settingsMessage.textContent = "";
    els.settingsMessage.className = "settings-message";
    var theme = state.settings.theme;
    document
      .querySelectorAll('input[name="theme"]')
      .forEach(function (radio) {
        radio.checked = radio.value === theme;
      });
    els.soundToggle.checked = state.settings.sound === true;
    updateStorageDetails();
    els.settingsDialog.showModal();
  }

  function setSettingsMessage(message, type) {
    if (!els.settingsMessage) return;
    els.settingsMessage.textContent = message;
    els.settingsMessage.className = "settings-message";
    if (type) els.settingsMessage.classList.add("is-" + type);
  }

  function exportData() {
    try {
      var payload = JSON.stringify(state, null, 2);
      var blob = new Blob([payload], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      var datePart = dateStampForFile(new Date());
      link.href = url;
      link.download = "papan-skor-remi-" + datePart + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      if (els.settingsDialog.open) {
        setSettingsMessage("Cadangan JSON berhasil diunduh.", "success");
      }
      showToast("Cadangan JSON diunduh.");
    } catch (error) {
      if (els.settingsDialog.open) {
        setSettingsMessage("Gagal membuat file cadangan.", "error");
      }
      showToast("Gagal membuat file cadangan.");
    }
  }

  async function importDataFromFile(file) {
    if (!file) return;
    els.importFile.value = "";
    setSettingsMessage("Membaca cadangan…", "");

    if (file.size > 5 * 1024 * 1024) {
      setSettingsMessage("File cadangan terlalu besar (maksimal 5 MB).", "error");
      return;
    }

    var imported;
    try {
      var text = await file.text();
      text = text.replace(/^\uFEFF/, "");
      var parsed = JSON.parse(text);
      imported = normaliseState(parsed, { strict: true });
    } catch (error) {
      setSettingsMessage(
        "Impor gagal: " + (error.message || "file tidak dikenali."),
        "error"
      );
      return;
    }

    var confirmed = await askConfirm({
      eyebrow: "Pulihkan data",
      title: "Impor cadangan?",
      message:
        "Cadangan berisi " +
        imported.games.length +
        " game. Semua game dan pengaturan yang sekarang akan diganti. Pastikan Anda sudah mengekspor data saat ini bila perlu.",
      acceptLabel: "Impor & ganti",
      danger: true
    });
    if (!confirmed) {
      setSettingsMessage("Impor dibatalkan.", "");
      return;
    }

    state = imported;
    ensureActivePlayer();
    saveState();
    applyThemeSetting(state.settings.theme, { persist: false });
    if (els.settingsDialog.open) els.settingsDialog.close();
    renderAll();
    showToast("Cadangan berhasil dipulihkan.");
  }

  /* ----------------------------------------------------------
     Menu
     ---------------------------------------------------------- */

  function openMenu() {
    menuDismissGuard = false;
    els.appMenu.hidden = false;
    menuIsOpen = true;
    els.menuButton.setAttribute("aria-expanded", "true");
    els.menuButton.setAttribute("aria-label", "Tutup menu");
    var firstItem = els.appMenu.querySelector("button");
    if (firstItem) {
      window.requestAnimationFrame(function () {
        firstItem.focus();
      });
    }
  }

  function closeMenu(options) {
    var opts = options || {};
    if (!els.appMenu) return;
    els.appMenu.hidden = true;
    menuIsOpen = false;
    if (els.menuButton) {
      els.menuButton.setAttribute("aria-expanded", "false");
      els.menuButton.setAttribute("aria-label", "Buka menu");
      if (opts.restoreFocus) {
        try {
          els.menuButton.focus({ preventScroll: true });
        } catch (error) {
          // Abaikan.
        }
      }
    }
  }

  function toggleMenu(event) {
    if (event) event.stopPropagation();
    if (menuIsOpen) {
      closeMenu({ restoreFocus: true });
    } else {
      openMenu();
    }
  }

  function handleMenuAction(action) {
    closeMenu({ restoreFocus: false });
    // Fokus dikembalikan ke tombol menu saat dialog ditutup, bukan ke item
    // menu yang sudah tersembunyi.
    if (els.menuButton) {
      try {
        els.menuButton.focus({ preventScroll: true });
      } catch (error) {
        // Abaikan.
      }
    }
    if (action === "new-game") {
      openNewGameDialog();
    } else if (action === "history") {
      openHistory();
    } else if (action === "settings") {
      openSettings();
    } else if (action === "export") {
      exportData();
    }
  }

  function handleDocumentPointerDown(event) {
    if (!menuIsOpen) return;
    if (
      els.appMenu.contains(event.target) ||
      els.menuButton.contains(event.target)
    ) {
      return;
    }
    closeMenu({ restoreFocus: false });
    // Jangan biarkan ketukan yang menutup menu ikut menekan tombol skor
    // yang kebetulan berada di bawahnya.
    menuDismissGuard = true;
    window.setTimeout(function () {
      menuDismissGuard = false;
    }, 350);
  }

  function handleDocumentClickCapture(event) {
    if (!menuDismissGuard) return;
    if (els.menuButton && els.menuButton.contains(event.target)) return;
    menuDismissGuard = false;
    event.preventDefault();
    event.stopPropagation();
  }

  /* ----------------------------------------------------------
     Event global
     ---------------------------------------------------------- */

  function handleGlobalKeyDown(event) {
    if (isAnimating) {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        if (event.key === "Escape") {
          var skip = document.querySelector(".bomb-skip-layer");
          if (skip) skip.click();
        } else {
          var skipFocus = document.querySelector(".bomb-skip-layer");
          if (skipFocus) skipFocus.focus();
        }
      }
      return;
    }

    if (menuIsOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
        return;
      }
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        var items = Array.prototype.slice.call(
          els.appMenu.querySelectorAll("button")
        );
        if (!items.length) return;
        var currentIndex = items.indexOf(document.activeElement);
        var nextIndex = 0;
        if (event.key === "ArrowDown") {
          nextIndex = (currentIndex + 1) % items.length;
        } else if (event.key === "ArrowUp") {
          nextIndex =
            (currentIndex - 1 + items.length) % items.length;
        } else if (event.key === "End") {
          nextIndex = items.length - 1;
        }
        event.preventDefault();
        items[nextIndex].focus();
        return;
      }
    }

    var anyDialog = hasOpenDialog();
    if (
      !anyDialog &&
      !isTextEntry(event.target) &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      undoLastStep();
    }
  }

  function handleResize() {
    scheduleFitsAndScrolls();
  }

  /* ----------------------------------------------------------
     Inisialisasi
     ---------------------------------------------------------- */

  function cacheElements() {
    els.app = document.getElementById("app");
    els.gameTitleButton = document.getElementById("gameTitleButton");
    els.gameTitleText = document.getElementById("gameTitleText");
    els.undoButton = document.getElementById("undoButton");
    els.menuButton = document.getElementById("menuButton");
    els.appMenu = document.getElementById("appMenu");
    els.storageBanner = document.getElementById("storageBanner");
    els.gameDateText = document.getElementById("gameDateText");
    els.gameStats = document.getElementById("gameStats");
    els.thresholdValue = document.getElementById("thresholdValue");
    els.scoreBoard = document.getElementById("scoreBoard");
    els.dockPlayers = document.getElementById("dockPlayers");
    els.dockActions = document.querySelector(".dock-actions");
    els.toast = document.getElementById("toast");
    els.scoreAnnouncer = document.getElementById("scoreAnnouncer");
    els.bombAnnouncer = document.getElementById("bombAnnouncer");

    els.newGameDialog = document.getElementById("newGameDialog");
    els.newGameForm = document.getElementById("newGameForm");
    els.newGameName = document.getElementById("newGameName");

    els.historyDialog = document.getElementById("historyDialog");
    els.historyList = document.getElementById("historyList");

    els.settingsDialog = document.getElementById("settingsDialog");
    els.soundToggle = document.getElementById("soundToggle");
    els.exportButton = document.getElementById("exportButton");
    els.importButton = document.getElementById("importButton");
    els.importFile = document.getElementById("importFile");
    els.settingsMessage = document.getElementById("settingsMessage");
    els.storageDetails = document.getElementById("storageDetails");

    els.renameDialog = document.getElementById("renameDialog");
    els.renameForm = document.getElementById("renameForm");
    els.renameEyebrow = document.getElementById("renameEyebrow");
    els.renameTitle = document.getElementById("renameTitle");
    els.renameLabel = document.getElementById("renameLabel");
    els.renameInput = document.getElementById("renameInput");
    els.renameError = document.getElementById("renameError");

    els.manualDialog = document.getElementById("manualDialog");
    els.manualForm = document.getElementById("manualForm");
    els.manualPlayerDot = document.getElementById("manualPlayerDot");
    els.manualPlayerName = document.getElementById("manualPlayerName");
    els.manualPlayerTotal = document.getElementById("manualPlayerTotal");
    els.manualInput = document.getElementById("manualInput");
    els.manualError = document.getElementById("manualError");
    els.manualAdd = document.getElementById("manualAdd");
    els.manualSubtract = document.getElementById("manualSubtract");

    els.confirmDialog = document.getElementById("confirmDialog");
    els.confirmEyebrow = document.getElementById("confirmEyebrow");
    els.confirmTitle = document.getElementById("confirmTitle");
    els.confirmMessage = document.getElementById("confirmMessage");
    els.confirmAccept = document.getElementById("confirmAccept");
    els.confirmCancel = document.getElementById("confirmCancel");
    els.confirmClose = document.getElementById("confirmClose");
  }

  function handleBoardClick(event) {
    if (isAnimating) return;
    var card = event.target.closest(".player-card");
    if (!card) return;
    var playerId = card.dataset.playerId;
    var control = event.target.closest("[data-action]");

    if (control && card.contains(control)) {
      var action = control.dataset.action;
      if (action === "card-score") {
        selectActivePlayer(playerId);
        commitScore(playerId, Number(control.dataset.amount), {
          scope: "card",
          kind: "score",
          playerId: playerId,
          amount: Number(control.dataset.amount)
        });
      } else if (action === "card-manual") {
        openManualDialog(playerId);
      } else if (action === "rename-player") {
        openRenamePlayer(playerId);
      }
      return;
    }

    selectActivePlayer(playerId);
  }

  function handleDockClick(event) {
    if (isAnimating) return;
    var button = event.target.closest("[data-dock-action]");
    if (!button) return;
    var action = button.dataset.dockAction;
    if (action === "select") {
      selectActivePlayer(button.dataset.playerId);
      return;
    }

    if (!activePlayerId) ensureActivePlayer();
    if (!activePlayerId) return;
    if (action === "score") {
      var amount = Number(button.dataset.amount);
      commitScore(activePlayerId, amount, {
        scope: "dock",
        kind: "score",
        playerId: activePlayerId,
        amount: amount
      });
    } else if (action === "manual") {
      openManualDialog(activePlayerId);
    }
  }

  function bindEvents() {
    if (els.undoButton) {
      els.undoButton.addEventListener("click", undoLastStep);
    }
    if (els.gameTitleButton) {
      els.gameTitleButton.addEventListener("click", function () {
        openRenameGame();
      });
    }
    if (els.menuButton) {
      els.menuButton.addEventListener("click", toggleMenu);
    }
    if (els.appMenu) {
      els.appMenu.addEventListener("click", function (event) {
        var item = event.target.closest("[data-menu-action]");
        if (!item) return;
        handleMenuAction(item.dataset.menuAction);
      });
    }

    if (els.scoreBoard) {
      els.scoreBoard.addEventListener("click", handleBoardClick);
    }
    if (els.dockPlayers) {
      els.dockPlayers.addEventListener("click", handleDockClick);
    }
    if (els.dockActions) {
      els.dockActions.addEventListener("click", handleDockClick);
    }

    if (els.newGameForm) {
      els.newGameForm.addEventListener("submit", submitNewGame);
    }
    if (els.renameForm) {
      els.renameForm.addEventListener("submit", submitRename);
    }
    if (els.manualForm) {
      els.manualForm.addEventListener("submit", function (event) {
        event.preventDefault();
        applyManualValue(1);
      });
    }
    if (els.manualInput) {
      els.manualInput.addEventListener("input", function () {
        var cleaned = els.manualInput.value.replace(/\D/g, "").slice(0, 7);
        if (els.manualInput.value !== cleaned) {
          els.manualInput.value = cleaned;
        }
        els.manualInput.removeAttribute("aria-invalid");
        els.manualError.textContent = "";
      });
      els.manualInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          applyManualValue(1);
        }
      });
    }
    if (els.manualAdd) {
      els.manualAdd.addEventListener("click", function () {
        applyManualValue(1);
      });
    }
    if (els.manualSubtract) {
      els.manualSubtract.addEventListener("click", function () {
        applyManualValue(-1);
      });
    }

    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        var dialog = button.closest("dialog");
        if (dialog && dialog.open) dialog.close();
      });
    });

    if (els.historyList) {
      els.historyList.addEventListener("click", handleHistoryClick);
    }

    document
      .querySelectorAll('input[name="theme"]')
      .forEach(function (radio) {
        radio.addEventListener("change", function () {
          if (!radio.checked) return;
          applyThemeSetting(radio.value, { persist: true });
        });
      });

    if (els.soundToggle) {
      els.soundToggle.addEventListener("change", function () {
        state.settings.sound = els.soundToggle.checked;
        saveState();
        if (els.soundToggle.checked) {
          primeBombAudio();
        } else {
          closeAudioContext();
        }
      });
    }

    if (els.exportButton) {
      els.exportButton.addEventListener("click", function () {
        exportData();
      });
    }
    if (els.importButton && els.importFile) {
      els.importButton.addEventListener("click", function () {
        els.importFile.click();
      });
      els.importFile.addEventListener("change", function () {
        var file = els.importFile.files && els.importFile.files[0];
        if (file) importDataFromFile(file);
      });
    }

    if (els.confirmAccept) {
      els.confirmAccept.addEventListener("click", function () {
        settleConfirm(true);
      });
    }
    if (els.confirmCancel) {
      els.confirmCancel.addEventListener("click", function () {
        settleConfirm(false);
      });
    }
    if (els.confirmClose) {
      els.confirmClose.addEventListener("click", function () {
        settleConfirm(false);
      });
    }
    if (els.confirmDialog) {
      els.confirmDialog.addEventListener("close", handleConfirmClose);
    }

    document.addEventListener("keydown", handleGlobalKeyDown);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("click", handleDocumentClickCapture, true);
    window.addEventListener("resize", handleResize);

    if (reducedMotionMedia) {
      var updateMotionPreference = function () {
        // Nilai dibaca ulang pada setiap animasi berikutnya.
      };
      if (reducedMotionMedia.addEventListener) {
        reducedMotionMedia.addEventListener("change", updateMotionPreference);
      } else if (reducedMotionMedia.addListener) {
        reducedMotionMedia.addListener(updateMotionPreference);
      }
    }

    if (colorSchemeMedia) {
      if (colorSchemeMedia.addEventListener) {
        colorSchemeMedia.addEventListener("change", handleSystemThemeChange);
      } else if (colorSchemeMedia.addListener) {
        colorSchemeMedia.addListener(handleSystemThemeChange);
      }
    }

    [els.newGameDialog, els.renameDialog, els.manualDialog, els.settingsDialog, els.historyDialog].forEach(
      function (dialog) {
        if (!dialog) return;
        dialog.addEventListener("close", function () {
          if (dialog === els.renameDialog) {
            renameContext = null;
            els.renameError.textContent = "";
          }
          if (dialog === els.manualDialog) {
            manualContext = null;
            els.manualError.textContent = "";
          }
          if (dialog === els.settingsDialog) {
            els.importFile.value = "";
            setSettingsMessage("", "");
          }
        });
      }
    );

  }

  function registerServiceWorker() {
    if (
      !("serviceWorker" in navigator) ||
      !/^https?:$/.test(window.location.protocol)
    ) {
      return;
    }
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        // Aplikasi tetap berfungsi tanpa cache offline.
      });
    });
  }

  function init() {
    cacheElements();
    try {
      state = loadInitialState();
    } catch (error) {
      state = createFreshState();
      showStorageBanner(
        "Data tersimpan tidak dapat dibuka. Aplikasi dimulai dengan game kosong agar tetap bisa dipakai."
      );
    }
    ensureActivePlayer();
    bindEvents();
    applyThemeSetting(state.settings.theme, { persist: false });
    if (initNotice) showStorageBanner(initNotice);
    if (!storageAvailable) updateStorageDetails();
    renderAll();
    registerServiceWorker();
  }

  init();
})();
