(function (global) {
  "use strict";

  var Storage = global.MockStorage;
  var Engine = global.MockEngine;
  var Voice = global.MockVoice;
  var PACKS = Array.isArray(global.MOCK_QUESTION_PACKS) ? global.MOCK_QUESTION_PACKS : [];
  var RUBRIC_VERSION = "local-text-rubric-v1";
  var SETTINGS_DEFAULTS = {
    autoSave: true,
    sound: false,
    reducedMotion: false,
    speechLanguage: "zh-CN"
  };
  var ROUTES = ["setup", "interview", "report", "history"];
  var IDS = [
    "appMain", "brandHomeBtn", "navSetupBtn", "navHistoryBtn", "openSettingsBtn",
    "viewSetup", "viewInterview", "viewReport", "viewHistory", "resumeSessionPanel",
    "resumeSessionMeta", "discardResumeBtn", "resumeInterviewBtn", "setupForm",
    "questionPackError", "candidateContext", "contextCount", "interviewTitle",
    "interviewTimer", "pauseInterviewBtn", "exitInterviewBtn", "questionProgressText",
    "questionProgress", "questionQueue", "questionTypeLabel", "currentQuestionNumber",
    "currentQuestionText", "currentQuestionGuidance", "voiceToggleBtn", "voiceButtonText",
    "answerForm", "answerInput", "recordingLayer", "answerCount", "voiceStatus",
    "answerError", "answerSubmitBtn", "interviewAnnouncer", "reportTitle", "reportMeta",
    "exportReportBtn", "newInterviewBtn", "overallScore", "overallBand", "overallSummary",
    "reportFacts", "dimensionScores", "reportQuestionList", "reanswerWeakQuestionsBtn",
    "reportStartPracticeBtn", "exportAllHistoryBtn", "trendDelta", "historyTrendChart",
    "historyFilter", "historyList", "historyEmptyState", "emptyStartInterviewBtn",
    "settingsDialog", "settingsForm", "closeSettingsBtn", "autoSaveToggle", "soundToggle",
    "reducedMotionToggle", "speechLanguage", "localDataSize", "exportDataBtn",
    "importDataInput", "clearAllDataBtn", "settingsSaveStatus", "saveSettingsBtn",
    "confirmDialog", "confirmTitle", "confirmMessage", "confirmCancelBtn",
    "confirmActionBtn", "exitInterviewDialog", "exitDiscardBtn", "exitCancelBtn",
    "exitSaveBtn", "appToast", "toastMessage", "toastActionBtn", "toastCloseBtn"
  ];
  var el = Object.create(null);
  var state = {
    route: "setup",
    settings: clone(SETTINGS_DEFAULTS),
    activeSession: null,
    turns: [],
    resumeSession: null,
    currentPlanIndex: 0,
    currentQuestion: null,
    followUpQueue: [],
    askedByMain: Object.create(null),
    paused: false,
    elapsedBaseMs: 0,
    timerStartedAt: null,
    questionStartedAt: null,
    timerId: null,
    draftTimerId: null,
    toastTimerId: null,
    submitting: false,
    voicePrefix: "",
    voiceFinal: "",
    voiceInterim: "",
    voiceRendered: "",
    pendingRoute: null,
    pendingConfirm: null,
    reportSession: null,
    reportTurns: [],
    weakQuestionId: null,
    historySessions: [],
    historyTurns: Object.create(null)
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cacheElements() {
    var missing = [];
    IDS.forEach(function (id) {
      el[id] = global.document.getElementById(id);
      if (!el[id]) missing.push(id);
    });
    if (missing.length) throw new Error("页面缺少必要元素：" + missing.join(", "));
  }

  function node(tag, className, text) {
    var result = global.document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined && text !== null) result.textContent = String(text);
    return result;
  }

  function add(parent, tag, className, text) {
    var child = node(tag, className, text);
    parent.appendChild(child);
    return child;
  }

  function numberOr(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function questionText(question) {
    if (!question) return "";
    return String(question.question || question.prompt || question.text || question.title || "");
  }

  function getPack(id) {
    return PACKS.find(function (pack) { return pack && pack.id === id; }) || null;
  }

  function sessionTitle(session) {
    var pack = session && getPack(session.rolePack);
    return session && (session.packTitle || session.packName || session.title) || pack && pack.title || "模拟面试";
  }

  function completed(session) {
    return Boolean(session && session.status === Engine.STATES.COMPLETED);
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog, value) {
    if (typeof dialog.close === "function" && dialog.open) dialog.close(value || "");
    else dialog.removeAttribute("open");
  }

  function showToast(message, options) {
    var config = options || {};
    global.clearTimeout(state.toastTimerId);
    el.toastMessage.textContent = String(message || "");
    el.toastActionBtn.hidden = !config.actionLabel;
    el.toastActionBtn.textContent = config.actionLabel || "";
    el.toastActionBtn.onclick = typeof config.onAction === "function" ? config.onAction : null;
    el.appToast.hidden = false;
    el.appToast.classList.add("is-visible");
    state.toastTimerId = global.setTimeout(hideToast, numberOr(config.duration, 3200));
  }

  function hideToast() {
    global.clearTimeout(state.toastTimerId);
    el.appToast.classList.remove("is-visible");
    el.appToast.hidden = true;
    el.toastActionBtn.onclick = null;
  }

  function fail(error, fallback) {
    if (global.console && global.console.error) global.console.error(error);
    showToast(error && error.message ? error.message : fallback || "操作失败，请稍后重试。", { duration: 5000 });
  }

  function announce(message) {
    el.interviewAnnouncer.textContent = "";
    global.setTimeout(function () { el.interviewAnnouncer.textContent = String(message); }, 20);
  }

  function clock(milliseconds) {
    var seconds = Math.max(0, Math.floor(numberOr(milliseconds, 0) / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds % 3600 / 60);
    var remainder = seconds % 60;
    var parts = hours ? [hours, minutes, remainder] : [minutes, remainder];
    return parts.map(function (part) { return String(part).padStart(2, "0"); }).join(":");
  }

  function dateLabel(value, withTime) {
    var date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "时间未知";
    var options = withTime
      ? { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
      : { year: "numeric", month: "long", day: "numeric" };
    return new Intl.DateTimeFormat("zh-CN", options).format(date);
  }

  function relativeDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    var today = new Date();
    var sameDay = date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    var time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    if (sameDay) return "今天 " + time;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function filename(value) {
    return String(value || "mock-report")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "mock-report";
  }

  function download(content, mimeType, name) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    var url = global.URL.createObjectURL(blob);
    var anchor = node("a");
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1500);
  }

  function playTone(frequency) {
    if (!state.settings.sound) return;
    var AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return;
    try {
      var context = new AudioContext();
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.frequency.value = frequency || 660;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.onended = function () { context.close(); };
    } catch (_error) {
      // 提示音是可选增强，不影响主流程。
    }
  }

  function routeFromHash() {
    var route = String(global.location.hash || "").replace(/^#/, "");
    return ROUTES.indexOf(route) >= 0 ? route : "setup";
  }

  function writeHash(route, replace) {
    try {
      var method = replace ? "replaceState" : "pushState";
      if (global.history && global.history[method]) global.history[method]({ mockRoute: route }, "", "#" + route);
      else global.location.hash = route;
    } catch (_error) {
      // file:// 环境限制 History API 时，视图仍可切换。
    }
  }

  function showRoute(route, options) {
    var config = options || {};
    if (ROUTES.indexOf(route) < 0) route = "setup";
    state.route = route;
    ROUTES.forEach(function (name) {
      var view = el["view" + name.charAt(0).toUpperCase() + name.slice(1)];
      view.hidden = name !== route;
    });
    var setup = route === "setup";
    var history = route === "history";
    el.navSetupBtn.classList.toggle("is-active", setup);
    el.navHistoryBtn.classList.toggle("is-active", history);
    if (setup) el.navSetupBtn.setAttribute("aria-current", "page");
    else el.navSetupBtn.removeAttribute("aria-current");
    if (history) el.navHistoryBtn.setAttribute("aria-current", "page");
    else el.navHistoryBtn.removeAttribute("aria-current");
    if (config.updateUrl !== false) writeHash(route, Boolean(config.replace));
    if (route !== "interview") stopTimer();
    if (route === "history") void renderHistory();
    global.requestAnimationFrame(function () {
      try { el.appMain.focus({ preventScroll: true }); } catch (_error) { el.appMain.focus(); }
    });
  }

  function navigate(route) {
    if (route === state.route) return;
    if (state.route === "interview" && state.activeSession && !completed(state.activeSession)) {
      state.pendingRoute = route;
      openDialog(el.exitInterviewDialog);
      return;
    }
    showRoute(route);
  }

  function elapsedMs() {
    if (state.paused || state.timerStartedAt === null) return state.elapsedBaseMs;
    return state.elapsedBaseMs + Math.max(0, Date.now() - state.timerStartedAt);
  }

  function renderTimer() {
    var elapsed = elapsedMs();
    el.interviewTimer.textContent = clock(elapsed);
    el.interviewTimer.setAttribute("datetime", "PT" + Math.floor(elapsed / 1000) + "S");
  }

  function startTimer() {
    stopTimer();
    renderTimer();
    state.timerId = global.setInterval(renderTimer, 1000);
  }

  function stopTimer() {
    if (state.timerId) global.clearInterval(state.timerId);
    state.timerId = null;
  }

  function pauseClock() {
    if (state.paused) return;
    state.elapsedBaseMs = elapsedMs();
    state.timerStartedAt = null;
    state.paused = true;
  }

  function resumeClock() {
    if (!state.paused) return;
    state.paused = false;
    state.timerStartedAt = Date.now();
  }

  function planFor(session) {
    if (session && session.plan && Array.isArray(session.plan.questions)) return session.plan;
    if (session && Array.isArray(session.questionsSnapshot)) {
      return {
        durationMinutes: numberOr(session.durationMinutes, 30),
        intensity: session.followupIntensity || "medium",
        maxFollowUpsPerQuestion: session.followupIntensity === "high" ? 2 : session.followupIntensity === "low" ? 0 : 1,
        actualMainQuestions: session.questionsSnapshot.length,
        questions: clone(session.questionsSnapshot)
      };
    }
    var pack = session && getPack(session.rolePack);
    return pack ? Engine.buildSessionPlan(pack, session.durationMinutes || 30, session.followupIntensity || "medium") : null;
  }

  function activePlan() {
    return planFor(state.activeSession) || { questions: [] };
  }

  function mainQuestion(index) {
    return activePlan().questions[index] || null;
  }

  function mainDescriptor(question) {
    if (!question) return null;
    var snapshot = clone(question);
    snapshot.prompt = snapshot.prompt || questionText(snapshot);
    snapshot.text = snapshot.text || snapshot.prompt;
    return {
      kind: "main",
      id: snapshot.id,
      mainQuestionId: snapshot.id,
      question: snapshot,
      prompt: snapshot.prompt
    };
  }

  function followDescriptor(followUp, main) {
    var question = Object.assign({}, clone(followUp), {
      category: main.category || "追问",
      question: questionText(followUp),
      isFollowUp: true,
      mainQuestionId: main.id
    });
    return {
      kind: "followup",
      id: followUp.id,
      mainQuestionId: main.id,
      question: question,
      prompt: questionText(followUp),
      reason: followUp.reason || ""
    };
  }

  function allAskedIds() {
    var result = [];
    Object.keys(state.askedByMain || {}).forEach(function (mainId) {
      (state.askedByMain[mainId] || []).forEach(function (id) {
        if (result.indexOf(id) < 0) result.push(id);
      });
    });
    return result;
  }

  function mainAnswerCount(turns) {
    var seen = Object.create(null);
    (turns || []).forEach(function (turn) {
      if (!turn || turn.isFollowUp) return;
      var id = turn.mainQuestionId || turn.questionId;
      if (id) seen[id] = true;
    });
    return Object.keys(seen).length;
  }

  function checkpoint() {
    return {
      version: 1,
      currentPlanIndex: state.currentPlanIndex,
      currentQuestion: clone(state.currentQuestion),
      followUpQueue: clone(state.followUpQueue),
      askedFollowUpIds: allAskedIds(),
      askedFollowUpIdsByQuestion: clone(state.askedByMain),
      paused: state.paused,
      elapsedMs: elapsedMs(),
      lastResumedAt: state.paused ? null : new Date().toISOString(),
      questionStartedAt: state.questionStartedAt ? new Date(state.questionStartedAt).toISOString() : null
    };
  }

  async function persistSession(extra) {
    if (!state.activeSession || completed(state.activeSession)) return state.activeSession;
    var point = checkpoint();
    var patch = Object.assign({
      status: Engine.STATES.ANSWERING,
      elapsedMs: point.elapsedMs,
      currentPlanIndex: point.currentPlanIndex,
      currentQuestion: point.currentQuestion,
      followUpQueue: point.followUpQueue,
      askedFollowUpIds: point.askedFollowUpIds,
      askedFollowUpIdsByQuestion: point.askedFollowUpIdsByQuestion,
      paused: point.paused,
      checkpoint: point
    }, extra || {});
    state.activeSession = await Storage.updateSession(state.activeSession.id, patch);
    return state.activeSession;
  }

  async function saveDraft(force) {
    if (!state.activeSession || !state.currentQuestion) return;
    if (!force && !state.settings.autoSave) return;
    await Storage.saveDraft({
      sessionId: state.activeSession.id,
      questionId: state.currentQuestion.id,
      mainQuestionId: state.currentQuestion.mainQuestionId,
      planIndex: state.currentPlanIndex,
      isFollowUp: state.currentQuestion.kind === "followup",
      answer: el.answerInput.value
    });
  }

  function scheduleDraftSave() {
    global.clearTimeout(state.draftTimerId);
    if (!state.settings.autoSave) return;
    state.draftTimerId = global.setTimeout(function () {
      void saveDraft(false).then(function () {
        return persistSession();
      }).catch(function (error) { fail(error, "草稿自动保存失败。"); });
    }, 450);
  }

  function renderRail() {
    var plan = activePlan();
    var questions = plan.questions || [];
    var answered = mainAnswerCount(state.turns);
    var displayIndex = Math.min(state.currentPlanIndex + 1, Math.max(questions.length, 1));
    el.questionProgressText.textContent = "第 " + displayIndex + " / " + questions.length + " 题";
    el.questionProgress.max = Math.max(questions.length, 1);
    el.questionProgress.value = Math.min(state.currentPlanIndex + 1, Math.max(questions.length, 1));
    el.questionProgress.textContent = answered + " / " + questions.length;
    el.questionQueue.replaceChildren();
    questions.forEach(function (question, index) {
      var item = node("li");
      item.dataset.questionId = question.id;
      var current = index === state.currentPlanIndex;
      var done = index < state.currentPlanIndex || state.turns.some(function (turn) {
        return !turn.isFollowUp && (turn.mainQuestionId || turn.questionId) === question.id;
      });
      if (current) {
        item.classList.add("is-current");
        item.setAttribute("aria-current", "step");
      } else if (done) item.classList.add("is-complete");
      add(item, "span", "", String(index + 1).padStart(2, "0"));
      var content = node("div");
      add(content, "strong", "", question.category || "核心问题");
      add(content, "small", "", current
        ? state.currentQuestion && state.currentQuestion.kind === "followup" ? "正在追问" : "正在回答"
        : done ? "已回答" : "待回答");
      item.appendChild(content);
      el.questionQueue.appendChild(item);
    });
    var main = mainQuestion(state.currentPlanIndex);
    var askedCount = main && state.askedByMain[main.id] ? state.askedByMain[main.id].length : 0;
    var followItem = node("li", "is-muted");
    add(followItem, "span", "", "＋");
    var followContent = node("div");
    add(followContent, "strong", "", "后续问题");
    add(followContent, "small", "", askedCount ? "本题已追问 " + askedCount + " 次" : "根据回答生成");
    followItem.appendChild(followContent);
    el.questionQueue.appendChild(followItem);
  }

  function updateAnswerCount() {
    el.answerCount.textContent = String(el.answerInput.value.length);
  }

  function updateInterviewControls() {
    var recognitionSupported = Voice && Voice.isRecognitionSupported && Voice.isRecognitionSupported();
    el.answerInput.disabled = state.paused;
    el.answerSubmitBtn.disabled = state.paused || state.submitting;
    el.voiceToggleBtn.disabled = state.paused || !recognitionSupported;
    el.pauseInterviewBtn.textContent = state.paused ? "继续" : "暂停";
    el.pauseInterviewBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    if (state.paused) el.voiceStatus.textContent = "面试已暂停，继续后可输入回答";
  }

  function renderQuestion(draft) {
    var descriptor = state.currentQuestion;
    var question = descriptor && descriptor.question;
    if (!descriptor || !question) return;
    var asked = state.askedByMain[descriptor.mainQuestionId] || [];
    var followNumber = Math.max(1, asked.indexOf(descriptor.id) + 1);
    var estimate = Math.max(1, Math.round(numberOr(activePlan().estimatedMinutesPerQuestion, 2)));
    el.interviewTitle.textContent = sessionTitle(state.activeSession);
    el.questionTypeLabel.textContent = descriptor.kind === "followup"
      ? "追问 · " + (question.category || "回答深挖")
      : "核心问题 · " + (question.category || "综合能力");
    el.currentQuestionNumber.textContent = "问题 " + String(state.currentPlanIndex + 1).padStart(2, "0") +
      (descriptor.kind === "followup" ? " · 追问 " + followNumber : "");
    el.currentQuestionText.textContent = descriptor.prompt || questionText(question);
    el.currentQuestionGuidance.textContent = descriptor.kind === "followup"
      ? descriptor.reason || "请直接补充追问所需的信息，保持具体、可验证。"
      : "建议用 " + estimate + "–" + (estimate + 1) + " 分钟回答，尽量说明个人行动与事实证据。";
    el.answerInput.value = draft && draft.questionId === descriptor.id ? String(draft.answer || "") : "";
    updateAnswerCount();
    el.answerError.hidden = true;
    updateInterviewControls();
    renderRail();
    state.questionStartedAt = state.questionStartedAt || Date.now();
    if (!state.paused) global.setTimeout(function () { el.answerInput.focus(); }, 0);
  }

  function stopRecognition(cancel) {
    if (!Voice || !Voice.isListening || !Voice.isListening()) return false;
    return cancel ? Voice.cancel() : Voice.stop();
  }

  function joinTranscript(left, right) {
    left = String(left || "");
    right = String(right || "");
    if (!left || !right) return left + right;
    return left + (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right) ? " " : "") + right;
  }

  function renderTranscript() {
    var text = joinTranscript(joinTranscript(state.voicePrefix, state.voiceFinal), state.voiceInterim);
    state.voiceRendered = text;
    el.answerInput.value = text;
    updateAnswerCount();
    scheduleDraftSave();
  }

  function setVoiceUi(listening, message) {
    el.voiceToggleBtn.setAttribute("aria-pressed", listening ? "true" : "false");
    el.voiceButtonText.textContent = listening ? "结束转写" : "语音回答";
    el.recordingLayer.hidden = !listening;
    el.recordingLayer.setAttribute("aria-hidden", listening ? "false" : "true");
    el.voiceStatus.textContent = message || (listening ? "正在转写；本站不保存原始录音" : "语音输入未开启");
  }

  function toggleVoice() {
    if (!Voice || !Voice.isRecognitionSupported || !Voice.isRecognitionSupported()) {
      setVoiceUi(false, "当前浏览器不支持语音识别，请使用键盘输入。");
      return;
    }
    if (Voice.isListening()) {
      Voice.stop();
      el.voiceStatus.textContent = "正在结束转写……";
      return;
    }
    state.voicePrefix = el.answerInput.value;
    state.voiceFinal = "";
    state.voiceInterim = "";
    state.voiceRendered = el.answerInput.value;
    var result = Voice.start({
      lang: state.settings.speechLanguage || "zh-CN",
      continuous: true,
      onInterim: function (text) {
        state.voiceInterim = String(text || "");
        renderTranscript();
      },
      onFinal: function (text) {
        state.voiceFinal = joinTranscript(state.voiceFinal, text);
        state.voiceInterim = "";
        renderTranscript();
      },
      onError: function (error) {
        setVoiceUi(false, error && error.message ? error.message : "语音识别失败，请改用键盘输入。");
      },
      onEnd: function (detail) {
        if (!detail || !detail.error) {
          setVoiceUi(false, detail && detail.transcript ? "转写已结束，可继续编辑后提交。" : "语音输入已结束");
        }
      }
    });
    if (result.started) setVoiceUi(true, "正在转写；本站不保存原始录音，音频可能由浏览器厂商处理");
    else setVoiceUi(false, result.error ? result.error.message : "无法启动语音识别。");
  }

  function analysisQuestion() {
    var main = mainQuestion(state.currentPlanIndex);
    if (!main || !state.currentQuestion || state.currentQuestion.kind !== "followup") return main || state.currentQuestion.question;
    var enriched = clone(main);
    enriched.question = state.currentQuestion.prompt;
    return enriched;
  }

  async function submitAnswer(event) {
    if (event) event.preventDefault();
    if (state.submitting || state.paused || !state.activeSession || !state.currentQuestion) return;
    global.clearTimeout(state.draftTimerId);
    // 当前 interim 已显示在文本框中；取消识别可避免迟到的回调污染下一题。
    stopRecognition(true);
    var answer = el.answerInput.value.trim();
    if (!answer) {
      el.answerError.hidden = false;
      el.answerInput.focus();
      return;
    }
    el.answerError.hidden = true;
    state.submitting = true;
    updateInterviewControls();
    try {
      var descriptor = clone(state.currentQuestion);
      var main = mainQuestion(state.currentPlanIndex);
      var analysis = Engine.analyzeAnswer(answer, analysisQuestion());
      var turn = await Storage.addTurn({
        sessionId: state.activeSession.id,
        order: state.turns.length + 1,
        questionId: descriptor.id,
        mainQuestionId: descriptor.mainQuestionId,
        planIndex: state.currentPlanIndex,
        isFollowUp: descriptor.kind === "followup",
        question: Object.assign({}, descriptor.question, {
          prompt: descriptor.prompt,
          text: descriptor.prompt
        }),
        questionText: descriptor.prompt,
        answer: answer,
        answerText: answer,
        analysis: analysis,
        answerDurationMs: state.questionStartedAt ? Math.max(0, Date.now() - state.questionStartedAt) : null,
        submittedAt: new Date().toISOString()
      });
      state.turns.push(turn);
      await Storage.deleteDraft(state.activeSession.id);
      if (descriptor.kind === "followup") {
        state.followUpQueue = state.followUpQueue.filter(function (item) { return item.id !== descriptor.id; });
      }
      var maxFollowUps = Math.min(
        Engine.MAX_FOLLOW_UPS_PER_QUESTION || 2,
        Math.max(0, numberOr(main && main.maxFollowUps, numberOr(activePlan().maxFollowUpsPerQuestion, 0)))
      );
      var followUp = main ? Engine.chooseFollowUp(main, analysis, allAskedIds(), maxFollowUps) : null;
      if (followUp) {
        if (!Array.isArray(state.askedByMain[main.id])) state.askedByMain[main.id] = [];
        if (state.askedByMain[main.id].indexOf(followUp.id) < 0) state.askedByMain[main.id].push(followUp.id);
        var nextFollow = followDescriptor(followUp, main);
        state.followUpQueue.push(nextFollow);
        state.currentQuestion = state.followUpQueue[0];
        state.questionStartedAt = Date.now();
        await persistSession();
        renderQuestion(null);
        announce("回答已保存。面试官继续追问：" + state.currentQuestion.prompt);
      } else {
        state.followUpQueue = [];
        state.currentPlanIndex += 1;
        if (state.currentPlanIndex >= activePlan().questions.length) {
          await finishInterview();
        } else {
          state.currentQuestion = mainDescriptor(mainQuestion(state.currentPlanIndex));
          state.questionStartedAt = Date.now();
          await persistSession();
          renderQuestion(null);
          announce("回答已保存，进入第 " + (state.currentPlanIndex + 1) + " 题。");
        }
      }
      playTone(660);
    } catch (error) {
      fail(error, "回答提交失败，草稿仍保留在输入框中。");
    } finally {
      state.submitting = false;
      updateInterviewControls();
    }
  }

  async function finishInterview() {
    pauseClock();
    stopRecognition(true);
    var aggregate = Engine.aggregateSession(state.turns);
    var finishedAt = new Date().toISOString();
    var finishedCheckpoint = checkpoint();
    finishedCheckpoint.currentPlanIndex = activePlan().questions.length;
    finishedCheckpoint.currentQuestion = null;
    finishedCheckpoint.followUpQueue = [];
    finishedCheckpoint.paused = true;
    finishedCheckpoint.lastResumedAt = null;
    state.activeSession = await Storage.updateSession(state.activeSession.id, {
      status: Engine.STATES.COMPLETED,
      completedAt: finishedAt,
      elapsedMs: state.elapsedBaseMs,
      currentPlanIndex: activePlan().questions.length,
      currentQuestion: null,
      followUpQueue: [],
      aggregate: aggregate,
      checkpoint: finishedCheckpoint
    });
    await Storage.deleteDraft(state.activeSession.id);
    await refreshResumePanel();
    state.reportSession = state.activeSession;
    state.reportTurns = state.turns.slice();
    renderReport(state.reportSession, state.reportTurns);
    showRoute("report");
    playTone(880);
  }

  async function togglePause() {
    if (!state.activeSession) return;
    if (state.paused) {
      resumeClock();
      state.questionStartedAt = state.questionStartedAt || Date.now();
      startTimer();
      announce("面试已继续。");
    } else {
      stopRecognition(true);
      pauseClock();
      announce("面试已暂停。");
    }
    updateInterviewControls();
    renderTimer();
    try {
      await saveDraft(true);
      await persistSession();
    } catch (error) {
      fail(error, "暂停状态保存失败。");
    }
  }

  async function openSession(sessionOrId) {
    var session = typeof sessionOrId === "string" ? await Storage.getSession(sessionOrId) : sessionOrId;
    if (!session) throw new Error("未找到这场面试。");
    if (completed(session)) {
      await openReport(session);
      return;
    }
    var plan = planFor(session);
    if (!plan || !Array.isArray(plan.questions) || !plan.questions.length) throw new Error("这场面试缺少可恢复的题目快照。");
    if (!session.plan) session = await Storage.updateSession(session.id, { plan: plan, questionsSnapshot: clone(plan.questions) });
    state.activeSession = session;
    state.turns = await Storage.getTurns(session.id);
    var point = session.checkpoint || session;
    state.currentPlanIndex = Math.max(0, Math.min(numberOr(point.currentPlanIndex, 0), plan.questions.length - 1));
    state.followUpQueue = Array.isArray(point.followUpQueue) ? clone(point.followUpQueue) : [];
    state.askedByMain = clone(point.askedFollowUpIdsByQuestion || session.askedFollowUpIdsByQuestion || {});
    state.currentQuestion = point.currentQuestion ? clone(point.currentQuestion) : mainDescriptor(plan.questions[state.currentPlanIndex]);
    if (!state.currentQuestion.question) {
      state.currentQuestion.question = state.currentQuestion.kind === "main"
        ? clone(plan.questions[state.currentPlanIndex]) : clone(state.currentQuestion);
    }
    state.currentQuestion.prompt = state.currentQuestion.prompt || questionText(state.currentQuestion.question);
    state.paused = Boolean(point.paused);
    state.elapsedBaseMs = numberOr(point.elapsedMs, numberOr(session.elapsedMs, 0));
    state.timerStartedAt = state.paused ? null : Date.now();
    // 刷新或关闭页面后的离线间隔不计入面试与单题作答时长。
    state.questionStartedAt = Date.now();
    var draft = await Storage.getDraft(session.id);
    showRoute("interview");
    renderQuestion(draft);
    renderTimer();
    if (!state.paused) startTimer();
    await persistSession();
  }

  async function createInterview(pack, plan, config, extra) {
    var first = plan.questions[0];
    if (!first) throw new Error("所选题包暂时没有可用题目。");
    var descriptor = mainDescriptor(first);
    var point = {
      version: 1,
      currentPlanIndex: 0,
      currentQuestion: descriptor,
      followUpQueue: [],
      askedFollowUpIds: [],
      askedFollowUpIdsByQuestion: {},
      paused: false,
      elapsedMs: 0,
      lastResumedAt: new Date().toISOString(),
      questionStartedAt: new Date().toISOString()
    };
    var payload = Object.assign({
      status: Engine.STATES.ANSWERING,
      rolePack: pack.id,
      questionPack: pack.id,
      packTitle: pack.title,
      packVersion: pack.version || "unversioned",
      rubricVersion: RUBRIC_VERSION,
      dimensionKeys: Object.keys(Engine.DIMENSIONS),
      durationMinutes: numberOr(config.duration, 30),
      duration: numberOr(config.duration, 30),
      followupIntensity: config.followupIntensity || "medium",
      intensity: config.followupIntensity || "medium",
      candidateContext: config.candidateContext || "",
      plan: clone(plan),
      questionsSnapshot: clone(plan.questions),
      currentPlanIndex: 0,
      currentQuestion: descriptor,
      followUpQueue: [],
      askedFollowUpIds: [],
      askedFollowUpIdsByQuestion: {},
      elapsedMs: 0,
      paused: false,
      startedAt: new Date().toISOString(),
      checkpoint: point
    }, extra || {});
    var session = await Storage.createSession(payload);
    await openSession(session);
    await refreshResumePanel();
  }

  async function startFromSetup(event) {
    event.preventDefault();
    var data = new FormData(el.setupForm);
    var pack = getPack(data.get("questionPack"));
    if (!pack) {
      el.questionPackError.hidden = false;
      return;
    }
    el.questionPackError.hidden = true;
    var config = {
      duration: numberOr(data.get("duration"), 30),
      followupIntensity: String(data.get("followupIntensity") || "medium"),
      candidateContext: String(data.get("candidateContext") || "").trim()
    };
    try {
      var plan = Engine.buildSessionPlan(pack, config.duration, config.followupIntensity);
      await Storage.saveSetting("lastSetup", {
        questionPack: pack.id,
        duration: config.duration,
        followupIntensity: config.followupIntensity
      });
      await createInterview(pack, plan, config);
    } catch (error) {
      fail(error, "无法开始模拟面试。");
    }
  }

  async function startSinglePractice(source, questionId) {
    var sourcePlan = planFor(source);
    var question = sourcePlan && sourcePlan.questions.find(function (item) { return item.id === questionId; });
    var pack = getPack(source.rolePack);
    if (!question || !pack) {
      showRoute("setup");
      showToast("无法定位原题，已回到新场配置。");
      return;
    }
    var practicePlan = Engine.buildSessionPlan({ questions: [clone(question)] }, 15, source.followupIntensity || "medium");
    await createInterview(pack, practicePlan, {
      duration: 15,
      followupIntensity: source.followupIntensity || "medium",
      candidateContext: source.candidateContext || ""
    }, {
      mode: "single-question-practice",
      parentSessionId: source.id,
      practiceQuestionId: question.id
    });
    showToast("已开始这道题的针对性重答。");
  }

  async function refreshResumePanel() {
    var sessions = await Storage.listSessions();
    state.resumeSession = sessions.find(function (session) { return !completed(session); }) || null;
    el.resumeSessionPanel.hidden = !state.resumeSession;
    if (!state.resumeSession) return;
    var turns = await Storage.getTurns(state.resumeSession.id);
    var plan = planFor(state.resumeSession);
    el.resumeSessionMeta.textContent = sessionTitle(state.resumeSession) + " · 已完成 " + mainAnswerCount(turns) +
      " / " + (plan && plan.questions ? plan.questions.length : 0) + " 题 · 更新于 " + relativeDate(state.resumeSession.updatedAt);
  }

  function scoreBand(score) {
    if (score >= 85) return "出色 · 表达证据与结构较稳定";
    if (score >= 70) return "良好 · 已具备基础胜任表达";
    if (score >= 55) return "发展中 · 建议针对薄弱项重答";
    return "待加强 · 先补齐结构与具体证据";
  }

  function dimensionHint(key, score) {
    var strong = {
      completeness: "回答要素相对完整",
      structure: "信息组织较清楚",
      evidence: "包含具体可观察证据",
      ownership: "个人行动边界较明确",
      reflection: "能说明复盘与改变",
      relevance: "回答聚焦题目考点"
    };
    var weak = {
      completeness: "补齐背景、目标、行动和结果",
      structure: "用 STAR 与因果链组织表达",
      evidence: "增加数字、对比或可观察结果",
      ownership: "区分个人贡献与团队成果",
      reflection: "说明不足与下一次改变",
      relevance: "围绕题目考点筛选信息"
    };
    return (score >= 3.5 ? strong : weak)[key] || "基于本场文本表现";
  }

  function renderReportFacts(session, turns, plan) {
    var evidenceCount = turns.reduce(function (sum, turn) {
      var quotes = turn.analysis && turn.analysis.evidenceQuotes;
      return sum + (Array.isArray(quotes) ? quotes.length : 0);
    }, 0);
    var durations = turns.map(function (turn) {
      return numberOr(turn.answerDurationMs, NaN);
    }).filter(Number.isFinite);
    var average = durations.length
      ? durations.reduce(function (sum, value) { return sum + value; }, 0) / durations.length
      : null;
    var facts = [
      ["主问题完成度", mainAnswerCount(turns) + " / " + (plan.questions ? plan.questions.length : 0)],
      ["有效证据", evidenceCount + " 处"],
      ["平均回答", average === null ? "暂无计时" : clock(average)]
    ];
    el.reportFacts.replaceChildren();
    facts.forEach(function (fact) {
      var wrapper = node("div");
      add(wrapper, "dt", "", fact[0]);
      add(wrapper, "dd", "", fact[1]);
      el.reportFacts.appendChild(wrapper);
    });
  }

  function renderDimensions(aggregate) {
    el.dimensionScores.replaceChildren();
    Object.keys(Engine.DIMENSIONS).forEach(function (key) {
      var score = numberOr(aggregate.dimensionAverages && aggregate.dimensionAverages[key], 0);
      var percentage = Math.max(0, Math.min(100, Math.round(score * 20)));
      var row = node("div", "dimension-row");
      row.dataset.dimension = key;
      var label = node("div");
      add(label, "strong", "", Engine.DIMENSIONS[key]);
      add(label, "span", "", dimensionHint(key, score));
      var track = node("div", "score-track");
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", Engine.DIMENSIONS[key] + " " + percentage + " 分");
      var bar = node("span");
      bar.style.setProperty("--score", percentage + "%");
      track.appendChild(bar);
      var output = node("output", "", String(percentage));
      output.setAttribute("aria-label", Engine.DIMENSIONS[key] + " " + percentage + " 分");
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(output);
      el.dimensionScores.appendChild(row);
    });
  }

  function feedbackValues(turns, key) {
    var result = [];
    turns.forEach(function (turn) {
      var values = turn.analysis && turn.analysis[key];
      if (!Array.isArray(values)) return;
      values.forEach(function (value) {
        var text = typeof value === "string" ? value : value && (value.reason || value.label);
        if (text && result.indexOf(text) < 0) result.push(text);
      });
    });
    return result;
  }

  function renderReviews(turns, plan) {
    el.reportQuestionList.replaceChildren();
    var ranked = [];
    var mainTurns = turns.filter(function (turn) { return !turn.isFollowUp; });
    mainTurns.forEach(function (turn, index) {
      var mainId = turn.mainQuestionId || turn.questionId;
      var related = turns.filter(function (candidate) {
        return (candidate.mainQuestionId || candidate.questionId) === mainId;
      });
      var values = related.map(function (item) {
        return numberOr(item.analysis && item.analysis.overall, NaN);
      }).filter(Number.isFinite);
      var score = values.length ? Math.round(values.reduce(function (sum, value) { return sum + value; }, 0) / values.length) : 0;
      ranked.push({ id: mainId, score: score });
      var question = turn.question || plan.questions.find(function (item) { return item.id === mainId; }) || {};
      var article = node("article", "review-item");
      article.dataset.questionId = mainId;
      var header = node("header");
      var heading = node("div");
      add(heading, "span", "", "问题 " + String(index + 1).padStart(2, "0") + " · " +
        (question.category || "核心问题") + (related.length > 1 ? " · 含 " + (related.length - 1) + " 次追问" : ""));
      add(heading, "h3", "", turn.questionText || questionText(question));
      var scoreNode = node("output", "", String(score));
      scoreNode.setAttribute("aria-label", "本题得分 " + score + " 分");
      header.appendChild(heading);
      header.appendChild(scoreNode);
      article.appendChild(header);
      var details = node("details");
      if (index === 0) details.open = true;
      add(details, "summary", "", "查看详细反馈");
      var grid = node("div", "feedback-grid");
      var evidence = feedbackValues(related, "evidenceQuotes");
      var gaps = [];
      related.forEach(function (item) {
        var detailsList = item.analysis && item.analysis.missingSignalDetails || [];
        detailsList.forEach(function (gap) {
          var text = gap.label ? gap.label + "：" + gap.reason : gap.reason;
          if (text && gaps.indexOf(text) < 0) gaps.push(text);
        });
      });
      var advice = feedbackValues(related, "improvements");
      var evidenceBlock = node("section", "feedback-block evidence-block");
      add(evidenceBlock, "h4", "", "有效证据");
      if (evidence.length) evidence.slice(0, 3).forEach(function (line) { add(evidenceBlock, "blockquote", "", line); });
      else add(evidenceBlock, "p", "", "暂未检测到数字、个人职责或因果表达等明确证据。");
      var gapBlock = node("section", "feedback-block gap-block");
      add(gapBlock, "h4", "", "信息缺口");
      add(gapBlock, "p", "", gaps.length ? gaps.slice(0, 3).join("；") : "本地规则未发现明显必填信息缺口。");
      var adviceBlock = node("section", "feedback-block advice-block");
      add(adviceBlock, "h4", "", "改进建议");
      add(adviceBlock, "p", "", advice.length ? advice.slice(0, 3).join("；") : "保持当前结构，再用更具体的事实校准表达。");
      grid.appendChild(evidenceBlock);
      grid.appendChild(gapBlock);
      grid.appendChild(adviceBlock);
      details.appendChild(grid);
      article.appendChild(details);
      var footer = node("footer");
      var button = node("button", "text-button reanswer-btn", "重答这一题 →");
      button.type = "button";
      button.dataset.action = "reanswer";
      button.dataset.questionId = mainId;
      footer.appendChild(button);
      article.appendChild(footer);
      el.reportQuestionList.appendChild(article);
    });
    ranked.sort(function (a, b) { return a.score - b.score; });
    state.weakQuestionId = ranked.length ? ranked[0].id : plan.questions[0] && plan.questions[0].id;
    el.reanswerWeakQuestionsBtn.disabled = !state.weakQuestionId;
    el.reportStartPracticeBtn.disabled = !state.weakQuestionId;
  }

  function renderReport(session, turns) {
    var plan = planFor(session) || { questions: [] };
    var aggregate = session.aggregate || Engine.aggregateSession(turns);
    state.reportSession = session;
    state.reportTurns = turns.slice();
    el.reportTitle.textContent = sessionTitle(session) + " · 面试报告";
    el.reportMeta.textContent = dateLabel(session.completedAt || session.updatedAt, false) + " · " +
      numberOr(session.durationMinutes, 30) + " 分钟模式 · 实际用时 " + clock(session.elapsedMs);
    el.overallScore.textContent = String(Math.round(numberOr(aggregate.overall, 0)));
    el.overallBand.textContent = scoreBand(numberOr(aggregate.overall, 0));
    el.overallSummary.textContent = aggregate.summary || "完成回答后会生成本地文本总结。";
    renderReportFacts(session, turns, plan);
    renderDimensions(aggregate);
    renderReviews(turns, plan);
  }

  async function openReport(sessionOrId) {
    var session = typeof sessionOrId === "string" ? await Storage.getSession(sessionOrId) : sessionOrId;
    if (!session || !completed(session)) throw new Error("这场面试尚未生成完整报告。");
    var turns = await Storage.getTurns(session.id);
    renderReport(session, turns);
    showRoute("report");
  }

  async function exportSession(session, turns) {
    var turnList = turns || await Storage.getTurns(session.id);
    var exportable = Object.assign({}, session, {
      title: sessionTitle(session) + " · 面试报告",
      packName: sessionTitle(session)
    });
    var markdown = Engine.formatMarkdown(exportable, turnList);
    var day = new Date(session.completedAt || session.updatedAt || Date.now()).toISOString().slice(0, 10);
    download(markdown, "text/markdown;charset=utf-8", filename(sessionTitle(session) + "-" + day) + ".md");
    showToast("Markdown 报告已导出。");
  }

  function progressFor(session, turns) {
    var plan = planFor(session);
    return { done: mainAnswerCount(turns), total: plan && plan.questions ? plan.questions.length : 0 };
  }

  function renderTrend(sessions) {
    var completeSessions = sessions.filter(completed).slice(0, 5).reverse();
    var scores = completeSessions.map(function (session) {
      return numberOr(session.aggregate && session.aggregate.overall, 0);
    });
    if (scores.length >= 2) {
      var delta = Math.round(scores[scores.length - 1] - scores[0]);
      el.trendDelta.textContent = delta > 0 ? "提升 " + delta + " 分" : delta < 0 ? "变化 " + delta + " 分" : "与首次持平";
    } else el.trendDelta.textContent = scores.length ? "已完成 1 场" : "暂无评分";
    el.historyTrendChart.setAttribute("aria-label", scores.length
      ? "最近 " + scores.length + " 场得分：" + scores.join("、") : "暂无可展示的完成场次");
    el.historyTrendChart.replaceChildren();
    var axis = node("div", "chart-axis");
    ["100", "75", "50"].forEach(function (label) { add(axis, "span", "", label); });
    axis.setAttribute("aria-hidden", "true");
    el.historyTrendChart.appendChild(axis);
    var svg = global.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 560 150");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    var grid = global.document.createElementNS(svg.namespaceURI, "path");
    grid.setAttribute("class", "chart-grid");
    grid.setAttribute("d", "M0 20H560M0 75H560M0 130H560");
    svg.appendChild(grid);
    if (scores.length) {
      var points = scores.map(function (score, index) {
        var x = scores.length === 1 ? 280 : 14 + index * (532 / (scores.length - 1));
        var y = 140 - Math.max(0, Math.min(100, score)) * 1.2;
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      });
      var line = global.document.createElementNS(svg.namespaceURI, "path");
      line.setAttribute("class", "chart-line");
      line.setAttribute("d", points.map(function (point, index) {
        return (index ? "L" : "M") + point.x + " " + point.y;
      }).join(" "));
      svg.appendChild(line);
      var group = global.document.createElementNS(svg.namespaceURI, "g");
      group.setAttribute("class", "chart-points");
      points.forEach(function (point, index) {
        var circle = global.document.createElementNS(svg.namespaceURI, "circle");
        circle.setAttribute("cx", point.x);
        circle.setAttribute("cy", point.y);
        circle.setAttribute("r", index === points.length - 1 ? "5" : "4");
        group.appendChild(circle);
      });
      svg.appendChild(group);
    }
    el.historyTrendChart.appendChild(svg);
    var labels = node("div", "chart-labels");
    labels.setAttribute("aria-hidden", "true");
    if (scores.length) scores.forEach(function (_score, index) {
      add(labels, "span", "", index === scores.length - 1 ? "最近" : "第 " + (index + 1) + " 场");
    });
    else add(labels, "span", "", "完成面试后显示趋势");
    el.historyTrendChart.appendChild(labels);
  }

  function renderHistoryRows(sessions) {
    el.historyList.replaceChildren();
    var filter = el.historyFilter.value;
    var visible = sessions.filter(function (session) { return filter === "all" || session.rolePack === filter; });
    el.historyEmptyState.hidden = visible.length > 0;
    visible.forEach(function (session) {
      var turns = state.historyTurns[session.id] || [];
      var progress = progressFor(session, turns);
      var isComplete = completed(session);
      var row = node("article", "session-row" + (isComplete ? "" : " is-incomplete"));
      row.dataset.sessionId = session.id;
      var main = node("div", "session-main");
      add(main, "span", "session-state" + (isComplete ? " is-complete" : ""), isComplete ? "已完成" : "未完成");
      add(main, "h3", "", sessionTitle(session));
      var meta = node("p");
      var time = add(meta, "time", "", relativeDate(session.updatedAt));
      time.dateTime = session.updatedAt || "";
      meta.appendChild(global.document.createTextNode(" · " + (isComplete
        ? "用时 " + clock(session.elapsedMs) : numberOr(session.durationMinutes, 30) + " 分钟模式")));
      main.appendChild(meta);
      row.appendChild(main);
      var progressBlock = node("div", "session-progress");
      add(progressBlock, "strong", "", progress.done + " / " + progress.total + " 题");
      if (isComplete) add(progressBlock, "span", "", "完整作答");
      else {
        var progressElement = node("progress");
        progressElement.max = Math.max(progress.total, 1);
        progressElement.value = progress.done;
        progressElement.textContent = progress.done + " / " + progress.total;
        progressBlock.appendChild(progressElement);
      }
      row.appendChild(progressBlock);
      var scoreBlock = node("div", "session-score");
      if (isComplete) {
        add(scoreBlock, "strong", "", String(Math.round(numberOr(session.aggregate && session.aggregate.overall, 0))));
        add(scoreBlock, "span", "", "综合分");
      } else add(scoreBlock, "span", "", "暂未评分");
      row.appendChild(scoreBlock);
      var actions = node("div", "session-actions");
      if (isComplete) {
        var reportButton = node("button", "text-button view-report-btn", "查看报告");
        reportButton.type = "button";
        reportButton.dataset.action = "view-report";
        reportButton.dataset.sessionId = session.id;
        actions.appendChild(reportButton);
        var exportButton = node("button", "menu-button export-session-btn", "导出");
        exportButton.type = "button";
        exportButton.dataset.action = "export";
        exportButton.dataset.sessionId = session.id;
        actions.appendChild(exportButton);
      } else {
        var continueButton = node("button", "button button-primary button-small continue-session-btn", "继续回答");
        continueButton.type = "button";
        continueButton.dataset.action = "continue";
        continueButton.dataset.sessionId = session.id;
        actions.appendChild(continueButton);
      }
      var deleteButton = node("button", "menu-button delete-session-btn", "删除");
      deleteButton.type = "button";
      deleteButton.dataset.action = "delete";
      deleteButton.dataset.sessionId = session.id;
      actions.appendChild(deleteButton);
      row.appendChild(actions);
      el.historyList.appendChild(row);
    });
  }

  async function renderHistory() {
    try {
      var sessions = await Storage.listSessions();
      var turnLists = await Promise.all(sessions.map(function (session) { return Storage.getTurns(session.id); }));
      state.historySessions = sessions;
      state.historyTurns = Object.create(null);
      sessions.forEach(function (session, index) { state.historyTurns[session.id] = turnLists[index]; });
      renderTrend(sessions);
      renderHistoryRows(sessions);
    } catch (error) {
      fail(error, "历史记录加载失败。");
    }
  }

  function confirm(title, message, actionLabel, callback) {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmActionBtn.textContent = actionLabel || "确认";
    state.pendingConfirm = callback;
    openDialog(el.confirmDialog);
  }

  async function runConfirmation() {
    var callback = state.pendingConfirm;
    state.pendingConfirm = null;
    closeDialog(el.confirmDialog, "confirm");
    if (typeof callback !== "function") return;
    try { await callback(); } catch (error) { fail(error, "操作失败。"); }
  }

  async function requestSessionDeletion(session) {
    confirm("删除这条记录？", "将删除“" + sessionTitle(session) + "”的回答、草稿与报告，且无法恢复。", "确认删除", async function () {
      await Storage.deleteSession(session.id);
      if (state.activeSession && state.activeSession.id === session.id) resetActiveSession();
      await refreshResumePanel();
      if (state.route === "history") await renderHistory();
      showToast("记录已删除。");
    });
  }

  function resetActiveSession() {
    stopRecognition(true);
    if (Voice && Voice.stopSpeaking) Voice.stopSpeaking();
    stopTimer();
    state.activeSession = null;
    state.turns = [];
    state.currentPlanIndex = 0;
    state.currentQuestion = null;
    state.followUpQueue = [];
    state.askedByMain = Object.create(null);
    state.elapsedBaseMs = 0;
    state.timerStartedAt = null;
    state.paused = false;
  }

  async function saveAndExit() {
    stopRecognition(true);
    pauseClock();
    await saveDraft(true);
    await persistSession();
    closeDialog(el.exitInterviewDialog, "save");
    var target = state.pendingRoute || "setup";
    state.pendingRoute = null;
    await refreshResumePanel();
    showRoute(target);
    showToast("进度与草稿已保存。");
  }

  async function discardAndExit() {
    var session = state.activeSession;
    closeDialog(el.exitInterviewDialog, "discard");
    state.pendingRoute = null;
    if (session) await Storage.deleteSession(session.id);
    resetActiveSession();
    await refreshResumePanel();
    showRoute("setup");
    showToast("本场面试已放弃并删除。");
  }

  function applySettings() {
    el.autoSaveToggle.checked = state.settings.autoSave !== false;
    el.soundToggle.checked = Boolean(state.settings.sound);
    el.reducedMotionToggle.checked = Boolean(state.settings.reducedMotion);
    el.speechLanguage.value = state.settings.speechLanguage || "zh-CN";
    global.document.documentElement.classList.toggle("reduced-motion", Boolean(state.settings.reducedMotion));
    global.document.body.classList.toggle("reduced-motion", Boolean(state.settings.reducedMotion));
  }

  function formatBytes(bytes) {
    var size = Math.max(0, numberOr(bytes, 0));
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10240 ? 1 : 0) + " KB";
    return (size / 1024 / 1024).toFixed(1) + " MB";
  }

  async function updateDataSize() {
    try {
      var snapshot = await Storage.exportAllData();
      var json = JSON.stringify(snapshot);
      var bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(json).length : new Blob([json]).size;
      el.localDataSize.textContent = formatBytes(bytes);
    } catch (_error) {
      el.localDataSize.textContent = "无法估算";
    }
  }

  function showSettings() {
    applySettings();
    el.settingsSaveStatus.textContent = "";
    openDialog(el.settingsDialog);
    void updateDataSize();
  }

  async function submitSettings(event) {
    event.preventDefault();
    if (event.submitter && event.submitter.value === "cancel") {
      closeDialog(el.settingsDialog, "cancel");
      return;
    }
    state.settings = {
      autoSave: el.autoSaveToggle.checked,
      sound: el.soundToggle.checked,
      reducedMotion: el.reducedMotionToggle.checked,
      speechLanguage: el.speechLanguage.value || "zh-CN"
    };
    try {
      await Storage.saveSetting("preferences", state.settings);
      applySettings();
      el.settingsSaveStatus.textContent = "设置已保存";
      global.setTimeout(function () { closeDialog(el.settingsDialog, "save"); }, 250);
    } catch (error) {
      el.settingsSaveStatus.textContent = error && error.message ? error.message : "设置保存失败";
    }
  }

  async function exportAllData() {
    var snapshot = await Storage.exportAllData();
    download(
      JSON.stringify(snapshot, null, 2),
      "application/json;charset=utf-8",
      "mock-interview-backup-" + new Date().toISOString().slice(0, 10) + ".json"
    );
    showToast("本地数据备份已导出。");
  }

  function requestClearAllData() {
    confirm(
      "清除全部本地数据？",
      "所有面试记录、草稿、报告和设置都会被永久删除。此操作无法撤销。",
      "清除全部数据",
      async function () {
        stopRecognition(true);
        await Storage.clearAllData();
        resetActiveSession();
        state.settings = clone(SETTINGS_DEFAULTS);
        applySettings();
        closeDialog(el.settingsDialog, "cleared");
        el.setupForm.reset();
        el.candidateContext.value = "";
        el.contextCount.textContent = "0";
        await refreshResumePanel();
        showRoute("setup");
        showToast("本地数据已全部清除。");
      }
    );
  }

  async function historyAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button || !el.historyList.contains(button)) return;
    var session = state.historySessions.find(function (item) { return item.id === button.dataset.sessionId; });
    if (!session) return;
    try {
      if (button.dataset.action === "continue") await openSession(session);
      else if (button.dataset.action === "view-report") await openReport(session);
      else if (button.dataset.action === "export") await exportSession(session, state.historyTurns[session.id]);
      else if (button.dataset.action === "delete") await requestSessionDeletion(session);
    } catch (error) {
      fail(error, "无法处理这条面试记录。");
    }
  }

  function bindEvents() {
    el.brandHomeBtn.addEventListener("click", function () { navigate("setup"); });
    el.navSetupBtn.addEventListener("click", function () { navigate("setup"); });
    el.navHistoryBtn.addEventListener("click", function () { navigate("history"); });
    el.openSettingsBtn.addEventListener("click", showSettings);
    el.setupForm.addEventListener("submit", startFromSetup);
    el.candidateContext.addEventListener("input", function () {
      el.contextCount.textContent = String(el.candidateContext.value.length);
    });
    el.resumeInterviewBtn.addEventListener("click", function () {
      if (state.resumeSession) void openSession(state.resumeSession).catch(function (error) { fail(error, "无法恢复上一场面试。"); });
    });
    el.discardResumeBtn.addEventListener("click", function () {
      if (state.resumeSession) void requestSessionDeletion(state.resumeSession);
    });

    el.answerInput.addEventListener("input", function () {
      if (Voice && Voice.isListening && Voice.isListening() && el.answerInput.value !== state.voiceRendered) {
        Voice.cancel();
        state.voicePrefix = el.answerInput.value;
        state.voiceFinal = "";
        state.voiceInterim = "";
        state.voiceRendered = el.answerInput.value;
        setVoiceUi(false, "已保留手动编辑内容；如需继续转写，请再次点击语音回答。");
      }
      updateAnswerCount();
      el.answerError.hidden = true;
      scheduleDraftSave();
    });
    el.answerInput.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (typeof el.answerForm.requestSubmit === "function") el.answerForm.requestSubmit();
        else void submitAnswer(event);
      }
    });
    el.answerForm.addEventListener("submit", submitAnswer);
    el.pauseInterviewBtn.addEventListener("click", function () { void togglePause(); });
    el.exitInterviewBtn.addEventListener("click", function () {
      state.pendingRoute = "setup";
      openDialog(el.exitInterviewDialog);
    });
    el.voiceToggleBtn.addEventListener("click", toggleVoice);

    el.exportReportBtn.addEventListener("click", function () {
      if (state.reportSession) void exportSession(state.reportSession, state.reportTurns).catch(function (error) { fail(error, "报告导出失败。"); });
    });
    el.newInterviewBtn.addEventListener("click", function () { showRoute("setup"); });
    el.reportQuestionList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action='reanswer']");
      if (!button || !state.reportSession) return;
      void startSinglePractice(state.reportSession, button.dataset.questionId).catch(function (error) {
        fail(error, "无法开始针对性重答。");
      });
    });
    function startWeakPractice() {
      if (state.reportSession && state.weakQuestionId) {
        void startSinglePractice(state.reportSession, state.weakQuestionId).catch(function (error) {
          fail(error, "无法开始薄弱题练习。");
        });
      } else showRoute("setup");
    }
    el.reanswerWeakQuestionsBtn.addEventListener("click", startWeakPractice);
    el.reportStartPracticeBtn.addEventListener("click", startWeakPractice);

    el.historyFilter.addEventListener("change", function () { renderHistoryRows(state.historySessions); });
    el.historyList.addEventListener("click", historyAction);
    el.emptyStartInterviewBtn.addEventListener("click", function () { showRoute("setup"); });
    el.exportAllHistoryBtn.addEventListener("click", function () {
      void exportAllData().catch(function (error) { fail(error, "历史记录导出失败。"); });
    });

    el.settingsForm.addEventListener("submit", submitSettings);
    el.exportDataBtn.addEventListener("click", function () {
      void exportAllData().catch(function (error) { fail(error, "备份导出失败。"); });
    });
    el.importDataInput.addEventListener("change", function () {
      if (typeof Storage.importAllData !== "function") {
        showToast("当前版本暂不支持导入。");
        el.importDataInput.value = "";
      }
    });
    el.importDataInput.addEventListener("click", function (event) {
      if (typeof Storage.importAllData !== "function") {
        event.preventDefault();
        showToast("当前版本暂不支持导入。");
      }
    });
    el.clearAllDataBtn.addEventListener("click", requestClearAllData);
    el.confirmCancelBtn.addEventListener("click", function (event) {
      event.preventDefault();
      state.pendingConfirm = null;
      closeDialog(el.confirmDialog, "cancel");
    });
    el.confirmActionBtn.addEventListener("click", function (event) {
      event.preventDefault();
      void runConfirmation();
    });
    el.confirmDialog.addEventListener("close", function () {
      if (el.confirmDialog.returnValue !== "confirm") state.pendingConfirm = null;
    });

    el.exitCancelBtn.addEventListener("click", function (event) {
      event.preventDefault();
      state.pendingRoute = null;
      closeDialog(el.exitInterviewDialog, "cancel");
    });
    el.exitSaveBtn.addEventListener("click", function (event) {
      event.preventDefault();
      void saveAndExit().catch(function (error) { fail(error, "进度保存失败。"); });
    });
    el.exitDiscardBtn.addEventListener("click", function (event) {
      event.preventDefault();
      void discardAndExit().catch(function (error) { fail(error, "无法放弃本场面试。"); });
    });
    el.toastCloseBtn.addEventListener("click", hideToast);

    global.addEventListener("popstate", function () {
      var route = routeFromHash();
      if (route === "interview" && !state.activeSession) route = "setup";
      if (route === "report" && !state.reportSession) route = "history";
      showRoute(route, { updateUrl: false });
    });
    global.document.addEventListener("visibilitychange", function () {
      if (global.document.visibilityState === "hidden" && state.activeSession && !completed(state.activeSession)) {
        void saveDraft(true);
        void persistSession();
      }
    });
    global.addEventListener("beforeunload", function () {
      if (!state.activeSession || completed(state.activeSession)) return;
      void saveDraft(true);
      void persistSession();
      // 不写 returnValue，刷新和关闭均不阻塞用户。
    });
  }

  async function loadPreferences() {
    var stored = await Storage.getSetting("preferences", SETTINGS_DEFAULTS);
    state.settings = Object.assign({}, SETTINGS_DEFAULTS, stored || {});
    applySettings();
    var setup = await Storage.getSetting("lastSetup", null);
    if (!setup) return;
    var radios = el.setupForm.querySelectorAll("input[type='radio']");
    radios.forEach(function (input) {
      if (input.name === "questionPack" && input.value === setup.questionPack) input.checked = true;
      if (input.name === "duration" && input.value === String(numberOr(setup.duration, 30))) input.checked = true;
      if (input.name === "followupIntensity" && input.value === String(setup.followupIntensity || "medium")) input.checked = true;
    });
  }

  function initializeVoice() {
    var capabilities = Voice && Voice.getCapabilities ? Voice.getCapabilities() : { recognition: false };
    el.voiceToggleBtn.disabled = !capabilities.recognition;
    el.voiceStatus.textContent = capabilities.recognition
      ? "语音输入未开启；本站不保存原始录音，音频可能由浏览器厂商处理"
      : "当前浏览器不支持语音识别，请使用键盘输入。";
  }

  async function initialize() {
    cacheElements();
    if (!Storage || !Engine || !Voice) throw new Error("Mock 核心模块未完整加载。");
    bindEvents();
    var storageInfo = await Storage.open();
    var localStatus = global.document.querySelector(".local-status");
    if (localStatus) localStatus.lastChild.textContent = storageInfo.persistent ? "本地存储" : "临时存储";
    await loadPreferences();
    initializeVoice();
    await refreshResumePanel();
    var route = routeFromHash();
    if (route === "interview" && state.resumeSession) {
      await openSession(state.resumeSession);
    } else if (route === "report") {
      var latest = (await Storage.listSessions({ status: Engine.STATES.COMPLETED, limit: 1 }))[0];
      if (latest) await openReport(latest);
      else showRoute("history", { replace: true });
    } else {
      showRoute(route === "interview" ? "setup" : route, { replace: true });
    }
  }

  function boot() {
    initialize().catch(function (error) {
      if (global.console && global.console.error) global.console.error(error);
      try {
        cacheElements();
        showToast(error && error.message ? error.message : "应用初始化失败，请刷新页面重试。", { duration: 8000 });
      } catch (_error) {
        // DOM 结构本身缺失时保留控制台错误。
      }
    });
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else boot();
})(typeof window !== "undefined" ? window : globalThis);
