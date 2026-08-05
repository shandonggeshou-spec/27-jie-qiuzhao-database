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
    card.innerHTML = `
      <div class="cc-head">
        <span class="cc-name">${c.name}</span>
        <span class="cc-tier">${c.tier}</span>
      </div>
      <div class="cc-roles">${c.roles.map((r) => `<span class="role-tag">${r}</span>`).join("")}</div>
      <div class="cc-meta">🗓 <b>开放：</b>${c.open}</div>
      <div class="cc-meta">📮 <b>渠道：</b>${c.channel}</div>
      <div class="cc-note">${c.note}</div>
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

// —— 初始化 ——
renderHeaderStats();
renderTimeline();
renderOverviewCards();
renderFilters();
renderCompanies();
renderPrepNav();
renderPrepContent();
renderChecklist();
