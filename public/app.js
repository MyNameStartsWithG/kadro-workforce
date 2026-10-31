/* Kadro — Workforce Management: user interface */

const main = document.getElementById("main");
const nav = document.getElementById("nav");

const S = { status: null, warnings: [], targets: [], tree: null, open: new Set(), selected: null };

/* ---------------- helpers ---------------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };

async function api(path, options = {}) {
  const r = await fetch(`/api${path}`, {
    ...options,
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(data.error || `Server error (${r.status})`);
  return data;
}

let toastCounter = 0;
function toast(title, message = "", kind = "") {
  const box = document.getElementById("toasts");
  const id = ++toastCounter;
  const b = el(`<div class="toast ${kind}" data-t="${id}"><div><b>${esc(title)}</b>${message ? esc(message) : ""}</div></div>`);
  box.appendChild(b);
  setTimeout(() => b.remove(), kind === "error" ? 8000 : 4200);
}
const toastError = (e) => toast("Could not complete the action", e.message || String(e), "error");

function confirmBox(title, message, yesText = "Yes, continue") {
  return new Promise((resolve) => {
    const p = el(`<div class="modal"><div class="modal-box">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body">${esc(message)}</div>
      <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(yesText)}</button></div>
    </div></div>`);
    const close = (v) => { p.remove(); resolve(v); };
    p.querySelector("[data-no]").onclick = () => close(false);
    p.querySelector("[data-yes]").onclick = () => close(true);
    p.onclick = (ev) => { if (ev.target === p) close(false); };
    document.getElementById("modalHost").appendChild(p);
    p.querySelector("[data-yes]").focus();
  });
}

/** "1 period" / "2 periods". */
const plural = (n, one, many = `${one}s`) => `${n} ${Number(String(n).replace(/,/g, "")) === 1 ? one : many}`;

const sizeText = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

function daysUntil(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(date + "T00:00:00") - today) / 86400000);
}

/* ---------------- navigation ---------------- */

const MENU = [
  { group: "General" },
  { id: "dashboard", name: "Dashboard", ico: "◆" },
  { id: "forecast", name: "Forecast", ico: "◔" },
  { id: "tree", name: "Folder Tree", ico: "▤" },
  { id: "upload", name: "Upload Documents", ico: "↑" },
  { group: "Records" },
  { id: "t/employees", name: "Employees", ico: "◉", counter: "employees" },
  { id: "t/contracts", name: "Employment Periods", ico: "⇥", counter: "contracts" },
  { id: "t/crews", name: "Crews", ico: "◎", counter: "crews" },
  { id: "t/equipment", name: "Equipment", ico: "▣", counter: "equipment" },
  { id: "t/projects", name: "Projects", ico: "◈", counter: "projects" },
  { id: "t/houses", name: "Houses", ico: "⌂", counter: "houses" },
  { id: "t/vehicles", name: "Vehicles", ico: "▤", counter: "vehicles" },
  { id: "t/clients", name: "Clients", ico: "◇", counter: "clients" },
  { group: "Timesheets, Pay and Cash" },
  { id: "timesheet", name: "Timesheets", ico: "▥" },
  { id: "t/advances", name: "Advances", ico: "↧", counter: "advances" },
  { id: "payments", name: "Payments", ico: "✓", counter: "paymentsDue", alarm: true },
  { id: "cash", name: "Cash", ico: "€" },
  { id: "statistics", name: "Employee Statistics", ico: "▲" },
  { group: "Registers" },
  { id: "t/documents", name: "Document Register", ico: "▦", counter: "documents" },
  { id: "settings", name: "Settings", ico: "⚙" },
];

function renderNav() {
  let here = (location.hash || "#dashboard").slice(1);
  if (here.startsWith("d/")) here = `t/${here.split("/")[1]}`;
  if (here.startsWith("timesheet/")) here = "timesheet";
  if (here.startsWith("cash/") || here === "t/cash") here = "cash";
  if (here.startsWith("payments/")) here = "payments";
  if (here.startsWith("employee/")) here = "t/employees";
  nav.innerHTML = "";
  for (const m of MENU) {
    if (m.group) { nav.appendChild(el(`<div class="nav-title">${esc(m.group)}</div>`)); continue; }
    const n = m.counter ? S.status?.counts?.[m.counter] : null;
    const alarm = m.id === "dashboard" && S.warnings.length;
    const count = alarm ? `<span class="count alarm">${S.warnings.length}</span>`
      : (n ? `<span class="count ${m.alarm ? "alarm" : ""}" ${m.alarm ? `title="Due and not yet paid"` : ""}>${n}</span>` : "");
    const a = el(`<a class="nav-item ${here === m.id ? "active" : ""}" href="#${m.id}">
      <span class="ico">${m.ico}</span><span>${esc(m.name)}</span>${count}</a>`);
    nav.appendChild(a);
  }
}

function renderHeader() {
  const d = S.status;
  document.getElementById("brandSub").textContent = d ? `version ${d.version} · port ${d.port}` : "";
  document.getElementById("rootPath").textContent = d ? d.documentRoot : "";
  const n = document.getElementById("aiStatus");
  n.className = `status-dot ${d?.apiKeySet ? "open" : "closed"}`;
  n.querySelector("span").textContent = d?.apiKeySet
    ? `AI on · ${{ hybrid: "hybrid", aiOnly: "AI only", rulesOnly: "rules" }[d.aiMode]}`
    : "AI off";
}

/* ---------------- DASHBOARD ---------------- */

async function renderDashboard() {
  const d = S.status;
  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head">
    <div><h2>Dashboard</h2><p>System summary, upcoming deadlines and quick actions.</p></div>
    <div class="head-tools">
      <button class="btn" data-do="refresh">Refresh</button>
      <button class="btn primary" data-do="build">Build Folders on Disk</button>
    </div></div>`));

  if (!d.built) {
    main.appendChild(el(`<div class="card"><div class="card-body">
      <div style="display:flex;gap:13px;align-items:flex-start">
        <span style="color:var(--accent);font-size:20px;line-height:1">!</span>
        <div style="min-width:0"><div style="font-weight:600;margin-bottom:3px">The folder structure is not on disk yet</div>
        <div style="color:var(--text-2);font-size:13px">
          "Build Folders on Disk" creates every section under <code style="font-family:var(--f-mono);font-size:12px;overflow-wrap:anywhere">${esc(d.documentRoot)}</code>.
          Existing folders are left alone.</div></div>
      </div></div></div>`));
  }

  const s = d.counts;
  main.appendChild(el(`<div class="tiles">
    <a class="tile" href="#t/employees"><b>${s.employees}</b><span>Employees</span><span class="extra">15-folder personnel file</span></a>
    <a class="tile" href="#t/crews"><b>${s.crews}</b><span>Active crews</span><span class="extra">meals and equipment</span></a>
    <a class="tile" href="#t/equipment"><b>${s.equipment}</b><span>Equipment out</span><span class="extra">awaiting return</span></a>
    <a class="tile" href="#t/projects"><b>${s.projects}</b><span>Active projects</span><span class="extra">work in progress</span></a>
    <a class="tile" href="#t/houses"><b>${s.houses}</b><span>Houses</span><span class="extra">staff housing abroad</span></a>
    <a class="tile" href="#t/vehicles"><b>${s.vehicles}</b><span>Vehicles</span><span class="extra">inspection and insurance</span></a>
    <a class="tile" href="#t/clients"><b>${s.clients}</b><span>Clients</span><span class="extra">accounts and bids</span></a>
    <a class="tile" href="#t/documents"><b>${s.documents}</b><span>Filed documents</span><span class="extra">files taken into the system</span></a>
  </div>`));

  const warnCard = el(`<div class="card">
    <div class="card-head"><h3>Deadline Warnings</h3><div class="right">
      <span style="font-family:var(--f-mono);font-size:10px;color:var(--muted)">${plural(S.warnings.length, "record")}</span>
    </div></div><div id="warnBody"></div></div>`);
  main.appendChild(warnCard);

  const g = warnCard.querySelector("#warnBody");
  if (!S.warnings.length) {
    g.appendChild(el(`<div class="empty"><div class="big">No upcoming deadlines</div>
      <p>Work permits, residence permits, passports, vehicle inspections, insurance policies and employment period end dates are listed here as they approach.</p></div>`));
  } else {
    for (const w of S.warnings.slice(0, 40)) {
      const text = w.daysLeft < 0 ? `${plural(Math.abs(w.daysLeft), "day")} overdue` : w.daysLeft === 0 ? "today" : `${plural(w.daysLeft, "day")} left`;
      const row = el(`<a class="warn-row" href="${w.href || `#t/${w.table}`}">
        <span class="pill ${w.level}">${text}</span>
        <span class="who">${esc(w.who)}</span>
        <span class="what">${esc(w.field)}</span>
        <span class="when">${esc(w.date)}</span></a>`);
      g.appendChild(row);
    }
  }

  main.appendChild(el(`<div class="card">
    <div class="card-head"><h3>How It Works</h3></div>
    <div class="card-body" style="display:grid;gap:11px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
      ${[
        ["Add a record", "When you add an employee, vehicle, project or client, its folder is created on disk from the template."],
        ["Drop a document", "Drag a file onto Upload Documents. The system reads the file name and the PDF/image content and suggests a target folder."],
        ["Confirm", "Accept the suggestion or pick another target. The file is moved into the real folder and logged in the Document Register."],
        ["Export to Excel", "Every table downloads as .xlsx in one click; edit it in Excel and upload it back."],
      ].map(([b, a]) => `<div><div style="font-family:var(--f-disp);font-weight:600;font-size:15px;margin-bottom:3px">${b}</div>
        <div style="color:var(--text-2);font-size:13px;line-height:1.5">${a}</div></div>`).join("")}
    </div></div>`));

  main.querySelector('[data-do="refresh"]').onclick = async () => { await loadStatus(); route(); };
  main.querySelector('[data-do="build"]').onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api("/build", { method: "POST" });
      toast("Folders built", `${r.created.length} folders created, ${r.existing} already existed.`, "good");
      await loadStatus(); route();
    } catch (e) { toastError(e); ev.target.disabled = false; }
  };
}

/* ---------------- FOLDER TREE ---------------- */

async function renderTree() {
  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head">
    <div><h2>Folder Tree</h2><p>What is really on disk. The numbers show how many files each folder holds.</p></div>
    <div class="head-tools">
      <button class="btn" data-do="all">Expand all</button>
      <button class="btn" data-do="refresh">Refresh</button>
      <button class="btn primary" data-do="build">Build Folders</button>
    </div></div>`));

  const layout = el(`<div class="tree-layout">
    <div class="card"><div class="card-head"><h3>Folders</h3>
      <div class="right"><span id="fileTotal" style="font-family:var(--f-mono);font-size:10px;color:var(--muted)"></span></div></div>
      <div class="tree" id="treeRoot"></div></div>
    <div class="card"><div class="card-body" id="treeDetail"></div></div>
  </div>`);
  main.appendChild(layout);

  main.querySelector('[data-do="refresh"]').onclick = () => { S.tree = null; renderTree(); };
  main.querySelector('[data-do="build"]').onclick = async () => {
    try { const r = await api("/build", { method: "POST" });
      toast("Folders built", `${r.created.length} folders created.`, "good");
      S.tree = null; renderTree();
    } catch (e) { toastError(e); }
  };
  main.querySelector('[data-do="all"]').onclick = (ev) => {
    const expand = S.open.size < 6;
    S.open.clear();
    if (expand) (function walk(l) { for (const d of l) if (d.ch?.length) { S.open.add(d.path); walk(d.ch); } })(S.tree?.ch || []);
    ev.target.textContent = expand ? "Collapse all" : "Expand all";
    renderTreeBody();
  };

  if (!S.tree) {
    document.getElementById("treeRoot").innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    try { S.tree = await api("/tree"); } catch (e) { toastError(e); return; }
  }
  renderTreeBody();
}

function renderTreeBody() {
  const root = document.getElementById("treeRoot");
  if (!root) return;
  const a = S.tree;
  document.getElementById("fileTotal").textContent = a.notBuilt ? "" : `${plural(a.totalFiles, "file")}`;

  if (a.notBuilt || !a.ch.length) {
    root.innerHTML = `<div class="empty"><div class="big">No folders on disk</div>
      <p>Press "Build Folders" above to create every section in one go.</p></div>`;
    document.getElementById("treeDetail").innerHTML = "";
    return;
  }

  const list = (nodes) => {
    const ul = document.createElement("ul");
    for (const d of nodes) {
      const li = document.createElement("li");
      const open = S.open.has(d.path);
      const m = /^(\d{2}|KDR-\d{4}-\d{4}|PRJ-\d{4}-\d{4}|CLI-\d{4}-\d{4}|HSE-\d+)[ -]+(.*)$/.exec(d.name);
      const depth = d.path.split("/").length - 1;
      const row = el(`<button class="node l${depth} ${S.selected === d.path ? "sel" : ""}" data-path="${esc(d.path)}">
        <span class="caret ${d.ch.length ? (open ? "open" : "") : "leaf"}">▶</span>
        ${m ? `<span class="code">${esc(m[1])}</span><span class="name">${esc(m[2])}</span>` : `<span class="name">${esc(d.name)}</span>`}
        <span class="count ${d.totalFiles ? "full" : ""}">${d.totalFiles || ""}</span></button>`);
      li.appendChild(row);
      if (d.ch.length && open) li.appendChild(list(d.ch));
      ul.appendChild(li);
    }
    return ul;
  };

  root.innerHTML = "";
  root.appendChild(list(a.ch));

  root.onclick = (ev) => {
    const row = ev.target.closest(".node");
    if (!row) return;
    const path = row.dataset.path;
    const find = (l) => { for (const d of l) { if (d.path === path) return d; const r = find(d.ch || []); if (r) return r; } return null; };
    const node = find(a.ch);
    if (ev.target.closest(".caret") && node?.ch.length) {
      S.open.has(path) ? S.open.delete(path) : S.open.add(path);
    } else {
      if (S.selected === path && node?.ch.length) { S.open.has(path) ? S.open.delete(path) : S.open.add(path); }
      S.selected = path;
      if (node?.ch.length) S.open.add(path);
    }
    renderTreeBody();
    if (node) renderTreeDetail(node);
  };

  if (S.selected) {
    const find = (l) => { for (const d of l) { if (d.path === S.selected) return d; const r = find(d.ch || []); if (r) return r; } return null; };
    const d = find(a.ch);
    if (d) renderTreeDetail(d);
    else document.getElementById("treeDetail").innerHTML = `<div class="empty"><div class="big">The folder is gone</div><p>Pick another folder on the left.</p></div>`;
  } else {
    document.getElementById("treeDetail").innerHTML =
      `<div class="empty"><div class="big">Pick a folder</div><p>The folder's description, rules and files appear here.</p></div>`;
  }
}

function renderTreeDetail(d) {
  const target = document.getElementById("treeDetail");
  if (!target) return;
  const parts = d.path.split("/");
  target.innerHTML = "";
  target.appendChild(el(`<div style="font-family:var(--f-mono);font-size:11px;color:var(--muted);margin-bottom:9px">
    ${parts.map((p, i) => `${i ? '<span style="opacity:.5"> \\ </span>' : ""}${esc(p)}`).join("")}</div>`));
  target.appendChild(el(`<h3 style="font-family:var(--f-disp);font-size:26px;font-weight:700;margin:0;letter-spacing:-.01em">${esc(d.name)}</h3>`));
  if (d.description) target.appendChild(el(`<p style="margin:9px 0 0;color:var(--text-2);max-width:64ch;font-size:14.5px;line-height:1.55">${esc(d.description)}</p>`));
  if (d.note) target.appendChild(el(`<div style="margin-top:12px;padding:10px 13px;background:var(--accent-wash);border-left:2px solid var(--accent);border-radius:0 3px 3px 0;font-size:13px;color:var(--text-2);max-width:64ch">${esc(d.note)}</div>`));
  const deleted = d.path.split("/")[0] === DELETED;
  if (deleted) target.appendChild(el(`<div class="sugg-note" style="margin-top:12px;max-width:64ch">Deleted documents are kept here in their original folder structure.
    "Restore" puts the file back where it was. "Delete forever" removes it from disk for good; this cannot be undone.</div>`));

  const pathBar = el(`<div class="path-bar"><code>${esc(d.path)}</code>
    <button class="btn small" data-copy>Copy</button>
    <button class="btn small" data-open>Open folder</button></div>`);
  target.appendChild(pathBar);
  pathBar.querySelector("[data-copy]").onclick = (ev) => {
    navigator.clipboard.writeText(d.path).then(() => { ev.target.textContent = "Copied"; setTimeout(() => ev.target.textContent = "Copy", 1500); });
  };
  pathBar.querySelector("[data-open]").onclick = async () => {
    try { await api("/open-folder", { method: "POST", body: JSON.stringify({ path: d.path }) }); }
    catch (e) { toastError(e); }
  };

  target.appendChild(el(`<div style="display:flex;align-items:center;gap:11px;margin:22px 0 10px">
    <h4 style="font-family:var(--f-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0;font-weight:600">Files in this folder</h4>
    <div style="flex:1;height:1px;background:var(--line)"></div>
    <span style="font-family:var(--f-mono);font-size:10px;color:var(--accent);font-weight:600">${String(d.fileCount).padStart(2, "0")}</span></div>`));

  if (!d.files.length) {
    target.appendChild(el(`<div style="padding:14px 0;color:var(--muted);font-size:13.5px">This folder is empty.${d.ch.length ? ` It has ${plural(d.ch.length, "subfolder")}.` : ""}</div>`));
  } else {
    const box = el(`<div style="border:1px solid var(--line);border-radius:3px;overflow:hidden"></div>`);
    for (const f of d.files) {
      const ext = (f.name.split(".").pop() || "").slice(0, 4);
      const row = el(`<div class="file-row"><span class="ext">${esc(ext)}</span>
        <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="meta">${sizeText(f.size)} · ${new Date(f.date).toLocaleDateString("en-GB")}</span>
        ${deleted
          ? `<button class="btn small" data-restore>Restore</button><button class="btn small danger" data-purge>Delete forever</button>`
          : `<button class="btn small danger" data-delete title="Moves it to the _Deleted folder">Delete</button>`}</div>`);
      row.querySelector("[data-delete]")?.addEventListener("click", () => documentAction("delete", d, f.name));
      row.querySelector("[data-restore]")?.addEventListener("click", () => documentAction("restore", d, f.name));
      row.querySelector("[data-purge]")?.addEventListener("click", () => documentAction("purge", d, f.name));
      box.appendChild(row);
    }
    target.appendChild(box);
  }
}

const DELETED = "_Deleted";

/** Deleting a file in the folder tree (moving it to _Deleted), restoring it and deleting it for good. */
async function documentAction(action, d, name) {
  const text = {
    delete: ["Delete this document?", `"${name}" is moved to the _Deleted folder and the Document Register gets a "deleted" note. You can restore it from there if needed.`, "Delete"],
    restore: ["Restore this document?", `"${name}" goes back to its old place, the ${d.path.split("/").slice(1).join(" \\ ") || "document root"} folder.`, "Restore"],
    purge: ["Delete for good?", `"${name}" is removed from disk completely. This cannot be undone.`, "Delete forever"],
  }[action];
  if (!(await confirmBox(...text))) return;
  try {
    const r = await api(`/document/${action}`, { method: "POST", body: JSON.stringify({ folder: d.path, name }) });
    toast({ delete: "Document deleted", restore: "Document restored", purge: "Document deleted for good" }[action],
      action === "delete" ? "Moved to the _Deleted folder." : action === "restore" ? r.path : "", "good");
    S.tree = await api("/tree");
    await loadStatus(); renderNav();
    renderTreeBody();
  } catch (e) { toastError(e); }
}

/* ---------------- UPLOAD DOCUMENTS ---------------- */

async function renderUpload() {
  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head">
    <div><h2>Upload Documents</h2><p>Drop your files and the system suggests which folder each one belongs in. Nothing is moved until you confirm.</p></div>
  </div>`));

  const modeName = { hybrid: "Rules + AI", aiOnly: "AI only", rulesOnly: "Rules only" }[S.status.aiMode];
  const warning = !S.status.apiKeySet && S.status.aiMode !== "rulesOnly"
    ? `<div class="sugg-note" style="margin-bottom:12px">No API key is set, so the AI layer is off; only the file-name rules are applied.
       You can enter the key on the <a href="#settings">Settings</a> page.</div>` : "";
  if (warning) main.appendChild(el(warning));

  const drop = el(`<button class="drop" id="dropArea">
    <div class="icon">↓</div>
    <div class="big">Drag and drop files</div>
    <div class="desc">or click to pick them from your computer — up to 30 files at once</div>
    <div class="types">Mode: ${esc(modeName)} · PDFs and images are read by their content</div>
  </button>`);
  main.appendChild(drop);

  const input = el(`<input type="file" multiple hidden>`);
  main.appendChild(input);
  const resultArea = el(`<div id="resultArea"></div>`);
  main.appendChild(resultArea);

  drop.onclick = () => input.click();
  input.onchange = () => { if (input.files.length) sendFiles([...input.files]); input.value = ""; };
  for (const evName of ["dragenter", "dragover"]) drop.addEventListener(evName, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const evName of ["dragleave", "drop"]) drop.addEventListener(evName, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) sendFiles(f); });

  if (!S.targets.length) { try { S.targets = await api("/targets"); } catch { /* ignore */ } }
}

async function sendFiles(files) {
  const area = document.getElementById("resultArea");
  const wait = el(`<div class="card" style="margin-top:14px"><div class="card-body" style="display:flex;gap:11px;align-items:center">
    <span class="spinner"></span><span>Examining ${plural(files.length, "file")}… PDF contents are read, so this can take a few seconds.</span></div></div>`);
  area.prepend(wait);

  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  try {
    const { results } = await api("/upload", { method: "POST", body: fd });
    wait.remove();
    if (!S.targets.length) S.targets = await api("/targets");
    for (const s of results.reverse()) area.prepend(suggestionCard(s));
  } catch (e) { wait.remove(); toastError(e); }
}

function targetOptions(selected) {
  const groups = new Map();
  for (const h of S.targets) {
    const top = h.path.split("/")[0];
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(h);
  }
  let out = `<option value="">— pick a folder —</option>`;
  for (const [top, list] of groups) {
    out += `<optgroup label="${esc(top)}">`;
    for (const h of list) {
      const label = h.path.split("/").slice(1).join(" / ") || h.path;
      out += `<option value="${esc(h.path)}" ${h.path === selected ? "selected" : ""}>${esc(label)}</option>`;
    }
    out += `</optgroup>`;
  }
  return out;
}

function suggestionCard(s) {
  if (s.error) {
    return el(`<div class="sugg" style="margin-top:14px"><div class="sugg-head">
      <span class="sname">${esc(s.fileName)}</span><span class="tag none">error</span></div>
      <div class="sugg-body"><div class="sugg-note">${esc(s.error)}</div></div></div>`);
  }

  const pct = Math.round((s.confidence || 0) * 100);
  const cls = pct >= 70 ? "" : pct >= 45 ? "low" : "very-low";
  const tag = s.method === "claude" ? `<span class="tag ai">AI</span>`
    : s.method === "rules" ? `<span class="tag rules">rules</span>`
    : `<span class="tag none">not found</span>`;

  const k = el(`<div class="sugg" style="margin-top:14px" data-ticket="${esc(s.ticket)}">
    <div class="sugg-head">
      <span class="sname">${esc(s.fileName)}</span>
      <span style="font-family:var(--f-mono);font-size:11px;color:var(--muted)">${sizeText(s.size || 0)}</span>
      ${tag}
      <span class="conf"><span class="bar"><i class="${cls}" style="width:${pct}%"></i></span><span class="pct">${pct}%</span></span>
    </div>
    <div class="sugg-body">
      ${s.reason ? `<div class="sugg-reason">${esc(s.reason)}</div>` : ""}
      ${(s.notes || []).map((n) => `<div class="sugg-note">${esc(n)}</div>`).join("")}
      <div class="pair">
        <div class="field"><label>Target folder</label>
          <select data-target>${targetOptions(s.targetPath)}</select></div>
        <div class="field"><label>File name to save as</label>
          <input class="mono" data-name value="${esc(s.suggestedName || s.fileName)}"></div>
      </div>
      <div class="sugg-tools">
        <button class="btn primary" data-place>File it</button>
        <button class="btn danger" data-cancel>Cancel</button>
        ${s.ai?.read && s.ai.read !== "none" ? `<span style="font-family:var(--f-mono);font-size:10px;color:var(--muted);align-self:center">
          document content was read (${esc({ pdf: "PDF", image: "image", text: "text" }[s.ai.read])})</span>` : ""}
      </div>
    </div></div>`);

  const select = k.querySelector("[data-target]");
  const nameInput = k.querySelector("[data-name]");

  select.onchange = async () => {
    try {
      const r = await api("/suggest-name", { method: "POST", body: JSON.stringify({ fileName: s.fileName, targetPath: select.value }) });
      nameInput.value = r.name;
    } catch { /* not important */ }
  };

  k.querySelector("[data-place]").onclick = async (ev) => {
    if (!select.value) return toast("No target picked", "Pick a folder first.", "error");
    ev.target.disabled = true;
    try {
      const manual = select.value !== s.targetPath;
      const r = await api("/place", {
        method: "POST",
        body: JSON.stringify({
          ticket: s.ticket, targetPath: select.value, fileName: nameInput.value,
          docType: s.docType, related: s.related,
          method: manual ? "manual" : s.method, confidence: manual ? null : s.confidence,
        }),
      });
      k.replaceWith(el(`<div class="sugg" style="margin-top:14px"><div class="sugg-head">
        <span class="sname">${esc(r.placed.name)}</span><span class="tag rules" style="background:var(--good);color:#fff">filed</span></div>
        <div class="sugg-body"><div class="sugg-reason" style="font-family:var(--f-mono);font-size:12px">${esc(r.placed.path)}</div></div></div>`));
      toast("Document filed", r.placed.path, "good");
      S.tree = null;
      await loadStatus(); renderNav();
    } catch (e) { toastError(e); ev.target.disabled = false; }
  };

  k.querySelector("[data-cancel]").onclick = async () => {
    try { await api("/cancel", { method: "POST", body: JSON.stringify({ ticket: s.ticket }) }); } catch { /* ignore */ }
    k.remove();
  };
  return k;
}

/* ---------------- TABLES ---------------- */

const tableState = {};

async function renderTable(tableName) {
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let data;
  try { data = await api(`/table/${tableName}`); } catch (e) { toastError(e); return; }
  const { def, rows } = data;
  tableState[tableName] = { def, rows, filter: tableState[tableName]?.filter || "" };

  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head">
    <div><h2>${esc(def.name)}</h2><p>${esc(def.description)}</p></div>
    <div class="head-tools">
      <button class="btn" data-do="excel-out">Export to Excel</button>
      ${def.readOnly ? "" : `<button class="btn" data-do="excel-in">Import from Excel</button>
      <button class="btn primary" data-do="add">+ New ${esc(def.singular)}</button>`}
    </div></div>`));

  const tools = el(`<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
    <div class="search"><input placeholder="Search the table…" value="${esc(tableState[tableName].filter)}"></div>
    <span id="rowCount" style="font-family:var(--f-mono);font-size:11px;color:var(--muted)"></span>
    ${def.readOnly ? "" : `<span style="font-family:var(--f-mono);font-size:10.5px;color:var(--muted);margin-left:auto">
      Edit a cell and click elsewhere — the record is saved at once.</span>`}
  </div>`);
  main.appendChild(tools);

  const wrap = el(`<div class="table-wrap"><table class="grid"><thead></thead><tbody></tbody></table></div>`);
  main.appendChild(wrap);

  const excelInput = el(`<input type="file" accept=".xlsx" hidden>`);
  main.appendChild(excelInput);

  main.querySelector('[data-do="excel-out"]').onclick = () => { location.href = `/api/table/${tableName}/excel`; };
  if (!def.readOnly) {
    main.querySelector('[data-do="excel-in"]').onclick = () => excelInput.click();
    main.querySelector('[data-do="add"]').onclick = () => {
      tableState[tableName].rows.unshift({ _id: null, _new: true });
      renderGrid(tableName);
      wrap.querySelector("tbody tr input:not([disabled])")?.focus();
    };
    excelInput.onchange = async () => {
      if (!excelInput.files[0]) return;
      const fd = new FormData(); fd.append("file", excelInput.files[0]);
      try {
        const r = await api(`/table/${tableName}/excel`, { method: "POST", body: fd });
        toast("Excel imported",
          `${r.added} new, ${r.updated} updated${r.skipped.length ? `, ${plural(r.skipped.length, "row")} skipped` : ""}.`, "good");
        if (r.skipped.length) console.warn("Skipped rows:", r.skipped);
        await loadStatus(); renderNav(); renderTable(tableName);
      } catch (e) { toastError(e); }
      excelInput.value = "";
    };
  }

  tools.querySelector("input").oninput = (ev) => { tableState[tableName].filter = ev.target.value; renderGrid(tableName); };
  renderGrid(tableName);
}

