// ============================================================
//  渲染逻辑 · 无框架，纯原生 JS
// ============================================================

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const STATUS_OPTIONS = ["想投", "已投", "笔试", "一面", "二面", "三面", "HR面", "Offer", "挂"];
const LS_STATUS = "qiuzhao_status_v1";     // 公司状态
const LS_CHECK = "qiuzhao_check_v1";       // 清单进度
const LS_PROFILE = "qiuzhao_profile_v1";   // 自查资料

// "2027-08" -> "2027年8月"
const fmtGrad = (s) => { const [y, m] = s.split("-"); return `${y}年${parseInt(m, 10)}月`; };

// —— Tab 切换 ——
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");
  });
});

// —— 顶部统计 ——
function renderHeaderStats() {
  const total = COMPANIES.length;
  const high = COMPANIES.filter((c) => c.priority === "高").length;
  const box = $("#headerStats");
  box.innerHTML = "";
  [
    { n: total, l: "目标公司" },
    { n: high, l: "高优先级" },
    { n: PREPARATION.length, l: "岗位方向" },
  ].forEach((s) => {
    const d = el("div", "stat", `<b>${s.n}</b><span>${s.l}</span>`);
    box.appendChild(d);
  });
}

// —— 时间线 ——
function renderTimeline() {
  const box = $("#timeline");
  box.innerHTML = "";
  TIMELINE.forEach((t) => {
    const item = el("div", "tl-item" + (t.highlight ? " hot" : ""));
    item.innerHTML = `
      <div class="tl-month">${t.month}</div>
      <div class="tl-title">${t.title} <span class="tl-tag">${t.tag}</span></div>
      <div class="tl-desc">${t.desc}</div>`;
    box.appendChild(item);
  });
}

// —— 概览卡片：按岗位统计机会数 ——
function renderOverviewCards() {
  const box = $("#overviewCards");
  box.innerHTML = "";
  PREPARATION.forEach((p) => {
    const count = COMPANIES.filter((c) => c.roles.includes(p.role)).length;
    const card = el("div", "ov-card");
    card.innerHTML = `<b style="color:${p.color}">${count}</b><span>${p.role} 岗机会</span>`;
    box.appendChild(card);
  });
}

// —— 公司筛选状态 ——
let activeRole = "全部";
let activeTier = "全部";

function getStatusMap() {
  try { return JSON.parse(localStorage.getItem(LS_STATUS)) || {}; } catch { return {}; }
}
function setStatus(name, val) {
  const m = getStatusMap();
  m[name] = val;
  localStorage.setItem(LS_STATUS, JSON.stringify(m));
}

function renderFilters() {
  const roles = ["全部", ...PREPARATION.map((p) => p.role)];
  const tiers = ["全部", ...Array.from(new Set(COMPANIES.map((c) => c.tier)))];
  const rBox = $("#roleFilter");
  const tBox = $("#tierFilter");
  rBox.innerHTML = ""; tBox.innerHTML = "";

  roles.forEach((r) => {
    const c = el("div", "chip" + (r === activeRole ? " active" : ""), r);
    c.onclick = () => { activeRole = r; renderFilters(); renderCompanies(); };
    rBox.appendChild(c);
  });
  tiers.forEach((t) => {
    const c = el("div", "chip" + (t === activeTier ? " active" : ""), t);
    c.onclick = () => { activeTier = t; renderFilters(); renderCompanies(); };
    tBox.appendChild(c);
  });
}

