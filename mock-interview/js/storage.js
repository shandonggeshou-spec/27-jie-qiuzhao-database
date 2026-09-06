(function (global) {
  "use strict";

  // 面试内容只保存在用户当前浏览器中；本模块不发起任何网络请求。
  var DB_NAME = "qiuzhao_mock_interview";
  var DB_VERSION = 1;
  var FALLBACK_KEY = DB_NAME + "__fallback_v1";
  var STORE_NAMES = [
    "sessions",
    "turns",
    "drafts",
    "customQuestionPacks",
    "settings"
  ];

  var db = null;
  var openPromise = null;
  var storageMode = "uninitialized";
  var memoryData = emptyData();

  function emptyData() {
    return {
      sessions: [],
      turns: [],
      drafts: [],
      customQuestionPacks: [],
      settings: []
    };
  }

  function clone(value) {
    if (value === undefined || value === null) return value;
    if (typeof global.structuredClone === "function") {
      try {
        return global.structuredClone(value);
      } catch (_error) {
        // 某些宿主对象不能 structuredClone，继续尝试 JSON 副本。
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return prefix + "_" + global.crypto.randomUUID();
    }
    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB 请求失败"));
      };
    });
  }

  function transactionDone(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("IndexedDB 事务失败"));
      };
      // 具体请求会报告错误；这里只阻止浏览器控制台把事务错误当作未处理事件。
      transaction.onerror = function () {};
    });
  }

  function createSchema(database) {
    var sessions = database.createObjectStore("sessions", { keyPath: "id" });
    sessions.createIndex("updatedAt", "updatedAt", { unique: false });
    sessions.createIndex("status", "status", { unique: false });
    sessions.createIndex("rolePack", "rolePack", { unique: false });

    var turns = database.createObjectStore("turns", { keyPath: "id" });
    turns.createIndex("sessionId", "sessionId", { unique: false });
    turns.createIndex("questionId", "questionId", { unique: false });

    database.createObjectStore("drafts", { keyPath: "sessionId" });
    database.createObjectStore("customQuestionPacks", { keyPath: "id" });
    database.createObjectStore("settings", { keyPath: "key" });
  }

  function ensureSchema(database, transaction) {
    var sessions = database.objectStoreNames.contains("sessions")
      ? transaction.objectStore("sessions")
      : database.createObjectStore("sessions", { keyPath: "id" });
    if (!sessions.indexNames.contains("updatedAt")) sessions.createIndex("updatedAt", "updatedAt", { unique: false });
    if (!sessions.indexNames.contains("status")) sessions.createIndex("status", "status", { unique: false });
    if (!sessions.indexNames.contains("rolePack")) sessions.createIndex("rolePack", "rolePack", { unique: false });

    var turns = database.objectStoreNames.contains("turns")
      ? transaction.objectStore("turns")
      : database.createObjectStore("turns", { keyPath: "id" });
    if (!turns.indexNames.contains("sessionId")) turns.createIndex("sessionId", "sessionId", { unique: false });
    if (!turns.indexNames.contains("questionId")) turns.createIndex("questionId", "questionId", { unique: false });

    if (!database.objectStoreNames.contains("drafts")) database.createObjectStore("drafts", { keyPath: "sessionId" });
    if (!database.objectStoreNames.contains("customQuestionPacks")) database.createObjectStore("customQuestionPacks", { keyPath: "id" });
    if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", { keyPath: "key" });
  }

  function canUseLocalStorage() {
    var probeKey = FALLBACK_KEY + "__probe";
    try {
      // 某些隐私模式连读取 localStorage 属性本身都会抛 SecurityError。
      var localStorageObject = global.localStorage;
      if (!localStorageObject) return false;
      localStorageObject.setItem(probeKey, "1");
      localStorageObject.removeItem(probeKey);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function normalizeFallbackData(candidate) {
    var normalized = emptyData();
    if (!candidate || typeof candidate !== "object") return normalized;
    STORE_NAMES.forEach(function (name) {
      normalized[name] = Array.isArray(candidate[name]) ? candidate[name] : [];
    });
    return normalized;
  }

  function readLocalData() {
    try {
      var raw = global.localStorage.getItem(FALLBACK_KEY);
      return normalizeFallbackData(raw ? JSON.parse(raw) : null);
    } catch (_error) {
      return emptyData();
    }
  }

  function switchToMemory(snapshot) {
    memoryData = normalizeFallbackData(clone(snapshot || memoryData));
    storageMode = "memory";
  }

  function writeLocalData(data) {
    try {
      global.localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
      return true;
    } catch (_error) {
      // 配额耗尽或隐私策略改变时保留当前数据，并安全退到页面内存。
      switchToMemory(data);
      return false;
    }
  }

  function activateFallback() {
    if (canUseLocalStorage()) {
      storageMode = "localStorage";
      memoryData = readLocalData();
    } else {
      switchToMemory(memoryData);
    }
    return {
      storageMode: storageMode,
      dbName: DB_NAME,
      version: DB_VERSION,
      persistent: storageMode !== "memory"
    };
  }

  function open() {
    if (openPromise) return openPromise;

    openPromise = new Promise(function (resolve) {
      if (!global.indexedDB) {
        resolve(activateFallback());
        return;
      }

      var request;
      var settled = false;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (_error) {
        resolve(activateFallback());
        return;
      }

      request.onupgradeneeded = function (event) {
        var database = event.target.result;
        if (event.oldVersion === 0) createSchema(database);
        else ensureSchema(database, event.target.transaction);
      };

      request.onsuccess = function () {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        db = request.result;
        storageMode = "indexedDB";
        db.onversionchange = function () {
          db.close();
          db = null;
          openPromise = null;
          storageMode = "uninitialized";
        };
        resolve({
          storageMode: storageMode,
          dbName: DB_NAME,
          version: DB_VERSION,
          persistent: true
        });
      };

      request.onerror = function () {
        if (settled) return;
        settled = true;
        resolve(activateFallback());
      };

      // 被旧页面阻塞时不让业务永久卡住；旧连接关闭后仍可在下次加载重试。
      request.onblocked = function () {
        if (settled) return;
        settled = true;
        resolve(activateFallback());
      };
    });

    return openPromise;
  }

  function fallbackData() {
    if (storageMode === "localStorage") {
      memoryData = readLocalData();
    }
    return memoryData;
  }

  function persistFallback() {
    if (storageMode === "localStorage") writeLocalData(memoryData);
  }

  function fallbackPut(storeName, value, keyName) {
    var data = fallbackData();
    var list = data[storeName];
    var key = value[keyName];
    var index = list.findIndex(function (item) {
      return item[keyName] === key;
    });
    if (index >= 0) list[index] = clone(value);
    else list.push(clone(value));
    persistFallback();
    return clone(value);
  }

  function fallbackGet(storeName, keyName, key) {
    var item = fallbackData()[storeName].find(function (candidate) {
      return candidate[keyName] === key;
    });
    return clone(item);
  }

  async function put(storeName, value) {
    await open();
    if (storageMode !== "indexedDB") {
      var keyName = storeName === "drafts" ? "sessionId" : storeName === "settings" ? "key" : "id";
      return fallbackPut(storeName, value, keyName);
    }
    var transaction = db.transaction(storeName, "readwrite");
    var donePromise = transactionDone(transaction);
    var resultPromise = requestResult(transaction.objectStore(storeName).put(clone(value)));
    // 同时监听请求和事务，防止请求先失败而形成未处理的 Promise 拒绝。
    var storedKey;
    try {
      storedKey = await resultPromise;
    } catch (error) {
      try { transaction.abort(); } catch (_abortError) {}
      try { await donePromise; } catch (_transactionError) {}
      throw error;
    }
    await donePromise;
    void storedKey;
    return clone(value);
  }

  async function get(storeName, key) {
    await open();
    if (storageMode !== "indexedDB") {
      var keyName = storeName === "drafts" ? "sessionId" : storeName === "settings" ? "key" : "id";
      return fallbackGet(storeName, keyName, key);
    }
    var transaction = db.transaction(storeName, "readonly");
    return clone(await requestResult(transaction.objectStore(storeName).get(key)));
  }

  async function getAll(storeName) {
    await open();
    if (storageMode !== "indexedDB") return clone(fallbackData()[storeName]);
    var transaction = db.transaction(storeName, "readonly");
    return clone(await requestResult(transaction.objectStore(storeName).getAll()));
  }

  async function remove(storeName, key) {
    await open();
    if (storageMode !== "indexedDB") {
      var data = fallbackData();
      var keyName = storeName === "drafts" ? "sessionId" : storeName === "settings" ? "key" : "id";
      data[storeName] = data[storeName].filter(function (item) {
        return item[keyName] !== key;
      });
      persistFallback();
      return true;
    }
    var transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
    return true;
  }

  async function createSession(input) {
    var timestamp = now();
    var session = Object.assign({}, clone(input || {}));
    session.id = session.id || makeId("session");
    session.createdAt = session.createdAt || timestamp;
    session.updatedAt = timestamp;
    session.status = session.status || "SETUP";
    await put("sessions", session);
    return clone(session);
  }

  async function updateSession(idOrSession, patch) {
    var id = typeof idOrSession === "object" && idOrSession ? idOrSession.id : idOrSession;
    var changes = typeof idOrSession === "object" && idOrSession ? idOrSession : patch;
    if (!id) throw new TypeError("updateSession 需要 session id");
    var existing = await getSession(id);
    if (!existing) throw new Error("未找到要更新的面试会话：" + id);
    var updated = Object.assign({}, existing, clone(changes || {}), { id: id, updatedAt: now() });
    await put("sessions", updated);
    return clone(updated);
  }

  function getSession(id) {
    if (!id) return Promise.resolve(undefined);
    return get("sessions", id);
  }

  async function listSessions(options) {
    var settings = options || {};
    var sessions = await getAll("sessions");
    if (settings.status) {
      sessions = sessions.filter(function (item) {
        return item.status === settings.status;
      });
    }
    if (settings.rolePack) {
      sessions = sessions.filter(function (item) {
        return item.rolePack === settings.rolePack;
      });
    }
    sessions.sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    if (Number.isFinite(settings.limit) && settings.limit >= 0) {
      sessions = sessions.slice(0, settings.limit);
    }
    return sessions;
  }

  async function deleteSession(sessionId) {
    if (!sessionId) return false;
    await open();

    if (storageMode !== "indexedDB") {
      var data = fallbackData();
      data.sessions = data.sessions.filter(function (item) { return item.id !== sessionId; });
      data.turns = data.turns.filter(function (item) { return item.sessionId !== sessionId; });
      data.drafts = data.drafts.filter(function (item) { return item.sessionId !== sessionId; });
      persistFallback();
      return true;
    }

    // 会话、答题轮次和草稿在同一事务中删除，避免留下孤儿记录。
    var transaction = db.transaction(["sessions", "turns", "drafts"], "readwrite");
    transaction.objectStore("sessions").delete(sessionId);
    transaction.objectStore("drafts").delete(sessionId);
    var index = transaction.objectStore("turns").index("sessionId");
    var cursorRequest = index.openKeyCursor(sessionId);
    var cursorError = null;
    cursorRequest.onsuccess = function () {
      var cursor = cursorRequest.result;
      if (!cursor) return;
      transaction.objectStore("turns").delete(cursor.primaryKey);
      cursor.continue();
    };
    cursorRequest.onerror = function () {
      cursorError = cursorRequest.error || new Error("删除答题记录失败");
      try { transaction.abort(); } catch (_abortError) {}
    };
    await transactionDone(transaction);
    if (cursorError) throw cursorError;
    return true;
  }

  async function addTurn(input) {
    if (!input || !input.sessionId) throw new TypeError("addTurn 需要 sessionId");
    var timestamp = now();
    var turn = Object.assign({}, clone(input));
    turn.id = turn.id || makeId("turn");
    turn.createdAt = turn.createdAt || timestamp;
    turn.updatedAt = timestamp;
    await put("turns", turn);
    return clone(turn);
  }

  async function getTurns(sessionId, options) {
    if (!sessionId) return [];
    await open();
    var turns;
    if (storageMode === "indexedDB") {
      var transaction = db.transaction("turns", "readonly");
      turns = await requestResult(transaction.objectStore("turns").index("sessionId").getAll(sessionId));
    } else {
      turns = fallbackData().turns.filter(function (item) { return item.sessionId === sessionId; });
    }
    if (options && options.questionId) {
      turns = turns.filter(function (item) { return item.questionId === options.questionId; });
    }
    turns.sort(function (a, b) {
      var orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      var orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return orderA - orderB || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
    return clone(turns);
  }

  async function saveDraft(sessionIdOrDraft, draftValue) {
    var record;
    if (typeof sessionIdOrDraft === "object" && sessionIdOrDraft) {
      record = Object.assign({}, clone(sessionIdOrDraft));
    } else {
      record = typeof draftValue === "object" && draftValue !== null
        ? Object.assign({}, clone(draftValue), { sessionId: sessionIdOrDraft })
        : { sessionId: sessionIdOrDraft, answer: draftValue == null ? "" : String(draftValue) };
    }
    if (!record.sessionId) throw new TypeError("saveDraft 需要 sessionId");
    record.updatedAt = now();
    await put("drafts", record);
    return clone(record);
  }

  function getDraft(sessionId) {
    if (!sessionId) return Promise.resolve(undefined);
    return get("drafts", sessionId);
  }

  function deleteDraft(sessionId) {
    if (!sessionId) return Promise.resolve(false);
    return remove("drafts", sessionId);
  }

  async function saveSetting(keyOrRecord, value) {
    var record = typeof keyOrRecord === "object" && keyOrRecord
      ? Object.assign({}, clone(keyOrRecord))
      : { key: keyOrRecord, value: clone(value) };
    if (!record.key) throw new TypeError("saveSetting 需要 key");
    record.updatedAt = now();
    await put("settings", record);
    return clone(record.value);
  }

  async function getSetting(key, defaultValue) {
    if (!key) return clone(defaultValue);
    var record = await get("settings", key);
    return record ? clone(record.value) : clone(defaultValue);
  }

  async function exportAllData() {
    await open();
    var data = {};
    if (storageMode === "indexedDB") {
      var transaction = db.transaction(STORE_NAMES, "readonly");
      var requests = STORE_NAMES.map(function (name) {
        return requestResult(transaction.objectStore(name).getAll());
      });
      var results = await Promise.all(requests);
      STORE_NAMES.forEach(function (name, index) { data[name] = clone(results[index]); });
    } else {
      data = clone(fallbackData());
    }
    var exported = {
      schemaVersion: DB_VERSION,
      databaseName: DB_NAME,
      exportedAt: now(),
      storageMode: storageMode,
      data: data
    };
    // 同时提供顶层集合，便于导出/导入 UI 直接读取；data 保留完整命名空间。
    STORE_NAMES.forEach(function (name) { exported[name] = clone(data[name]); });
    return exported;
  }

  async function clearAllData() {
    await open();
    if (storageMode === "indexedDB") {
      var transaction = db.transaction(STORE_NAMES, "readwrite");
      STORE_NAMES.forEach(function (name) { transaction.objectStore(name).clear(); });
      await transactionDone(transaction);
    } else {
      memoryData = emptyData();
      if (storageMode === "localStorage") {
        try {
          global.localStorage.removeItem(FALLBACK_KEY);
        } catch (_error) {
          switchToMemory(memoryData);
        }
      }
    }
    return { cleared: true, storageMode: storageMode };
  }

  var api = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    open: open,
    createSession: createSession,
    updateSession: updateSession,
    getSession: getSession,
    listSessions: listSessions,
    deleteSession: deleteSession,
    addTurn: addTurn,
    getTurns: getTurns,
    saveDraft: saveDraft,
    getDraft: getDraft,
    deleteDraft: deleteDraft,
    saveSetting: saveSetting,
    getSetting: getSetting,
    exportAllData: exportAllData,
    clearAllData: clearAllData,
    getStorageMode: function () { return storageMode; }
  };

  Object.defineProperty(api, "storageMode", {
    enumerable: true,
    get: function () { return storageMode; }
  });

  global.MockStorage = api;
})(typeof window !== "undefined" ? window : globalThis);