function renderGrid(tableName) {
  const { def, rows, filter } = tableState[tableName];
  const table = main.querySelector("table.grid");
  const head = table.querySelector("thead");
  const body = table.querySelector("tbody");

  head.innerHTML = `<tr>${def.detail ? `<th class="detail-col"></th>` : ""}${def.columns.map((c) => `<th style="min-width:${c.width}px">${esc(c.label)}</th>`).join("")}${def.readOnly ? "" : `<th class="del-col"></th>`}</tr>`;

  const q = filter.trim().toLocaleLowerCase("tr");
  const visible = q
    ? rows.filter((s) => s._new || def.columns.some((c) => String(s[c.key] || "").toLocaleLowerCase("tr").includes(q)))
    : rows;
  main.querySelector("#rowCount").textContent = `${visible.length} / ${plural(rows.length, "record")}`;

  body.innerHTML = "";
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="${def.columns.length + 2}"><div class="empty">
      <div class="big">${q ? "No matching records" : "No records yet"}</div>
      <p>${q ? "Change the search and try again." : def.readOnly ? "This register fills itself as documents are uploaded." : `Add the first record with "+ New ${esc(def.singular)}" at the top right.`}</p>
    </div></td></tr>`;
    return;
  }

  for (const row of visible) {
    const tr = document.createElement("tr");
    if (row._new) tr.className = "new";
    if (row.source && row.source !== "Manual") tr.classList.add("auto");
    tr.dataset.id = row._id || "";

    if (def.detail) {
      const td = document.createElement("td");
      td.className = "detail-cell";
      td.innerHTML = row._id ? `<a href="#d/${tableName}/${row._id}" title="Detail page">↗</a>` : "";
      tr.appendChild(td);
    }

    for (const c of def.columns) {
      const td = document.createElement("td");
      const value = row[c.key] ?? "";
      if (c.type === "readonly") {
        td.className = `ro ${c.key === "code" ? "code" : ""} ${c.computed ? "calc" : ""}`;
        if (c.badge && value) td.innerHTML = badgeHtml(value, row);
        else td.textContent = value || (row._new && c.key === "code" ? "automatic" : "—");
      } else if (c.type === "select") {
        td.innerHTML = `<select data-k="${c.key}"><option value=""></option>${c.options.map((o) =>
          `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else if (c.type === "link") {
        td.innerHTML = `<select data-k="${c.key}">${linkOptions(c.source, value)}</select>`;
      } else {
        const type = c.type === "date" ? "date" : (c.type === "number" || c.type === "money") ? "number" : "text";
        td.innerHTML = `<input type="${type}" data-k="${c.key}" value="${esc(value)}" ${c.type === "money" ? 'step="0.01"' : ""}>`;
        if (c.warnDays) {
          const left = daysUntil(value);
          if (left !== null && left <= 0) td.classList.add("danger");
          else if (left !== null && left <= c.warnDays) td.classList.add("attn");
        }
      }
      tr.appendChild(td);
    }

    if (!def.readOnly) {
      const td = document.createElement("td");
      td.innerHTML = `<button class="row-del" title="Delete row">×</button>`;
      td.querySelector("button").onclick = () => deleteRow(tableName, row, tr);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  if (def.readOnly || body.dataset.bound) return;

  // Listeners are bound to the tbody ONCE. If renderGrid bound them on every call,
  // saving would fire several times for the same row.
  body.dataset.bound = "1";
  body.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (tr) tr.classList.add("dirty");
  });
  body.addEventListener("focusout", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr || !tr.classList.contains("dirty")) return;
    // Don't save while focus is still in the same row.
    setTimeout(() => { if (!tr.contains(document.activeElement)) saveRow(tableName, tr); }, 0);
  });
}

/** A status column (e.g. cash: Automatic / Corrected by hand) is drawn as a coloured label. */
function badgeHtml(value, row) {
  const revert = value === "Corrected by hand";
  const hint = revert ? `The system's figure: ${row.systemAmount || "—"}. Click to go back to the system's figure.` : "";
  const cls = { "Automatic": "auto", "Corrected by hand": "edited revert", "Entered by hand": "manual" }[value] || "";
  return `<span class="spill ${cls}"
    ${revert ? `data-revert="${esc(row._id)}" title="${esc(hint)}"` : ""}>${esc(value)}</span>`;
}

/** Refreshes the read-only cells of a saved row in place (without losing focus). */
function refreshRow(tableName, tr, row) {
  const { def } = tableState[tableName];
  const shift = def.detail ? 1 : 0;
  if (shift && row._id) tr.children[0].innerHTML = `<a href="#d/${tableName}/${row._id}" title="Detail page">↗</a>`;
  def.columns.forEach((c, i) => {
    const td = tr.children[i + shift];
    if (!td) return;
    if (c.type === "readonly") {
      if (c.badge && row[c.key]) td.innerHTML = badgeHtml(row[c.key], row); else td.textContent = row[c.key] || "—";
    }
    if (c.warnDays) {
      const left = daysUntil(row[c.key]);
      td.classList.toggle("danger", left !== null && left <= 0);
      td.classList.toggle("attn", left !== null && left > 0 && left <= c.warnDays);
    }
  });
}

async function saveRow(tableName, tr) {
  const { def, rows } = tableState[tableName];
  const id = tr.dataset.id;
  const row = id ? rows.find((s) => s._id === id) : rows.find((s) => s._new);
  if (!row) return;

  const fields = {};
  for (const f of tr.querySelectorAll("[data-k]")) fields[f.dataset.k] = f.value;

  const missing = def.columns.find((c) => c.required && !String(fields[c.key] || "").trim());
  if (missing) {
    if (row._new && Object.values(fields).every((v) => !String(v).trim())) return; // empty new row: leave it quietly
    tr.classList.remove("dirty");
    return toast("Missing field", `"${missing.label}" must be filled in before saving.`, "error");
  }

  try {
    const y = row._new
      ? await api(`/table/${tableName}`, { method: "POST", body: JSON.stringify(fields) })
      : await api(`/table/${tableName}/${id}`, { method: "PUT", body: JSON.stringify(fields) });

    Object.assign(row, y.row);
    delete row._new;
    tr.classList.remove("dirty", "new");
    tr.dataset.id = y.row._id;
    // The cells are refreshed in place instead of redrawing the table; otherwise
    // the user loses focus while moving to the next row.
    refreshRow(tableName, tr, y.row);

    if (y.warning) {
      toast("Saved, but note", y.warning, "error");
    } else if (y.folderReport?.created?.length) {
      toast("Record added", `Folder ${y.folderPath} was created with ${plural(y.folderReport.created.length, "subfolder")}.`, "good");
      S.tree = null;
    } else if (y.renamed) {
      toast("Folder renamed", `${y.renamed.from} → ${y.renamed.to}`, "good");
      S.tree = null;
    } else {
      toast("Saved", "", "good");
    }
    S.targets = [];
    await loadStatus(); renderNav();
    tableState[tableName].onSaved?.();
  } catch (e) {
    toastError(e);
    tr.classList.add("dirty");
  }
}

async function deleteRow(tableName, row, tr) {
  const { def, rows } = tableState[tableName];
  if (row._new) {
    rows.splice(rows.indexOf(row), 1);
    return renderGrid(tableName);
  }
  const label = row.name || row.plate || row.code || row.description || row.item || "this record";
  const message = def.folderType
    ? `"${label}" will be removed from the table. Its folder on disk and the documents in it are NOT deleted; they stay where they are.`
    : row.source && row.source !== "Manual"
      ? `"${label}" is a row the system wrote. If you delete it the system won't write it again (it can be brought back from the Cash page).`
      : `"${label}" will be deleted.`;
  const ok = await confirmBox("Delete this record?", message, "Delete");
  if (!ok) return;
  try {
    const y = await api(`/table/${tableName}/${row._id}`, { method: "DELETE" });
    rows.splice(rows.indexOf(row), 1);
    tr.remove();
    toast("Record deleted", y.warning || "", "good");
    S.targets = [];
    await loadStatus(); renderNav(); renderGrid(tableName);
    tableState[tableName].onSaved?.();
  } catch (e) { toastError(e); }
}

/* ---------------- links ---------------- */

/** Option sources for the link columns (crew, house, project, employee, client). */
const SOURCES = ["employees", "clients", "projects", "crews", "houses"];

async function loadSources(except) {
  await Promise.all(SOURCES.filter((k) => k !== except).map(async (k) => {
    try { const v = await api(`/table/${k}`); tableState[k] = { ...v, filter: tableState[k]?.filter || "" }; }
    catch { /* ignore */ }
  }));
}

const records = (name) => (tableState[name]?.rows || []).filter((r) => !r._new);
const recordLabel = (r) => (r.code ? `${r.code} — ${r.name}` : r.name);

function linkOptions(sourceName, value) {
  let out = `<option value=""></option>`;
  let found = false;
  for (const r of records(sourceName)) {
    const v = r.code || r.name;
    if (v === value) found = true;
    out += `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(recordLabel(r))}</option>`;
  }
  if (value && !found) out += `<option value="${esc(value)}" selected>${esc(value)}</option>`;
  return out;
}

/* ---------------- DETAIL PAGES ---------------- */

const numText = (n) => Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const totalText = (t) => {
  const p = Object.entries(t || {}).filter(([, v]) => v);
  return p.length ? p.map(([cur, v]) => `${numText(v)} ${cur}`).join(" · ") : "—";
};
/** The total in the base currency (at the rates in Settings, or the period's rates). */
function baseAmount(total, rates = S.status?.rates) {
  const base = rates?.base || "EUR";
  const o = { ...(rates?.rate || {}), [base]: 1 };
  let t = 0;
  const missing = [];
  for (const [cur, v] of Object.entries(total || {})) { if (!v) continue; if (o[cur]) t += v / o[cur]; else missing.push(cur); }
  return { cur: base, t: Math.round(t * 100) / 100, missing };
}
/** "≈ 1,234 EUR" when there are several currencies; empty when there is only the base currency. */
function baseEquivalent(total, rates = S.status?.rates) {
  const filled = Object.entries(total || {}).filter(([, v]) => v);
  const base = rates?.base || "EUR";
  if (!filled.length || (filled.length === 1 && filled[0][0] === base)) return "";
  const a = baseAmount(total, rates);
  return `≈ ${numText(a.t)} ${a.cur}${a.missing.length ? ` (no rate for ${a.missing.join(", ")})` : ""}`;
}
/** A base-currency row for summary tables: the ≈ value of every column. */
function baseRowHtml(columns, rates = S.status?.rates) {
  const base = rates?.base || "EUR";
  const curs = new Set(columns.flatMap((t) => Object.entries(t || {}).filter(([, v]) => v).map(([k]) => k)));
  if (!curs.size || (curs.size === 1 && curs.has(base))) return "";
  return `<tr class="base-row" title="${base} value at the rates in Settings (for information)"><td class="cur">≈ ${base}</td>${columns.map((t) => {
    const a = baseAmount(t, rates);
    return `<td>${numText(a.t)}${a.missing.length ? `<span class="muted"> + ${a.missing.join(", ")}</span>` : ""}</td>`;
  }).join("")}</tr>`;
}
const ratesEqual = (a, b) => (a?.base || "EUR") === (b?.base || "EUR") &&
  ["EUR", "TRY", "RSD"].every((cur) => (a?.rate?.[cur] ?? null) === (b?.rate?.[cur] ?? null));
const ratesText = (rates) => (rates ? Object.entries(rates.rate || {}).map(([cur, v]) => `1 ${rates.base} = ${numText(v)} ${cur}`).join(" · ") || "no rates entered" : "no rates");

const payText = (p) => p.payType && p.pay
  ? `${p.payType} · ${numText(p.pay)} ${p.currency || ""}${p.payType === "Hourly" ? "/hour" : "/month"}` : "no pay entered";
const todayText = () => new Date().toISOString().slice(0, 10);

function fieldHtml(c, value) {
  if (c.type === "readonly") return `<div class="ro-value ${c.key === "code" ? "code" : ""}">${esc(value || "—")}</div>`;
  if (c.type === "select") {
    return `<select data-k="${c.key}"><option value=""></option>${c.options.map((o) =>
      `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  }
  if (c.type === "link") return `<select data-k="${c.key}">${linkOptions(c.source, value)}</select>`;
  const type = c.type === "date" ? "date" : (c.type === "number" || c.type === "money") ? "number" : "text";
  return `<input type="${type}" data-k="${c.key}" value="${esc(value)}" ${c.type === "money" ? 'step="0.01"' : ""}>`;
}

function card(title, right = "") {
  return el(`<div class="card"><div class="card-head"><h3>${esc(title)}</h3>${right ? `<div class="right">${right}</div>` : ""}</div>
    <div class="card-body"></div></div>`);
}

function metrics(list) {
  return `<div class="metrics">${list.map(([b, a, extra]) =>
    `<div class="metric"><b>${esc(b)}</b><span>${esc(a)}</span>${extra ? `<small>${esc(extra)}</small>` : ""}</div>`).join("")}</div>`;
}

function personRow(p, { remove, extra } = {}) {
  return `<div class="list-row">
    <a class="code" href="#d/employees/${p._id}">${esc(p.code)}</a>
    <span class="name">${esc(p.name)}</span>
    <span class="meta">${esc([extra, p.role, payText(p)].filter(Boolean).join(" · "))}</span>
    ${remove ? `<button class="btn small danger" data-remove="${p._id}">${esc(remove)}</button>` : ""}</div>`;
}

function equipmentRow(z) {
  return `<div class="list-row">
    <span class="chip ${z.ownerType === "Crew" ? "crew" : ""}">${z.ownerType === "Crew" ? "crew" : "person"}</span>
    <span class="name">${esc(z.item)}${Number(z.quantity) > 1 ? ` × ${esc(z.quantity)}` : ""}</span>
    <span class="meta">${esc([z.category, z.serialNo, z.ownerName, z.status].filter(Boolean).join(" · "))}</span></div>`;
}

const emptyRow = (text) => `<div class="list-empty">${esc(text)}</div>`;

/** Changes an employee's crew / house field (assigning and removing). */
async function assignEmployee(id, fields, message) {
  try {
    const y = await api(`/table/employees/${id}`, { method: "PUT", body: JSON.stringify(fields) });
    if (y.warning) toast(message, y.warning, "error"); else toast(message, "", "good");
    await loadStatus(); await route();
  } catch (e) { toastError(e); }
}

/** A select box + Add button; hands back the chosen record. */
function addRow(options, button, blank, handle) {
  const s = el(`<div class="add-row">
    <select>${options.length ? `<option value="">${esc(blank)}</option>` : `<option value="">Nothing to add</option>`}
      ${options.map(([v, e]) => `<option value="${esc(v)}">${esc(e)}</option>`).join("")}</select>
    <button class="btn small primary" ${options.length ? "" : "disabled"}>${esc(button)}</button></div>`);
  s.querySelector("button").onclick = () => { const v = s.querySelector("select").value; if (v) handle(v); };
  return s;
}

async function renderDetail(tableName, id) {
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  await loadSources();
  let v;
  try { v = await api(`/detail/${tableName}/${id}`); }
  catch (e) {
    main.innerHTML = `<div class="empty"><div class="big">Record not found</div><p>${esc(e.message)}</p></div>`;
    return;
  }
  const { def, row } = v;

  main.innerHTML = "";
  const head = el(`<div class="page-head"><div>
      <a class="back" href="#t/${tableName}">← ${esc(def.name)}</a>
      <h2>${row.code ? `<span class="title-code">${esc(row.code)}</span>` : ""}${esc(row.name || "")}</h2>
      <p>${esc(def.description)}</p></div>
    <div class="head-tools">${tableName === "employees" && row.code ? `<a class="btn" href="#employee/${encodeURIComponent(row.code)}"
        title="The page this person would see: timesheet, earnings, reasons for deductions and payments">Employee's view</a>` : ""}
      ${v.folderPath ? `<button class="btn" data-do="folder">Open folder</button>` : ""}</div></div>`);
  main.appendChild(head);
  head.querySelector('[data-do="folder"]')?.addEventListener("click", async () => {
    try { await api("/open-folder", { method: "POST", body: JSON.stringify({ path: v.folderPath }) }); } catch (e) { toastError(e); }
  });

  const layout = el(`<div class="detail-layout"><div class="detail-left"></div><div class="detail-right"></div></div>`);
  main.appendChild(layout);
  layout.querySelector(".detail-left").appendChild(infoCard(tableName, def, row));
  const right = layout.querySelector(".detail-right");
  ({ employees: employeeDetail, crews: crewDetail, projects: projectDetail, houses: houseDetail })[tableName]?.(right, v);
}

function infoCard(tableName, def, row) {
  const k = card("Details");
  const g = k.querySelector(".card-body");
  g.innerHTML = `<div class="form-grid">${def.columns.map((c) =>
    `<label class="field"><span>${esc(c.label)}</span>${fieldHtml(c, row[c.key] ?? "")}</label>`).join("")}</div>
    <div class="form-foot"><button class="btn primary" data-save>Save changes</button></div>`;
  g.querySelector("[data-save]").onclick = async (ev) => {
    const fields = {};
    for (const a of g.querySelectorAll("[data-k]")) fields[a.dataset.k] = a.value;
    ev.target.disabled = true;
    try {
      const y = await api(`/table/${tableName}/${row._id}`, { method: "PUT", body: JSON.stringify(fields) });
      if (y.warning) toast("Saved, but note", y.warning, "error");
      else if (y.renamed) toast("Saved", `Folder renamed: ${y.renamed.to}`, "good");
      else toast("Saved", "", "good");
      S.tree = null; S.targets = [];
      await loadStatus(); await route();
    } catch (e) { toastError(e); ev.target.disabled = false; }
  };
  return k;
}

/**
 * The person's employment periods (contracts): project, start and an end (leaving) date that can be entered in advance.
 * For a person with employment periods, the status, the days they appear in timesheets and their forecast come from these dates.
 */
function contractsCard(v) {
  const person = v.row;
  const list = v.contracts || [];
  const work = list.filter((r) => r.type !== "Leave");
  const k = card("Employment Periods", `<a class="btn small" href="#t/contracts">All people</a>`);
  const g = k.querySelector(".card-body");

  const ongoing = work.find((r) => r.statusLabel === "Ongoing");
  const next = [...work].reverse().find((r) => r.statusLabel === "Not started");
  let top;
  if (!work.length) {
    top = `<div class="hint-box">No employment period entered; the status (${esc(person.status || "Active")}) is set by hand.
      Once a period is entered the status follows today's date by itself, and the person appears in timesheets and the forecast only between these dates.
      The leaving date can be entered in advance.</div>`;
  } else {
    const current = ongoing || next;
    const leaving = current?.end || "";
    const f = leaving ? daysUntil(leaving) : null;
    top = metrics([
      [person.status || "—", "Status today", "from employment periods"],
      [ongoing ? ongoing.projectName || "no project entered" : next ? `starts ${shortDate(next.start)}` : "Not working", ongoing ? "Current project" : "Work"],
      [current ? (leaving ? shortDate(leaving) : "open-ended") : "—", "Leaving date", f !== null ? (f === 0 ? "today" : `${plural(f, "day")} left`) : ""],
    ]);
  }
  g.innerHTML = `${top}
    ${list.length ? `<table class="mini ct-table"><thead><tr><th>Type</th><th>Project</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr data-id="${esc(r._id)}" class="${r.statusLabel === "Ended" ? "ct-ended" : ""}">
        <td>${esc(r.type || "Work")}</td><td>${esc(r.projectName || "—")}</td><td>${shortDate(r.start)}</td>
        <td>${r.end ? shortDate(r.end) : `<span class="muted">open-ended</span>`}</td>
        <td><span class="chip ${r.statusLabel === "Ongoing" ? "good" : ""}">${esc(r.statusLabel)}</span></td>
        <td class="ct-actions">${r.type !== "Leave" && !r.end && r.statusLabel !== "Ended" ? `<button class="btn small" data-leave>Enter leaving date</button>` : ""}
          <button class="btn small" data-edit>Edit</button><button class="btn small danger" data-delete>Delete</button></td></tr>
        ${r.notes ? `<tr class="ct-note"><td colspan="6">${esc(r.notes)}</td></tr>` : ""}`).join("")}
      </tbody></table>` : ""}
    <div class="ct-form">
      <div class="subhead" data-title>New period</div>
      <div class="ct-fields">
        <label class="field"><span>Type</span><select data-f="type"><option>Work</option><option>Leave</option></select></label>
        <label class="field"><span>Project</span><select data-f="project">${linkOptions("projects", "")}</select></label>
        <label class="field"><span>Start</span><input type="date" data-f="start"></label>
        <label class="field"><span>End (leaving date)</span><input type="date" data-f="end"></label>
        <label class="field ct-wide"><span>Note</span><input type="text" data-f="notes" placeholder="e.g. 6-month contract, can be extended"></label>
      </div>
      <div class="form-foot"><button class="btn" data-cancel style="display:none">Cancel</button><button class="btn primary" data-save>Add period</button></div>
    </div>`;

  const form = g.querySelector(".ct-form");
  const field = (name) => form.querySelector(`[data-f="${name}"]`);
  let editing = null;
  const fillForm = (r) => {
    editing = r;
    const lastEnd = work.map((x) => x.end).filter(Boolean).sort().at(-1);
    const defaults = {
      type: "Work", project: ongoing?.project || v.project?.code || "",
      start: lastEnd ? addDays(lastEnd, 1) : person.startDate || todayStr(), end: "", notes: "",
    };
    for (const name of ["type", "project", "start", "end", "notes"]) field(name).value = (r ? r[name] : defaults[name]) || "";
    form.querySelector("[data-title]").textContent = r ? `Editing: ${r.type || "Work"} · ${shortDate(r.start)}` : "New period";
    form.querySelector("[data-save]").textContent = r ? "Save changes" : "Add period";
    form.querySelector("[data-cancel]").style.display = r ? "" : "none";
  };
  fillForm(null);

  const find = (b) => list.find((r) => r._id === b.closest("tr").dataset.id);
  g.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { fillForm(find(b)); form.scrollIntoView({ block: "nearest" }); });
  g.querySelectorAll("[data-leave]").forEach((b) => b.onclick = () => {
    fillForm(find(b));
    field("end").focus();
    field("end").showPicker?.();
  });
  form.querySelector("[data-cancel]").onclick = () => fillForm(null);
  g.querySelectorAll("[data-delete]").forEach((b) => b.onclick = async () => {
    const r = find(b);
    if (!(await confirmBox("Delete this employment period?", `${r.type || "Work"} · ${shortDate(r.start)} – ${r.end ? shortDate(r.end) : "open-ended"} will be deleted. ` +
      "The person's status and open timesheet periods are recalculated from the remaining records.", "Delete"))) return;
    try { await api(`/table/contracts/${r._id}`, { method: "DELETE" }); toast("Employment period deleted", "", "good"); await loadStatus(); await route(); }
    catch (e) { toastError(e); }
  });
  form.querySelector("[data-save]").onclick = async (ev) => {
    const data = { employeeCode: person.code };
    for (const name of ["type", "project", "start", "end", "notes"]) data[name] = field(name).value.trim();
    ev.target.disabled = true;
    try {
      if (editing) await api(`/table/contracts/${editing._id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api("/table/contracts", { method: "POST", body: JSON.stringify(data) });
      toast(editing ? "Employment period updated" : "Employment period added", "Status and open timesheet periods were updated to these dates.", "good");
      await loadStatus(); await route();
    } catch (e) { toastError(e); ev.target.disabled = false; }
  };
  return k;
}

/**
 * The person's notes: a title + text, each note saved separately. Below are the titles of saved notes;
 * clicking a title shows the text, ✎ edits it, ✕ deletes it after confirmation. These are manager notes and never reach the employee's page.
 */
function notesCard(v) {
  const code = v.row.code;
  const list = v.notes || [];
  const k = card(`Notes${list.length ? ` · ${list.length}` : ""}`);
  const g = k.querySelector(".card-body");
  g.innerHTML = `<div class="note-form">
      <label class="field"><span>Note title</span><input type="text" data-f="title" maxlength="120" placeholder="e.g. Leave request, warning, meeting"></label>
      <label class="field"><span>Note</span><textarea data-f="text" rows="4" placeholder="Write the note here…"></textarea></label>
      <div class="form-foot"><span class="note-status muted" data-status></span>
        <button class="btn" data-cancel style="display:none">Cancel</button><button class="btn primary" data-save>Save</button></div>
    </div>
    <div class="note-list">${list.length ? list.map((n) => `<div class="note-row" data-id="${esc(n._id)}">
        <button class="note-title" data-show title="Show the note">${esc(n.title)}</button>
        <span class="note-date">${shortDate((n.updated || n.created || "").slice(0, 10))}</span>
        <button class="note-icon" data-edit title="Edit" aria-label="Edit">✎</button>
        <button class="note-icon danger" data-delete title="Delete" aria-label="Delete">✕</button>
        <div class="note-text" hidden>${esc(n.text)}</div></div>`).join("")
      : emptyRow("No notes yet. Type a title and a note above and press Save.")}</div>`;

  const field = (name) => g.querySelector(`[data-f="${name}"]`);
  let editing = null;
  const openForm = (n) => {
    editing = n;
    field("title").value = n?.title || "";
    field("text").value = n?.text || "";
    g.querySelector("[data-status]").textContent = n ? `Editing: ${n.title}` : "";
    g.querySelector("[data-cancel]").style.display = n ? "" : "none";
    g.querySelector("[data-save]").textContent = n ? "Save changes" : "Save";
    g.querySelectorAll(".note-row").forEach((x) => x.classList.toggle("selected", x.dataset.id === n?._id));
  };
  const noteOf = (b) => list.find((n) => n._id === b.closest(".note-row").dataset.id);

  g.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => {
    const m = b.closest(".note-row").querySelector(".note-text");
    m.hidden = !m.hidden;
  });
  g.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { openForm(noteOf(b)); field("text").focus(); });
  g.querySelector("[data-cancel]").onclick = () => openForm(null);
  g.querySelectorAll("[data-delete]").forEach((b) => b.onclick = async () => {
    const n = noteOf(b);
    if (!(await confirmBox("Delete this note?", `The note "${n.title}" will be deleted for good.`, "Delete"))) return;
    try { await api(`/notes/${n._id}`, { method: "DELETE" }); toast("Note deleted", "", "good"); await route(); }
    catch (e) { toastError(e); }
  });
  g.querySelector("[data-save]").onclick = async (ev) => {
    const data = { employeeCode: code, title: field("title").value, text: field("text").value };
    if (!data.text.trim()) { field("text").focus(); return toast("Empty note", "Write the note before saving.", "error"); }
    ev.target.disabled = true;
    try {
      if (editing) await api(`/notes/${editing._id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api("/notes", { method: "POST", body: JSON.stringify(data) });
      toast(editing ? "Note updated" : "Note saved", "", "good");
      await route();
    } catch (e) { toastError(e); ev.target.disabled = false; }
  };
  return k;
}

function employeeDetail(right, v) {
  // For a person with employment periods the status is automatic: it is locked on the Details card.
  const statusField = main.querySelector('.detail-left select[data-k="status"]');
  if (statusField && v.statusAutomatic) {
    statusField.disabled = true;
    statusField.title = "Calculated from the employment periods for today. Use the Employment Periods card to change it.";
    statusField.closest(".field")?.querySelector("span")?.insertAdjacentHTML("beforeend", ` <small class="muted">· from employment periods</small>`);
  }

  const crewCard = card("Crew and Project");
  crewCard.querySelector(".card-body").innerHTML = v.crew
    ? `${metrics([
        [v.crew.code, v.crew.name],
        [v.project ? v.project.name : "—", "Project"],
        [v.mealDaily?.amount ? `${numText(v.mealDaily.amount)} ${v.mealDaily.currency}` : "—", "Meals / day"],
      ])}<a class="btn small" href="#d/crews/${v.crew._id}">Go to crew</a>`
    : emptyRow("Not assigned to a crew. Use the Crew field on the left or the crew's page.");
  right.appendChild(crewCard);
  right.appendChild(contractsCard(v));
  main.querySelector(".detail-left")?.appendChild(notesCard(v));

  const houseCard = card("Housing");
  houseCard.querySelector(".card-body").innerHTML = v.house
    ? `${metrics([
        [v.house.code, v.house.name],
        [v.house.occupancy, "Occupancy"],
        [v.house.rentPerPerson, "Rent share / month", v.project ? `→ ${v.project.name}` : ""],
        [v.house.rentPerPersonDaily, "Rent share / day", "deducted from pay for days absent"],
      ])}<a class="btn small" href="#d/houses/${v.house._id}">Go to house</a>`
    : emptyRow("Not assigned to a house.");
  right.appendChild(houseCard);

  const eqCard = card("Equipment", `<a class="btn small" href="#t/equipment">Equipment table</a>`);
  eqCard.querySelector(".card-body").innerHTML =
    `<div class="subhead">Personal</div>${v.personalEquipment.map(equipmentRow).join("") || emptyRow("No personal equipment.")}
     <div class="subhead">Crew equipment${v.crew ? ` · ${esc(v.crew.code)}` : ""}</div>${v.crewEquipment.map(equipmentRow).join("") || emptyRow("No crew equipment.")}`;
  right.appendChild(eqCard);

  const payCard = card("Pay History");
  payCard.querySelector(".card-body").innerHTML =
    `<div class="hint-box">Pay is changed on the Details card on the left. A change only applies to timesheet periods opened from now on; periods already open keep the old pay.</div>
     ${v.payHistory.length ? `<table class="mini"><thead><tr><th>Date</th><th>Type</th><th>Pay</th><th>Changed by</th></tr></thead><tbody>
       ${v.payHistory.map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.payType || "—")}</td>
         <td>${m.pay ? `${numText(m.pay)} ${esc(m.currency)}` : "—"}</td><td>${esc(m.user || "")}</td></tr>`).join("")}
       </tbody></table>` : emptyRow("No pay records yet.")}`;
  right.appendChild(payCard);

  // Work summary from the timesheet periods (matched by employee code).
  const workCard = card("Work Summary", `<a class="btn small" href="#statistics">All statistics</a>`);
  const cg = workCard.querySelector(".card-body");
  cg.innerHTML = `<span class="spinner"></span>`;
  right.insertBefore(workCard, houseCard);
  api(`/statistics/employee/${encodeURIComponent(v.row.code)}`).then((list) => {
    if (!list.length) { cg.innerHTML = emptyRow("Not in any timesheet period yet."); return; }
    const t = (field) => list.reduce((a, d) => a + d[field], 0);
    const tc = (field) => list.reduce((a, d) => { for (const [cur, n] of Object.entries(d[field] || {})) a[cur] = (a[cur] || 0) + n; return a; }, {});
    cg.innerHTML = metrics([
      [numText(t("total")), "Total hours", `${plural(list.length, "period")}`],
      [numText(t("overtime")), "Overtime"],
      [numText(t("short")), "Short hours"],
      [totalText(tc("net")), "Net (advances deducted)"],
    ]) + `<table class="mini"><thead><tr><th>Period</th><th>Crew</th><th>Hours</th><th>Overtime</th><th>Short</th><th>Earnings</th><th>Advance</th><th>Net</th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><a href="#timesheet/${d.period}">${esc(d.name.replace(/ \(.*\)$/, ""))}</a>${d.status === "closed" ? ` <span class="chip">closed</span>` : ""}</td>
        <td>${esc(d.crew || "—")}</td><td>${numText(d.total)}</td><td>${numText(d.overtime)}</td><td>${numText(d.short)}</td>
        <td>${d.earnings ? `${numText(d.earnings)} ${esc(d.currency)}` : "—"}</td><td>${totalText(d.advance)}</td><td><b>${totalText(d.net)}</b></td></tr>`).join("")}
      </tbody></table>`;
    right.insertBefore(absenceCard(list), workCard.nextSibling);
  }).catch((e) => { cg.innerHTML = emptyRow(e.message); });
}