function renderCompanies() {
  const box = $("#companyGrid");
  box.innerHTML = "";
  const statusMap = getStatusMap();
  const list = COMPANIES.filter(
    (c) => (activeRole === "全部" || c.roles.includes(activeRole)) &&
           (activeTier === "全部" || c.tier === activeTier)
  );
  if (!list.length) { box.innerHTML = '<p style="color:var(--text-dim)">没有符合条件的公司。</p>'; return; }

  list.forEach((c) => {
    const cur = statusMap[c.name] || c.status;
    const card = el("div", "company-card");
    const links = [];
    if (c.official) links.push(`<a class="link-btn primary" href="${c.official}" target="_blank" rel="noopener">🔗 官方校招</a>`);
    if (c.nowcoder) links.push(`<a class="link-btn" href="${c.nowcoder}" target="_blank" rel="noopener">💬 牛客开奖</a>`);
    const posHtml = c.positions
      ? `<div class="cc-positions"><span class="cc-label">在招方向</span>${c.positions.map((p) => `<span class="pos-tag">${p}</span>`).join("")}</div>`
      : "";
    const gradTip = c.gradInfo ? " title=\"该毕业窗口为当届通用推断，请以官网为准\"" : "";
    const gradHtml = (c.gradFrom && c.gradTo)
      ? `<div class="cc-meta"${gradTip}>🎓 <b>毕业窗口：</b>${fmtGrad(c.gradFrom)} ~ ${fmtGrad(c.gradTo)}${c.gradInfo ? " <span class=\"est\">推断</span>" : ""}</div>`
      : "";
    const cityHtml = c.cities ? `<div class="cc-meta">📍 <b>城市：</b>${c.cities.join(" / ")}</div>` : "";
    card.innerHTML = `
      <div class="cc-head">
        <span class="cc-name">${c.name}</span>
        <span class="cc-tier">${c.tier}</span>
      </div>
      <div class="cc-roles">${c.roles.map((r) => `<span class="role-tag">${r}</span>`).join("")}</div>
      ${posHtml}
      <div class="cc-meta">🗓 <b>开放：</b>${c.open}</div>
      ${gradHtml}
      ${cityHtml}
      <div class="cc-meta">📮 <b>渠道：</b>${c.channel}</div>
      <div class="cc-note">${c.note}</div>
      <div class="cc-links">${links.join("")}</div>
      <div class="cc-foot">
        <span class="priority ${c.priority}">优先级 ${c.priority}</span>
        <select class="status-select"></select>
      </div>`;
    const sel = card.querySelector(".status-select");
    STATUS_OPTIONS.forEach((s) => {
      const o = el("option", null, s);
      o.value = s;
      if (s === cur) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => setStatus(c.name, sel.value);
    box.appendChild(card);
  });
}

// —— 准备方向 ——
let activePrep = 0;
function renderPrepNav() {
  const box = $("#prepNav");
  box.innerHTML = "";
  PREPARATION.forEach((p, i) => {
    const t = el("button", "prep-tab" + (i === activePrep ? " active" : ""), p.role);
    if (i === activePrep) { t.style.background = p.color; t.style.borderColor = p.color; }
    t.style.borderLeftColor = p.color;
    t.onclick = () => { activePrep = i; renderPrepNav(); renderPrepContent(); };
    box.appendChild(t);
  });
}

function renderPrepContent() {
  const p = PREPARATION[activePrep];
  const box = $("#prepContent");
  box.innerHTML = `
    <div class="prep-summary" style="border-left:4px solid ${p.color}">
      <b style="color:${p.color}">${p.role}</b> — ${p.summary}
    </div>
    <div class="prep-block">
      <h3>🧩 核心能力</h3>
      <div class="tag-list">${p.skills.map((s) => `<span class="skill-tag">${s}</span>`).join("")}</div>
    </div>
    <div class="prep-block">
      <h3>🎯 准备重点</h3>
      <ul class="prep-list">${p.focus.map((f) => `<li>${f}</li>`).join("")}</ul>
    </div>
    <div class="prep-block">
      <h3>❓ 高频面试题</h3>
      <ul class="prep-list q-list">${p.questions.map((q) => `<li>${q}</li>`).join("")}</ul>
    </div>
    <div class="prep-block">
      <h3>📖 推荐资源</h3>
      <div class="res-list">${p.resources.map((r) => `<span class="res-tag">${r}</span>`).join("")}</div>
    </div>`;
}

// —— 备战清单 ——
function getChecks() {
  try { return JSON.parse(localStorage.getItem(LS_CHECK)) || {}; } catch { return {}; }
}
function renderChecklist() {
  const box = $("#checklist");
  const checks = getChecks();
  box.innerHTML = "";
  let done = 0;
  CHECKLIST.forEach((item, i) => {
    const isDone = !!checks[i];
    if (isDone) done++;
    const row = el("label", "check-item" + (isDone ? " done" : ""));
    row.innerHTML = `<input type="checkbox" ${isDone ? "checked" : ""} /><span>${item}</span>`;
    row.querySelector("input").onchange = (e) => {
      const c = getChecks();
      c[i] = e.target.checked;
      localStorage.setItem(LS_CHECK, JSON.stringify(c));
      renderChecklist();
    };
    box.appendChild(row);
  });
  const pct = Math.round((done / CHECKLIST.length) * 100);
  $("#progressBar").style.width = pct + "%";
}

// —— 投递资格自查 ——
function getProfile() {
  try { return JSON.parse(localStorage.getItem(LS_PROFILE)) || {}; } catch { return {}; }
}
function saveProfile(p) { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); }

// 岗位方向关键词 -> 匹配 positions 里的字样
const ROLE_KEYWORDS = {
  "产品": ["产品经理", "产品策划", "产品培训生", "AI产品"],
  "产运": ["产品运营", "内容运营", "电商运营", "运营"],
  "商分": ["商业分析", "商分"],
  "战略": ["战略", "跨境增长"],
  "数分": ["数据分析", "数据科学"],
};

function roleMatchesPositions(role, positions) {
  if (!positions) return false;
  const kws = ROLE_KEYWORDS[role] || [role];
  return positions.some((p) => kws.some((kw) => p.includes(kw)));
}

function renderEligForm() {
  const p = getProfile();
  if (p.grad) $("#efGrad").value = p.grad;
  if (p.degree) $("#efDegree").value = p.degree;

  const roles = PREPARATION.map((x) => x.role);
  const rBox = $("#efRoles");
  rBox.innerHTML = "";
  const selRoles = new Set(p.roles || []);
  roles.forEach((r) => {
    const c = el("div", "chip" + (selRoles.has(r) ? " active" : ""), r);
    c.onclick = () => {
      const cur = getProfile();
      const s = new Set(cur.roles || []);
      s.has(r) ? s.delete(r) : s.add(r);
      cur.roles = [...s];
      saveProfile(cur);
      renderEligForm(); runEligibility();
    };
    rBox.appendChild(c);
  });

  const cities = Array.from(new Set(COMPANIES.flatMap((c) => c.cities || []))).sort();
  const cBox = $("#efCities");
  cBox.innerHTML = "";
  const selCities = new Set(p.cities || []);
  cities.forEach((city) => {
    const c = el("div", "chip" + (selCities.has(city) ? " active" : ""), city);
    c.onclick = () => {
      const cur = getProfile();
      const s = new Set(cur.cities || []);
      s.has(city) ? s.delete(city) : s.add(city);
      cur.cities = [...s];
      saveProfile(cur);
      renderEligForm(); runEligibility();
    };
    cBox.appendChild(c);
  });

  $("#efGrad").onchange = (e) => { const cur = getProfile(); cur.grad = e.target.value; saveProfile(cur); runEligibility(); };
  $("#efDegree").onchange = (e) => { const cur = getProfile(); cur.degree = e.target.value; saveProfile(cur); runEligibility(); };
}

function runEligibility() {
  const p = getProfile();
  const box = $("#eligResult");
  if (!p.grad) {
    box.innerHTML = '<p class="elig-hint">👆 先填毕业年月，就能看到你能投哪些。</p>';
    return;
  }
  const wantRoles = new Set(p.roles || []);

  const results = COMPANIES.map((c) => {
    const reasons = [];
    let ok = true;
    // 毕业窗口
    if (c.gradFrom && c.gradTo) {
      if (p.grad < c.gradFrom || p.grad > c.gradTo) {
        ok = false;
        reasons.push(`毕业时间不在窗口（${fmtGrad(c.gradFrom)}~${fmtGrad(c.gradTo)}）`);
      }
    }
    // 方向匹配（选了才筛）
    let matchedRoles = c.roles;
    if (wantRoles.size) {
      matchedRoles = c.roles.filter((r) => wantRoles.has(r));
      if (!matchedRoles.length) { ok = false; reasons.push("无你意向的方向"); }
    }
    // 城市匹配（选了才筛）
    if ((p.cities || []).length) {
      const hit = (c.cities || []).some((ct) => p.cities.includes(ct));
      if (!hit) { ok = false; reasons.push("无你意向的城市"); }
    }
    // 匹配到的具体岗位
    const matchedPos = (c.positions || []).filter((pos) =>
      matchedRoles.some((r) => roleMatchesPositions(r, [pos]))
    );
    return { c, ok, reasons, matchedRoles, matchedPos };
  });

  const canApply = results.filter((r) => r.ok);
  const cannot = results.filter((r) => !r.ok);

  let html = `<div class="elig-summary">✅ 你可投 <b>${canApply.length}</b> 家 · ❌ 暂不符合 <b>${cannot.length}</b> 家</div>`;

  if (canApply.length) {
    html += '<h3 class="elig-h">✅ 现在可以投</h3><div class="elig-grid">';
    canApply.forEach(({ c, matchedPos, matchedRoles }) => {
      const pos = (matchedPos.length ? matchedPos : c.positions || matchedRoles).slice(0, 6);
      html += `
        <div class="elig-card ok">
          <div class="ec-head"><b>${c.name}</b><span class="cc-tier">${c.tier}</span></div>
          <div class="ec-pos">${pos.map((x) => `<span class="pos-tag">${x}</span>`).join("")}</div>
          <div class="ec-meta">📍 ${(c.cities || []).join(" / ")}${c.gradInfo ? ' · 毕业窗口为推断' : ''}</div>
          <a class="link-btn primary" href="${c.official}" target="_blank" rel="noopener">🔗 去投递</a>
        </div>`;
    });
    html += "</div>";
  }

  if (cannot.length) {
    html += '<h3 class="elig-h dim">❌ 暂不符合</h3><div class="elig-grid">';
    cannot.forEach(({ c, reasons }) => {
      html += `
        <div class="elig-card no">
          <div class="ec-head"><b>${c.name}</b><span class="cc-tier">${c.tier}</span></div>
          <div class="ec-reason">${reasons.join("；")}</div>
        </div>`;
    });
    html += "</div>";
  }

  html += '<p class="elig-foot">⚠️ 判断基于调研到的毕业窗口/方向/城市规则，仅供快速缩小范围；标「推断」的毕业窗口未必精确，正式投递请以各公司官网为准。</p>';
  box.innerHTML = html;
}

// —— 初始化 ——
renderHeaderStats();
renderTimeline();
renderOverviewCards();
renderFilters();
renderCompanies();
renderEligForm();
runEligibility();
renderPrepNav();
renderPrepContent();
renderChecklist();
