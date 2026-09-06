(function (global) {
  "use strict";

  // 仅使用浏览器原生语音能力：不创建 MediaRecorder，也不保存或上传音频。
  var RecognitionConstructor = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var recognition = null;
  var recognitionState = "idle";
  var recognitionRunId = 0;
  var speakingUtterance = null;
  var speakingRunId = 0;

  function safeCall(callback) {
    if (typeof callback !== "function") return;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      callback.apply(null, args);
    } catch (error) {
      // 用户回调异常不应破坏语音对象的内部状态；异步抛出便于开发时发现。
      global.setTimeout(function () { throw error; }, 0);
    }
  }

  function getCapabilities() {
    var navigatorObject = global.navigator || {};
    return {
      recognition: Boolean(RecognitionConstructor),
      speechRecognition: Boolean(RecognitionConstructor),
      synthesis: Boolean(global.speechSynthesis && global.SpeechSynthesisUtterance),
      speechSynthesis: Boolean(global.speechSynthesis && global.SpeechSynthesisUtterance),
      microphoneApi: Boolean(navigatorObject.mediaDevices && navigatorObject.mediaDevices.getUserMedia),
      recognitionConstructor: global.SpeechRecognition
        ? "SpeechRecognition"
        : global.webkitSpeechRecognition
          ? "webkitSpeechRecognition"
          : null,
      audioPersistence: false,
      defaultLanguage: "zh-CN"
    };
  }

  function voiceError(code, originalCode, originalEvent, overrideMessage) {
    var definitions = {
      unsupported: {
        kind: "unsupported",
        message: "当前浏览器不支持语音识别，请改用键盘输入。",
        recoverable: false
      },
      "synthesis-unsupported": {
        kind: "unsupported",
        message: "当前浏览器不支持语音朗读。",
        recoverable: false
      },
      "permission-denied": {
        kind: "permission-denied",
        message: "麦克风权限被拒绝，请在浏览器设置中允许本页面使用麦克风。",
        recoverable: true
      },
      "no-microphone": {
        kind: "no-microphone",
        message: "未检测到可用麦克风，请连接或启用麦克风后重试。",
        recoverable: true
      },
      "already-started": {
        kind: "state",
        message: "语音识别已经在运行。",
        recoverable: true
      },
      "no-speech": {
        kind: "no-speech",
        message: "没有识别到语音，请靠近麦克风后重试。",
        recoverable: true
      },
      "network": {
        kind: "network",
        message: "浏览器语音识别服务暂时不可用；你仍可使用键盘输入。",
        recoverable: true
      },
      "aborted": {
        kind: "cancelled",
        message: "语音识别已取消。",
        recoverable: true
      },
      "language-not-supported": {
        kind: "unsupported-language",
        message: "浏览器不支持当前识别语言，请切换语言或使用键盘输入。",
        recoverable: true
      },
      "recognition-error": {
        kind: "recognition-error",
        message: "语音识别发生错误，请重试或改用键盘输入。",
        recoverable: true
      },
      "synthesis-error": {
        kind: "synthesis-error",
        message: "语音朗读失败。",
        recoverable: true
      }
    };
    var definition = definitions[code] || definitions["recognition-error"];
    return {
      name: "MockVoiceError",
      code: code,
      kind: definition.kind,
      message: overrideMessage || definition.message,
      recoverable: definition.recoverable,
      originalCode: originalCode || null,
      originalEvent: originalEvent || null
    };
  }

  function normalizeRecognitionError(eventOrError) {
    var original = eventOrError || {};
    var rawCode = String(original.error || original.name || original.code || "").toLocaleLowerCase();
    var message = String(original.message || "").toLocaleLowerCase();

    if (rawCode === "not-allowed" || rawCode === "service-not-allowed" ||
        rawCode === "notallowederror" || rawCode === "securityerror" ||
        /permission|denied|not allowed|不允许|拒绝/.test(message)) {
      return voiceError("permission-denied", rawCode, original);
    }
    if (rawCode === "audio-capture" || rawCode === "notfounderror" ||
        rawCode === "devicesnotfounderror" || /microphone|audio input|麦克风|录音设备/.test(message)) {
      return voiceError("no-microphone", rawCode, original);
    }
    if (rawCode === "no-speech") return voiceError("no-speech", rawCode, original);
    if (rawCode === "network") return voiceError("network", rawCode, original);
    if (rawCode === "aborted") return voiceError("aborted", rawCode, original);
    if (rawCode === "language-not-supported") return voiceError("language-not-supported", rawCode, original);
    if (rawCode === "invalidstateerror") return voiceError("already-started", rawCode, original);
    return voiceError("recognition-error", rawCode, original, original.message || undefined);
  }

  function start(options) {
    var config = options && typeof options === "object" ? options : {};
    var callbacks = {
      onInterim: config.onInterim,
      onFinal: config.onFinal,
      onError: config.onError,
      onEnd: config.onEnd
    };

    if (!RecognitionConstructor) {
      var unsupported = voiceError("unsupported");
      safeCall(callbacks.onError, unsupported);
      safeCall(callbacks.onEnd, { reason: "unsupported", error: unsupported });
      return { started: false, error: unsupported };
    }

    if (recognition && (recognitionState === "starting" || recognitionState === "listening" || recognitionState === "stopping")) {
      var busy = voiceError("already-started");
      safeCall(callbacks.onError, busy);
      return { started: false, error: busy };
    }

    var instance = new RecognitionConstructor();
    var runId = ++recognitionRunId;
    var endReason = "ended";
    var lastError = null;
    var finalTranscript = "";
    recognition = instance;
    recognitionState = "starting";

    instance.lang = config.lang || "zh-CN";
    instance.interimResults = true;
    instance.continuous = config.continuous === true;
    if ("maxAlternatives" in instance) instance.maxAlternatives = 1;

    instance.onstart = function () {
      if (runId !== recognitionRunId) return;
      recognitionState = "listening";
    };

    instance.onresult = function (event) {
      if (runId !== recognitionRunId) return;
      var interimTranscript = "";
      var newFinalTranscript = "";
      var startIndex = Number.isFinite(event.resultIndex) ? event.resultIndex : 0;
      for (var index = startIndex; index < event.results.length; index += 1) {
        var result = event.results[index];
        var transcript = result && result[0] ? String(result[0].transcript || "") : "";
        if (result && result.isFinal) newFinalTranscript += transcript;
        else interimTranscript += transcript;
      }
      if (newFinalTranscript) {
        finalTranscript += newFinalTranscript;
        safeCall(callbacks.onFinal, newFinalTranscript, {
          transcript: newFinalTranscript,
          accumulatedTranscript: finalTranscript,
          event: event
        });
      }
      if (interimTranscript) {
        safeCall(callbacks.onInterim, interimTranscript, {
          transcript: interimTranscript,
          finalTranscript: finalTranscript,
          event: event
        });
      }
    };

    instance.onerror = function (event) {
      if (runId !== recognitionRunId) return;
      lastError = normalizeRecognitionError(event);
      endReason = lastError.code === "aborted" ? "cancelled" : "error";
      safeCall(callbacks.onError, lastError);
    };

    instance.onend = function () {
      if (runId !== recognitionRunId) return;
      recognition = null;
      recognitionState = "idle";
      safeCall(callbacks.onEnd, {
        reason: endReason,
        transcript: finalTranscript,
        error: lastError
      });
    };

    try {
      instance.start();
      return {
        started: true,
        lang: instance.lang,
        continuous: instance.continuous,
        audioPersisted: false
      };
    } catch (error) {
      var normalized = normalizeRecognitionError(error);
      recognition = null;
      recognitionState = "idle";
      safeCall(callbacks.onError, normalized);
      safeCall(callbacks.onEnd, { reason: "error", transcript: "", error: normalized });
      return { started: false, error: normalized };
    }
  }

  function stop() {
    if (!recognition || recognitionState === "idle") return false;
    recognitionState = "stopping";
    try {
      // stop 会提交已经识别到的最终文本。
      recognition.stop();
      return true;
    } catch (_error) {
      recognition = null;
      recognitionState = "idle";
      return false;
    }
  }

  function cancel() {
    if (!recognition || recognitionState === "idle") return false;
    recognitionState = "stopping";
    try {
      // abort 直接取消当前识别，不应再把临时文本当作答案。
      recognition.abort();
      return true;
    } catch (_error) {
      recognition = null;
      recognitionState = "idle";
      return false;
    }
  }

  function selectVoice(lang, preferredVoiceName) {
    if (!global.speechSynthesis || typeof global.speechSynthesis.getVoices !== "function") return null;
    var voices = global.speechSynthesis.getVoices() || [];
    if (preferredVoiceName) {
      var exact = voices.find(function (voice) { return voice.name === preferredVoiceName; });
      if (exact) return exact;
    }
    var normalizedLanguage = String(lang || "zh-CN").toLocaleLowerCase();
    var baseLanguage = normalizedLanguage.split("-")[0];
    return voices.find(function (voice) {
      return String(voice.lang || "").toLocaleLowerCase() === normalizedLanguage;
    }) || voices.find(function (voice) {
      return String(voice.lang || "").toLocaleLowerCase().split("-")[0] === baseLanguage;
    }) || null;
  }

  function speak(text, options) {
    var config = options && typeof options === "object" ? options : {};
    var content = String(text == null ? "" : text).trim();
    if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) {
      var unsupported = voiceError("synthesis-unsupported");
      safeCall(config.onError, unsupported);
      safeCall(config.onEnd, { reason: "unsupported", error: unsupported });
      return { started: false, error: unsupported };
    }
    if (!content) {
      safeCall(config.onEnd, { reason: "empty", error: null });
      return { started: false, reason: "empty" };
    }

    stopSpeaking();
    var runId = ++speakingRunId;
    var utterance = new global.SpeechSynthesisUtterance(content);
    utterance.lang = config.lang || "zh-CN";
    var numericRate = Number(config.rate);
    utterance.rate = Number.isFinite(numericRate) ? Math.min(2, Math.max(0.5, numericRate)) : 1;
    if (Number.isFinite(Number(config.pitch))) utterance.pitch = Math.min(2, Math.max(0, Number(config.pitch)));
    if (Number.isFinite(Number(config.volume))) utterance.volume = Math.min(1, Math.max(0, Number(config.volume)));
    var selectedVoice = selectVoice(utterance.lang, config.voiceName);
    if (selectedVoice) utterance.voice = selectedVoice;
    speakingUtterance = utterance;

    utterance.onstart = function (event) {
      if (runId === speakingRunId) safeCall(config.onStart, event);
    };
    utterance.onend = function (event) {
      if (runId !== speakingRunId) return;
      speakingUtterance = null;
      safeCall(config.onEnd, { reason: "ended", event: event, error: null });
    };
    utterance.onerror = function (event) {
      if (runId !== speakingRunId) return;
      speakingUtterance = null;
      var error = voiceError("synthesis-error", event && event.error, event);
      safeCall(config.onError, error);
      safeCall(config.onEnd, { reason: "error", event: event, error: error });
    };

    try {
      global.speechSynthesis.speak(utterance);
      return {
        started: true,
        lang: utterance.lang,
        rate: utterance.rate,
        voice: utterance.voice ? utterance.voice.name : null
      };
    } catch (originalError) {
      speakingUtterance = null;
      var normalized = voiceError("synthesis-error", originalError.name, originalError, originalError.message || undefined);
      safeCall(config.onError, normalized);
      safeCall(config.onEnd, { reason: "error", error: normalized });
      return { started: false, error: normalized };
    }
  }

  function stopSpeaking() {
    var wasSpeaking = Boolean(speakingUtterance || (global.speechSynthesis && global.speechSynthesis.speaking));
    speakingRunId += 1;
    speakingUtterance = null;
    if (global.speechSynthesis && typeof global.speechSynthesis.cancel === "function") {
      global.speechSynthesis.cancel();
    }
    return wasSpeaking;
  }

  var api = {
    getCapabilities: getCapabilities,
    detectCapabilities: getCapabilities,
    isRecognitionSupported: function () { return Boolean(RecognitionConstructor); },
    isSynthesisSupported: function () { return Boolean(global.speechSynthesis && global.SpeechSynthesisUtterance); },
    getRecognitionState: function () { return recognitionState; },
    isListening: function () { return recognitionState === "starting" || recognitionState === "listening"; },
    isSpeaking: function () { return Boolean(speakingUtterance || (global.speechSynthesis && global.speechSynthesis.speaking)); },
    start: start,
    stop: stop,
    cancel: cancel,
    speak: speak,
    stopSpeaking: stopSpeaking,
    normalizeError: normalizeRecognitionError
  };

  Object.defineProperty(api, "capabilities", {
    enumerable: true,
    get: getCapabilities
  });

  global.MockVoice = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