/** The person's absence and deduction statistics: days absent and what was deducted from their pay. */
function absenceCard(list) {
  const k = card("Absence and Deductions");
  const g = k.querySelector(".card-body");
  const tc = (fn) => list.reduce((a, d) => { const cur = d.currency; a[cur] = (a[cur] || 0) + (fn(d) || 0); return a; }, {});
  const clean = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v));
  const absent = list.reduce((a, d) => a + (d.absent || 0), 0);
  const deduction = clean(tc((d) => d.deduction));
  if (!absent && !Object.keys(deduction).length) { g.innerHTML = emptyRow("No days absent and no deductions."); return k; }
  g.innerHTML = metrics([
    [String(absent), "Days absent", `in ${plural(list.filter((d) => d.absent).length, "period")}`],
    [totalText(clean(tc((d) => (d.deductionDetail?.salary || 0) + (d.deductionDetail?.shortHours || 0)))), "Pay deducted"],
    [totalText(clean(tc((d) => d.deductionDetail?.rent))), "Rent share deducted"],
    [totalText(clean(tc((d) => d.deductionDetail?.meals))), "Meals deducted"],
    [totalText(deduction), "Total deductions"],
  ]) + `<table class="mini"><thead><tr><th>Period</th><th>Days absent</th><th>Pay</th><th>Rent</th><th>Meals</th><th>Total</th></tr></thead><tbody>
    ${list.filter((d) => d.absent || d.deduction).map((d) => {
      const dd = d.deductionDetail || {};
      const cur = ` ${esc(d.currency)}`;
      const outside = Object.entries(d.notDeducted || {}).map(([a, n]) => `${a} ${numText(n)}`).join(", ");
      return `<tr><td><a href="#timesheet/${d.period}">${esc(d.name.replace(/ \(.*\)$/, ""))}</a>${d.rule === 1 ? ` <span class="chip" title="Old rule: short hours × hourly value">old rule</span>` : ""}</td>
        <td>${(d.absentDays || []).map((x) => x.slice(8, 10)).join(", ") || "—"}</td>
        <td>${numText((dd.salary || 0) + (dd.shortHours || 0))}${cur}</td><td>${numText(dd.rent || 0)}${cur}</td><td>${numText(dd.meals || 0)}${cur}</td>
        <td><b>${numText(d.deduction)}${cur}</b>${outside ? `<div class="muted" title="Different currency; not deducted from pay">+ ${esc(outside)}</div>` : ""}</td></tr>
        ${d.rule >= 2 && (d.deductionItems || []).length ? `<tr class="dd-row"><td colspan="6">${deductionLines(d).map(esc).join("<br>")}</td></tr>` : ""}`;
    }).join("")}</tbody></table>`;
  return k;
}

function crewDetail(right, v) {
  const { row, calc } = v;

  const mealCard = card("Meals");
  mealCard.querySelector(".card-body").innerHTML = metrics([
    [calc.mealPerPersonDaily ? `${numText(calc.mealPerPersonDaily)} ${calc.currency}` : "—", "Per person / day"],
    [String(calc.headcount), "People"],
    [`${numText(calc.mealCrewDaily)} ${calc.currency}`, "Crew / day"],
    [`${numText(calc.mealCrewPeriod)} ${calc.currency}`, "Crew / 15 days", "from the days worked once the timesheet is in"],
  ]) + `<div class="hint-box">Crew meals = daily amount per person × number of people in the crew. Change the amount on the Details card on the left.</div>`;
  right.appendChild(mealCard);

  const memberCard = card(`Members · ${v.members.length}`);
  const mg = memberCard.querySelector(".card-body");
  mg.innerHTML = v.members.map((p) => personRow(p, {
    remove: "Remove from crew", extra: p.code === row.leader ? "crew leader" : "",
  })).join("") || emptyRow("Nobody in the crew.");
  mg.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => assignEmployee(b.dataset.remove, { crew: "" }, "Removed from the crew");
  });
  const candidates = records("employees")
    .filter((p) => p.status !== "Left" && p.crew !== row.code)
    .map((p) => [p._id, `${p.code} — ${p.name}${p.crew ? `  (now ${p.crew})` : ""}`]);
  mg.appendChild(addRow(candidates, "Add to crew", "Pick an employee…", (pid) =>
    assignEmployee(pid, { crew: row.code }, "Added to the crew")));
  right.appendChild(memberCard);

  const eqCard = card(`Crew Equipment · ${v.equipment.length}`, `<a class="btn small" href="#t/equipment">Equipment table</a>`);
  const eg = eqCard.querySelector(".card-body");
  eg.innerHTML = v.equipment.map(equipmentRow).join("") || emptyRow("No equipment issued to the crew.");
  const ef = el(`<div class="quick-form">
    <input data-f="item" placeholder="Item (e.g. Hilti drill)">
    <select data-f="category"><option value="">Category</option>${["Hand tool", "Measuring device", "Computer", "Phone", "Vehicle", "PPE", "Other"].map((c) => `<option>${c}</option>`).join("")}</select>
    <input data-f="serialNo" placeholder="Serial no">
    <input data-f="quantity" type="number" min="1" value="1" style="max-width:70px">
    <button class="btn small primary">Issue to crew</button></div>`);
  ef.querySelector("button").onclick = async () => {
    const f = Object.fromEntries([...ef.querySelectorAll("[data-f]")].map((x) => [x.dataset.f, x.value.trim()]));
    if (!f.item) return toast("Item name is empty", "Type the name of the item to issue.", "error");
    try {
      await api("/table/equipment", { method: "POST", body: JSON.stringify({
        ...f, ownerType: "Crew", crewCode: row.code, issuedDate: todayText(), status: "Issued",
      }) });
      toast("Issued to the crew", f.item, "good");
      await loadStatus(); await route();
    } catch (e) { toastError(e); }
  };
  eg.appendChild(ef);
  right.appendChild(eqCard);

  const personalCard = card("Members' Personal Equipment");
  personalCard.querySelector(".card-body").innerHTML = v.personalEquipment.map(equipmentRow).join("") || emptyRow("No personal equipment.");
  right.appendChild(personalCard);
}

function projectDetail(right, v) {
  const { row, cost } = v;

  const costCard = card("Cost Summary");
  costCard.querySelector(".card-body").innerHTML = metrics([
    [totalText(cost.mealDaily), "Meals / day"],
    [totalText(cost.rentMonthly), "Rent share / month", "from per-person shares"],
    [totalText(cost.salaryMonthly), "Monthly salaries / month"],
    [String(cost.hourlyCount), "Hourly workers", "cost comes from the timesheets"],
  ]);
  right.appendChild(costCard);

  const crewCard = card(`Crews · ${v.crews.length}`);
  const cg = crewCard.querySelector(".card-body");
  for (const c of v.crews) {
    const block = el(`<div class="crew-block">
      <div class="crew-head">
        <a class="code" href="#d/crews/${c._id}">${esc(c.code)}</a><b>${esc(c.name)}</b>
        <span class="meta">${plural(c.calc.headcount, "person", "people")} · meals ${esc(c.mealCrewDaily)}/day</span>
        <button class="btn small danger" data-remove>Remove from project</button></div>
      ${c.members.map((p) => personRow(p)).join("") || emptyRow("Nobody in the crew.")}
      ${c.equipment.length || c.personalEquipment.length ? `<div class="subhead">Equipment</div>${[...c.equipment, ...c.personalEquipment].map(equipmentRow).join("")}` : ""}
    </div>`);
    block.querySelector("[data-remove]").onclick = async () => {
      try {
        await api(`/table/crews/${c._id}`, { method: "PUT", body: JSON.stringify({ project: "" }) });
        toast("Crew removed from the project", c.name, "good"); await route();
      } catch (er) { toastError(er); }
    };
    cg.appendChild(block);
  }
  if (!v.crews.length) cg.innerHTML = emptyRow("No crews assigned to this project.");
  const candidates = records("crews").filter((c) => c.project !== row.code && c.status !== "Inactive")
    .map((c) => [c._id, `${c.code} — ${c.name}${c.project ? `  (now ${c.project})` : ""}`]);
  cg.appendChild(addRow(candidates, "Assign to project", "Pick a crew…", async (cid) => {
    try {
      await api(`/table/crews/${cid}`, { method: "PUT", body: JSON.stringify({ project: row.code }) });
      toast("Crew assigned to the project", "", "good"); await route();
    } catch (e) { toastError(e); }
  }));
  right.appendChild(crewCard);

  const houseCard = card(`Houses · ${v.houses.length}`);
  houseCard.querySelector(".card-body").innerHTML = v.houses.map((h) => `<div class="crew-block">
      <div class="crew-head"><a class="code" href="#d/houses/${h._id}">${esc(h.code)}</a><b>${esc(h.name)}</b>
        <span class="meta">${esc(h.occupancy)} · per person ${esc(h.rentPerPerson)}</span></div>
      ${h.residents.map((p) => personRow(p)).join("") || emptyRow("Nobody lives in the house.")}</div>`).join("")
    || emptyRow("No house linked to this project. Pick the Project field in the Houses table.");
  right.appendChild(houseCard);
}

function houseDetail(right, v) {
  const { row, calc } = v;

  const occCard = card("Occupancy and Rent");
  occCard.querySelector(".card-body").innerHTML = metrics([
    [`${calc.headcount} / ${calc.beds || "?"}`, "People / beds"],
    [calc.rent ? `${numText(calc.rent)} ${calc.currency}` : "—", "Monthly rent"],
    [calc.rentPerPerson ? `${numText(calc.rentPerPerson)} ${calc.currency}` : "—", "Per person / month"],
  ]) + (calc.overCapacity ? `<div class="sugg-note">Over capacity: ${plural(calc.headcount, "person", "people")} live here and there are ${calc.beds} beds.</div>` : "");
  right.appendChild(occCard);

  const resCard = card(`Residents · ${v.residents.length}`);
  const rg = resCard.querySelector(".card-body");
  rg.innerHTML = v.residents.map((p) => personRow(p, { remove: "Move out", extra: p.crew || "no crew" })).join("")
    || emptyRow("Nobody lives in the house.");
  rg.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => assignEmployee(b.dataset.remove, { house: "" }, "Moved out of the house");
  });
  const candidates = records("employees").filter((p) => p.status !== "Left" && p.house !== row.code)
    .map((p) => [p._id, `${p.code} — ${p.name}${p.house ? `  (now ${p.house})` : ""}`]);
  rg.appendChild(addRow(candidates, "Move in", "Pick an employee…", async (pid) => {
    if (calc.beds && calc.headcount >= calc.beds) {
      const ok = await confirmBox("The house is full", `${row.name} has ${calc.beds} beds and all are taken. Move the person in anyway?`, "Move in anyway");
      if (!ok) return;
    }
    assignEmployee(pid, { house: row.code }, "Moved into the house");
  }));
  right.appendChild(resCard);

  const shareCard = card("Rent Shares");
  shareCard.querySelector(".card-body").innerHTML = v.rentShares.length
    ? `<table class="mini"><thead><tr><th>Project</th><th>People</th><th>Monthly share</th></tr></thead><tbody>
        ${v.rentShares.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.people}</td><td>${numText(p.amount)} ${esc(calc.currency)}</td></tr>`).join("")}
       </tbody></table><div class="hint-box">The rent is split by the number of people living in the house and charged to each person's project (their crew's project; the house's project if they have no crew).</div>`
    : emptyRow("Nobody lives in the house, so there are no shares.");
  right.appendChild(shareCard);
}

/* ---------------- EMPLOYEE'S VIEW ---------------- */

