(function (global) {
  "use strict";

  // 本引擎只分析回答文本中可观察到的表达特征，不联网，也不验证事实真伪。
  var STATES = Object.freeze({
    SETUP: "SETUP",
    PREPARING: "PREPARING",
    ASKING: "ASKING",
    ANSWERING: "ANSWERING",
    EVALUATING_LOCAL: "EVALUATING_LOCAL",
    REVIEWING: "REVIEWING",
    COMPLETED: "COMPLETED"
  });

  var DIMENSIONS = Object.freeze({
    completeness: "内容完整度",
    structure: "表达结构",
    evidence: "证据具体度",
    ownership: "个人贡献",
    reflection: "复盘成长",
    relevance: "问题相关度"
  });

  var DIMENSION_KEYS = Object.keys(DIMENSIONS);
  var SCORE_WEIGHTS = {
    completeness: 0.14,
    structure: 0.18,
    evidence: 0.18,
    ownership: 0.17,
    reflection: 0.13,
    relevance: 0.2
  };

  var STRUCTURE_PATTERNS = {
    situation: /(?:背景|当时|那时|项目初期|在[^。！？\n]{0,16}(?:情况|环境|阶段)下|面临|场景|情境)/i,
    task: /(?:目标|任务|职责|负责|需要|要求|挑战|要解决|希望达成)/i,
    action: /(?:我(?:先|通过|采取|推动|主导|设计|分析|制定|协调|搭建|完成|提出|组织|负责|落地|跟进|优化)|具体(?:做法|行动)|首先|其次|然后)/i,
    result: /(?:结果|最终|因此|从而|使得|带来|提升|下降|增长|减少|达成|完成|上线|落地|转化|产出)/i
  };

  var CAUSAL_PATTERNS = [
    /因为[^。！？\n]{1,80}所以/i,
    /由于[^。！？\n]{1,80}(?:因此|所以)/i,
    /通过[^。！？\n]{1,80}(?:从而|进而|使|让)/i,
    /(?:为了|为)[^。！？\n]{1,50}(?:我|我们)/i,
    /(?:导致|促使|使得|带来)/i
  ];

  var NUMBER_PATTERN = /(?:\d+(?:[.,]\d+)?\s*(?:%|％|万|千|百|亿|元|人|家|个|次|天|周|月|年|小时|分钟|倍|条|项|分|pp|bps)|(?:提升|增长|下降|减少|节省|缩短|扩大|达到|完成)[^。！？\n]{0,12}\d+(?:[.,]\d+)?)/gi;
  var OWNERSHIP_PATTERN = /我(?:负责|主导|推动|提出|设计|分析|制定|协调|搭建|完成|决策|发现|组织|争取|落地|跟进|优化|拆解|验证|复盘)/gi;
  var REFLECTION_PATTERN = /(?:复盘|反思|学到|收获|意识到|不足|改进|迭代|如果再来|下次(?:会|要)|以后(?:会|要))/gi;
  var DEEP_REFLECTION_PATTERN = /(?:如果再来|下次(?:会|要)|不足(?:是|在于)?|改进(?:点|方向|方式)?|可以做得更好|后来我(?:调整|优化))/gi;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function asText(value) {
    return value == null ? "" : String(value);
  }

  function unique(values) {
    var seen = Object.create(null);
    return values.filter(function (value) {
      var key = String(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeKeywords(value) {
    if (Array.isArray(value)) {
      return unique(value.map(function (item) {
        return typeof item === "object" && item ? item.keyword || item.text || item.label : item;
      }).map(asText).map(function (item) { return item.trim(); }).filter(Boolean));
    }
    if (typeof value === "string") {
      return unique(value.split(/[，,、|/；;\n]+/).map(function (item) { return item.trim(); }).filter(Boolean));
    }
    return [];
  }

  // 主格式为 { problem: { label, keywords, required }, ... }，同时兼容数组式旧题库。
  function normalizeSignalGroups(question) {
    var source = question && (question.signalGroups || question.signal_groups);
    var groups = [];

    if (Array.isArray(source)) {
      source.forEach(function (item, index) {
        if (typeof item === "string") {
          groups.push({ key: item, label: item, keywords: [item], required: true });
          return;
        }
        if (!item || typeof item !== "object") return;
        var key = asText(item.key || item.id || item.name || "signal_" + (index + 1));
        groups.push({
          key: key,
          label: asText(item.label || item.title || key),
          keywords: normalizeKeywords(item.keywords || item.signals || item.examples),
          required: item.required !== false
        });
      });
    } else if (source && typeof source === "object") {
      Object.keys(source).forEach(function (key) {
        var item = source[key];
        if (Array.isArray(item) || typeof item === "string") {
          groups.push({
            key: key,
            label: key,
            keywords: normalizeKeywords(item),
            required: true
          });
          return;
        }
        item = item && typeof item === "object" ? item : {};
        groups.push({
          key: key,
          label: asText(item.label || item.title || key),
          keywords: normalizeKeywords(item.keywords || item.signals || item.examples),
          required: item.required !== false
        });
      });
    }

    return groups;
  }

  function includesKeyword(textLower, keyword) {
    return textLower.indexOf(asText(keyword).toLocaleLowerCase()) >= 0;
  }

  function heuristicSignalMatch(key, text) {
    var patterns = {
      problem: /(?:问题|痛点|困难|难点|瓶颈|卡在|缺少|没有|无法|不准|错误|低效|耗时|成本|重复|分散|遗漏|冲突)/i,
      context: /(?:用户|业务|客户|团队|同学|管理者|一线|当时|之前|早期|背景|场景|流程|区域|国家|角色)/i,
      action: /(?:我(?:负责|主导|推动|提出|设计|分析|制定|协调|搭建|完成|组织|落地|跟进|优化|梳理|拆解|验证)|我们(?:先|通过|设计|搭建|梳理|拆解)|首先|其次|然后)/i,
      evidence: /(?:结果|最终|上线|落地|提升|下降|减少|增长|覆盖|准确率|完成率|留存|反馈|验证|\d)/i,
      judgment: /(?:因为|所以|因此|相比|而不是|选择|判断|取舍|权衡|优先|边界|风险|原因)/i,
      reflection: /(?:复盘|反思|不足|改进|如果再来|下次|后来调整|没有达到|仍然|还需要)/i
    };
    return patterns[key] ? patterns[key].test(text) : false;
  }

  function findMatches(text, regex) {
    var flags = regex.flags.indexOf("g") >= 0 ? regex.flags : regex.flags + "g";
    var copy = new RegExp(regex.source, flags);
    return text.match(copy) || [];
  }

  function sentenceContaining(text, matcher) {
    // 不使用正则后行断言，兼容较旧的 WebView / Safari。
    var sentences = text.split(/[。！？!?；;\n]+/).map(function (item) { return item.trim(); }).filter(Boolean);
    for (var index = 0; index < sentences.length; index += 1) {
      var matched = typeof matcher === "string"
        ? includesKeyword(sentences[index].toLocaleLowerCase(), matcher)
        : new RegExp(matcher.source, matcher.flags.replace("g", "")).test(sentences[index]);
      if (matched) {
        var sentence = sentences[index].replace(/[\r\n]+/g, " ");
        return sentence.length > 72 ? sentence.slice(0, 69) + "…" : sentence;
      }
    }
    return "";
  }

  function addEvidence(target, label, quote) {
    if (!quote) return;
    var value = label + "：“" + quote.replace(/[。；;！？!?]+$/, "") + "”";
    if (target.indexOf(value) < 0 && target.length < 8) target.push(value);
  }

  function lengthScore(characters) {
    if (characters === 0) return 1;
    if (characters < 35) return 1;
    if (characters < 80) return 2;
    if (characters < 160) return 3;
    if (characters < 280) return 4;
    return 5;
  }

  function structureScore(partCount, causalDetected) {
    var score = partCount <= 1 ? 1 : partCount === 2 ? 2 : partCount === 3 ? 4 : 5;
    return clamp(score + (causalDetected && score < 5 ? 1 : 0), 1, 5);
  }

  function makeMissingDetail(key, label, reason, required) {
    return { key: key, label: label, reason: reason, required: required !== false };
  }

  function analyzeAnswer(answer, question) {
    var text = asText(answer).trim();
    var compactText = text.replace(/\s+/g, "");
    var lower = text.toLocaleLowerCase();
    var characters = compactText.length;
    var sentenceCount = text ? text.split(/[。！？!?；;\n]+/).filter(function (item) { return item.trim(); }).length : 0;

    var parts = {};
    var partEvidence = {};
    Object.keys(STRUCTURE_PATTERNS).forEach(function (key) {
      parts[key] = STRUCTURE_PATTERNS[key].test(text);
      partEvidence[key] = parts[key] ? sentenceContaining(text, STRUCTURE_PATTERNS[key]) : "";
    });
    var detectedPartKeys = Object.keys(parts).filter(function (key) { return parts[key]; });
    var missingPartKeys = Object.keys(parts).filter(function (key) { return !parts[key]; });
    var causalDetected = CAUSAL_PATTERNS.some(function (pattern) { return pattern.test(text); });
    var causalQuote = "";
    CAUSAL_PATTERNS.some(function (pattern) {
      causalQuote = sentenceContaining(text, pattern);
      return Boolean(causalQuote);
    });

    var numberMatches = unique(findMatches(text, NUMBER_PATTERN));
    var ownershipMatches = unique(findMatches(text, OWNERSHIP_PATTERN));
    var reflectionMatches = unique(findMatches(text, REFLECTION_PATTERN));
    var deepReflectionMatches = unique(findMatches(text, DEEP_REFLECTION_PATTERN));
    var firstPersonDetected = /我|本人/.test(text);
    var isIntroduction = question && question.evaluationProfile === "introduction";

    var groups = normalizeSignalGroups(question || {});
    var groupKeySet = Object.create(null);
    var groupSignals = {};
    groups.forEach(function (group) {
      groupKeySet[group.key] = true;
      var matchedKeywords = group.keywords.filter(function (keyword) { return includesKeyword(lower, keyword); });
      var heuristicMatched = heuristicSignalMatch(group.key, text);
      groupSignals[group.key] = {
        label: group.label,
        required: group.required,
        detectable: group.keywords.length > 0,
        matched: group.keywords.length > 0 ? matchedKeywords.length > 0 || heuristicMatched : heuristicMatched || null,
        heuristicMatched: heuristicMatched,
        matchedKeywords: matchedKeywords,
        keywords: group.keywords.slice()
      };
    });

    var questionKeywords = normalizeKeywords(question && (question.keywords || question.expectedKeywords || question.relevantKeywords));
    var allRelevantKeywords = unique(questionKeywords.concat(groups.reduce(function (all, group) {
      return all.concat(group.keywords);
    }, [])));
    var matchedRelevantKeywords = allRelevantKeywords.filter(function (keyword) { return includesKeyword(lower, keyword); });
    var relevanceRatio = allRelevantKeywords.length ? matchedRelevantKeywords.length / allRelevantKeywords.length : null;

    var scores = {
      completeness: lengthScore(characters),
      structure: structureScore(detectedPartKeys.length, causalDetected),
      evidence: numberMatches.length === 0 ? 1 : numberMatches.length >= 2 && parts.result ? 5 : parts.result ? 4 : 3,
      ownership: ownershipMatches.length >= 2 ? 5 : ownershipMatches.length === 1 ? 4 : firstPersonDetected ? 2 : 1,
      reflection: deepReflectionMatches.length >= 2 ? 5 : deepReflectionMatches.length === 1 ? 4 : reflectionMatches.length ? 3 : 1,
      relevance: relevanceRatio === null
        ? 3
        : matchedRelevantKeywords.length === 0
          ? 1
          : relevanceRatio >= 0.75 && matchedRelevantKeywords.length >= 3
            ? 5
            : relevanceRatio >= 0.45 || matchedRelevantKeywords.length >= 3
              ? 4
              : 3
    };

    if (isIntroduction) {
      var conciseIntroduction = characters >= 55 && characters <= 420;
      var introSignals = Object.keys(groupSignals).filter(function (key) { return groupSignals[key].matched; }).length;
      scores.completeness = characters < 35 ? 1 : characters < 55 ? 3 : characters <= 420 ? 5 : 3;
      scores.structure = introSignals >= 3 ? 5 : introSignals === 2 ? 4 : introSignals === 1 ? 3 : 2;
      scores.evidence = numberMatches.length || matchedRelevantKeywords.length >= 2 ? 4 : 3;
      scores.ownership = firstPersonDetected ? 4 : 2;
      scores.reflection = conciseIntroduction ? 4 : 3;
    }

    if (!text) {
      DIMENSION_KEYS.forEach(function (key) { scores[key] = 1; });
    }

    var weighted = DIMENSION_KEYS.reduce(function (sum, key) {
      return sum + scores[key] * SCORE_WEIGHTS[key];
    }, 0);
    var overall = text ? clamp(Math.round(weighted * 20), 0, 100) : 0;

    var missingDetails = [];
    groups.forEach(function (group) {
      var result = groupSignals[group.key];
      if (result.detectable && !result.matched) {
        missingDetails.push(makeMissingDetail(
          group.key,
          group.label,
          "未检测到题库为“" + group.label + "”配置的关键词线索",
          group.required
        ));
      }
    });
    if (characters < (isIntroduction ? 55 : 80)) missingDetails.push(makeMissingDetail("detail", "回答细节", "当前回答较短，信息展开不足", true));
    if (!isIntroduction) missingPartKeys.forEach(function (key) {
      // 题库 signalGroups 的同名键优先，避免已命中的 action 等信号被 STAR 规则误报为缺失。
      if (groupKeySet[key]) return;
      var labels = { situation: "情境背景", task: "任务目标", action: "具体行动", result: "结果影响" };
      missingDetails.push(makeMissingDetail(key, labels[key], "未检测到清晰的" + labels[key] + "表达", true));
    });
    if (!isIntroduction && !numberMatches.length) missingDetails.push(makeMissingDetail("numericEvidence", "量化证据", "未检测到数字、比例或明确量级", true));
    if (!isIntroduction && !ownershipMatches.length) missingDetails.push(makeMissingDetail("ownership", "个人贡献", "未检测到“我负责/主导/推动”等职责表达", true));
    if (!isIntroduction && !reflectionMatches.length && !groupKeySet.reflection) {
      missingDetails.push(makeMissingDetail("reflection", "复盘成长", "未检测到复盘、经验或改进表达", false));
    }
    if (relevanceRatio !== null && matchedRelevantKeywords.length === 0) {
      missingDetails.push(makeMissingDetail("relevance", "题目关键信号", "未检测到题库配置的相关关键词", true));
    }

    var missingSeen = Object.create(null);
    missingDetails = missingDetails.filter(function (item) {
      if (missingSeen[item.key]) return false;
      missingSeen[item.key] = true;
      return true;
    });

    var evidenceQuotes = [];
    addEvidence(evidenceQuotes, "量化线索", numberMatches.length ? sentenceContaining(text, NUMBER_PATTERN) : "");
    addEvidence(evidenceQuotes, "个人职责", ownershipMatches.length ? sentenceContaining(text, OWNERSHIP_PATTERN) : "");
    addEvidence(evidenceQuotes, "因果表达", causalQuote);
    addEvidence(evidenceQuotes, "复盘表达", reflectionMatches.length ? sentenceContaining(text, REFLECTION_PATTERN) : "");
    matchedRelevantKeywords.slice(0, 3).forEach(function (keyword) {
      addEvidence(evidenceQuotes, "相关信号“" + keyword + "”", sentenceContaining(text, keyword));
    });

    var strengths = [];
    if (scores.completeness >= 4) strengths.push("回答展开较充分，包含较多可供追问的细节。");
    if (scores.structure >= 4) strengths.push("情境、任务、行动与结果的组织较清楚。");
    if (scores.evidence >= 4) strengths.push("使用了数字或量级描述结果，表达更具体。");
    if (scores.ownership >= 4) strengths.push("明确说明了个人承担的职责和采取的行动。");
    if (scores.reflection >= 4) strengths.push("包含复盘与后续改进思路。");
    if (scores.relevance >= 4) strengths.push("回答覆盖了题目所关注的多个关键信号。");
    if (!strengths.length && text) strengths.push("已给出基础回答，可继续补充关键细节。");

    var improvements = [];
    if (scores.completeness <= 2) improvements.push("补充事件背景、目标、关键动作和最终结果，避免只给结论。");
    if (scores.structure <= 2) improvements.push("按“情境—任务—行动—结果”重组回答，并明确动作与结果的因果关系。");
    if (scores.evidence <= 2) improvements.push("加入可说明结果的数字、比例、时间或前后对比；无法量化时说明可观察影响。");
    if (scores.ownership <= 2) improvements.push("区分团队成果与个人贡献，说明你具体负责、判断和推动了什么。");
    if (scores.reflection <= 2) improvements.push("补充一次复盘：哪里可改进，以及下次会如何做。");
    if (scores.relevance <= 2) improvements.push("围绕题目关键词取舍信息，优先回答面试官真正关注的能力点。");
    groups.forEach(function (group) {
      var signal = groupSignals[group.key];
      if (group.required && signal.detectable && !signal.matched && improvements.length < 7) {
        improvements.push("补充“" + group.label + "”相关信息；当前文本未出现题库配置的对应线索。");
      }
    });

    return {
      signals: {
        length: { characters: characters, sentences: sentenceCount, sufficient: characters >= 80 },
        star: { detected: detectedPartKeys.length >= 3, parts: clone(parts) },
        causality: { detected: causalDetected },
        numericEvidence: { detected: numberMatches.length > 0, matches: numberMatches.slice(0, 8) },
        ownership: { detected: ownershipMatches.length > 0, matches: ownershipMatches.slice(0, 8) },
        reflection: { detected: reflectionMatches.length > 0, matches: reflectionMatches.slice(0, 8) },
        relevantKeywords: {
          configured: allRelevantKeywords,
          matched: matchedRelevantKeywords,
          ratio: relevanceRatio === null ? null : round(relevanceRatio, 2)
        },
        signalGroups: groupSignals
      },
      scores: scores,
      dimensionScores: clone(scores),
      dimensions: clone(scores),
      overall: overall,
      evidenceQuotes: evidenceQuotes,
      missingSignals: missingDetails.map(function (item) { return item.key; }),
      missingSignalDetails: missingDetails,
      strengths: strengths,
      improvements: unique(improvements).slice(0, 7),
      structureInfo: {
        framework: "STAR + 因果链",
        starDetected: detectedPartKeys.length >= 3,
        causalDetected: causalDetected,
        parts: clone(parts),
        detectedParts: detectedPartKeys,
        missingParts: missingPartKeys,
        evidence: partEvidence,
        characters: characters,
        sentences: sentenceCount
      },
      methodNote: "评分仅依据回答文本中的结构、关键词和可观察表达，不代表对经历真实性或业务结论正确性的核验。"
    };
  }

  var REQUIREMENT_ALIASES = {
    length: "detail", completeness: "detail", details: "detail",
    background: "situation", context: "situation", scene: "situation",
    goal: "task", objective: "task", challenge: "task",
    actions: "action", approach: "action", method: "action",
    outcome: "result", outcomes: "result", impact: "result",
    number: "numericEvidence", numbers: "numericEvidence", numeric: "numericEvidence",
    metric: "numericEvidence", metrics: "numericEvidence", data: "numericEvidence", evidence: "numericEvidence",
    responsibility: "ownership", contribution: "ownership", firstPerson: "ownership",
    review: "reflection", learning: "reflection", learnings: "reflection",
    keyword: "relevance", keywords: "relevance", relevant: "relevance"
  };

  function canonicalRequirement(value, knownSignalKeys) {
    var raw = asText(value).trim();
    // signalGroups 的键是题库契约，必须优先保留（例如 context/evidence）。
    if (knownSignalKeys && knownSignalKeys[raw]) return raw;
    return REQUIREMENT_ALIASES[raw] || REQUIREMENT_ALIASES[raw.toLocaleLowerCase()] || raw;
  }

  function normalizeRequires(followUp, knownSignalKeys) {
    if (!followUp) return [];
    var value = followUp.requires != null ? followUp.requires : followUp.require;
    if (Array.isArray(value)) {
      return unique(value.map(function (item) {
        return canonicalRequirement(item, knownSignalKeys);
      }).filter(Boolean));
    }
    if (typeof value === "string") {
      return unique(value.split(/[，,、|/；;\s]+/).map(function (item) {
        return canonicalRequirement(item, knownSignalKeys);
      }).filter(Boolean));
    }
    return [];
  }

  function followUpId(item, index) {
    return asText(item && (item.id || item.key || item.code)) || "followup_" + (index + 1);
  }

  function chooseFollowUp(question, analysis, askedFollowUpIds, maxFollowUps) {
    var asked = Array.isArray(askedFollowUpIds) ? askedFollowUpIds.map(asText) : [];
    var requestedLimit = Number.isFinite(Number(maxFollowUps)) ? Number(maxFollowUps) : 2;
    var limit = clamp(Math.floor(requestedLimit), 0, 2);

    var followUps = question && (question.followUps || question.followups || question.followUpQuestions || question.follow_ups);
    if (!Array.isArray(followUps) || !followUps.length) return null;
    // 调用方可以传整场已问 ID；上限只统计当前主问题自己的追问。
    var currentFollowUpIds = followUps.map(followUpId);
    var askedForThisQuestion = asked.filter(function (id) { return currentFollowUpIds.indexOf(id) >= 0; });
    if (askedForThisQuestion.length >= limit) return null;

    var knownSignalKeys = Object.create(null);
    normalizeSignalGroups(question || {}).forEach(function (group) { knownSignalKeys[group.key] = true; });
    var missing = analysis && Array.isArray(analysis.missingSignals)
      ? analysis.missingSignals.map(function (item) { return canonicalRequirement(item, knownSignalKeys); })
      : [];
    var missingSet = Object.create(null);
    missing.forEach(function (key) { missingSet[key] = true; });
    var detailByKey = Object.create(null);
    if (analysis && Array.isArray(analysis.missingSignalDetails)) {
      analysis.missingSignalDetails.forEach(function (item) {
        if (item && item.key) detailByKey[canonicalRequirement(item.key, knownSignalKeys)] = item;
      });
    }

    var candidates = [];
    followUps.forEach(function (item, index) {
      if (!item) return;
      if (typeof item === "string") item = { prompt: item };
      var id = followUpId(item, index);
      if (asked.indexOf(id) >= 0) return;
      var requires = normalizeRequires(item, knownSignalKeys);
      var matched = requires.filter(function (key) { return missingSet[key]; });
      // 配置了 requires 的追问，只在对应信息确实缺失时触发。
      if (requires.length && !matched.length) return;
      var requiredWeight = matched.reduce(function (sum, key) {
        return sum + (detailByKey[key] && detailByKey[key].required === false ? 1 : 2);
      }, 0);
      candidates.push({
        item: item,
        index: index,
        id: id,
        requires: requires,
        matched: matched,
        score: matched.length * 10 + requiredWeight - index / 1000
      });
    });

    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.score - a.score; });
    var selected = candidates[0];
    var labels = selected.matched.map(function (key) {
      return detailByKey[key] ? detailByKey[key].label : key;
    });
    var result = Object.assign({}, clone(selected.item), {
      id: selected.id,
      requires: selected.requires,
      matchedMissingSignals: selected.matched,
      reason: selected.matched.length
        ? "回答中缺少“" + labels.join("、") + "”相关信息，因此选择此追问。"
        : "该追问未绑定特定缺失信号，用于进一步澄清回答。"
    });
    if (!result.prompt && result.question) result.prompt = result.question;
    if (!result.prompt && result.text) result.prompt = result.text;
    if (!result.text && result.prompt) result.text = result.prompt;
    if (!result.question && result.prompt) result.question = result.prompt;
    return result;
  }

  function collectQuestions(pack) {
    var collected = [];
    var seen = Object.create(null);

    function add(question, inheritedCategory) {
      if (!question || typeof question !== "object") return;
      var copy = clone(question);
      if (!copy.category && inheritedCategory) copy.category = inheritedCategory;
      var id = asText(copy.id || copy.key || copy.code || "question_" + (collected.length + 1));
      if (seen[id]) return;
      seen[id] = true;
      copy.id = id;
      collected.push(copy);
    }

    if (Array.isArray(pack)) {
      pack.forEach(function (question) { add(question, "通用"); });
      return collected;
    }
    if (!pack || typeof pack !== "object") return collected;

    var direct = pack.questions || pack.items || pack.questionList;
    if (Array.isArray(direct)) direct.forEach(function (question) { add(question, pack.category); });

    if (Array.isArray(pack.categories)) {
      pack.categories.forEach(function (category, index) {
        if (!category) return;
        var categoryName = typeof category === "string" ? category : category.name || category.label || category.id || "类别" + (index + 1);
        var questions = category.questions || category.items;
        if (Array.isArray(questions)) questions.forEach(function (question) { add(question, categoryName); });
      });
    } else if (pack.categories && typeof pack.categories === "object") {
      Object.keys(pack.categories).forEach(function (categoryName) {
        var category = pack.categories[categoryName];
        var questions = Array.isArray(category) ? category : category && (category.questions || category.items);
        if (Array.isArray(questions)) questions.forEach(function (question) { add(question, categoryName); });
      });
    }

    if (!collected.length) {
      Object.keys(pack).forEach(function (key) {
        if (!Array.isArray(pack[key])) return;
        pack[key].forEach(function (question) { add(question, key); });
      });
    }
    return collected;
  }

  function difficultyValue(question) {
    var value = question && (question.difficulty || question.level);
    if (Number.isFinite(Number(value))) return clamp(Number(value), 1, 3);
    value = asText(value).toLocaleLowerCase();
    if (/挑战|困难|高级|hard|advanced|高/.test(value)) return 3;
    if (/基础|简单|easy|basic|低/.test(value)) return 1;
    return 2;
  }

  function intensityInfo(intensity) {
    var raw = asText(intensity || "standard");
    var lower = raw.toLocaleLowerCase();
    if (/轻|低|温和|基础|easy|light|relaxed|low/.test(lower)) {
      return { value: raw, targetDifficulty: 1, maxFollowUpsPerQuestion: 0, label: "轻量" };
    }
    if (/高|深|深入|挑战|hard|intensive|deep|high/.test(lower)) {
      return { value: raw, targetDifficulty: 3, maxFollowUpsPerQuestion: 2, label: "高强度" };
    }
    return { value: raw, targetDifficulty: 2, maxFollowUpsPerQuestion: 1, label: "标准" };
  }

  function targetQuestionCount(duration) {
    var minutes = Number(duration);
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
    return clamp(Math.round(minutes / 5) + 1, 1, 10);
  }

  function explicitFlowForDuration(pack, duration) {
    var flow = pack && pack.interviewFlow;
    if (!flow || typeof flow !== "object") return [];
    var minutes = Number(duration);
    var keys = Object.keys(flow).filter(function (key) {
      return Array.isArray(flow[key]) && flow[key].length && Number.isFinite(Number(key));
    });
    if (!keys.length) return [];
    keys.sort(function (left, right) {
      return Math.abs(Number(left) - minutes) - Math.abs(Number(right) - minutes);
    });
    return flow[keys[0]].map(asText).filter(Boolean);
  }

  function buildSessionPlan(pack, duration, intensity) {
    var minutes = Number(duration);
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
    var target = targetQuestionCount(minutes);
    var intensityConfig = intensityInfo(intensity);
    var questions = collectQuestions(pack);
    var explicitFlow = explicitFlowForDuration(pack, minutes);
    var questionById = Object.create(null);
    questions.forEach(function (question) { questionById[question.id] = question; });
    var selected = explicitFlow.map(function (id) { return questionById[id]; }).filter(Boolean);
    var buckets = [];
    var bucketByCategory = Object.create(null);

    if (!selected.length) {
      questions.forEach(function (question, sourceIndex) {
        var category = asText(question.category || question.type || question.topic || question.dimension || "通用");
        if (!bucketByCategory[category]) {
          bucketByCategory[category] = { category: category, items: [] };
          buckets.push(bucketByCategory[category]);
        }
        bucketByCategory[category].items.push({ question: question, sourceIndex: sourceIndex });
      });

      buckets.forEach(function (bucket) {
        bucket.items.sort(function (a, b) {
          var gapA = Math.abs(difficultyValue(a.question) - intensityConfig.targetDifficulty);
          var gapB = Math.abs(difficultyValue(b.question) - intensityConfig.targetDifficulty);
          var priorityA = Number.isFinite(Number(a.question.priority)) ? Number(a.question.priority) : 99;
          var priorityB = Number.isFinite(Number(b.question.priority)) ? Number(b.question.priority) : 99;
          return gapA - gapB || priorityA - priorityB || a.sourceIndex - b.sourceIndex;
        });
      });

      var cursor = 0;
      while (selected.length < target && buckets.some(function (bucket) { return bucket.items.length > 0; })) {
        var bucket = buckets[cursor % buckets.length];
        if (bucket.items.length) selected.push(bucket.items.shift().question);
        cursor += 1;
      }
    } else {
      target = selected.length;
    }

    selected = selected.map(function (question, index) {
      var copy = clone(question);
      copy.planOrder = index + 1;
      var configuredLimit = Number.isFinite(Number(copy.maxFollowUps)) ? Number(copy.maxFollowUps) : null;
      if (configuredLimit !== null) {
        copy.maxFollowUps = Math.min(2, Math.max(0, configuredLimit));
      } else if (explicitFlow.length) {
        // 真实一面会把追问集中在开场后的两个主项目问题，后半段不会机械深挖每一题。
        copy.maxFollowUps = intensityConfig.maxFollowUpsPerQuestion === 0
          ? 0
          : intensityConfig.maxFollowUpsPerQuestion === 2 && index >= 1 && index <= 2
            ? 2
            : Math.min(1, intensityConfig.maxFollowUpsPerQuestion);
      } else {
        copy.maxFollowUps = Math.min(2, intensityConfig.maxFollowUpsPerQuestion);
      }
      return copy;
    });

    var distribution = {};
    selected.forEach(function (question) {
      var category = asText(question.category || question.type || question.topic || question.dimension || "通用");
      distribution[category] = (distribution[category] || 0) + 1;
    });

    return {
      durationMinutes: minutes,
      intensity: intensityConfig.value,
      intensityLabel: intensityConfig.label,
      targetMainQuestions: target,
      actualMainQuestions: selected.length,
      maxFollowUpsPerQuestion: intensityConfig.maxFollowUpsPerQuestion,
      estimatedMinutesPerQuestion: selected.length ? round(minutes / selected.length, 1) : 0,
      categoryDistribution: distribution,
      questions: selected
    };
  }

  function analysisFromTurn(turn) {
    if (!turn || typeof turn !== "object") return null;
    if (turn.analysis && typeof turn.analysis === "object") return turn.analysis;
    if (turn.evaluation && typeof turn.evaluation === "object") return turn.evaluation;
    if (turn.localAnalysis && typeof turn.localAnalysis === "object") return turn.localAnalysis;
    if (turn.scores || turn.dimensionScores) return turn;
    return null;
  }

  function scoreFromAnalysis(analysis, key) {
    var scores = analysis && (analysis.scores || analysis.dimensionScores || analysis.dimensions);
    if (!scores) return null;
    var aliases = {
      completeness: ["completeness", "length", "完整度", "内容完整度"],
      structure: ["structure", "结构", "表达结构"],
      evidence: ["evidence", "specificity", "证据", "具体性", "证据具体度"],
      ownership: ["ownership", "contribution", "个人贡献"],
      reflection: ["reflection", "learning", "复盘", "复盘成长"],
      relevance: ["relevance", "相关度", "问题相关度"]
    };
    var names = aliases[key] || [key];
    for (var index = 0; index < names.length; index += 1) {
      var value = Number(scores[names[index]]);
      if (Number.isFinite(value)) return clamp(value, 1, 5);
    }
    return null;
  }

  var DRILL_BY_DIMENSION = {
    completeness: "用 90 秒完整讲述一个项目：背景、目标、动作、结果各至少一句。",
    structure: "选择一道经历题，用 STAR 四段式重答，并用“因为—所以”连接关键判断。",
    evidence: "为最近三个项目各补一项数字、前后对比或可观察结果，再重答其中一题。",
    ownership: "把回答中的“我们”逐句拆开，明确你个人做出的判断、动作与贡献。",
    reflection: "为一个项目写下“做得不足—原因—下次改变”三句话，并口述 30 秒。",
    relevance: "先用一句话说出题目考点，再只保留能证明该考点的经历细节。"
  };

  function aggregateSession(turns) {
    var list = Array.isArray(turns) ? turns : [];
    var analyses = list.map(analysisFromTurn).filter(Boolean);
    var averages = {};
    var counts = {};

    DIMENSION_KEYS.forEach(function (key) {
      var values = analyses.map(function (analysis) { return scoreFromAnalysis(analysis, key); }).filter(function (value) { return value !== null; });
      counts[key] = values.length;
      averages[key] = values.length ? round(values.reduce(function (sum, value) { return sum + value; }, 0) / values.length, 1) : 0;
    });

    var overallValues = analyses.map(function (analysis) { return Number(analysis.overall); }).filter(Number.isFinite);
    var overall = overallValues.length
      ? Math.round(overallValues.reduce(function (sum, value) { return sum + value; }, 0) / overallValues.length)
      : analyses.length
        ? Math.round(DIMENSION_KEYS.reduce(function (sum, key) { return sum + averages[key]; }, 0) / DIMENSION_KEYS.length * 20)
        : 0;

    var ordered = DIMENSION_KEYS.slice().sort(function (a, b) {
      var valueA = counts[a] ? averages[a] : 99;
      var valueB = counts[b] ? averages[b] : 99;
      return valueA - valueB;
    });
    var weakest = ordered.filter(function (key) { return counts[key] > 0; }).slice(0, 3);
    var strongest = ordered.filter(function (key) { return counts[key] > 0; }).sort(function (a, b) { return averages[b] - averages[a]; })[0];

    var improvementFrequency = Object.create(null);
    analyses.forEach(function (analysis) {
      (Array.isArray(analysis.improvements) ? analysis.improvements : []).forEach(function (item) {
        var text = asText(item).trim();
        if (text) improvementFrequency[text] = (improvementFrequency[text] || 0) + 1;
      });
    });
    var repeatedImprovements = Object.keys(improvementFrequency).sort(function (a, b) {
      return improvementFrequency[b] - improvementFrequency[a];
    });

    var dimensionAdvice = {
      completeness: "提高回答完整度：补齐背景、目标、行动和结果。",
      structure: "加强表达结构：使用 STAR 和清晰的因果连接。",
      evidence: "加强证据具体度：增加数字、对比或可观察结果。",
      ownership: "突出个人贡献：明确你本人负责的判断和行动。",
      reflection: "补足复盘成长：说明不足以及下次的改进方式。",
      relevance: "提升问题相关度：围绕题目考点筛选信息。"
    };
    var priorityImprovements = weakest.filter(function (key) { return averages[key] < 4; }).map(function (key) { return dimensionAdvice[key]; });
    repeatedImprovements.forEach(function (item) {
      if (priorityImprovements.length < 3 && priorityImprovements.indexOf(item) < 0) priorityImprovements.push(item);
    });

    var summary;
    if (!analyses.length) {
      summary = "尚无可汇总的本地评估结果。完成至少一道回答后会生成六维总结。";
    } else {
      summary = "本次共汇总 " + analyses.length + " 个回答，文本表现综合分约 " + overall + "/100。";
      if (strongest) summary += "相对优势是" + DIMENSIONS[strongest] + "（" + averages[strongest] + "/5）";
      if (weakest[0]) summary += "，优先提升" + DIMENSIONS[weakest[0]] + "（" + averages[weakest[0]] + "/5）。";
    }

    return {
      answeredCount: analyses.length,
      dimensionAverages: averages,
      dimensions: clone(averages),
      dimensionLabels: clone(DIMENSIONS),
      overall: clamp(overall, 0, 100),
      summary: summary,
      priorityImprovements: unique(priorityImprovements).slice(0, 3),
      nextDrill: weakest[0] ? DRILL_BY_DIMENSION[weakest[0]] : "完成一道回答后再生成针对性训练。",
      methodNote: "汇总仅反映本地文本特征，不验证回答所述事实。"
    };
  }

  function markdownText(value) {
    return asText(value).replace(/\r/g, "").trim();
  }

  function formatMarkdown(session, turns) {
    var data = session && typeof session === "object" ? session : {};
    var turnList = Array.isArray(turns) ? turns : Array.isArray(data.turns) ? data.turns : [];
    var aggregate = data.aggregate || data.summaryData || aggregateSession(turnList);
    var lines = [
      "# " + markdownText(data.title || data.name || "Mock 面试复盘"),
      "",
      "- 会话 ID：" + markdownText(data.id || "未记录"),
      "- 岗位题包：" + markdownText(data.rolePack || data.packName || "未记录"),
      "- 状态：" + markdownText(data.status || "未记录"),
      "- 更新时间：" + markdownText(data.updatedAt || data.completedAt || "未记录"),
      "",
      "## 总结",
      "",
      markdownText(aggregate.summary),
      "",
      "综合分：" + (Number.isFinite(Number(aggregate.overall)) ? Math.round(Number(aggregate.overall)) : 0) + "/100",
      "",
      "## 六维评分",
      "",
      "| 维度 | 平均分 |",
      "| --- | ---: |"
    ];

    DIMENSION_KEYS.forEach(function (key) {
      var score = aggregate.dimensionAverages && Number(aggregate.dimensionAverages[key]);
      lines.push("| " + DIMENSIONS[key] + " | " + (Number.isFinite(score) ? score.toFixed(1) : "0.0") + "/5 |");
    });

    lines.push("", "## 优先改进", "");
    var priorities = Array.isArray(aggregate.priorityImprovements) ? aggregate.priorityImprovements : [];
    if (priorities.length) priorities.forEach(function (item) { lines.push("- " + markdownText(item)); });
    else lines.push("- 暂无");
    lines.push("", "## 下一步练习", "", markdownText(aggregate.nextDrill || "暂无"));

    lines.push("", "## 问答记录");
    turnList.forEach(function (turn, index) {
      var question = turn.question && typeof turn.question === "object"
        ? turn.question.prompt || turn.question.text || turn.question.question || turn.question.title
        : turn.question || turn.questionText || turn.prompt;
      var answer = turn.answer || turn.answerText || turn.response || "";
      var analysis = analysisFromTurn(turn);
      lines.push(
        "",
        "### " + (index + 1) + ". " + markdownText(question || "未记录题目"),
        "",
        markdownText(answer || "（未作答）")
      );
      if (analysis) {
        lines.push("", "本地文本评分：" + (Number.isFinite(Number(analysis.overall)) ? Math.round(Number(analysis.overall)) : "—") + "/100");
        if (Array.isArray(analysis.strengths) && analysis.strengths.length) {
          lines.push("", "优点：" + analysis.strengths.map(markdownText).join("；"));
        }
        if (Array.isArray(analysis.improvements) && analysis.improvements.length) {
          lines.push("", "改进：" + analysis.improvements.map(markdownText).join("；"));
        }
      }
    });
    lines.push("", "> 注：评分来自本地文本规则，仅用于表达训练，不验证经历真实性。", "");
    return lines.join("\n");
  }

  function makeSessionExport(session, turns) {
    var data = session && typeof session === "object" ? clone(session) : {};
    var turnList = Array.isArray(turns) ? clone(turns) : Array.isArray(data.turns) ? clone(data.turns) : [];
    data.turns = turnList;
    return {
      format: "qiuzhao-mock-interview-session",
      version: 1,
      exportedAt: new Date().toISOString(),
      session: data,
      aggregate: data.aggregate || aggregateSession(turnList)
    };
  }

  function toSessionJSON(session, turns, space) {
    var indentation = Number.isFinite(Number(space)) ? clamp(Number(space), 0, 10) : 2;
    return JSON.stringify(makeSessionExport(session, turns), null, indentation);
  }

  function parseSessionJSON(json) {
    var parsed = typeof json === "string" ? JSON.parse(json) : clone(json);
    if (!parsed || typeof parsed !== "object") throw new TypeError("会话 JSON 必须是对象");
    if (parsed.format && parsed.format !== "qiuzhao-mock-interview-session") {
      throw new Error("无法识别的会话 JSON 格式");
    }
    var session = parsed.session && typeof parsed.session === "object" ? parsed.session : parsed;
    if (session.turns != null && !Array.isArray(session.turns)) throw new TypeError("session.turns 必须是数组");
    return clone(parsed);
  }

  global.MockEngine = Object.freeze({
    STATES: STATES,
    STATE: STATES,
    SETUP: STATES.SETUP,
    PREPARING: STATES.PREPARING,
    ASKING: STATES.ASKING,
    ANSWERING: STATES.ANSWERING,
    EVALUATING_LOCAL: STATES.EVALUATING_LOCAL,
    REVIEWING: STATES.REVIEWING,
    COMPLETED: STATES.COMPLETED,
    DIMENSIONS: DIMENSIONS,
    MAX_FOLLOW_UPS_PER_QUESTION: 2,
    analyzeAnswer: analyzeAnswer,
    chooseFollowUp: chooseFollowUp,
    buildSessionPlan: buildSessionPlan,
    aggregateSession: aggregateSession,
    formatMarkdown: formatMarkdown,
    makeSessionExport: makeSessionExport,
    toSessionJSON: toSessionJSON,
    formatSessionJSON: toSessionJSON,
    formatJSON: toSessionJSON,
    parseSessionJSON: parseSessionJSON,
    normalizeSignalGroups: normalizeSignalGroups
  });
})(typeof window !== "undefined" ? window : globalThis);