const money = (n, cur) => `${numText(n)} ${cur}`;
const addDays = (t, n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const evPeriodShort = (d) => d.name.replace(/ · \d(st|nd) half \((.*)\)$/, " · $2");
const evDayOutside = (g) => g.beforeStart || g.outsideContract;

/**
 * The selection on the page is read from the address bar:
 *   "2026-10-1"               one period
 *   "2026-09-2,2026-10-1"     several periods (there may be gaps between them)
 *   "2026-10-03..2026-10-20"  a day-by-day date range (may cross period boundaries)
 * Returns: the chosen periods (oldest first) and the first / last day to show.
 */
const EV_MAX = 2;
function evParseSelection(v, sel) {
  const all = [...v.periods].reverse();
  const first = (d) => d.days[0].day, last = (d) => d.days.at(-1).day;
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(sel || "");
  // At most EV_MAX periods are shown; if more are chosen, the newest ones stay.
  const trim = (periods) => periods.slice(-EV_MAX);
  if (m) {
    const [from, to] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
    const every = all.filter((d) => first(d) <= to && last(d) >= from), periods = trim(every);
    const trimmed = every.length > periods.length;
    return { range: true, from: trimmed && first(periods[0]) > from ? first(periods[0]) : from, to, periods, trimmed };
  }
  const list = String(sel || "").split(",");
  const every = all.filter((d) => list.includes(d.period));
  let periods = trim(every);
  if (!periods.length) periods = all.slice(-1);
  return { range: false, from: periods[0] ? first(periods[0]) : "", to: periods.length ? last(periods.at(-1)) : "", periods,
    trimmed: every.length > periods.length };
}

/** Hour and day counts of the chosen days (days before starting work and outside the employment period are not counted). */
function evDayTotals(days) {
  const t = { days: 0, hours: 0, normal: 0, overtime: 0, absent: 0, leave: 0, sick: 0 };
  for (const g of days) {
    if (evDayOutside(g)) continue;
    if (/^\d/.test(g.value) && Number(g.value) > 0) t.days += 1;
    t.normal += g.n || 0; t.overtime += g.m || 0;
    if (g.absent) t.absent += 1; else if (g.value === "L") t.leave += 1; else if (g.value === "S") t.sick += 1;
  }
  t.hours = t.normal + t.overtime;
  return t;
}

/**
 * The page the employee would see: their own timesheet, earnings, reasons for deductions and payments. Read only.
 * At most two periods or a day-by-day date range can be chosen. Printing (PDF) gives the timesheet, the earnings
 * calculation and that month's meal allowance payments; pay, house, employment periods and documents stay on screen only.
 */
async function renderEmployeeView(code, sel) {
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let v;
  try { v = await api(`/employee-view/${encodeURIComponent(code)}`); }
  catch (e) { main.innerHTML = `<div class="empty"><div class="big">Could not open the page</div><p>${esc(e.message)}</p></div>`; return; }
  const k = v.person;
  const selection = evParseSelection(v, sel);
  const go = (s) => { location.hash = `#employee/${encodeURIComponent(k.code)}/${s}`; };

  main.innerHTML = "";
  const head = el(`<div class="page-head ev-tools"><div>
      <a class="back" href="#d/employees/${esc(k._id)}">← ${esc(k.name)} · person page</a>
      <h2>Employee's view</h2>
      <p>${esc(k.name)} sees this page: their own timesheet, earnings, reasons for deductions and payments. Nobody else's information and no manager notes appear.
        At most two periods are shown. Printing or saving as PDF gives the timesheet, the earnings calculation and that month's meal allowance payments.</p></div>
    <div class="head-tools"><button class="btn primary" data-print ${selection.periods.length ? "" : "disabled"}>Print / PDF</button></div></div>`);
  main.appendChild(head);
  head.querySelector("[data-print]").onclick = () => {
    // The browser suggests the page title as the PDF file name.
    const old = document.title;
    document.title = `Timesheet and earnings ${k.name} ${selection.from}_${selection.to}`;
    window.addEventListener("afterprint", () => { document.title = old; }, { once: true });
    window.print();
  };

  if (v.periods.length) {
    const chosen = new Set(selection.periods.map((d) => d.period));
    const firstDay = v.periods.at(-1).days[0].day, lastDay = v.periods[0].days.at(-1).day;
    const bar = el(`<div class="card ev-pick">
      <div class="ev-row"><span class="small-label">Periods</span>
        <div class="ev-chips">${v.periods.map((d) => `<button class="ev-chip ${chosen.has(d.period) ? "active" : ""}" data-d="${d.period}"
          title="${esc(d.name)} · click to add to or remove from the selection">${esc(evPeriodShort(d))}</button>`).join("")}</div></div>
      <div class="ev-row"><span class="small-label">Date range</span>
        <input type="date" data-t="from" value="${selection.from}" min="${firstDay}" max="${lastDay}">
        <span class="muted">–</span>
        <input type="date" data-t="to" value="${selection.to}" min="${firstDay}" max="${lastDay}">
        <button class="btn small" data-h="month">This month</button>
        <button class="btn small" data-h="last">Last ${plural(EV_MAX, "period")}</button>
        <span class="ev-pick-sum">${plural(selection.periods.length, "period")}${selection.range ? " · day range" : ""}${selection.trimmed
          ? ` · <span class="bad">at most ${plural(EV_MAX, "period")} are shown</span>` : ""}</span></div></div>`);
    main.appendChild(bar);
    const order = new Map(v.periods.map((d, i) => [d.period, i]));
    bar.querySelectorAll("[data-d]").forEach((b) => b.onclick = () => {
      const tick = b.dataset.d, next = new Set(chosen);
      if (next.has(tick)) { if (next.size > 1) next.delete(tick); } else next.add(tick);
      // Over the limit: the clicked one stays and the period furthest from it is dropped.
      const distance = (x) => Math.abs(order.get(x) - order.get(tick));
      while (next.size > EV_MAX) next.delete([...next].filter((x) => x !== tick).sort((a, b2) => distance(b2) - distance(a))[0]);
      go([...next].sort().join(","));
    });
    bar.querySelectorAll("[data-t]").forEach((inp) => inp.onchange = () => {
      const b = bar.querySelector('[data-t="from"]').value, s = bar.querySelector('[data-t="to"]').value;
      if (b && s) go(`${b}..${s}`);
    });
    bar.querySelector('[data-h="month"]').onclick = () => {
      const month = todayStr().slice(0, 7);
      go(`${month}-01..${addDays(`${addDays(`${month}-01`, 32).slice(0, 7)}-01`, -1)}`);
    };
    bar.querySelector('[data-h="last"]').onclick = () => go(v.periods.slice(0, EV_MAX).map((d) => d.period).sort().join(","));
  }

  const paper = el(`<div class="card ev-paper"></div>`);
  main.appendChild(paper);

  // Identity and placement. Pay, house and meals stay on screen; they are not printed with the timesheet.
  const crewText = v.crew ? `${v.crew.name}${v.project ? ` · ${v.project.name}` : ""}` : "No crew assigned";
  const houseText = v.house ? `${v.house.name}${v.house.address ? ` · ${v.house.address}` : ""} · ${plural(v.house.people, "person", "people")}` : "No house assigned";
  const pay = k.payType && k.pay
    ? `${k.payType} · ${money(k.pay, k.currency)}${k.payType === "Hourly" ? " / hour" : " / month"}` : "—";
  paper.appendChild(el(`<div class="ev-head">
    <div><div class="ev-kicker">ACME ENGINEERING · employee page</div>
      <div class="ev-name">${esc(k.name)}</div>
      <div class="muted">${esc([k.code, k.role, k.startDate ? `started ${shortDate(k.startDate)}` : ""].filter(Boolean).join(" · "))}</div></div>
    <div class="ev-info">
      <div class="ev-screen"><span>Pay</span><b>${esc(pay)}</b></div>
      <div><span>Crew and project</span><b>${esc(crewText)}</b></div>
      <div class="ev-screen"><span>Your house</span><b>${esc(houseText)}</b>${v.house?.rentPerPerson
        ? `<small>Your rent share: ${esc(money(v.house.rentPerPerson, v.house.currency))} / month · ${esc(money(v.house.rentPerPersonDaily, v.house.currency))} / day</small>` : ""}</div>
      <div class="ev-screen"><span>Meal allowance</span><b>${v.crew?.mealDaily ? `${esc(money(v.crew.mealDaily, v.crew.mealCurrency))} / day` : "—"}</b>${v.crew?.mealDaily
        ? `<small>paid in advance at the start of the period</small>` : ""}</div>
      ${selection.periods.length ? `<div class="ev-print"><span>Timesheet range</span><b>${shortDate(selection.from)} – ${shortDate(selection.to)}</b></div>` : ""}
    </div></div>`));

  if (!selection.periods.length) {
    paper.appendChild(el(`<div class="empty"><div class="big">${v.periods.length ? "No timesheet for these dates" : "No timesheet yet"}</div>
      <p>${v.periods.length ? "The chosen range does not fall in any timesheet period." : "This person has not been in any timesheet period."}</p></div>`));
  } else {
    paper.appendChild(employeeTimesheetHtml(selection));
    paper.appendChild(employeeEarningsSection(selection));

    // Payments: only the meal allowance of the chosen month(s). Salary payments are not listed here; the earnings calculation is above.
    const months = new Set(selection.periods.map((d) => d.period.slice(0, 7)));
    const pays = v.payments.filter((o) => o.type === "meals" && months.has(String(o.period || "").slice(0, 7)));
    paper.appendChild(el(`<div class="ev-section"><h4>Your payments · meal allowance</h4>
      ${pays.length ? `<table class="mini"><thead><tr><th>Due date</th><th>Payment</th><th style="text-align:right">Amount</th><th>Status</th></tr></thead><tbody>
        ${pays.map((o) => `<tr><td>${shortDate(o.due)}</td><td>${esc(o.description)}</td>
          <td style="text-align:right;white-space:nowrap">${esc(money(o.paid ? o.paidAmount : o.amount, o.currency))}</td>
          <td>${o.paid ? `<span class="ev-pill good">Paid ${shortDate(o.paidDate)}</span>` : `<span class="ev-pill">Pending</span>`}</td></tr>`).join("")}
      </tbody></table>` : `<div class="list-empty">No meal allowance item for this month.</div>`}</div>`));
  }

  if (v.work?.length) {
    paper.appendChild(el(`<div class="ev-section ev-screen"><h4>Your employment periods</h4>
      <table class="mini"><thead><tr><th>Type</th><th>Project</th><th>Start</th><th>End</th><th>Status</th></tr></thead><tbody>
      ${v.work.map((c) => `<tr><td>${esc(c.type)}</td><td>${esc(c.project || "—")}</td><td>${shortDate(c.start)}</td>
        <td>${c.end ? shortDate(c.end) : "open-ended"}</td><td><span class="ev-pill ${c.status === "Ongoing" ? "good" : ""}">${esc(c.status)}</span></td></tr>`).join("")}
      </tbody></table></div>`));
  }

  if (k.documents.length) {
    paper.appendChild(el(`<div class="ev-section ev-screen"><h4>Expiry dates of your documents</h4><div class="ev-docs">
      ${k.documents.map((b) => {
        const f = daysUntil(b.expiry);
        return `<div><span>${esc(b.name)}</span><b>${shortDate(b.expiry)}</b>${f !== null && f <= 60
          ? `<small class="bad">${f < 0 ? `${plural(-f, "day")} overdue` : `${plural(f, "day")} left`}</small>` : ""}</div>`;
      }).join("")}</div></div>`));
  }
  const when = new Date(v.created).toLocaleString("en-GB");
  paper.appendChild(el(`<div class="ev-foot"><span class="ev-screen">This page was prepared on ${when}.
    Figures may change until the period is closed. If you see a mistake, tell your manager.</span>
    <span class="ev-print">This page was prepared on ${when}. In open periods the figures may change until the period is closed.</span></div>`));
}

/** What is deducted for a day absent: depends on the pay type and the period's rule. */
function absentRule(d) {
  const hourly = d.payType === "Hourly";
  if (d.rule === 1) return hourly ? "Hours not worked are not paid." : "Missing hours are deducted from the salary.";
  return hourly
    ? "Hours not worked are not paid anyway; for each day you were absent the rent share and the meal allowance are deducted as well."
    : "For each day you were absent, that day's salary, the rent share and the meal allowance are deducted.";
}

/** The timesheet of the chosen days: totals and a day grid per period. */
function employeeTimesheetHtml(selection) {
  const parts = selection.periods.map((d) => ({ d, days: d.days.filter((g) => g.day >= selection.from && g.day <= selection.to) }));
  const t = evDayTotals(parts.flatMap((x) => x.days));
  const anyOutside = parts.some((x) => x.days.some(evDayOutside));

  const dayHtml = (g) => {
    const v = g.value === "L" ? "v-leave" : g.value === "S" ? "v-sick" : g.absent ? "v-absent" : "";
    const outside = evDayOutside(g);
    const value = outside ? "" : g.absent ? "–" : g.value;
    const what = g.beforeStart ? "before starting work" : g.outsideContract ? "outside the employment period" : g.absent ? "absent"
      : g.value === "L" ? "leave" : g.value === "S" ? "sick" : /^\d/.test(g.value) ? `${plural(g.value, "hour")}` : "";
    const hint = [longDate(g.day), what, g.otherCrew ? `in crew ${g.otherCrew}` : "",
      g.type === "overtime" ? "overtime day" : g.type === "holiday" ? "holiday" : ""].filter(Boolean).join(" · ");
    return `<div class="ev-day t-${g.type} ${v} ${outside ? "pre" : ""}" title="${esc(hint)}">
      <span>${g.day.slice(8)} ${esc(g.wd)}</span><b>${esc(value) || "&nbsp;"}</b>${g.otherCrew ? `<i>${esc(g.otherCrew)}</i>` : ""}</div>`;
  };

  const periodHtml = ({ d, days }) => {
    const dt = evDayTotals(days);
    const absent = days.filter((g) => g.absent);
    const partial = days.length < d.days.length;
    return `<div class="ev-ts-period">
      <div class="ev-ts-head"><b>${esc(evPeriodShort(d))}</b>
        <span>${d.status === "closed" ? "period closed" : "period open"}${partial ? ` · ${days.length}/${plural(d.days.length, "day")}` : ""}</span>
        <span class="ev-ts-total">${plural(numText(dt.hours), "hour")} · ${plural(dt.days, "day")}${dt.overtime ? ` · ${numText(dt.overtime)} overtime` : ""}${dt.absent ? ` · <em class="bad">${dt.absent} absent</em>` : ""}</span></div>
      <div class="ev-days">${days.map(dayHtml).join("")}</div>
      ${absent.length ? `<div class="ev-note">Days you were absent: <b>${absent.map((g) => esc(longDate(g.day))).join(", ")}</b>.
        <span class="ev-screen">${esc(absentRule(d))}</span></div>` : ""}</div>`;
  };

  return el(`<div class="ev-section ev-ts"><h4>Your timesheet · ${shortDate(selection.from)} – ${shortDate(selection.to)}</h4>
    <div class="ev-counts">
      <div><b>${t.days}</b><span>days worked</span></div>
      <div><b>${numText(t.hours)}</b><span>total hours</span></div>
      <div><b>${numText(t.normal)}</b><span>normal hours</span></div>
      <div><b>${numText(t.overtime)}</b><span>overtime hours</span></div>
      <div class="${t.absent ? "bad" : ""}"><b>${t.absent}</b><span>days absent</span></div>
      ${t.leave ? `<div><b>${t.leave}</b><span>leave</span></div>` : ""}${t.sick ? `<div><b>${t.sick}</b><span>sick</span></div>` : ""}
    </div>
    ${parts.map(periodHtml).join("")}
    <div class="legend ev-legend"><span class="lg">number = hours worked</span><span class="lg v-absent">– absent</span>
      <span class="lg v-leave">L leave</span><span class="lg v-sick">S sick</span><span class="lg t-overtime">overtime day</span><span class="lg t-holiday">holiday</span>
      ${anyOutside ? `<span class="lg ev-lg-out">faded day = before starting work / outside the employment period</span>` : ""}</div>
  </div>`);
}

/** The earnings calculation of every chosen period (for the whole period). Boxes start open; a closed box is not printed. */
function employeeEarningsSection(selection) {
  const anyPartial = selection.periods.some((d) => d.days[0].day < selection.from || d.days.at(-1).day > selection.to);
  const b = el(`<div class="ev-section ev-earnings"><h4>How your earnings are calculated</h4>
    ${anyPartial ? `<div class="ev-note muted" style="margin:0 0 8px">Earnings are always calculated for the whole period, even if your chosen range covers only part of it.</div>` : ""}</div>`);
  // Same order as the timesheet (oldest first): the 2nd half's "net of the 1st half" line comes after the 1st half's calculation.
  for (const d of selection.periods) {
    const cur = d.currency;
    const summary = d.payType === "Monthly" && d.half === 2 && d.monthEnd ? `month end ${totalText(d.monthEnd)}` : `net ${money(d.net?.[cur] ?? 0, cur)}`;
    const det = el(`<details class="ev-pay" open><summary><b>${esc(evPeriodShort(d))}</b>
      <span class="muted">${d.status === "closed" ? "closed" : "open"}</span><span class="ev-pay-total">${esc(summary)}</span></summary></details>`);
    det.appendChild(employeeEarningsHtml(d));
    b.appendChild(det);
  }
  return b;
}

/** One period's earnings calculation (in the employee's words). */
function employeeEarningsHtml(d) {
  const cur = d.currency;
  const monthly = d.payType === "Monthly", hourly = d.payType === "Hourly";
  const net = d.net?.[cur] ?? 0;
  const hasMonthEnd = monthly && d.half === 2 && d.monthEnd;

  // Earnings lines: [name, formula, amount (negative = deducted)]
  const s = [];
  if (monthly) {
    const half = Number(d.pay) / 2;
    if (d.rule === 1) {
      s.push(["Half of the salary", `${numText(d.pay)} ${cur} ÷ 2`, half]);
      if (d.deduction) s.push(["Short-hours deduction", "", -d.deduction]);
    } else if (Math.abs(d.basePay - half) < 0.01) s.push(["Half of the salary", `${numText(d.pay)} ${cur} ÷ 2`, d.basePay]);
    else s.push(["Salary share", "days you were employed: daily salary × days", d.basePay]);
  } else if (hourly) {
    s.push(["Hours you worked", `${plural(numText(d.normal), "hour")} × ${numText(d.pay)} ${cur}`, d.basePay]);
  }
  if (d.overtime) s.push(["Overtime", `${plural(numText(d.overtime), "hour")} × ${numText(d.overtimeUnit)} ${cur}`, d.overtimePay]);
  const notDeducted = [];
  if (d.rule !== 1) {
    for (const kl of d.deductionItems || []) {
      if (kl.notDeducted) { notDeducted.push(`${kl.name.toLowerCase()} ${money(kl.amount, kl.currency)}`); continue; }
      s.push([`Deduction: ${kl.name.toLowerCase()}`, kl.formula, -kl.amount]);
    }
  }
  // Advances, by currency
  const byCur = {};
  for (const a of d.advances) (byCur[a.currency] ||= []).push(a);
  for (const [acur, list] of Object.entries(byCur)) {
    const total = list.reduce((t, a) => t + a.amount, 0);
    const dates = list.map((a) => shortDate(a.date).slice(0, 5)).join(", ");
    const c = acur === cur ? null : d.advanceConverted.find((x) => x.currency === acur);
    if (acur === cur) s.push(["Advance you received", dates, -total]);
    else if (c) s.push(["Advance you received", `${dates} · ${c.formula}`, -c.converted]);
    else notDeducted.push(`advance ${money(total, acur)} (${dates})`);
  }
  const converted = (d.deductionItems || []).some((x) => x.source) || d.advanceConverted.length;

  return el(`<div class="ev-period-body">
    <div class="ev-state">${esc(d.name)} · ${d.status === "closed" ? "period closed" : "period open; may change as the timesheet is filled in"}${
      hasMonthEnd ? " · the month-end amount is paid on the 1st of the next month" : monthly ? " · the monthly salary is paid at month end"
        : hourly ? " · hourly wages are paid when the period closes" : ""}</div>
    <table class="ev-calc"><tbody>
      ${s.map(([name, f, t]) => `<tr class="${t < 0 ? "neg" : ""}"><td>${esc(name)}</td><td class="f">${esc(f)}</td>
        <td class="amt">${t < 0 ? "− " : ""}${esc(money(Math.abs(t), cur))}</td></tr>`).join("")}
    </tbody><tfoot>
      <tr><td colspan="2">${hasMonthEnd ? "Net for this half" : "Net"}</td><td class="amt">${esc(money(net, cur))}</td></tr>
      ${hasMonthEnd && d.firstHalfNet ? `<tr class="mid"><td colspan="2">Net for the 1st half of the month</td><td class="amt">+ ${esc(totalText(d.firstHalfNet))}</td></tr>
        <tr class="final"><td colspan="2">What you receive at month end</td><td class="amt">${esc(totalText(d.monthEnd))}</td></tr>` : ""}
    </tfoot></table>
    ${notDeducted.length ? `<div class="ev-note">Items not deducted from your pay, which your manager will settle separately: ${esc(notDeducted.join(", "))}.</div>` : ""}
    ${converted && d.rates ? `<div class="ev-note muted">Amounts in another currency were converted at the period's rates: ${esc(ratesText(d.rates))}.</div>` : ""}
  </div>`);
}

/* ---------------- pop-up menu ---------------- */

let popCloser = null;

function closePop() {
  document.querySelector(".pop")?.remove();
  if (popCloser) { document.removeEventListener("mousedown", popCloser, true); document.removeEventListener("keydown", popCloser, true); }
  popCloser = null;
}

/** Opens a small menu next to an element. */
function openPop(anchor, html) {
  closePop();
  const a = el(`<div class="pop">${html}</div>`);
  document.body.appendChild(a);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, innerWidth - a.offsetWidth - 8));
  const top = r.bottom + a.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - a.offsetHeight - 4) : r.bottom + 4;
  a.style.left = `${left}px`; a.style.top = `${top}px`;
  popCloser = (ev) => {
    if (ev.type === "keydown" ? ev.key === "Escape" : !a.contains(ev.target)) closePop();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", popCloser, true);
    document.addEventListener("keydown", popCloser, true);
  }, 0);
  return a;
}

/* ---------------- TIMESHEET ---------------- */

const TS = { pkg: null, filter: { crew: "", project: "", search: "" }, queue: Promise.resolve() };
const DAY_TYPE_NAME = { normal: "Normal day", overtime: "Overtime day", holiday: "Holiday" };
const two = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const periodOfDate = (t) => `${t.slice(0, 7)}-${+t.slice(8, 10) <= 15 ? 1 : 2}`;
const hoursText = (n) => (n ? numText(n) : "0");
const tsClosed = () => TS.pkg?.record?.status === "closed";
const tsRow = (code) => TS.pkg.record.rows.find((s) => s.employeeCode === code);
const tsCrewName = (code) => TS.pkg.record.crews[code]?.name || records("crews").find((e) => e.code === code)?.name || "";

function tsVisible() {
  const { record } = TS.pkg;
  const { crew, project, search } = TS.filter;
  const q = search.trim().toLocaleLowerCase("tr");
  return record.rows.filter((s) => {
    const crews = [s.crew, ...Object.values(s.crewDays)];
    if (crew && !crews.includes(crew)) return false;
    if (project && !crews.some((e) => record.crews[e]?.project === project) && s.project !== project) return false;
    if (q && !`${s.name} ${s.employeeCode}`.toLocaleLowerCase("tr").includes(q)) return false;
    return true;
  });
}

function tsSummaryColumns() {
  const one = (h, v) => (v ? { [h.currency]: v } : {});
  return [
    { k: "total", label: "Total", hours: (h) => h.total, f: (h) => `<b>${hoursText(h.total)}</b>` },
    { k: "normal", label: "Normal", hours: (h) => h.normal, f: (h) => hoursText(h.normal) },
    { k: "overtime", label: "Overtime", hours: (h) => h.overtime, f: (h) => (h.overtime ? `<span class="hl">${hoursText(h.overtime)}</span>` : "0") },
    { k: "short", label: "Short", hours: (h) => h.short, f: (h) => (h.short ? `<span class="bad">${hoursText(h.short)}</span>` : "0") },
    { k: "absent", label: "Absent", hours: (h) => h.absent, f: (h) => (h.absent ? `<span class="bad">${plural(h.absent, "day")}</span>` : "0") },
    { k: "earnings", label: "Earnings", money: (h) => one(h, h.earnings), f: (h) => (h.earnings ? totalText(one(h, h.earnings)) : `<span class="muted">—</span>`) },
    { k: "deduction", label: "Deduction", money: (h) => one(h, h.deduction), f: (h) => (h.deduction || Object.keys(h.notDeducted || {}).length
      ? `<span class="bad dd-open" data-dd title="${esc(deductionHint(h))}">${h.deduction ? totalText(one(h, h.deduction)) : "0"}${Object.keys(h.notDeducted || {}).length ? " *" : ""}</span>`
      : `<span class="muted">—</span>`) },
    { k: "advance", label: "Advance", money: (h) => h.advance, f: (h) => totalText(h.advance) },
    { k: "net", label: "Net", money: (h) => h.net, f: (h) => `<b>${totalText(h.net)}</b>` },
    ...(TS.pkg.period.endsWith("-2")
      ? [{ k: "monthEnd", label: "Due at Month End", money: (h) => h.monthEnd, f: (h) => `<b class="hl">${totalText(h.monthEnd)}</b>` }]
      : []),
  ];
}

/** The deduction broken down formula by formula (timesheet, employee card). */
function deductionLines(h) {
  if (h.rule === 1) return [`Short ${plural(hoursText(h.short), "hour")} × hourly value ${numText(h.hourlyValue)} ${h.currency} (old rule)`];
  return (h.deductionItems || []).map((k) =>
    `${k.name}: ${k.formula} = ${numText(k.amount)} ${k.currency}${k.notDeducted ? ` (${k.notDeducted}; not deducted from pay)` : ""}`);
}

/** The short breakdown shown when hovering over the deduction cell. */
function deductionHint(h) {
  const lines = deductionLines(h);
  if (h.rule !== 1 && h.deduction) lines.push(`Total: ${numText(h.deduction)} ${h.currency}`, "Click for details");
  return lines.join("\n");
}

/** The breakdown that opens when the deduction cell is clicked: each item's formula, the total, converted advances and the period's rates. */
function tsOpenDeduction(anchor, code) {
  const h = TS.pkg.calc.rows.find((x) => x.employeeCode === code);
  const s = tsRow(code);
  if (!h || !s) return;
  const cur = h.currency;
  const body = h.rule === 1
    ? `<div class="pop-note">${esc(deductionLines(h)[0])}</div>`
    : `<table class="dd-table"><tbody>${(h.deductionItems || []).map((k) => `<tr class="${k.notDeducted ? "not-deducted" : ""}">
        <td>${esc(k.name)}</td><td class="dd-f">${esc(k.formula)}</td>
        <td class="dd-t">${numText(k.amount)} ${esc(k.currency)}${k.notDeducted ? `<div class="dd-note">${esc(k.notDeducted)}, not deducted</div>` : ""}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="2">Total deduction</td><td class="dd-t">${numText(h.deduction)} ${esc(cur)}</td></tr></tfoot></table>
      ${(h.advanceConverted || []).map((a) => `<div class="pop-note">Advance: ${esc(a.formula)} = ${numText(a.converted)} ${esc(cur)}</div>`).join("")}
      <div class="pop-note muted">${plural(h.absent, "day")} absent · ${h.rates ? `period rates: ${esc(ratesText(h.rates))}` : "no currency conversion in this period"}</div>`;
  const a = openPop(anchor, `<div class="pop-head">${esc(s.name)} · deduction breakdown</div>${body}`);
  a.classList.add("wide");
}

function tsCellClass(s, day) {
  const type = TS.pkg.record.days[day] || "normal";
  const v = s.cells[day] || "";
  const c = ["cell", `t-${type}`];
  if (v === "L") c.push("v-leave"); else if (v === "S") c.push("v-sick"); else if (v === "–") c.push("v-absent");
  if (s.crewDays[day]) c.push("other-crew");
  const r2 = (TS.pkg.record.rule || 1) >= 2;
  if (r2 && ((s.startDate && day < s.startDate) || (s.workRanges && !s.workRanges.some(([b, e]) => day >= b && (!e || day <= e))))) c.push("pre-start");
  // Under the old rule an empty past day counts as short (red); under the new rule only "–" leads to a deduction.
  else if (!r2 && !v && type === "normal" && (tsClosed() || day <= todayStr())) c.push("empty-past");
  return c.join(" ");
}

async function renderTimesheet(period) {
  if (!period) { location.replace(`#timesheet/${periodOfDate(todayStr())}`); return; }
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  await loadSources();
  let p;
  try { p = await api(`/timesheet/${period}`); }
  catch (e) { main.innerHTML = `<div class="empty"><div class="big">Could not open the period</div><p>${esc(e.message)}</p></div>`; return; }
  TS.pkg = p;

  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head"><div><h2>Timesheets</h2>
    <p>Type hours into a cell; <b>L</b> leave, <b>S</b> sick, <b>–</b> absent. Click a day header to change the day type,
    right-click a cell to change that day's crew. Blocks copied from Excel can be pasted straight in.</p></div></div>`));

  const state = p.record ? p.record.status : "none";
  const bar = el(`<div class="period-bar">
    <a class="btn arrow-btn" href="#timesheet/${p.previous}" title="Previous period">‹</a>
    <div class="period-name">${esc(p.name)}<span class="state-pill ${state}">${{ open: "open", closed: "closed", none: "not opened" }[state]}</span></div>
    <a class="btn arrow-btn" href="#timesheet/${p.next}" title="Next period">›</a>
    ${p.period !== p.current ? `<a class="btn small" href="#timesheet/${p.current}">Go to the current period</a>` : ""}
    <div class="head-tools">${p.record ? `
      ${state === "open" ? `<button class="btn" data-do="person">+ Add person</button>` : ""}
      <button class="btn" data-do="excel-out">Export to Excel</button>
      ${state === "open" ? `<button class="btn" data-do="excel-in">Import from Excel</button>` : ""}
      ${state === "open" ? `<button class="btn primary" data-do="close">Close period</button>` : `<button class="btn" data-do="open">Reopen period</button>`}
    ` : ""}</div></div>`);
  main.appendChild(bar);

  if (p.missing) return tsRenderNotOpened(p);

  const filter = el(`<div class="ts-filter">
    <select data-f="crew"><option value="">All crews</option>
      ${Object.entries(p.record.crews).map(([k, e]) => `<option value="${esc(k)}">${esc(`${k} — ${e.name}`)}</option>`).join("")}</select>
    <select data-f="project"><option value="">All projects</option>
      ${[...new Map(Object.values(p.record.crews).filter((e) => e.project).map((e) => [e.project, e.projectName])).entries()]
        .map(([k, a]) => `<option value="${esc(k)}">${esc(a || k)}</option>`).join("")}</select>
    <div class="search"><input data-f="search" placeholder="Find a person…"></div>
    <div class="legend">
      <span class="lg t-overtime">overtime day</span><span class="lg t-holiday">holiday</span>
      <span class="lg v-leave">L leave</span><span class="lg v-sick">S sick</span><span class="lg v-absent">– absent</span>
      ${(p.record?.rule || 1) >= 2 ? `<span class="lg pre-start" title="These days are not counted">before starting / outside the employment period</span>` : `<span class="lg empty-past">not entered (counts as short)</span>`}<span class="lg other-crew">other crew</span></div>
  </div>`);
  for (const s of filter.querySelectorAll("[data-f]")) {
    s.value = TS.filter[s.dataset.f] || "";
    s.addEventListener(s.tagName === "INPUT" ? "input" : "change", () => { TS.filter[s.dataset.f] = s.value; tsRenderGrid(); });
  }
  main.appendChild(filter);

  let drawerOpen = true;
  try { drawerOpen = localStorage.getItem("kadro-drawer") !== "0"; } catch { /* no storage */ }
  const layout = el(`<div class="ts-layout ${drawerOpen ? "drawer-open" : ""}">
    <div class="ts-main"><div id="closedBand"></div><div class="ts-wrap"><table class="ts"></table></div></div>
    <aside class="drawer"></aside></div>`);
  main.appendChild(layout);

  tsBindTools(bar);
  tsRenderClosedBand();
  tsRenderGrid();
  tsRenderDrawer();
}

function tsRenderNotOpened(p) {
  const o = p.preview;
  const k = el(`<div class="card"><div class="card-body not-opened">
    <div class="big">This period has not been opened yet</div>
    <p>Opening the period copies the pay and crew of <b>${o.people}</b> people, the crews' meal amounts and the house rent shares into it.
      Pay changes made after that do not affect this period; they only apply to periods opened later.</p>
    ${metrics([[String(o.people), "People"], [String(o.crews), "Crews"], [String(o.noCrew), "People without a crew"], [String(o.unpaid.length), "No pay entered"]])}
    ${o.unpaid.length ? `<div class="sugg-note">Earnings are not calculated for people without pay: ${esc(o.unpaid.join(", "))}.
      You can enter it in the <a href="#t/employees">Employees</a> table before opening the period.</div>` : ""}
    <p class="muted">${o.previousSettings
      ? `Overtime settings are carried over from the previous period: multiplier ${esc(o.previousSettings.overtimeMultiplier)}, normal day ${plural(esc(o.previousSettings.normalHours), "hour")}.`
      : "Default overtime settings: multiplier 1.5, normal day 8 hours. Saturday is an overtime day, Sunday a holiday."} All of them can be changed in the side panel.</p>
    <button class="btn primary" data-open>Open period</button>
  </div></div>`);
  k.querySelector("[data-open]").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api(`/timesheet/${p.period}`, { method: "POST" }); toast("Period opened", p.name, "good"); await route(); }
    catch (e) { toastError(e); ev.target.disabled = false; }
  };
  main.appendChild(k);
}

function tsRenderClosedBand() {
  const b = document.getElementById("closedBand");
  const k = TS.pkg.record;
  if (!b) return;
  if (k.status !== "closed") { b.innerHTML = ""; return; }
  const kp = k.closing || {};
  b.innerHTML = `<div class="closed-band">This period was closed on ${esc(kp.date ? new Date(kp.date).toLocaleString("en-GB") : "")}
    by ${esc(kp.user || "")}; the cells are locked.
    ${kp.file ? `Excel: <code>${esc(kp.file)}</code> <button class="btn small" data-folder>Open folder</button>` : ""}</div>`;
  b.querySelector("[data-folder]")?.addEventListener("click", async () => {
    try { await api("/open-folder", { method: "POST", body: JSON.stringify({ path: kp.file.split("/").slice(0, -1).join("/") }) }); }
    catch (e) { toastError(e); }
  });
}

function tsBindTools(bar) {
  const p = TS.pkg;
  const on = (name, f) => bar.querySelector(`[data-do="${name}"]`)?.addEventListener("click", f);
  on("excel-out", () => { location.href = `/api/timesheet/${p.period}/excel`; });
  on("excel-in", () => {
    const g = el(`<input type="file" accept=".xlsx" hidden>`);
    g.onchange = async () => {
      if (!g.files[0]) return;
      const fd = new FormData(); fd.append("file", g.files[0]);
      try {
        const r = await api(`/timesheet/${p.period}/excel`, { method: "POST", body: fd });
        TS.pkg = r; tsRenderGrid();
        toast("Excel imported", `${plural(r.report.changed, "cell")} updated.` +
          (r.report.unknown.length ? ` ${plural(r.report.unknown.length, "person", "people")} not in this period were skipped: ${r.report.unknown.join(", ")}` : ""), "good");
      } catch (e) { toastError(e); }
    };
    g.click();
  });
  on("close", async () => {
    const ok = await confirmBox("Close this period?",
      "The period is locked, normal days left empty count as short hours, and the period's Excel file is written to the 02 - Accounting / Payroll / Timesheets folder. " +
      `Payments for hourly workers${p.period.endsWith("-2") ? " and monthly-paid staff (month end)" : ""} show as "pending" on the Payments page; once marked paid they go into the cash book. ` +
      "You can reopen the period if needed.",
      "Close period");
    if (!ok) return;
    try {
      const r = await api(`/timesheet/${p.period}/close`, { method: "POST" });
      if (r.fileError) toast("Period closed", r.fileError, "error"); else toast("Period closed", r.file, "good");
      toast("Payments ready", "Salary payments are waiting to be marked paid on the Payments page.", "good");
      await loadStatus();
      S.tree = null; await route();
    } catch (e) { toastError(e); }
  });
  on("open", async () => {
    const ok = await confirmBox("Reopen this period?", "The cells become editable again. The Excel file written at closing stays where it is; it is updated when you close again. " +
      "This period's salary items are removed from the Payments page; records and cash rows of items already marked paid remain. Closing again recreates the items.", "Reopen");
    if (!ok) return;
    try {
      const r = await api(`/timesheet/${p.period}/open`, { method: "POST" });
      toast("Period reopened", r.cash?.deleted ? `${r.cash.deleted} automatic rows removed from the cash book.` : "", "good");
      await route();
    }
    catch (e) { toastError(e); }
  });
  on("person", (ev) => {
    const present = new Set(p.record.rows.map((s) => s.employeeCode));
    const candidates = records("employees").filter((x) => x.status !== "Left" && !present.has(x.code));
    const a = openPop(ev.currentTarget, `<div class="pop-head">Add a person to the period</div>
      <div class="pop-note">The person is added with today's pay and crew.</div>
      <select>${candidates.length ? candidates.map((x) => `<option value="${esc(x.code)}">${esc(`${x.code} — ${x.name}`)}</option>`).join("") : `<option value="">Nobody to add</option>`}</select>
      <button class="btn small primary" ${candidates.length ? "" : "disabled"}>Add</button>`);
    a.querySelector("button").onclick = async () => {
      const code = a.querySelector("select").value;
      if (!code) return;
      closePop();
      try { TS.pkg = await api(`/timesheet/${p.period}/row`, { method: "POST", body: JSON.stringify({ employeeCode: code }) }); tsRenderGrid(); toast("Person added", code, "good"); }
      catch (e) { toastError(e); }
    };
  });
}

function tsRenderGrid() {
  const table = main.querySelector("table.ts");
  if (!table || !TS.pkg?.record) return;
  const { days, record } = TS.pkg;
  const closed = tsClosed();
  const today = todayStr();
  const sumCols = tsSummaryColumns();
  const rows = tsVisible();
  const span = days.length + sumCols.length + 1;

  let h = `<thead><tr><th class="c1">Employee</th><th class="c2">Crew</th>`;
  days.forEach((g, i) => {
    const type = record.days[g.day];
    h += `<th class="day t-${type} ${g.day === today ? "today" : ""}" data-c="${i}" title="${DAY_TYPE_NAME[type]}${closed ? "" : " — click to change"}">
      <b>${g.no}</b><span>${g.short}</span></th>`;
  });
  h += sumCols.map((o) => `<th class="sum">${o.label}</th>`).join("") + `<th class="op"></th></tr></thead><tbody>`;

  let lastCrew = null, r = 0;
  for (const s of rows) {
    if (s.crew !== lastCrew) {
      lastCrew = s.crew;
      const e = record.crews[s.crew];
      const n = rows.filter((x) => x.crew === s.crew).length;
      h += `<tr class="group"><td class="c1" colspan="2">${s.crew ? `${esc(s.crew)} · ${esc(e?.name || "")}` : "No crew"}</td>
        <td colspan="${span}">${e?.projectName ? `${esc(e.projectName)} · ` : ""}${plural(n, "person", "people")}${e?.mealDaily ? ` · meals ${numText(e.mealDaily)} ${esc(e.mealCurrency)} / person / day` : ""}</td></tr>`;
    }
    h += `<tr data-emp="${esc(s.employeeCode)}"><td class="c1"><div class="person"><span class="name">${esc(s.name)}</span>
      <span class="sub">${esc(s.employeeCode)} · ${esc(s.payType ? `${s.payType} ${numText(s.pay)} ${s.currency}` : "no pay")}</span></div></td>
      <td class="c2">${esc(s.crew || "—")}</td>`;
    days.forEach((g, c) => {
      h += `<td class="${tsCellClass(s, g.day)}"><input class="cin" data-r="${r}" data-c="${c}" data-day="${g.day}" value="${esc(s.cells[g.day] || "")}" ${closed ? "readonly" : ""} maxlength="5" autocomplete="off"></td>`;
    });
    h += sumCols.map((o) => `<td class="sum" data-o="${o.k}"></td>`).join("") +
      `<td class="op"><button class="row-menu" title="Row actions">⋯</button></td></tr>`;
    r += 1;
  }
  if (!rows.length) {
    h += `<tr><td colspan="${span + 2}"><div class="empty"><div class="big">${record.rows.length ? "Nobody matches the filter" : "Nobody in this period"}</div>
      <p>${record.rows.length ? "Change the crew, project or search filter." : "Add people with \"+ Add person\" at the top right."}</p></div></td></tr>`;
  }
  h += `</tbody><tfoot><tr><td class="c1">Total · ${plural(rows.length, "person", "people")}</td><td class="c2"></td>
    ${days.map((g, i) => `<td class="day-total" data-c="${i}"></td>`).join("")}
    ${sumCols.map((o) => `<td class="sum" data-ot="${o.k}"></td>`).join("")}<td></td></tr></tfoot>`;
  table.innerHTML = h;
  tsRefreshValues();
  tsBindTable(table);
}

/** Refreshes the calculated cells, the totals and the panel without redrawing the table. */
function tsRefreshValues() {
  const table = main.querySelector("table.ts");
  if (!table) return;
  const { calc, days } = TS.pkg;
  const calcMap = new Map(calc.rows.map((x) => [x.employeeCode, x]));
  const sumCols = tsSummaryColumns();
  const active = document.activeElement;
  const dayTotals = days.map(() => 0);
  const foot = Object.fromEntries(sumCols.map((o) => [o.k, o.hours ? 0 : {}]));

  table.querySelectorAll("tbody tr[data-emp]").forEach((tr) => {
    const s = tsRow(tr.dataset.emp);
    const h = calcMap.get(tr.dataset.emp);
    if (!s || !h) return;
    tr.querySelectorAll("input.cin").forEach((inp) => {
      const g = inp.dataset.day;
      const v = s.cells[g] || "";
      if (inp !== active) inp.value = v;
      inp.dataset.v = v;
      const td = inp.parentElement;
      td.className = tsCellClass(s, g);
      td.title = s.crewDays[g] ? `Crew on this day: ${s.crewDays[g]} ${tsCrewName(s.crewDays[g])}` : "";
      if (/^\d/.test(v)) dayTotals[+inp.dataset.c] += Number(v);
    });
    for (const o of sumCols) {
      tr.querySelector(`[data-o="${o.k}"]`).innerHTML = o.f(h);
      if (o.hours) foot[o.k] += o.hours(h);
      else for (const [cur, v] of Object.entries(o.money(h) || {})) foot[o.k][cur] = (foot[o.k][cur] || 0) + v;
    }
    tr.classList.toggle("flagged", h.warnings.length > 0);
    tr.querySelector(".c1").title = h.warnings.join("\n");
  });
  table.querySelectorAll("tfoot .day-total").forEach((td) => { const v = dayTotals[+td.dataset.c]; td.textContent = v ? numText(v) : ""; });
  for (const o of sumCols) {
    const td = table.querySelector(`tfoot [data-ot="${o.k}"]`);
    if (td) td.innerHTML = o.hours ? numText(foot[o.k]) : totalText(foot[o.k]);
  }
  tsRefreshDrawer();
}

/** Saves cell changes one after another (so fast typing does not race). */
function tsSave(changes, message) {
  const period = TS.pkg.period;
  TS.queue = TS.queue.then(async () => {
    try {
      TS.pkg = await api(`/timesheet/${period}/cells`, { method: "PUT", body: JSON.stringify({ changes }) });
      tsRefreshValues();
      if (message) toast(message, "", "good");
    } catch (e) {
      toastError(e);
      tsRefreshValues(); // undo the invalid value
      const table = main.querySelector("table.ts");
      for (const d of changes) {
        const inp = table?.querySelector(`tr[data-emp="${d.employeeCode}"] input[data-day="${d.day}"]`);
        if (inp) inp.value = inp.dataset.v;
      }
    }
  });
  return TS.queue;
}

function tsBindTable(table) {
  if (table.dataset.bound) return;
  table.dataset.bound = "1";
  const focus = (r, c) => { const i = table.querySelector(`input.cin[data-r="${r}"][data-c="${c}"]`); if (i) { i.focus(); return true; } return false; };

  table.addEventListener("focusin", (ev) => { if (ev.target.matches("input.cin")) ev.target.select(); });

  table.addEventListener("keydown", (ev) => {
    const inp = ev.target.closest("input.cin");
    if (!inp) return;
    const r = +inp.dataset.r, c = +inp.dataset.c;
    const allSelected = inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
    if (ev.key === "Escape") { inp.value = inp.dataset.v; inp.blur(); return; }
    // Enter on the last row: there is no cell below, so leave the cell to save (fires the change event).
    if (ev.key === "Enter") { ev.preventDefault(); if (!focus(r + 1, c)) inp.blur(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); focus(r + 1, c); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); focus(r - 1, c); }
    else if (ev.key === "ArrowRight" && (allSelected || inp.selectionStart === inp.value.length)) { ev.preventDefault(); focus(r, c + 1); }
    else if (ev.key === "ArrowLeft" && (allSelected || inp.selectionStart === 0)) { ev.preventDefault(); focus(r, c - 1); }
  });

  table.addEventListener("change", (ev) => {
    const inp = ev.target.closest("input.cin");
    if (!inp || tsClosed() || inp.value.trim() === inp.dataset.v) return;
    tsSave([{ employeeCode: inp.closest("tr").dataset.emp, day: inp.dataset.day, value: inp.value }]);
  });

  // A block copied from Excel: spread over the cells by tabs and line breaks.
  table.addEventListener("paste", (ev) => {
    const inp = ev.target.closest("input.cin");
    if (!inp || tsClosed()) return;
    const text = (ev.clipboardData?.getData("text") || "").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\t\n]/.test(text)) return;
    ev.preventDefault();
    const r0 = +inp.dataset.r, c0 = +inp.dataset.c;
    const changes = [];
    text.split("\n").forEach((line, i) => line.split("\t").forEach((v, j) => {
      const target = table.querySelector(`input.cin[data-r="${r0 + i}"][data-c="${c0 + j}"]`);
      if (target) changes.push({ employeeCode: target.closest("tr").dataset.emp, day: target.dataset.day, value: v.trim() });
    }));
    if (changes.length) tsSave(changes, `${plural(changes.length, "cell")} pasted`);
  });

  table.addEventListener("click", (ev) => {
    const th = ev.target.closest("th.day");
    if (th) return tsDayMenu(th);
    const b = ev.target.closest(".row-menu");
    if (b) return tsRowMenu(b, b.closest("tr").dataset.emp);
    const dd = ev.target.closest("[data-dd]");
    if (dd) return tsOpenDeduction(dd, dd.closest("tr").dataset.emp);
  });

  table.addEventListener("contextmenu", (ev) => {
    const td = ev.target.closest("td.cell");
    if (!td || tsClosed()) return;
    ev.preventDefault();
    const inp = td.querySelector("input");
    tsCellMenu(td, inp.closest("tr").dataset.emp, inp.dataset.day);
  });
}

function tsDayMenu(th) {
  const g = TS.pkg.days[+th.dataset.c];
  const type = TS.pkg.record.days[g.day];
  const visible = tsVisible();
  const nh = TS.pkg.record.settings.normalHours;
  const closed = tsClosed();
  const a = openPop(th, `<div class="pop-head">${g.no} ${TS.pkg.name.split(" · ")[0]} · ${g.short}</div>
    <div class="opt-group">${["normal", "overtime", "holiday"].map((t) =>
      `<button class="sel ${t === type ? "active" : ""}" data-type="${t}" ${closed ? "disabled" : ""}>${DAY_TYPE_NAME[t]}</button>`).join("")}</div>
    ${closed ? `<div class="pop-note">The period is closed.</div>` : `
    <div class="pop-note">The actions below apply to the ${plural(visible.length, "person", "people")} shown.</div>
    <button class="pop-item" data-do="fill">Write ${plural(numText(nh), "hour")} in empty cells</button>
    <button class="pop-item" data-do="copy" ${+th.dataset.c === 0 ? "disabled" : ""}>Copy the previous day</button>
    <button class="pop-item danger" data-do="clear">Clear the column</button>`}`);
  a.querySelectorAll("[data-type]").forEach((b) => b.onclick = async () => {
    closePop();
    try { TS.pkg = await api(`/timesheet/${TS.pkg.period}/settings`, { method: "PUT", body: JSON.stringify({ days: { [g.day]: b.dataset.type } }) }); tsRenderGrid(); }
    catch (e) { toastError(e); }
  });
  const apply = (fn, message) => {
    closePop();
    const d = visible.map((s) => fn(s)).filter(Boolean);
    if (d.length) tsSave(d, message); else toast("No cells to change", "", "");
  };
  a.querySelector('[data-do="fill"]')?.addEventListener("click", () =>
    apply((s) => (!s.cells[g.day] ? { employeeCode: s.employeeCode, day: g.day, value: String(nh) } : null), "Empty cells filled"));
  a.querySelector('[data-do="copy"]')?.addEventListener("click", () => {
    const prev = TS.pkg.days[+th.dataset.c - 1].day;
    apply((s) => ((s.cells[prev] || "") !== (s.cells[g.day] || "") ? { employeeCode: s.employeeCode, day: g.day, value: s.cells[prev] || "" } : null), "Previous day copied");
  });
  a.querySelector('[data-do="clear"]')?.addEventListener("click", () =>
    apply((s) => (s.cells[g.day] ? { employeeCode: s.employeeCode, day: g.day, value: "" } : null), "Column cleared"));
}

function crewOptions(selected) {
  const codes = new Map(Object.entries(TS.pkg.record.crews).map(([k, e]) => [k, e.name]));
  for (const e of records("crews")) if (!codes.has(e.code)) codes.set(e.code, e.name);
  return [...codes].map(([k, name]) => `<option value="${esc(k)}" ${k === selected ? "selected" : ""}>${esc(`${k} — ${name}`)}</option>`).join("");
}

async function tsCrewDays(code, days, crew) {
  try {
    TS.pkg = await api(`/timesheet/${TS.pkg.period}/crew-days`, { method: "PUT", body: JSON.stringify({ employeeCode: code, days, crew }) });
    tsRefreshValues();
    toast("Crew assignment saved", `${plural(days.length, "day")} · ${crew || "own crew"}`, "good");
  } catch (e) { toastError(e); }
}

function tsCellMenu(td, code, day) {
  const s = tsRow(code);
  const g = TS.pkg.days.find((x) => x.day === day);
  const crew = s.crewDays[day] || s.crew;
  const a = openPop(td, `<div class="pop-head">${esc(s.name)} · ${g.no} ${g.short}</div>
    <div class="opt-group">${[["L", "Leave"], ["S", "Sick"], ["–", "Absent"], ["", "Clear"]].map(([v, name]) =>
      `<button class="sel" data-v="${v}">${v ? `<b>${v}</b> ` : ""}${name}</button>`).join("")}</div>
    <label class="pop-label">Crew on this day</label>
    <select data-crew><option value="">— ${esc(s.crew || "no crew")} (own crew)</option>${crewOptions(crew === s.crew ? "" : crew)}</select>
    <label class="check"><input type="checkbox" data-to-end> Apply until the end of the period</label>
    <button class="btn small primary" data-apply>Apply crew</button>`);
  a.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => {
    closePop();
    tsSave([{ employeeCode: code, day, value: b.dataset.v }]);
  });
  a.querySelector("[data-apply]").onclick = () => {
    const sel = a.querySelector("[data-crew]").value;
    const days = a.querySelector("[data-to-end]").checked ? TS.pkg.days.map((x) => x.day).filter((x) => x >= day) : [day];
    closePop();
    tsCrewDays(code, days, sel);
  };
}

function tsRowMenu(button, code) {
  const s = tsRow(code);
  const h = TS.pkg.calc.rows.find((x) => x.employeeCode === code);
  const nh = TS.pkg.record.settings.normalHours;
  const closed = tsClosed();
  const daySelect = (name) => `<select data-${name}>${TS.pkg.days.map((g) => `<option value="${g.day}">${g.no} ${g.short}</option>`).join("")}</select>`;
  const a = openPop(button, `<div class="pop-head">${esc(s.name)}</div>
    <div class="pop-note">${esc(s.payType ? `${s.payType} · ${numText(s.pay)} ${s.currency}` : "No pay entered")} — copied when the period was opened.
      ${h.hourlyValue ? `Hourly value ${numText(h.hourlyValue)} ${esc(h.currency)}.` : ""} ${s.rentShare ? `Rent share ${numText(s.rentShare)} ${esc(s.rentCurrency)}.` : ""}</div>
    ${h.warnings.map((u) => `<div class="pop-note warn">${esc(u)}</div>`).join("")}
    <a class="pop-item" href="#d/employees/${records("employees").find((x) => x.code === code)?._id || ""}">Open the employee card</a>
    ${closed ? "" : `
    <button class="pop-item" data-do="fill">Write ${plural(numText(nh), "hour")} in empty normal days</button>
    <button class="pop-item" data-do="crew">Change the crew for a date range…</button>
    <div class="range" hidden>
      <div class="pair-sm">${daySelect("from")}${daySelect("to")}</div>
      <select data-crew><option value="">— own crew (${esc(s.crew || "no crew")})</option>${crewOptions("")}</select>
      <button class="btn small primary" data-apply>Apply</button></div>
    <button class="pop-item danger" data-do="clear">Clear the row</button>
    <button class="pop-item danger" data-do="remove">Remove from the period</button>`}`);
  const on = (name, f) => a.querySelector(`[data-do="${name}"]`)?.addEventListener("click", f);
  on("fill", () => {
    closePop();
    const d = TS.pkg.days.filter((g) => TS.pkg.record.days[g.day] === "normal" && !s.cells[g.day])
      .map((g) => ({ employeeCode: code, day: g.day, value: String(nh) }));
    if (d.length) tsSave(d, `${plural(d.length, "day")} filled`); else toast("No empty normal days", "", "");
  });
  on("crew", () => {
    const ar = a.querySelector(".range");
    ar.hidden = false;
    ar.querySelector("[data-to]").value = TS.pkg.days.at(-1).day;
    ar.querySelector("[data-apply]").onclick = () => {
      const from = ar.querySelector("[data-from]").value, to = ar.querySelector("[data-to]").value;
      if (from > to) return toast("The date range is reversed", "The start day cannot be after the end day.", "error");
      const days = TS.pkg.days.map((g) => g.day).filter((g) => g >= from && g <= to);
      closePop();
      tsCrewDays(code, days, ar.querySelector("[data-crew]").value);
    };
  });
  on("clear", async () => {
    closePop();
    const d = Object.keys(s.cells).map((g) => ({ employeeCode: code, day: g, value: "" }));
    if (!d.length) return;
    if (await confirmBox("Clear this row?", `${plural(d.length, "cell")} entered for ${s.name} will be deleted.`, "Clear")) tsSave(d, "Row cleared");
  });
  on("remove", async () => {
    closePop();
    if (!(await confirmBox("Remove from the period?", `${s.name} will be removed from this period's timesheet. The employee record is not deleted.`, "Remove"))) return;
    try { TS.pkg = await api(`/timesheet/${TS.pkg.period}/row/${encodeURIComponent(code)}`, { method: "DELETE" }); tsRenderGrid(); }
    catch (e) { toastError(e); }
  });
}

/* --- side panel: statistics, overtime settings, calculator --- */

function tsRenderDrawer() {
  const c = main.querySelector(".drawer");
  if (!c) return;
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem("kadro-drawer-sections") || "[]"); } catch { /* ignore */ }
  const section = (id, name) => `<details data-s="${id}" ${closed.includes(id) ? "" : "open"}><summary>${name}</summary><div id="ts-${id}"></div></details>`;
  c.innerHTML = `<button class="drawer-tab" title="Open / close the panel"><span class="tab-arrow">${main.querySelector(".ts-layout").classList.contains("drawer-open") ? "›" : "‹"}</span><span>Panel</span></button>
    <div class="drawer-body">${section("stats", "Statistics")}${section("overtime", "Overtime Settings")}${section("calc", "Calculator")}</div>`;
  c.querySelector(".drawer-tab").onclick = () => {
    const d = main.querySelector(".ts-layout");
    const open = d.classList.toggle("drawer-open");
    try { localStorage.setItem("kadro-drawer", open ? "1" : "0"); } catch { /* ignore */ }
    c.querySelector(".tab-arrow").textContent = open ? "›" : "‹";
  };
  c.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
    const k = [...c.querySelectorAll("details:not([open])")].map((x) => x.dataset.s);
    try { localStorage.setItem("kadro-drawer-sections", JSON.stringify(k)); } catch { /* ignore */ }
  }));
  tsRenderOvertime();
  renderCalculator(c.querySelector("#ts-calc"));
  tsRefreshDrawer();
}

function tsRefreshDrawer() {
  const k = document.getElementById("ts-stats");
  if (!k || !TS.pkg?.calc) return;
  const { summary, crewSummary } = TS.pkg.calc;
  const row = (name, value, n, cls = "") =>
    `<div class="stat-row ${cls}"><span>${name}</span><b ${n !== undefined ? `data-value="${n}" title="Send to the calculator"` : ""}>${value}</b></div>`;
  const moneyRow = (name, t, cls) => {
    const p = Object.entries(t || {}).filter(([, v]) => v);
    if (!p.length) return row(name, "—");
    return p.map(([cur, v], i) => row(i ? "" : name, `${numText(v)} ${cur}`, v, cls)).join("");
  };
  const rates = TS.pkg.record.settings.rates || S.status?.rates;
  k.innerHTML = `
    ${row("Total hours worked", numText(summary.totalHours), summary.totalHours, "big")}
    ${row("Normal hours", numText(summary.normal), summary.normal)}
    ${row("Overtime hours", numText(summary.overtime), summary.overtime)}
    ${row("Short hours", numText(summary.short), summary.short, summary.short ? "bad" : "")}
    ${row("People / crews", `${summary.people} / ${summary.crews}`)}
    ${row("Person-days worked", numText(summary.workedDays), summary.workedDays)}
    ${row("Leave · sick · absent", `${summary.leave} · ${summary.sick} · ${plural(summary.absent, "day")}`)}
    <div class="stat-sep"></div>
    ${moneyRow("Earnings", summary.earnings)}
    ${moneyRow("Deductions", summary.deduction)}
    ${summary.rule >= 2 && Object.keys(summary.deduction).length ? `${moneyRow("· daily salary", summary.deductionSalary, "sub")}${moneyRow("· rent share", summary.deductionRent, "sub")}${moneyRow("· meals", summary.deductionMeals, "sub")}` : ""}
    ${moneyRow("Overtime pay", summary.overtimePay)}
    ${moneyRow("Advances", summary.advance)}
    ${moneyRow("Total to pay (net)", summary.net, "big")}
    ${baseEquivalent(summary.net, rates) ? row("", baseEquivalent(summary.net, rates), undefined, "sub") : ""}
    ${Object.keys(summary.monthEnd).length ? moneyRow("Due at month end", summary.monthEnd, "hl") : ""}
    <div class="stat-sep"></div>
    ${moneyRow("Meals", summary.meals)}
    ${moneyRow("Rent share", summary.rent)}
    ${summary.unpaid ? `<div class="pop-note warn">${plural(summary.unpaid, "person", "people")} have no pay entered; they are not in the earnings.</div>` : ""}
    ${crewSummary.length ? `<div class="stat-sub">By crew</div>${crewSummary.map((e) =>
      `<div class="stat-crew"><span><b>${esc(e.code)}</b> ${esc(e.name)}</span><span>${plural(e.personDays, "person-day")} · ${numText(e.hours)} h${Object.keys(e.meals).length ? ` · meals ${totalText(e.meals)}` : ""}</span></div>`).join("")}` : ""}`;
  k.querySelectorAll("[data-value]").forEach((b) => b.onclick = () => addToCalculator(b.dataset.value));
}

function tsRenderOvertime() {
  const k = document.getElementById("ts-overtime");
  if (!k) return;
  const { settings, days } = TS.pkg.record;
  const rule = TS.pkg.record.rule || 1;
  const closed = tsClosed();
  const dis = closed ? "disabled" : "";
  const rateMode = rule >= 2 && settings.overtimeMode !== "multiplier";
  const or = settings.overtimeRate || {};

  k.innerHTML = `
    ${rule >= 2 ? `
    <label class="ps-field"><span>Overtime calculation</span><select data-a="overtimeMode" ${dis}>
      <option value="rate" ${rateMode ? "selected" : ""}>Fixed hourly rate</option>
      <option value="multiplier" ${!rateMode ? "selected" : ""}>Hourly value × multiplier</option></select></label>
    ${rateMode ? ["EUR", "TRY", "RSD"].map((cur) => `<label class="ps-field"><span>Overtime rate · ${cur} / hour</span>
      <input type="number" step="0.01" min="0" data-or="${cur}" value="${or[cur] ?? ""}" placeholder="not entered" ${dis}></label>`).join("")
      : `<label class="ps-field"><span>Overtime multiplier</span><input type="number" step="0.05" min="1" max="5" data-a="overtimeMultiplier" value="${settings.overtimeMultiplier}" ${dis}></label>`}
    ${rateMode ? `<div class="ps-note">If a personal overtime rate is entered on the employee card, that one is used. The rate belongs to this period; the next period takes it over from here.</div>` : ""}
    ` : `<label class="ps-field"><span>Overtime multiplier</span><input type="number" step="0.05" min="1" max="5" data-a="overtimeMultiplier" value="${settings.overtimeMultiplier}" ${dis}></label>`}
    <label class="ps-field"><span>Normal day (hours)</span><input type="number" step="0.5" min="1" max="24" data-a="normalHours" value="${settings.normalHours}" ${dis}></label>
    <label class="check"><input type="checkbox" data-a="weekdayExcess" ${settings.weekdayExcess ? "checked" : ""} ${dis}> Hours above ${numText(settings.normalHours)} on a normal day count as overtime</label>
    <label class="check"><input type="checkbox" data-a="holidayAsOvertime" ${settings.holidayAsOvertime ? "checked" : ""} ${dis}> Hours worked on a holiday (Sunday etc.) count as overtime</label>
    ${rule >= 2 ? `<label class="check"><input type="checkbox" data-a="deductShortHours" ${settings.deductShortHours ? "checked" : ""} ${dis}> Also deduct short hours entered for monthly staff (e.g. 5 hours instead of 8)</label>
    <div class="ps-note"><b>Deductions:</b> only days marked <b>–</b> (absent) are deducted. Monthly staff lose the daily salary (salary × 12 ÷ 365) + the daily rent share + daily meals,
      hourly staff the rent share + meals. Empty cells, leave, sick days and days before starting work cause no deduction.</div>`
    : `<div class="ps-rule">This period was opened with the <b>old calculation rules</b>: overtime by multiplier, deductions as short hours × hourly value, empty past days count as short.
      ${closed ? "The period is closed; its figures do not change." : `<button class="btn small primary" data-do="rule">Move to the new rules</button>`}</div>`}
    ${rule === 2 ? `<div class="ps-rule">This period was opened <b>without currency conversion</b>: meals, rent and advances in a currency other than the salary's are not deducted from pay.
      ${closed ? "The period is closed; its figures do not change." : `<button class="btn small primary" data-do="rule">Move to the new rules</button>`}</div>` : ""}
    ${rule >= 3 ? `<div class="ps-note"><b>Rates (this period):</b> ${esc(ratesText(settings.rates))}. Meals, rent and advances in a currency other than the salary's are converted at these rates and deducted.
      ${!closed && S.status?.rates && !ratesEqual(S.status.rates, settings.rates)
        ? `<br>The current rates in Settings differ (${esc(ratesText(S.status.rates))}). <button class="btn small" data-do="takeRates">Use the current rates</button>` : ""}</div>` : ""}
    <div class="ps-note">All hours on an overtime day are overtime. Click a day header in the calendar to change its type.</div>
    ${closed ? `<div class="ps-note">The period is closed; the settings are locked.</div>` : `
    <div class="ps-buttons">
      <button class="btn small" data-dt="sat">Saturdays overtime</button>
      <button class="btn small" data-dt="sun">Sundays holiday</button>
      <button class="btn small" data-dt="reset">Back to default</button>
    </div>`}
    <div class="ps-note">This period: ${Object.values(days).filter((t) => t === "normal").length} normal, ${Object.values(days).filter((t) => t === "overtime").length} overtime, ${Object.values(days).filter((t) => t === "holiday").length} holiday days · workdays in the month ${TS.pkg.calc.monthWorkdays}.</div>`;

  const save = async (body) => {
    try { TS.pkg = await api(`/timesheet/${TS.pkg.period}/settings`, { method: "PUT", body: JSON.stringify(body) }); return true; }
    catch (e) { toastError(e); return false; }
  };
  k.querySelectorAll("[data-a]").forEach((g) => g.addEventListener("change", async () => {
    const v = g.type === "checkbox" ? g.checked : g.value;
    if (await save({ settings: { [g.dataset.a]: v } })) { tsRefreshValues(); tsRenderOvertime(); toast("Overtime setting saved", "", "good"); }
  }));
  k.querySelectorAll("[data-or]").forEach((g) => g.addEventListener("change", async () => {
    if (await save({ settings: { overtimeRate: { [g.dataset.or]: g.value } } })) {
      tsRefreshValues(); tsRenderOvertime(); toast("Overtime rate saved", `${g.dataset.or}: ${g.value || "removed"}`, "good");
    }
  }));
  k.querySelector('[data-do="rule"]')?.addEventListener("click", async () => {
    const ok = await confirmBox("Move the period to the new rules?",
      "Overtime is paid at a fixed hourly rate; only days marked \"–\" (absent) are deducted (daily salary + rent share + meals); " +
      "empty days and days before starting work cause no deduction; the meal allowance is counted in advance for every day of the period; " +
      "meals, rent and advances in a currency other than the salary's are converted at the rates in Settings and deducted. This cannot be undone.", "Move to the new rules");
    if (ok && await save({ upgradeRule: true })) { tsRenderGrid(); tsRenderOvertime(); toast("The period now uses the new rules", "Check the overtime rates in the panel.", "good"); }
  });
  k.querySelector('[data-do="takeRates"]')?.addEventListener("click", async () => {
    if (await save({ settings: { rates: "current" } })) { tsRefreshValues(); tsRenderOvertime(); toast("The period's rates were updated", ratesText(TS.pkg.record.settings.rates), "good"); }
  });
  k.querySelectorAll("[data-dt]").forEach((b) => b.onclick = async () => {
    const next = {};
    for (const g of TS.pkg.days) {
      if (b.dataset.dt === "sat" && g.short === "Sa") next[g.day] = "overtime";
      if (b.dataset.dt === "sun" && g.short === "Su") next[g.day] = "holiday";
      if (b.dataset.dt === "reset") next[g.day] = g.short === "Sa" ? "overtime" : g.short === "Su" ? "holiday" : "normal";
    }
    if (await save({ days: next })) { tsRenderGrid(); tsRenderOvertime(); }
  });
}

/* --- calculator --- */

function renderCalculator(box) {
  if (!box) return;
  box.innerHTML = `<input class="calc-screen" placeholder="0" spellcheck="false">
    <div class="calc-result"></div>
    <div class="calc-keys">${["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "⌫", "="]
      .map((t) => `<button class="${/[0-9.]/.test(t) ? "" : "op"} ${t === "=" ? "eq" : ""}">${t}</button>`).join("")}</div>
    <div class="ps-note">Click a value in the statistics to add it here.</div>`;
  const screen = box.querySelector(".calc-screen");
  const result = box.querySelector(".calc-result");
  const calculate = () => {
    const expr = screen.value.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, "").replace(/\s/g, "");
    if (!expr) return;
    if (!/^[\d+\-*/().]+$/.test(expr)) { result.textContent = "invalid expression"; return; }
    try {
      const v = Function(`"use strict";return (${expr})`)();
      if (!Number.isFinite(v)) throw new Error();
      result.textContent = `${screen.value} =`;
      screen.value = String(Math.round(v * 10000) / 10000);
    } catch { result.textContent = "invalid expression"; }
  };
  box.querySelectorAll(".calc-keys button").forEach((b) => b.onclick = () => {
    const t = b.textContent;
    if (t === "C") { screen.value = ""; result.textContent = ""; }
    else if (t === "⌫") screen.value = screen.value.slice(0, -1);
    else if (t === "=") calculate();
    else screen.value += t;
    screen.focus();
  });
  screen.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); calculate(); } });
}

function addToCalculator(value) {
  const screen = document.querySelector(".calc-screen");
  if (!screen) return;
  const d = document.querySelector('details[data-s="calc"]');
  if (d) d.open = true;
  const n = String(value);
  screen.value = /[\d.)]$/.test(screen.value) ? `${screen.value}+${n}` : screen.value + n;
  screen.focus();
}

/* ---------------- EMPLOYEE STATISTICS ---------------- */

const ST = { from: null, to: null, tab: "people" };

async function renderStatistics() {
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  const periods = await api("/timesheets");
  const year = String(new Date().getFullYear());
  if (ST.from === null) {
    const thisYear = periods.filter((d) => d.period.startsWith(year));
    ST.from = thisYear[0]?.period || ""; ST.to = thisYear.at(-1)?.period || "";
  }
  const v = await api(`/statistics?from=${encodeURIComponent(ST.from)}&to=${encodeURIComponent(ST.to)}`);

  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head"><div><h2>Employee Statistics</h2>
    <p>Collected from the timesheet periods; people are matched by employee code. In the project view, hours and amounts
      go to the project of the crew the person worked in on that day.</p></div></div>`));

  const options = (selected, blank) => `<option value="">${blank}</option>` +
    periods.map((d) => `<option value="${d.period}" ${d.period === selected ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const tools = el(`<div class="ts-filter">
    <label class="small-label">From <select data-i="from">${options(ST.from, "From the start")}</select></label>
    <label class="small-label">To <select data-i="to">${options(ST.to, "To the end")}</select></label>
    <button class="btn small" data-h="year">This year</button>
    <button class="btn small" data-h="all">All</button>
    <div class="tabs">
      <button class="tab ${ST.tab === "people" ? "active" : ""}" data-s="people">Employees · ${v.people.length}</button>
      <button class="tab ${ST.tab === "projects" ? "active" : ""}" data-s="projects">Projects · ${v.projects.length}</button>
    </div></div>`);
  tools.querySelectorAll("[data-i]").forEach((s) => s.onchange = () => { ST[s.dataset.i] = s.value; renderStatistics(); });
  tools.querySelector('[data-h="year"]').onclick = () => {
    const b = periods.filter((d) => d.period.startsWith(year));
    ST.from = b[0]?.period || ""; ST.to = b.at(-1)?.period || ""; renderStatistics();
  };
  tools.querySelector('[data-h="all"]').onclick = () => { ST.from = ""; ST.to = ""; renderStatistics(); };
  tools.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { ST.tab = b.dataset.s; renderStatistics(); });
  main.appendChild(tools);

  if (!v.periods.length) {
    main.appendChild(el(`<div class="card"><div class="empty"><div class="big">No timesheet periods in this range</div>
      <p>Open a period on the <a href="#timesheet">Timesheets</a> page and the statistics build up here as hours are entered.</p></div></div>`));
    return;
  }

  const sum = (list, field) => list.reduce((a, x) => {
    if (typeof x[field] === "number") return (a || 0) + x[field];
    const t = { ...(a || {}) }; for (const [cur, n] of Object.entries(x[field] || {})) t[cur] = (t[cur] || 0) + n; return t;
  }, null);
  const L = ST.tab === "people" ? v.people : v.projects;
  main.appendChild(el(`<div>${metrics([
    [String(v.periods.length), "Periods", `${v.periods[0].name.split(" · ")[0]} → ${v.periods.at(-1).name.split(" · ")[0]}`],
    [numText(sum(v.people, "hours")), "Total hours"],
    [numText(sum(v.people, "overtime")), "Overtime hours"],
    [numText(sum(v.people, "short")), "Short hours"],
    [totalText(sum(v.people, "earnings")), "Earnings"],
    [totalText(sum(v.people, "meals")), "Meals"],
    [totalText(sum(v.people, "rent")), "Rent share"],
  ])}</div>`));

  const columns = ST.tab === "people" ? [
    ["Employee", (k) => `<a href="${k._id ? `#d/employees/${k._id}` : "#t/employees"}"><b>${esc(k.name)}</b></a><div class="muted mono">${esc(k.employeeCode)}</div>`],
    ["Periods", (k) => k.periodCount, "periodCount"],
    ["Hours", (k) => numText(k.hours), "hours"],
    ["Normal", (k) => numText(k.normal), "normal"],
    ["Overtime", (k) => numText(k.overtime), "overtime"],
    ["Short", (k) => numText(k.short), "short"],
    ["Leave/Sick/Absent", (k) => `${k.leave} / ${k.sick} / ${k.absent}`],
    ["Earnings", (k) => totalText(k.earnings), "earnings"],
    ["Deduction", (k) => `<span title="${esc(`Salary: ${totalText(k.deductionSalary)}\nRent: ${totalText(k.deductionRent)}\nMeals: ${totalText(k.deductionMeals)}`)}">${totalText(k.deduction)}</span>`, "deduction"],
    ["Advance", (k) => totalText(k.advance), "advance"],
    ["Net", (k) => `<b>${totalText(k.net)}</b>`, "net"],
    ["Meals", (k) => totalText(k.meals), "meals"],
    ["Rent", (k) => totalText(k.rent), "rent"],
    ["Projects", (k) => esc(k.projects.map((p) => p.name).join(", ") || "—")],
  ] : [
    ["Project", (p) => `<b>${esc(p.name)}</b>`],
    ["People", (p) => p.people],
    ["Hours", (p) => numText(p.hours), "hours"],
    ["Normal", (p) => numText(p.normal), "normal"],
    ["Overtime", (p) => numText(p.overtime), "overtime"],
    ["Short", (p) => numText(p.short), "short"],
    ["Salary (earnings)", (p) => totalText(p.earnings), "earnings"],
    ["Meals", (p) => totalText(p.meals), "meals"],
    ["Rent", (p) => totalText(p.rent), "rent"],
    ["Total Cost", (p) => `<b>${totalText(sum([{ t: p.earnings }, { t: p.meals }, { t: p.rent }], "t"))}</b>`],
  ];
  const table = el(`<div class="table-wrap"><table class="mini stat-table"><thead><tr>${columns.map(([b]) => `<th>${b}</th>`).join("")}</tr></thead>
    <tbody>${L.map((x) => `<tr>${columns.map(([, f]) => `<td>${f(x)}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${columns.map(([, , field], i) => {
      if (i === 0) return `<td><b>Total</b></td>`;
      if (!field) return `<td></td>`;
      const t = sum(L, field);
      return `<td><b>${typeof t === "number" ? numText(t) : totalText(t)}</b></td>`;
    }).join("")}</tr></tfoot></table></div>`);
  main.appendChild(table);
}

/* ---------------- CASH ---------------- */

const CS = { month: "", tab: "moves", report: { type: "month", year: new Date().getFullYear(), project: "", selected: null } };
const CUR_ORDER = ["EUR", "TRY", "RSD"];
const REPORT_TYPES = [["period", "15 days"], ["month", "Monthly"], ["quarter", "Quarterly"], ["half", "Half-yearly"], ["year", "Yearly"], ["project", "Project"]];

/** The currencies used in the totals, in EUR / TRY / RSD order. */
function currencyList(...totals) {
  const v = new Set(totals.flatMap((t) => Object.keys(t || {}).filter((k) => t[k])));
  return CUR_ORDER.filter((k) => v.has(k)).concat([...v].filter((k) => !CUR_ORDER.includes(k)));
}

/** One line per currency in a cell. */
const curCell = (t, cls = "") => {
  const curs = currencyList(t);
  return curs.length
    ? curs.map((cur) => `<div class="cur-row ${cls} ${t[cur] < 0 ? "neg" : ""}"><span>${numText(t[cur])}</span><small>${cur}</small></div>`).join("")
    : `<span class="muted">—</span>`;
};

const cashSyncText = (r) => [
  r.added ? `${r.added} new rows` : "", r.updated ? `${plural(r.updated, "row")} updated` : "",
  r.deleted ? `${plural(r.deleted, "row")} removed` : "",
].filter(Boolean).join(", ") || "No changes.";

/** Carry / income / expense / balance box: one row per currency. */
function cashSummaryHtml(z, { carryLabel = "Carried over", balanceLabel = "Balance", net = false } = {}) {
  const curs = currencyList(z.carry, z.income, z.expense, z.balance);
  if (!curs.length) return `<div class="list-empty">No movements or carry-over in this range.</div>`;
  return `<table class="mini cash-sum"><thead><tr><th></th><th>${carryLabel}</th><th>Income</th><th>Expense</th>${net ? "<th>Net</th>" : ""}<th>${balanceLabel}</th></tr></thead>
    <tbody>${curs.map((cur) => `<tr><td class="cur">${cur}</td>
      <td>${numText(z.carry[cur] || 0)}</td>
      <td class="income">${z.income[cur] ? "+" + numText(z.income[cur]) : "—"}</td>
      <td class="expense">${z.expense[cur] ? "−" + numText(z.expense[cur]) : "—"}</td>
      ${net ? `<td class="${(z.net[cur] || 0) < 0 ? "neg" : ""}">${numText(z.net[cur] || 0)}</td>` : ""}
      <td class="balance ${(z.balance[cur] || 0) < 0 ? "neg" : ""}"><b>${numText(z.balance[cur] || 0)}</b></td></tr>`).join("")}
      ${baseRowHtml([z.carry, z.income, z.expense, ...(net ? [z.net] : []), z.balance])}</tbody></table>`;
}

async function renderCash(arg) {
  if (arg === "report") CS.tab = "report";
  else { CS.tab = "moves"; CS.month = arg || CS.month || "current"; }
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;

  const head = el(`<div class="page-head"><div><h2>Cash</h2>
    <p>Income and expenses. The system writes the advance, meal, rent and salary rows itself. No currency conversion is done; each currency is totalled separately.</p></div>
    <div class="head-tools"></div></div>`);
  const tabs = el(`<div class="tabs" style="margin-left:0">
    <button class="tab ${CS.tab === "moves" ? "active" : ""}" data-s="moves">Movements</button>
    <button class="tab ${CS.tab === "report" ? "active" : ""}" data-s="report">Reports</button></div>`);
  tabs.querySelector('[data-s="moves"]').onclick = () => { location.hash = `#cash/${CS.month && CS.month !== "current" ? CS.month : ""}`.replace(/\/$/, ""); };
  tabs.querySelector('[data-s="report"]').onclick = () => { location.hash = "#cash/report"; };

  if (CS.tab === "report") return renderCashReport(head, tabs);

  await loadSources();
  const v = await api(`/cash/${CS.month}`);
  CS.month = v.month;
  main.innerHTML = "";
  main.appendChild(head);
  head.querySelector(".head-tools").innerHTML = `
    <button class="btn" data-do="excel">Export to Excel</button>
    <button class="btn" data-do="income">+ Income</button>
    <button class="btn primary" data-do="expense">+ Expense</button>`;

  const tools = el(`<div class="ts-filter cash-tools">
    <div class="month-nav">
      <a class="btn small" href="#cash/${v.previous}" title="Previous month">‹</a>
      <b>${esc(v.name)}</b>
      <a class="btn small" href="#cash/${v.next}" title="Next month">›</a>
      ${v.month !== v.current ? `<a class="btn small" href="#cash/${v.current}">This month</a>` : ""}
    </div></div>`);
  tools.appendChild(tabs);
  main.appendChild(tools);

  const sumCard = card(`${v.name} · Summary`, `<span class="mono muted">${plural(v.rows.length, "movement")}</span>`);
  sumCard.classList.add("cash-sum-card");
  const drawSummary = (z) => { sumCard.querySelector(".card-body").innerHTML = cashSummaryHtml(z, { carryLabel: "Carried over (earlier months)", balanceLabel: "Month-end balance" }); };
  drawSummary(v.summary);
  main.appendChild(sumCard);

  const notes = [];
  notes.push(`Monthly file: <span class="mono">${esc(v.file)}</span> — updated on every change to the cash book.`);
  if (v.fileError) notes.push(`<span class="bad">${esc(v.fileError)}</span>`);
  if (v.deleted.length) {
    notes.push(`${v.deleted.length} automatic rows were deleted by hand this month; the system does not write them.
      <button class="btn small" data-do="restore">Bring back</button>`);
  }
  const noteBox = el(`<div class="hint-box cash-note">${notes.map((n) => `<div>${n}</div>`).join("")}</div>`);
  main.appendChild(noteBox);

  const search = el(`<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
    <div class="search"><input placeholder="Search the cash book (description, category, project…)" value="${esc(tableState.cash?.filter || "")}"></div>
    <span id="rowCount" style="font-family:var(--f-mono);font-size:11px;color:var(--muted)"></span>
    <span class="cash-legend"><span class="spill auto">Automatic</span> written by the system
      <span class="spill edited">Corrected by hand</span> the system won't overwrite it; click to go back</span>
  </div>`);
  main.appendChild(search);
  const wrap = el(`<div class="table-wrap"><table class="grid cash-grid"><thead></thead><tbody></tbody></table></div>`);
  main.appendChild(wrap);

  const refreshSummary = async () => {
    try { const y = await api(`/cash/${CS.month}`); drawSummary(y.summary); } catch { /* ignore */ }
  };
  tableState.cash = { def: v.def, rows: v.rows, filter: tableState.cash?.filter || "", onSaved: refreshSummary };
  search.querySelector("input").oninput = (ev) => { tableState.cash.filter = ev.target.value; renderGrid("cash"); };
  renderGrid("cash");

  const add = (type) => {
    const today = todayText();
    tableState.cash.rows.unshift({
      _id: null, _new: true, type, currency: "EUR", recurring: "No",
      date: today.startsWith(CS.month) ? today : `${CS.month}-01`,
      category: type === "Income" ? "Progress billing / Invoice" : "",
    });
    renderGrid("cash");
    wrap.querySelector('tbody tr.new input[data-k="description"]')?.focus();
  };
  head.querySelector('[data-do="income"]').onclick = () => add("Income");
  head.querySelector('[data-do="expense"]').onclick = () => add("Expense");
  head.querySelector('[data-do="excel"]').onclick = () => { location.href = `/api/cash/${CS.month}/excel`; };
  noteBox.querySelector('[data-do="restore"]')?.addEventListener("click", async () => {
    try {
      const r = await api(`/cash/${CS.month}/restore`, { method: "POST" });
      toast("Automatic rows brought back", cashSyncText(r), "good");
      renderCash(CS.month);
    } catch (e) { toastError(e); }
  });

  // Clicking the "Corrected by hand" label takes the row back to the system's figure.
  wrap.querySelector("tbody").addEventListener("click", async (ev) => {
    const p = ev.target.closest("[data-revert]");
    if (!p) return;
    const row = tableState.cash.rows.find((x) => x._id === p.dataset.revert);
    const ok = await confirmBox("Go back to the system's figure?",
      `The correction made by hand on this row is removed and the system's figure is written: ${row?.systemAmount || "—"}.` +
      (row?.systemAmount === "source deleted" ? " Its source was deleted, so the row will be removed from the cash book." : ""), "Hand back to the system");
    if (!ok) return;
    try {
      await api(`/cash/row/${p.dataset.revert}/system`, { method: "POST" });
      toast("The row is back on the system's figure", "", "good");
      renderCash(CS.month);
    } catch (e) { toastError(e); }
  });
}

async function renderCashReport(head, tabs) {
  const R = CS.report;
  await loadSources();
  const q = new URLSearchParams({ type: R.type, year: R.year, project: R.type === "project" ? "" : R.project });
  const r = await api(`/cash/report?${q}`);
  main.innerHTML = "";
  main.appendChild(head);
  head.querySelector(".head-tools").innerHTML = `<button class="btn" data-do="excel">Export the report to Excel</button>`;
  head.querySelector('[data-do="excel"]').onclick = () => { location.href = `/api/cash/report/excel?${q}`; };

  const projects = records("projects");
  const tools = el(`<div class="ts-filter cash-tools">
    <div class="tabs report-types" style="margin-left:0">${REPORT_TYPES.map(([k, b]) =>
      `<button class="tab ${R.type === k ? "active" : ""}" data-t="${k}">${b}</button>`).join("")}</div>
    ${R.type === "year" ? "" : `<label class="small-label">Year <select data-r="year">${r.years.map((y) =>
      `<option ${y === r.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>`}
    ${R.type === "project" ? "" : `<label class="small-label">Project <select data-r="project">
      <option value="">All projects</option><option value="-" ${R.project === "-" ? "selected" : ""}>No project</option>
      ${projects.map((p) => `<option value="${esc(p.code)}" ${R.project === p.code ? "selected" : ""}>${esc(recordLabel(p))}</option>`).join("")}
    </select></label>`}
  </div>`);
  tools.appendChild(tabs);
  tabs.style.marginLeft = "auto";
  main.appendChild(tools);
  tools.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { R.type = b.dataset.t; R.selected = null; renderCash("report"); });
  tools.querySelectorAll("[data-r]").forEach((s) => s.onchange = () => {
    R[s.dataset.r] = s.dataset.r === "year" ? Number(s.value) : s.value; R.selected = null; renderCash("report");
  });

  const scope = R.type === "year" ? "All years" : String(r.year);
  const totalCard = card(`Total · ${scope} · ${r.projectName}`);
  totalCard.querySelector(".card-body").innerHTML = cashSummaryHtml(r.total,
    { carryLabel: R.type === "year" ? "Carried over" : "Carried in at year start", balanceLabel: R.type === "year" ? "Balance" : "Year-end balance", net: true });
  main.appendChild(totalCard);

  const first = R.type === "project" ? "Project" : "Period";
  const table = el(`<div class="table-wrap cash-report-wrap"><table class="mini stat-table cash-report"><thead><tr>
    <th>${first}</th><th>Carried over</th><th>Income</th><th>Expense</th><th>Net</th><th>Balance</th><th>Movements</th></tr></thead>
    <tbody>${r.buckets.map((k) => `<tr data-a="${esc(k.key)}" class="${k.count ? "" : "empty-bucket"} ${R.selected === k.key ? "selected" : ""}">
      <td><b>${esc(k.name)}</b>${R.type === "month" ? ` <a class="go" href="#cash/${k.key}" title="This month's movements">↗</a>` : ""}</td>
      <td>${curCell(k.carry)}</td><td>${curCell(k.income, "income")}</td><td>${curCell(k.expense, "expense")}</td>
      <td>${curCell(k.net)}</td><td>${curCell(k.balance, "balance")}</td><td class="muted">${k.count || "—"}</td></tr>`).join("")}
    </tbody></table></div>`);
  main.appendChild(table);

  const split = el(`<div class="cash-split"></div>`);
  main.appendChild(split);
  const drawSplit = () => {
    const k = r.buckets.find((x) => x.key === R.selected);
    const z = k || r.total;
    const title = k ? k.name : `${scope} total`;
    split.innerHTML = "";

    const kk = card(`By category · ${title}`, k ? `<button class="btn small" data-do="clear">Back to the total</button>` : `<span class="muted mono">click a row for that period</span>`);
    const largest = {};
    for (const c of z.categories) for (const [cur, t] of Object.entries(c.amount)) largest[`${c.type}|${cur}`] = Math.max(largest[`${c.type}|${cur}`] || 0, t);
    kk.querySelector(".card-body").innerHTML = z.categories.length ? z.categories.map((c) => `
      <div class="cat-row"><span class="spill ${c.type === "Income" ? "income" : "expense"}">${c.type}</span><span class="name">${esc(c.category)}</span>
        <div class="cat-amount">${currencyList(c.amount).map((cur) => `<div class="cat-bar"><b class="track">
          <i style="width:${Math.max(2, Math.round(100 * c.amount[cur] / largest[`${c.type}|${cur}`]))}%" class="${c.type === "Income" ? "income" : "expense"}"></i></b>
          <span>${numText(c.amount[cur])} <small>${cur}</small></span></div>`).join("")}</div></div>`).join("")
      : `<div class="list-empty">No movements in this range.</div>`;
    kk.querySelector('[data-do="clear"]')?.addEventListener("click", () => { R.selected = null; table.querySelectorAll("tr.selected").forEach((t) => t.classList.remove("selected")); drawSplit(); });
    split.appendChild(kk);

    if (R.type !== "project") {
      const pk = card(`By project · ${title}`);
      pk.querySelector(".card-body").innerHTML = z.projects.length ? `<table class="mini"><thead><tr><th>Project</th><th>Income</th><th>Expense</th><th>Net</th></tr></thead>
        <tbody>${z.projects.map((p) => `<tr><td>${esc(p.name)}</td><td>${curCell(p.income, "income")}</td><td>${curCell(p.expense, "expense")}</td><td>${curCell(p.net)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="list-empty">No movements in this range.</div>`;
      split.appendChild(pk);
    }
  };
  table.querySelector("tbody").addEventListener("click", (ev) => {
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest("tr[data-a]");
    if (!tr) return;
    R.selected = R.selected === tr.dataset.a ? null : tr.dataset.a;
    table.querySelectorAll("tr.selected").forEach((t) => t.classList.remove("selected"));
    if (R.selected) tr.classList.add("selected");
    drawSplit();
  });
  drawSplit();
}

/* ---------------- FORECAST ---------------- */

const FC = { from: "", count: 24, project: "", cur: "", selected: null, data: null, focus: null, scroll: null };

/** Shifts a period id by n periods (client side; the same as adjacentPeriod on the server). */
function shiftPeriod(period, n) {
  let [y, a, h] = period.split("-").map(Number);
  let i = (y * 12 + (a - 1)) * 2 + (h - 1) + n;
  y = Math.floor(i / 24); i -= y * 24;
  return `${y}-${String(Math.floor(i / 2) + 1).padStart(2, "0")}-${(i % 2) + 1}`;
}

async function renderForecast() {
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  await loadSources();
  const q = new URLSearchParams({ from: FC.from, count: FC.count, project: FC.project });
  const v = await api(`/forecast?${q}`);
  FC.data = v; FC.from = v.from;
  renderForecastPage();
}

function renderForecastPage() {
  const v = FC.data;
  if (!v.currencies.includes(FC.cur)) FC.cur = v.currencies[0];
  const scroll = main.querySelector(".fc-wrap")?.scrollLeft;
  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head"><div><h2>Forecast</h2>
    <p>Past periods show what actually happened, future periods show the estimate. Type an amount into an estimate cell to correct it;
      empty the cell to go back to the system's figure. There is no currency conversion; each currency has its own tab.</p></div>
    <div class="head-tools"><button class="btn" data-do="excel">Export to Excel</button></div></div>`));

  const projects = records("projects");
  const tools = el(`<div class="ts-filter fc-tools">
    <button class="btn small" data-k="-6" title="6 periods back">‹‹ 3 months</button>
    <button class="btn small" data-k="today">Today</button>
    <button class="btn small" data-k="6" title="6 periods forward">3 months ››</button>
    <label class="small-label">Project <select data-i="project">
      <option value="">All projects</option><option value="-" ${FC.project === "-" ? "selected" : ""}>No project</option>
      ${projects.map((p) => `<option value="${esc(p.code)}" ${FC.project === p.code ? "selected" : ""}>${esc(recordLabel(p))}</option>`).join("")}
    </select></label>
    <div class="tabs">${v.currencies.map((cur) => `<button class="tab ${cur === FC.cur ? "active" : ""}" data-cur="${cur}">${cur}</button>`).join("")}</div>
  </div>`);
  main.appendChild(tools);
  tools.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => {
    FC.from = b.dataset.k === "today" ? "" : shiftPeriod(FC.from, Number(b.dataset.k));
    FC.selected = null; FC.scroll = b.dataset.k === "today" ? null : "keep"; renderForecast();
  });
  tools.querySelector('[data-i="project"]').onchange = (ev) => { FC.project = ev.target.value; FC.selected = null; FC.scroll = "keep"; renderForecast(); };
  tools.querySelectorAll("[data-cur]").forEach((b) => b.onclick = () => { FC.cur = b.dataset.cur; FC.scroll = "keep"; renderForecastPage(); });
  main.querySelector('[data-do="excel"]').onclick = () => {
    location.href = `/api/forecast/excel?${new URLSearchParams({ from: v.from, count: v.count, project: v.project })}`;
  };

  // Summary of the next 6 estimate periods.
  const cur = FC.cur;
  const ahead = v.columns.filter((s) => s.state === "estimate").slice(0, 6);
  const sumAhead = (t) => ahead.reduce((a, s) => a + (t[s.period]?.[cur] || 0), 0);
  const notes = [];
  if (!v.info.closedPeriods) notes.push("No timesheet period has been closed yet, so the overtime estimate shows zero.");
  else if (v.info.closedPeriods < v.info.overtimeSamples) notes.push(`The overtime estimate is the average of ${v.info.closedPeriods} closed periods (at most ${plural(v.info.overtimeSamples, "period")} are used).`);
  if (v.info.unpaid) notes.push(`${plural(v.info.unpaid, "person", "people")} have no pay information; they are not in the salary estimate.`);
  main.appendChild(el(`<div>${metrics(ahead.length ? [
    [`${numText(sumAhead(v.totals.expense))}`, `Expense estimate · ${cur}`, `${ahead[0].name.split(" · ")[0]} → ${ahead.at(-1).name.split(" · ")[0]} (${plural(ahead.length, "period")})`],
    [`${numText(sumAhead(v.totals.income))}`, `Income estimate · ${cur}`],
    [`${numText(sumAhead(v.totals.net))}`, `Net · ${cur}`],
    [`${numText(v.totals.balance[ahead.at(-1).period]?.[cur] || 0)}`, `Cash balance · ${cur}`, `at the end of ${ahead.at(-1).name.split(" · ")[0]}`],
  ] : [["—", "No estimate periods", "Scroll the table forward"]])}</div>`));
  if (notes.length) main.appendChild(el(`<div class="hint-box">${notes.map(esc).join("<br>")}</div>`));

  // Table
  const months = [];
  for (const s of v.columns) { if (months.at(-1)?.month === s.month) months.at(-1).n += 1; else months.push({ month: s.month, n: 1 }); }
  const cls = (s) => `${s.state === "actual" ? "actual" : "est"} ${s.current ? "current" : ""} ${s.half === 1 ? "month-start" : ""}`;
  const value = (k, s) => v.values[k][s.period]?.[cur];
  const cell = (row, s) => {
    const d = value(row.key, s);
    const sel = FC.selected?.k === row.key && FC.selected?.period === s.period ? "selected" : "";
    if (s.state === "actual") {
      return `<td class="${cls(s)} ${sel}" data-k="${row.key}" data-d="${s.period}">${d?.value ? numText(d.value) : `<span class="muted">—</span>`}</td>`;
    }
    const hint = d?.manual ? `Corrected by hand. The system's figure: ${numText(d.system)} ${cur}` : "";
    return `<td class="${cls(s)} ${sel} ${d?.manual ? "manual" : ""}" data-k="${row.key}" data-d="${s.period}" ${hint ? `title="${esc(hint)}"` : ""}>
      <input inputmode="decimal" data-raw="${d?.value ?? ""}" value="${d?.value ? numText(d.value) : ""}" placeholder="—"></td>`;
  };
  const totalRow = (name, t, rowCls, k) => `<tr class="${rowCls}"><th>${name}</th>${v.columns.map((s) => {
    const n = t[s.period]?.[cur] || 0;
    const sel = FC.selected?.k === k && FC.selected?.period === s.period ? "selected" : "";
    return `<td class="${cls(s)} ${sel} ${n < 0 ? "neg" : ""}" data-k="${k}" data-d="${s.period}">${n ? numText(n) : `<span class="muted">—</span>`}</td>`;
  }).join("")}</tr>`;
  const expenses = v.rows.filter((r) => r.kind === "expense");
  const table = el(`<div class="fc-wrap"><table class="fc">
    <thead>
      <tr class="fc-month"><th rowspan="2" class="corner">${esc(v.projectName)}<small>${cur}</small></th>${months.map((a) => `<th colspan="${a.n}">${esc(a.month)}</th>`).join("")}</tr>
      <tr class="fc-half">${v.columns.map((s) => `<th class="${cls(s)}">${s.range}<small>${s.current ? "this period" : s.state === "actual" ? "actual" : "estimate"}</small></th>`).join("")}</tr>
    </thead>
    <tbody>
      <tr class="group"><th colspan="${v.columns.length + 1}"><span>Expenses</span></th></tr>
      ${expenses.map((r) => `<tr data-row="${r.key}"><th>${esc(r.name)}</th>${v.columns.map((s) => cell(r, s)).join("")}</tr>`).join("")}
      ${totalRow("Total expenses", v.totals.expense, "total", "_expense")}
      <tr class="group"><th colspan="${v.columns.length + 1}"><span>Income</span></th></tr>
      <tr data-row="income"><th>Income</th>${v.columns.map((s) => cell(v.rows.find((x) => x.key === "income"), s)).join("")}</tr>
      ${totalRow("Net (income − expenses)", v.totals.net, "total", "_net")}
      ${totalRow("Cash balance", v.totals.balance, "balance", "_balance")}
    </tbody></table></div>`);
  main.appendChild(table);

  const detail = el(`<div class="card fc-detail"></div>`);
  main.appendChild(detail);
  renderForecastDetail(detail);

  // Scrolling: on first open the current period is in view; while navigating the old position is kept.
  const wrap = table;
  if (FC.scroll === "keep" && scroll !== undefined) wrap.scrollLeft = scroll;
  else {
    const now = wrap.querySelector("th.current");
    if (now) wrap.scrollLeft = Math.max(0, now.offsetLeft - wrap.querySelector("th.corner").offsetWidth - 2 * now.offsetWidth);
  }
  FC.scroll = null;

  const select = (k, period) => {
    FC.selected = { k, period };
    wrap.querySelectorAll("td.selected").forEach((t) => t.classList.remove("selected"));
    wrap.querySelector(`td[data-k="${k}"][data-d="${period}"]`)?.classList.add("selected");
    renderForecastDetail(detail);
  };
  wrap.addEventListener("click", (ev) => { const td = ev.target.closest("td[data-k]"); if (td) select(td.dataset.k, td.dataset.d); });

  const inputs = [...wrap.querySelectorAll("td input")];
  for (const inp of inputs) {
    const td = inp.closest("td");
    inp.addEventListener("focus", () => { inp.value = inp.dataset.raw || ""; inp.select(); select(td.dataset.k, td.dataset.d); });
    inp.addEventListener("blur", () => {
      if (inp.dataset.changed) return;
      inp.value = inp.dataset.raw ? numText(inp.dataset.raw) : "";
    });
    inp.addEventListener("input", () => { inp.dataset.changed = "1"; });
    inp.addEventListener("keydown", (ev) => {
      const rows = [...wrap.querySelectorAll("tr[data-row]")];
      const r = rows.indexOf(inp.closest("tr"));
      const target = (dr, dd) => {
        const tr = rows[r + dr];
        const period = dd ? shiftPeriod(td.dataset.d, dd) : td.dataset.d;
        return tr?.querySelector(`td[data-d="${period}"] input`);
      };
      let h = null;
      if (ev.key === "Enter" || ev.key === "ArrowDown") h = target(1, 0);
      else if (ev.key === "ArrowUp") h = target(-1, 0);
      else if (ev.key === "ArrowRight" && inp.selectionStart === inp.value.length) h = target(0, 1);
      else if (ev.key === "ArrowLeft" && inp.selectionStart === 0) h = target(0, -1);
      else if (ev.key === "Escape") { delete inp.dataset.changed; inp.blur(); return; }
      else return;
      ev.preventDefault();
      if (h) h.focus(); else inp.blur();
    });
    inp.addEventListener("change", () => saveForecastCell(inp, td));
  }
}

async function saveForecastCell(inp, td) {
  const v = FC.data;
  try {
    // The server accepts "1,500.25", "1500.25" and "1500,25".
    FC.data = await api("/forecast/cell", {
      method: "PUT",
      body: JSON.stringify({ period: td.dataset.d, row: td.dataset.k, currency: FC.cur, project: v.project, value: inp.value.trim(), view: { from: v.from, count: v.count, project: v.project } }),
    });
    // Focus may have moved to another cell while saving; it goes back there after the redraw.
    const next = document.activeElement?.closest?.("td[data-k]");
    FC.focus = next && next !== td ? { k: next.dataset.k, d: next.dataset.d } : null;
    FC.scroll = "keep";
    renderForecastPage();
    if (FC.focus) main.querySelector(`td[data-k="${FC.focus.k}"][data-d="${FC.focus.d}"] input`)?.focus();
  } catch (e) {
    toastError(e);
    delete inp.dataset.changed;
    inp.value = inp.dataset.raw ? numText(inp.dataset.raw) : "";
  }
}

function renderForecastDetail(box) {
  const v = FC.data, cur = FC.cur, s = FC.selected;
  const col = s && v.columns.find((x) => x.period === s.period);
  if (!col) {
    box.innerHTML = `<div class="card-head"><h3>Cell detail</h3></div>
      <div class="card-body fc-sources">${v.rows.map((r) => `<div><b>${esc(r.name)}</b>
        <span><i>actual:</i> ${esc(r.actual)}</span><span><i>estimate:</i> ${esc(r.estimate)}</span></div>`).join("")}
        <div><b>Cash balance</b><span><i>actual:</i> the period-end balance in the cash book</span><span><i>estimate:</i> the previous balance + the estimated net</span></div>
        <p class="muted">Click a cell to see which person, crew, house or cash row it comes from.</p></div>`;
    return;
  }
  const def = v.rows.find((r) => r.key === s.k);
  const name = def?.name || { _expense: "Total expenses", _net: "Net", _balance: "Cash balance" }[s.k];
  const d = v.values[s.k]?.[s.period]?.[cur];
  const source = def ? (col.state === "actual" ? def.actual : def.estimate) : "";
  let body;
  if (!def) {
    const t = { _expense: v.totals.expense, _net: v.totals.net, _balance: v.totals.balance }[s.k][s.period]?.[cur] || 0;
    const parts = s.k === "_expense" ? v.rows.filter((r) => r.kind === "expense").map((r) => [r.name, v.values[r.key][s.period]?.[cur]?.value || 0])
      : s.k === "_net" ? [["Income", v.totals.income[s.period]?.[cur] || 0], ["Expenses", -(v.totals.expense[s.period]?.[cur] || 0)]]
        : [[col.state === "actual" ? "Period-end balance in the cash book" : "Previous balance + estimated net", t]];
    body = `<table class="mini">${parts.map(([a, n]) => `<tr><td>${esc(a)}</td><td class="ta-right">${numText(n)} ${cur}</td></tr>`).join("")}
      <tr class="total"><td><b>Total</b></td><td class="ta-right"><b>${numText(t)} ${cur}</b></td></tr></table>`;
  } else {
    const list = d?.detail || [];
    body = `${d?.manual ? `<div class="fc-manual">Corrected by hand: <b>${numText(d.value)} ${cur}</b>. The system's figure: <b>${numText(d.system)} ${cur}</b>
        <button class="btn small" data-do="system">Back to the system's figure</button></div>` : ""}
      ${list.length ? `<table class="mini">${list.slice(0, 40).map((x) => `<tr><td>${esc(x.name)}</td><td class="ta-right">${numText(x.amount)} ${cur}</td></tr>`).join("")}
        ${list.length > 40 ? `<tr><td class="muted">… ${list.length - 40} more items</td><td></td></tr>` : ""}
        <tr class="total"><td><b>The system's figure</b></td><td class="ta-right"><b>${numText(d.system)} ${cur}</b></td></tr></table>`
        : `<div class="list-empty">No ${cur} data feeds into this cell.</div>`}`;
  }
  box.innerHTML = `<div class="card-head"><h3>${esc(name)} · ${esc(col.name)}</h3>
    <div class="right"><span class="spill ${col.state === "actual" ? "manual" : "auto"}">${col.state === "actual" ? "actual" : "estimate"}</span>
    <button class="btn small" data-do="close">Close</button></div></div>
    <div class="card-body">${source ? `<p class="muted fc-source">${esc(source)}</p>` : ""}${body}</div>`;
  box.querySelector('[data-do="close"]').onclick = () => {
    FC.selected = null; main.querySelectorAll(".fc td.selected").forEach((t) => t.classList.remove("selected")); renderForecastDetail(box);
  };
  box.querySelector('[data-do="system"]')?.addEventListener("click", async () => {
    try {
      FC.data = await api("/forecast/cell", {
        method: "PUT",
        body: JSON.stringify({ period: s.period, row: s.k, currency: cur, project: v.project, value: "", view: { from: v.from, count: v.count, project: v.project } }),
      });
      toast("Back on the system's figure", "", "good");
      FC.scroll = "keep"; renderForecastPage();
    } catch (e) { toastError(e); }
  });
}

/* ---------------- PAYMENTS ---------------- */

const PY = { month: "", date: {} };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDate = (g) => {
  const d = new Date(`${g}T00:00:00`);
  return `${d.getDate()} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()]} ${d.getFullYear()} · ${DAY_NAMES[d.getDay()]}`;
};
const shortDate = (g) => (g ? g.split("-").reverse().join("/") : "");

/** The short line under a payment item: where the figure comes from. */
function paymentDetailText(k) {
  const d = k.detail || {};
  if (k.type === "meals") return `${plural(d.days, "day")} × ${numText(d.daily)} ${k.currency} (in advance)`;
  if (k.type === "rent") return `${d.people ? `${plural(d.people, "person", "people")} live there` : "house empty"} · rent ${numText(d.rent)} ${k.currency} (${(d.period || "Monthly").toLowerCase()})`;
  if (k.type === "hourly" || k.type === "monthly") {
    const dd = d.deductionDetail || {};
    const p = [`earnings ${numText(d.earnings)}`];
    if (d.overtimePay) p.push(`overtime ${numText(d.overtime)} h = ${numText(d.overtimePay)}`);
    if (d.deduction) p.push(`deduction −${numText(d.deduction)}${d.absent ? ` (${plural(d.absent, "day")} absent: salary ${numText(dd.salary + dd.shortHours)}, rent ${numText(dd.rent)}, meals ${numText(dd.meals)})` : ""}`);
    if (d.advance) p.push(`advance −${numText(d.advance)}`);
    if (k.type === "monthly" && d.firstHalf !== null && d.firstHalf !== undefined) p.push(`includes the 1st-half net ${numText(d.firstHalf)}`);
    return p.join(" · ");
  }
  return "";
}

async function renderPayments(month) {
  PY.month = month || PY.month || "current";
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  await loadSources();
  const v = await api(`/payments/${PY.month}`);
  PY.month = v.month;
  const today = todayText();
  const employeeId = new Map(records("employees").map((p) => [p.code, p._id]));
  const houseId = new Map(records("houses").map((e) => [e.code, e._id]));

  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head"><div><h2>Payments</h2>
    <p>Who gets paid, when and how much. Rents and monthly salaries on the 1st of the month, hourly wages and meal allowances (in advance) every 15 days.
      An item marked "paid" goes into the cash book as an expense on the payment date. The amount paid may differ from the calculated one.</p></div></div>`));

  const tools = el(`<div class="ts-filter cash-tools"><div class="month-nav">
    <a class="btn small" href="#payments/${v.previous}" title="Previous month">‹</a><b>${esc(v.name)}</b>
    <a class="btn small" href="#payments/${v.next}" title="Next month">›</a>
    ${v.month !== v.current ? `<a class="btn small" href="#payments/${v.current}">This month</a>` : ""}</div></div>`);
  main.appendChild(tools);

  if (v.overdue.count) {
    main.appendChild(el(`<div class="pay-warn">There are <b>${v.overdue.count} unpaid items</b> from earlier months.
      <a class="btn small" href="#payments/${v.overdue.oldest.slice(0, 7)}">Go to the oldest (${shortDate(v.overdue.oldest)})</a></div>`));
  }

  const curs = currencyList(v.summary.total, v.summary.paid);
  const sumCard = card(`${v.name} · Summary`, `<span class="mono muted">${v.summary.paidCount} / ${plural(v.summary.count, "item")} paid</span>`);
  sumCard.querySelector(".card-body").innerHTML = curs.length
    ? `<table class="mini cash-sum"><thead><tr><th></th><th>To pay (calculated)</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>
      ${curs.map((cur) => `<tr><td class="cur">${cur}</td><td>${numText(v.summary.total[cur] || 0)}</td>
        <td class="income">${numText(v.summary.paid[cur] || 0)}</td><td class="balance ${v.summary.remaining[cur] ? "neg" : ""}"><b>${numText(v.summary.remaining[cur] || 0)}</b></td></tr>`).join("")}
      ${baseRowHtml([v.summary.total, v.summary.paid, v.summary.remaining])}
      </tbody></table>`
    : emptyRow("No payments fall due this month. Payments appear as timesheet periods are opened and closed.");
  main.appendChild(sumCard);

  for (const g of v.days) {
    const dayCard = el(`<div class="card pay-day ${g.past ? "past" : ""}">
      <div class="card-head"><h3>${esc(longDate(g.due))}</h3><div class="right">
        ${g.summary.paidCount < g.summary.count && g.due < today ? `<span class="spill expense">overdue</span>` : ""}
        <span class="mono muted">${g.summary.paidCount}/${g.summary.count} paid · remaining ${totalText(g.summary.remaining)}</span></div></div>
      <div class="card-body"></div></div>`);
    main.appendChild(dayCard);
    const body = dayCard.querySelector(".card-body");

    for (const gr of g.groups) {
      const key = `${g.due}|${gr.type}`;
      const date = PY.date[key] || (g.due < today ? today : g.due);
      const pending = gr.items.filter((k) => !k.paid);
      const grEl = el(`<div class="pay-group">
        <div class="pay-group-head"><b>${esc(gr.name)}</b>
          <span class="muted">${gr.summary.paidCount}/${gr.summary.count} paid · total ${totalText(gr.summary.total)}</span>
          <label class="small-label">Payment date <input type="date" class="pay-date" value="${date}"></label>
          <button class="btn small primary" data-do="all" ${pending.length ? "" : "disabled"}>All paid${pending.length ? ` (${pending.length})` : ""}</button>
        </div>
        <div class="table-wrap pay-wrap"><table class="mini pay-table"><thead><tr>
          <th class="pay-check">Paid</th><th>${gr.type === "rent" ? "House" : "Person"}</th><th>Description</th><th class="r">Calculated</th>
          <th class="r">Paid</th><th>Note</th><th>Status</th></tr></thead><tbody></tbody></table></div></div>`);
      body.appendChild(grEl);
      const tbody = grEl.querySelector("tbody");
      const dateInput = grEl.querySelector(".pay-date");
      dateInput.onchange = () => { PY.date[key] = dateInput.value; };

      for (const k of gr.items) {
        const o = k.payment;
        const link = k.employeeCode && employeeId.get(k.employeeCode) ? `#d/employees/${employeeId.get(k.employeeCode)}`
          : k.houseCode && houseId.get(k.houseCode) ? `#d/houses/${houseId.get(k.houseCode)}` : "";
        const diff = o && o.amount !== o.systemAmount ? o.amount - o.systemAmount : 0;
        const flags = [
          k.warning ? `<span class="spill edited" title="${esc(k.warning)}">check</span>` : "",
          k.changed !== null && k.changed !== undefined ? `<span class="spill edited" title="The calculation changed after payment">calculation changed: ${numText(k.changed)}</span>` : "",
          k.noSource ? `<span class="spill manual" title="The period was reopened or the record changed; the payment record stays">no source</span>` : "",
        ].join(" ");
        const tr = el(`<table><tr class="${k.paid ? "paid" : ""}" data-a="${esc(k.key)}">
          <td class="pay-check"><input type="checkbox" ${k.paid ? "checked" : ""}></td>
          <td>${link ? `<a href="${link}">${esc(k.who)}</a>` : esc(k.who)}</td>
          <td>${esc(k.description)}<div class="pay-detail">${esc(paymentDetailText(k))}</div></td>
          <td class="r mono">${numText(k.amount)} ${esc(k.currency)}</td>
          <td class="r"><input class="pay-amount" type="number" step="0.01" min="0" value="${o ? o.amount : k.amount}">
            ${diff ? `<div class="pay-diff ${diff < 0 ? "neg" : ""}">${diff > 0 ? "+" : ""}${numText(diff)}</div>` : ""}</td>
          <td><input class="pay-note" placeholder="e.g. in cash, rounded" value="${esc(o?.note || "")}"></td>
          <td class="pay-state">${o ? `<span class="spill income">paid ${shortDate(o.date)}</span>` : `<span class="spill ${k.due < today ? "expense" : ""}">pending</span>`} ${flags}</td>
        </tr></table>`).querySelector("tr");
        tbody.appendChild(tr);

        const save = async (onDate) => {
          try {
            await api("/payments", { method: "POST", body: JSON.stringify({ list: [{
              key: k.key, date: onDate, amount: tr.querySelector(".pay-amount").value, note: tr.querySelector(".pay-note").value,
            }] }) });
            await loadStatus(); renderNav();
            return true;
          } catch (e) { toastError(e); return false; }
        };
        const box = tr.querySelector("input[type=checkbox]");
        box.onchange = async () => {
          if (box.checked) {
            if (await save(dateInput.value)) { toast("Paid", `${k.who} · ${numText(tr.querySelector(".pay-amount").value)} ${k.currency} written to the cash book as an expense.`, "good"); renderPayments(PY.month); }
            else box.checked = false;
            return;
          }
          const ok = await confirmBox("Remove the paid mark?", `${k.who} · ${k.description}. The expense row in the cash book is deleted as well.`, "Remove");
          if (!ok) { box.checked = true; return; }
          try {
            await api("/payments/undo", { method: "POST", body: JSON.stringify({ key: k.key }) });
            toast("Paid mark removed", "", "good");
            await loadStatus(); renderNav(); renderPayments(PY.month);
          } catch (e) { toastError(e); box.checked = true; }
        };
        // When the amount or note of a paid item changes, the record (and its cash row) is updated.
        for (const sel of [".pay-amount", ".pay-note"]) {
          tr.querySelector(sel).onchange = async () => {
            if (!k.paid) return;
            if (await save(o.date)) { toast("Payment updated", "The cash row was updated too.", "good"); renderPayments(PY.month); }
          };
        }
      }

      grEl.querySelector('[data-do="all"]').onclick = async () => {
        const amounts = {};
        for (const k of pending) {
          const tr = tbody.querySelector(`tr[data-a="${CSS.escape(k.key)}"]`);
          const t = Number(tr.querySelector(".pay-amount").value) || 0;
          amounts[k.currency] = (amounts[k.currency] || 0) + t;
        }
        const ok = await confirmBox(`${gr.name}: all paid?`,
          `${plural(pending.length, "item")} will be marked paid on ${shortDate(dateInput.value)}: ${totalText(amounts)}. Each goes into the cash book as an expense.`, "All paid");
        if (!ok) return;
        try {
          const list = pending.map((k) => {
            const tr = tbody.querySelector(`tr[data-a="${CSS.escape(k.key)}"]`);
            return { key: k.key, date: dateInput.value, amount: tr.querySelector(".pay-amount").value, note: tr.querySelector(".pay-note").value };
          });
          const r = await api("/payments", { method: "POST", body: JSON.stringify({ list }) });
          toast("All paid", `${plural(r.count, "item")} written to the cash book as expenses.`, "good");
          await loadStatus(); renderNav(); renderPayments(PY.month);
        } catch (e) { toastError(e); }
      };
    }
  }

  if (!v.days.length) {
    main.appendChild(el(`<div class="card"><div class="empty"><div class="big">No payment days this month</div>
      <p>Meal allowances and rents are listed here once a timesheet period is opened, salaries once it is closed.</p></div></div>`));
  }
}

/* ---------------- SETTINGS ---------------- */

function renderSettings() {
  const d = S.status;
  main.innerHTML = "";
  main.appendChild(el(`<div class="page-head">
    <div><h2>Settings</h2><p>Where documents are written and how the AI layer works.</p></div>
  </div>`));

  const modes = [
    ["hybrid", "Rules + AI", "File-name rules run first. If the rules are not sure enough, the document is sent to Claude. The most balanced option for everyday use."],
    ["aiOnly", "AI only", "Every document goes to Claude. The most accurate result, the highest cost."],
    ["rulesOnly", "Rules only", "No document leaves the computer, no internet needed, free. Accuracy drops if file names are messy."],
  ];

  const box = el(`<div class="card"><div class="settings">

    <div class="set-row">
      <div class="label">Document root<small>The main folder all folders are created in. Can be a network drive.</small></div>
      <div><input type="text" id="setRoot" value="${esc(d.documentRoot)}">
        <div class="hint">If you change it the old folders are not moved — you need to build the structure again in the new root.</div></div>
    </div>

    <div class="set-row">
      <div class="label">AI mode<small>How documents are classified.</small></div>
      <div class="choice-group" id="setMode">
        ${modes.map(([v, b, a]) => `<label class="choice ${d.aiMode === v ? "selected" : ""}">
          <input type="radio" name="aimode" value="${v}" ${d.aiMode === v ? "checked" : ""}>
          <span><span class="big">${b}</span><span class="desc">${a}</span></span></label>`).join("")}
      </div>
    </div>

    <div class="set-row">
      <div class="label">Claude API key<small>Needed for the AI layer. It never leaves this computer and is stored in data/db.json.</small></div>
      <div><input type="password" id="setKey" placeholder="${d.apiKeySet ? "•••••••• (saved; type a new key to change it)" : "sk-ant-..."}">
        <div class="hint">Now: <b>${d.apiKeySet ? `on — source: ${esc(d.apiKeySource)}` : "off"}</b>.
        Get a key at console.anthropic.com. Model used: claude-opus-5.</div></div>
    </div>

    <div class="set-row">
      <div class="label">Voice commands<small>Record timesheets, advances, cash and payments by speaking. The audio and the sentence go to the assistant server (n8n).</small></div>
      <div>
        <input type="text" id="setVaUrl" value="${esc(d.assistant?.url || "")}" placeholder="${esc(d.assistant?.defaultUrl || "https://n8n.example.com")} (can be left empty)" autocomplete="off">
        <input type="password" id="setVaKey" style="margin-top:6px" autocomplete="off"
          placeholder="${d.assistant?.keySet ? "•••••••• (saved; type a new key to change it)" : d.assistant?.embedded ? "built into the program — nothing to enter" : "assistant key"}">
        <div class="hint">Now: <b>${d.assistant?.ready ? "on" : "off"}</b>. ${d.assistant?.embedded ? "The key came with the program." : "The person who set up the system gives you the key."} If the address is empty the default server is used.
          The key stays on this computer and is not included in backups. Employee names and timesheet, advance, payment and cash summaries go to the assistant server;
          IBANs, phone numbers, passports and notes do not. To improve the assistant, the spoken command, the action it took and the
          outcome (approved / cancelled / undone) are logged on the server; audio is not stored.</div>
      </div>
    </div>

    <div class="set-row">
      <div class="label">AI threshold<small>If the rule engine's confidence is below this value, Claude steps in.</small></div>
      <div><input type="number" id="setThreshold" min="0" max="1" step="0.01" value="${d.threshold}">
        <div class="hint">Raise it and more documents go to Claude (more accurate, more expensive). Only applies in "Rules + AI" mode.</div></div>
    </div>

    <div class="set-row">
      <div class="label">User name<small>Written in the Document Register as the person who acted.</small></div>
      <div><input type="text" id="setUser" value="${esc(d.user)}"></div>
    </div>

    <div class="set-row">
      <div class="label">Currency and rates<small>Rates are entered by hand; nothing is fetched from the internet.</small></div>
      <div>
        <label class="rate-row"><span>Base currency</span><select id="setBase">${["EUR", "TRY", "RSD"].map((cur) =>
          `<option ${(d.rates?.base || "EUR") === cur ? "selected" : ""}>${cur}</option>`).join("")}</select></label>
        <div id="setRates"></div>
        <div class="hint">In timesheets, meals, rent and advances in a currency other than the salary's are converted at these rates and deducted from pay
          (e.g. 600 RSD ÷ 117 = 5.13 EUR). The "≈" row in Cash, Payments and timesheet summaries is the value in the base currency.<br>
          Newly opened timesheet periods copy the rates from here; an open period's rates change with "Use the current rates" in the timesheet panel.
          Closed periods and payments marked "paid" do not change.</div>
      </div>
    </div>

    <div class="set-row">
      <div class="label">Appearance<small>Dark and light theme.</small></div>
      <div><select id="setTheme">
        <option value="">Follow the system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select></div>
    </div>

    <div class="set-row">
      <div class="label">Data and backup<small>To move the records to another computer or keep a backup.</small></div>
      <div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="backupDownload">Download backup</button>
          <button class="btn" id="backupUpload">Restore from backup…</button>
          <input type="file" id="backupFile" accept=".json,application/json" hidden>
        </div>
        <div class="hint">A backup writes every record (employees, crews, timesheets, cash, forecast…) into a single <b>.json</b> file.
          On another computer, open it with "Restore from backup"; it replaces the records there, and the old ones are first saved in the
          <code style="font-family:var(--f-mono)">data/backups</code> folder. The API key is not included in the backup.<br>
          Documents (PDFs, photos) are not included either; copy this folder separately if needed:
          <code style="font-family:var(--f-mono)">${esc(d.documentRoot)}</code></div>
      </div>
    </div>

    <div class="set-row">
      <div class="label">Reset records<small>To get rid of test records and start clean.</small></div>
      <div>
        <button class="btn danger" id="resetAll">Delete all records…</button>
        <div class="hint">Employee, crew, project, house, vehicle, client, equipment, advance, timesheet, cash, payment and Document Register records are deleted.
          Settings (document root, rates, API key) stay. A backup is taken automatically before deleting
          (<code style="font-family:var(--f-mono)">data/backups</code>); if you delete by mistake, "Restore from backup" brings it back.</div>
      </div>
    </div>

  </div>
  <div class="card-head" style="border-top:1px solid var(--line);border-bottom:0">
    <div class="right" style="margin-left:0"><button class="btn primary" id="setSave">Save settings</button></div>
  </div></div>`);
  main.appendChild(box);

  const themeSelect = box.querySelector("#setTheme");
  try { themeSelect.value = localStorage.getItem("kadro-theme") || ""; } catch { /* no storage */ }
  themeSelect.onchange = () => {
    const v = themeSelect.value;
    try {
      if (v) { document.documentElement.setAttribute("data-theme", v); localStorage.setItem("kadro-theme", v); }
      else { document.documentElement.removeAttribute("data-theme"); localStorage.removeItem("kadro-theme"); }
    } catch { /* no storage */ }
  };

  box.querySelectorAll('input[name="aimode"]').forEach((r) => {
    r.onchange = () => box.querySelectorAll(".choice").forEach((o) => o.classList.toggle("selected", o.contains(r) && r.checked));
  });

  // Rates: 1 base = x of another. When the base currency changes, the rates entered are rewritten against the new base.
  const rateData = { base: d.rates?.base || "EUR", rate: { ...(d.rates?.rate || {}) } };
  const rateBox = box.querySelector("#setRates");
  const readRates = () => {
    for (const i of rateBox.querySelectorAll("[data-rate]")) {
      const n = Number(i.value);
      if (i.value.trim() && n > 0) rateData.rate[i.dataset.rate] = n; else delete rateData.rate[i.dataset.rate];
    }
  };
  const drawRates = () => {
    rateBox.innerHTML = ["EUR", "TRY", "RSD"].filter((cur) => cur !== rateData.base).map((cur) =>
      `<label class="rate-row"><span>1 ${rateData.base} =</span><input type="number" step="any" min="0" data-rate="${cur}" value="${rateData.rate[cur] ?? ""}" placeholder="not entered"><span>${cur}</span></label>`).join("");
  };
  drawRates();
  box.querySelector("#setBase").onchange = (ev) => {
    readRates();
    const next = ev.target.value;
    const o = { ...rateData.rate, [rateData.base]: 1 };
    const rate = {};
    if (o[next]) for (const [cur, v] of Object.entries(o)) if (cur !== next) rate[cur] = Number((v / o[next]).toPrecision(10));
    rateData.base = next; rateData.rate = rate;
    drawRates();
  };

  box.querySelector("#backupDownload").onclick = () => { location.href = "/api/backup"; };
  const backupFile = box.querySelector("#backupFile");
  box.querySelector("#backupUpload").onclick = () => backupFile.click();
  backupFile.onchange = async () => {
    const f = backupFile.files[0];
    backupFile.value = "";
    if (!f) return;
    const ok = await confirmBox("Restore from backup?",
      `"${f.name}" will be loaded. ALL records on this computer are REPLACED with those in the backup. ` +
      "The current records are saved in the data/backups folder first. The document root and API key stay as they are on this computer.", "Restore from backup");
    if (!ok) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await api("/backup", { method: "POST", body: fd });
      const z = r.counts;
      toast("Backup restored", `${plural(z.employees, "employee")}, ${plural(z.crews, "crew")}, ${plural(z.projects, "project")}, ${z.timesheets} timesheet periods, ${z.cash} cash rows. ` +
        `Previous records: ${r.previousBackup}`, "good");
      S.tree = null; S.targets = [];
      for (const k of Object.keys(tableState)) delete tableState[k];
      await loadStatus(); renderNav(); renderSettings();
    } catch (e) { toastError(e); }
  };

  box.querySelector("#resetAll").onclick = async () => {
    const choice = await resetModal();
    if (!choice) return;
    try {
      const r = await api("/reset", { method: "POST", body: JSON.stringify({ confirm: "DELETE", documents: choice.documents }) });
      toast("Records reset", `Backup of the previous records: ${r.backup}` +
        (r.oldRoot ? `. Old documents were set aside: ${r.oldRoot}` : ""), "good");
      S.tree = null; S.targets = [];
      for (const k of Object.keys(tableState)) delete tableState[k];
      await loadStatus(); renderNav(); renderSettings();
    } catch (e) { toastError(e); }
  };

  box.querySelector("#setSave").onclick = async (ev) => {
    ev.target.disabled = true;
    const next = {
      documentRoot: box.querySelector("#setRoot").value.trim(),
      aiMode: box.querySelector('input[name="aimode"]:checked')?.value || "hybrid",
      threshold: Number(box.querySelector("#setThreshold").value),
      user: box.querySelector("#setUser").value.trim() || "Manager",
    };
    readRates();
    next.rates = { base: rateData.base, rate: rateData.rate };
    const key = box.querySelector("#setKey").value.trim();
    if (key) next.apiKey = key;
    next.assistantUrl = box.querySelector("#setVaUrl").value.trim();
    const vaKey = box.querySelector("#setVaKey").value.trim();
    if (vaKey) next.assistantKey = vaKey;
    try {
      await api("/settings", { method: "POST", body: JSON.stringify(next) });
      toast("Settings saved", "", "good");
      S.tree = null; S.targets = [];
      await loadStatus(); renderHeader(); renderSettings();
    } catch (e) { toastError(e); }
    ev.target.disabled = false;
  };
}

/** Reset confirmation in two steps: 1) what will be deleted and the documents-folder choice, 2) confirm by typing "DELETE". Returns { documents } or null. */
function resetModal() {
  return new Promise((resolve) => {
    const s = S.status.counts;
    const p = el(`<div class="modal"><div class="modal-box">
      <div class="modal-head"><h3>Delete all records?</h3></div>
      <div class="modal-body">
        <div data-step="1">
          <p style="margin:0 0 10px">These records will be deleted: ${plural(s.employees, "employee")}, ${plural(s.crews, "crew")}, ${s.projects} active projects, ${s.houses} houses,
            ${s.vehicles} vehicles, ${s.clients} clients, ${s.advances} advances, ${s.cash} cash rows, ${s.documents} document records and every timesheet period.</p>
          <p style="margin:0 0 12px" class="muted">A backup is taken automatically before deleting. Settings (document root, rates, API key) stay.</p>
          <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" data-docs style="margin-top:3px;accent-color:var(--bad)">
            <span><b>Clear the documents folder too</b><br><span class="muted" style="font-size:12.5px">Documents are not deleted:
              the <code style="font-family:var(--f-mono)">${esc(S.status.documentRoot)}</code> folder is set aside as "(old date)"
              and an empty folder structure is built in its place. If you leave this unticked the documents stay as they are.</span></span>
          </label>
        </div>
        <div data-step="2" hidden>
          <p style="margin:0 0 10px">Last step. To confirm, type <b>DELETE</b> in capitals in the box.</p>
          <input type="text" data-typed autocomplete="off" style="width:100%;padding:8px 10px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);font-size:14px">
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Continue</button></div>
    </div></div>`);
    const close = (v) => { p.remove(); resolve(v); };
    const e = p.querySelector("[data-yes]"), typed = p.querySelector("[data-typed]");
    let step = 1;
    p.querySelector("[data-no]").onclick = () => close(null);
    p.onclick = (ev) => { if (ev.target === p) close(null); };
    typed.oninput = () => { e.disabled = typed.value.trim().toUpperCase() !== "DELETE"; };
    e.onclick = () => {
      if (step === 1) {
        step = 2;
        p.querySelector('[data-step="1"]').hidden = true;
        p.querySelector('[data-step="2"]').hidden = false;
        e.textContent = "Delete all records"; e.disabled = true; e.style.background = "var(--bad)"; e.style.borderColor = "var(--bad)";
        typed.focus();
        return;
      }
      close({ documents: p.querySelector("[data-docs]").checked });
    };
    document.getElementById("modalHost").appendChild(p);
    e.focus();
  });
}

/* ---------------- VOICE COMMANDS ---------------- */

// Speech → n8n (transcription + model) → confirmation cards. Nothing is written until Approve is pressed.
const VA = { conversationId: null, recorder: null, chunks: [], started: 0, timer: null, busy: false };
const MIC_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>`;

function setUpAssistantButton() {
  const d = el(`<button class="va-button" id="vaButton" title="Voice commands" aria-label="Voice commands">${MIC_SVG}</button>`);
  d.onclick = () => (document.getElementById("vaPanel") ? closeAssistant() : openAssistant());
  document.body.appendChild(d);
}

function closeAssistant() {
  if (VA.recorder?.state === "recording") VA.recorder.stop();
  document.getElementById("vaPanel")?.remove();
  document.getElementById("vaButton")?.classList.remove("open");
}

async function openAssistant() {
  const ready = S.status?.assistant?.ready;
  const p = el(`<aside class="va-panel" id="vaPanel" aria-label="Voice commands">
    <div class="va-head"><h3>Voice commands</h3>
      <button class="btn small" data-new title="Forget the previous conversation">New conversation</button>
      <button class="va-close" data-close aria-label="Close">×</button></div>
    <div class="va-flow" data-flow>
      ${ready ? `<div class="va-hint">Tap the microphone and speak, tap again when you are done. For example:<br>
        <i>"Cem was absent today, Tolga worked 10 hours"</i> · <i>"I gave Mehmet a 100 euro advance"</i> ·
        <i>"How much will Murat get this month?"</i><br>Nothing is written until you press <b>Approve</b>.</div>`
        : `<div class="va-hint">Voice commands are not switched on yet. Enter the key you were given under <a href="#settings">Settings</a> → Voice commands.</div>`}
    </div>
    <div class="va-foot">
      <button class="va-mic" data-mic ${ready ? "" : "disabled"}>${MIC_SVG}<span>Tap to speak</span></button>
      <form class="va-form" data-form><input type="text" data-text placeholder="or type…" autocomplete="off" ${ready ? "" : "disabled"}>
        <button class="btn" ${ready ? "" : "disabled"}>Send</button></form>
    </div>
    <details class="va-log" data-log><summary>Recent actions</summary><div data-log-list><div class="muted">Loading…</div></div></details>
  </aside>`);
  document.body.appendChild(p);
  document.getElementById("vaButton").classList.add("open");
  p.querySelector("[data-close]").onclick = closeAssistant;
  p.querySelector("[data-new]").onclick = () => {
    VA.conversationId = null;
    p.querySelector("[data-flow]").querySelectorAll(".va-bubble,.va-card,.va-reply").forEach((x) => x.remove());
  };
  p.querySelector("[data-mic]").onclick = () => (VA.recorder?.state === "recording" ? VA.recorder.stop() : startRecording());
  p.querySelector("[data-form]").onsubmit = (ev) => {
    ev.preventDefault();
    const i = p.querySelector("[data-text]");
    const m = i.value.trim();
    if (!m || VA.busy) return;
    i.value = "";
    sendCommand({ text: m });
  };
  p.querySelector("[data-log]").ontoggle = (ev) => { if (ev.target.open) renderAssistantLog(); };
  if (ready) p.querySelector("[data-text]").focus();
}

function addToFlow(node) {
  const flow = document.querySelector("#vaPanel [data-flow]");
  if (!flow) return null;
  flow.querySelector(".va-hint")?.remove();
  flow.appendChild(node);
  flow.scrollTop = flow.scrollHeight;
  return node;
}

async function startRecording() {
  if (VA.busy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    return toastError(new Error("This browser cannot reach the microphone. On a phone it has to be opened from an HTTPS address."));
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toastError(new Error("Microphone permission was not given. Allow the microphone from the browser's address bar.")); }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const k = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  VA.recorder = k; VA.chunks = []; VA.started = Date.now();
  const mic = document.querySelector("#vaPanel [data-mic]");
  const label = mic?.querySelector("span");
  mic?.classList.add("recording");
  VA.timer = setInterval(() => {
    const sec = Math.floor((Date.now() - VA.started) / 1000);
    if (label) label.textContent = `Listening… ${sec} s · tap when done`;
    if (sec >= 90) k.stop();   // short commands instead of long recordings
  }, 250);
  k.ondataavailable = (e) => { if (e.data.size) VA.chunks.push(e.data); };
  k.onstop = () => {
    clearInterval(VA.timer);
    stream.getTracks().forEach((t) => t.stop());
    mic?.classList.remove("recording");
    if (label) label.textContent = "Tap to speak";
    const duration = Date.now() - VA.started;
    const blob = new Blob(VA.chunks, { type: k.mimeType || "audio/webm" });
    if (duration < 700 || !blob.size) return;
    sendCommand({ audio: blob });
  };
  k.start(250);
}

async function sendCommand({ text, audio }) {
  VA.busy = true;
  const panel = document.getElementById("vaPanel");
  panel?.classList.add("busy");
  const bubble = addToFlow(el(`<div class="va-bubble">${text ? esc(text) : '<span class="muted">Transcribing the audio…</span>'}</div>`));
  const wait = addToFlow(el(`<div class="va-reply muted">Thinking…</div>`));
  try {
    let r;
    if (audio) {
      const fd = new FormData();
      const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", audio, `command.${ext}`);
      if (VA.conversationId) fd.append("conversationId", VA.conversationId);
      r = await api("/assistant/voice", { method: "POST", body: fd });
    } else {
      r = await api("/assistant/text", { method: "POST", body: JSON.stringify({ text, conversationId: VA.conversationId }) });
    }
    if (r.conversationId) VA.conversationId = r.conversationId;
    if (bubble) bubble.innerHTML = r.text ? esc(r.text) : '<span class="muted">(no speech heard)</span>';
    wait?.remove();
    addToFlow(el(`<div class="va-reply">${esc(r.reply)}</div>`));
    const cardNodes = r.cards.map((k) => addToFlow(cardHtml(k)));
    if (r.cards.length > 1) {
      const all = addToFlow(el(`<div class="va-all"><button class="btn primary">Approve all (${r.cards.length})</button></div>`));
      all.querySelector("button").onclick = async () => {
        all.remove();
        for (const d of cardNodes) { const b = d?.querySelector("[data-approve]"); if (b && !b.disabled) await approveCard(d); }
      };
    }
  } catch (e) {
    wait?.remove();
    if (bubble && audio) bubble.innerHTML = '<span class="muted">(the audio could not be sent)</span>';
    addToFlow(el(`<div class="va-reply error">${esc(e.message)}</div>`));
  } finally {
    VA.busy = false;
    panel?.classList.remove("busy");
  }
}

function cardHtml(k) {
  const d = el(`<div class="va-card" data-card="${esc(k.id)}">
    <div class="va-card-head">${esc(k.title)}</div>
    <ul>${k.lines.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${k.note ? `<div class="va-note">${esc(k.note)}</div>` : ""}
    <div class="va-card-foot"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-approve>Approve</button></div>
  </div>`);
  d.querySelector("[data-approve]").onclick = () => approveCard(d);
  d.querySelector("[data-cancel]").onclick = async () => {
    try { await api("/assistant/cancel", { method: "POST", body: JSON.stringify({ id: k.id }) }); } catch {}
    d.classList.add("done");
    d.querySelector(".va-card-foot").innerHTML = `<span class="muted">Cancelled</span>`;
  };
  return d;
}

async function approveCard(d) {
  const foot = d.querySelector(".va-card-foot");
  foot.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  try {
    const r = await api("/assistant/approve", { method: "POST", body: JSON.stringify({ id: d.dataset.card }) });
    d.classList.add("done", "good");
    foot.innerHTML = `<span class="va-ok">✓ Written</span><button class="btn small" data-undo>Undo</button>`;
    if (r.warning) foot.insertAdjacentHTML("beforebegin", `<div class="va-note">${esc(r.warning)}</div>`);
    foot.querySelector("[data-undo]").onclick = () => undoAction(r.record.id, foot);
    refreshBehind();
  } catch (e) {
    foot.innerHTML = `<span class="va-error">${esc(e.message)}</span>`;
  }
}

async function undoAction(id, box) {
  if (!(await confirmBox("Undo this action?", "The record written by the voice command goes back to how it was.", "Undo"))) return;
  try {
    await api("/assistant/undo", { method: "POST", body: JSON.stringify({ id }) });
    if (box) box.innerHTML = `<span class="muted">Undone</span>`;
    toast("Action undone", "", "good");
    refreshBehind();
    if (document.querySelector("#vaPanel [data-log]")?.open) renderAssistantLog();
  } catch (e) { toastError(e); }
}

/** Let the page behind the panel show the record that was written. */
function refreshBehind() {
  for (const k of Object.keys(tableState)) delete tableState[k];
  loadStatus().then(() => { renderNav(); route(); }).catch(() => {});
}

async function renderAssistantLog() {
  const box = document.querySelector("#vaPanel [data-log-list]");
  if (!box) return;
  try {
    const { log } = await api("/assistant");
    if (!log.length) { box.innerHTML = emptyRow("No action has been written by voice command yet."); return; }
    box.innerHTML = "";
    for (const g of log) {
      const z = new Date(g.date);
      const s = el(`<div class="va-log-item ${g.undoneAt ? "undone" : ""}">
        <div><b>${esc(g.title)}</b> <span class="muted">${z.toLocaleDateString("en-GB")} ${z.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ${esc(g.user)}</span></div>
        <div>${g.lines.map(esc).join("<br>")}</div>
        <div class="muted">"${esc(g.sentence)}"</div>
        <div class="va-log-foot">${g.undoneAt ? '<span class="muted">Undone</span>' : '<button class="btn small" data-undo>Undo</button>'}</div>
      </div>`);
      s.querySelector("[data-undo]")?.addEventListener("click", () => undoAction(g.id, s.querySelector(".va-log-foot")));
      box.appendChild(s);
    }
  } catch (e) { box.innerHTML = emptyRow(e.message); }
}

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && document.getElementById("vaPanel") && !document.querySelector("#modalHost .modal")) closeAssistant();
});

/* ---------------- routing ---------------- */

async function loadStatus() {
  S.status = await api("/status");
  try { S.warnings = await api("/warnings"); } catch { S.warnings = []; }
  renderHeader();
}

async function route() {
  const y = (location.hash || "#dashboard").slice(1);
  renderNav();
  try {
    if (y === "dashboard") await renderDashboard();
    else if (y === "tree") await renderTree();
    else if (y === "upload") await renderUpload();
    else if (y === "settings") renderSettings();
    else if (y.startsWith("t/")) {
      const name = y.slice(2);
      // Refresh the source tables for link columns on every visit (they may have changed on another page).
      await loadSources(name);
      await renderTable(name);
    } else if (y.startsWith("d/")) {
      const [, name, id] = y.split("/");
      await renderDetail(name, id);
    } else if (y === "timesheet" || y.startsWith("timesheet/")) {
      await renderTimesheet(y.split("/")[1] || "");
    } else if (y === "statistics") {
      await renderStatistics();
    } else if (y === "payments" || y.startsWith("payments/")) {
      await renderPayments(y.split("/")[1] || "");
    } else if (y.startsWith("employee/")) {
      const [, code, sel] = y.split("/");
      await renderEmployeeView(decodeURIComponent(code || ""), sel || "");
    } else if (y === "forecast") {
      await renderForecast();
    } else if (y === "cash" || y.startsWith("cash/")) {
      await renderCash(y.split("/")[1] || "");
    } else location.hash = "#dashboard";
  } catch (e) { toastError(e); }
}

window.addEventListener("hashchange", route);

(async function start() {
  try {
    const t = localStorage.getItem("kadro-theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch { /* no storage */ }
  setUpAssistantButton();
  try {
    await loadStatus();
    await route();
  } catch (e) {
    main.innerHTML = `<div class="empty"><div class="big">Could not reach the server</div>
      <p>Make sure the start.bat window is open, then reload the page.</p></div>`;
  }
})();
