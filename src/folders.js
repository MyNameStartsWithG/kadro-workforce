/**
 * Real folder operations on disk: building the structure, scanning the tree, filing documents.
 * Nothing is ever written outside the document root — every path is checked against it.
 */
import fs from "node:fs";
import path from "node:path";
import { flatTree, TEMPLATES, DYNAMIC_NAME, dynamicRoot } from "./structure.js";
import * as db from "./db.js";

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Turns a string into a valid Windows file or folder name. */
export function safeName(s) {
  const t = String(s || "").replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return t.slice(0, 120) || "Untitled";
}

/** Resolves a relative path and makes sure it stays inside the document root. */
export function fullPath(root, relative) {
  const raw = String(relative || "").split(/[/\\]/).filter(Boolean);
  // "." and ".." segments are not silently cleaned up — they are rejected.
  if (raw.some((p) => p === "." || p === "..")) {
    throw new Error(`Invalid folder path: "${relative}"`);
  }
  const parts = raw.map(safeName);
  const full = path.resolve(root, ...parts);
  const rootAbs = path.resolve(root);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
    throw new Error(`Path outside the document root rejected: ${relative}`);
  }
  return full;
}

function makeFolder(root, relative, report) {
  const p = fullPath(root, relative);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    report.created.push(relative);
  } else {
    report.existing += 1;
  }
  return p;
}

/** Folder path of a dynamic record (employee/project/vehicle/client/house). */
export function dynamicPath(type, row) {
  const root = dynamicRoot(type);
  if (!root) return null;
  const name = safeName(DYNAMIC_NAME[type](row));
  if (!name || name === "Untitled") return null;
  return `${root}/${name}`;
}

/** Creates the folder of one dynamic record and its template sub-folders. */
export function buildDynamicFolder(root, type, row) {
  const report = { created: [], existing: 0 };
  const base = dynamicPath(type, row);
  if (!base) return report;
  makeFolder(root, base, report);
  for (const sub of TEMPLATES[type] || []) {
    makeFolder(root, `${base}/${sub.c} ${sub.n}`, report);
  }
  return report;
}

/** Builds the whole static tree plus a folder for every dynamic record in the tables. */
export function buildStructure(root) {
  const report = { created: [], existing: 0, root };
  fs.mkdirSync(root, { recursive: true });

  for (const d of flatTree()) makeFolder(root, d.path, report);

  const sources = { employee: "employees", project: "projects", vehicle: "vehicles", client: "clients", house: "houses" };
  for (const [type, tableName] of Object.entries(sources)) {
    for (const row of db.table(tableName)) {
      const r = buildDynamicFolder(root, type, row);
      report.created.push(...r.created);
      report.existing += r.existing;
    }
  }

  // A placeholder is left in the Templates folder while its blank forms are missing.
  for (const d of flatTree()) {
    if (!d.files.length) continue;
    const dir = fullPath(root, d.path);
    const readme = path.join(dir, "_PUT-BLANK-FORMS-HERE.txt");
    // Sub-folders don't count; the placeholder is written only if there is no FILE at all.
    const hasFile = fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile());
    if (!fs.existsSync(readme) && !hasFile) {
      fs.writeFileSync(readme,
        `These blank forms belong in this folder:\r\n\r\n${d.files.map((f) => "  - " + f).join("\r\n")}\r\n\r\n` +
        `You can delete this file once the forms are in place.\r\n`, "utf8");
      report.created.push(`${d.path}/_PUT-BLANK-FORMS-HERE.txt`);
    }
  }
  return report;
}

/** Walks the disk and returns the real folder tree (with file counts). */
export function scanTree(root, maxDepth = 5) {
  const defined = new Map(flatTree().map((d) => [d.path, d]));

  const walk = (relative, depth) => {
    const full = fullPath(root, relative);
    let entries = [];
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { return null; }

    const folders = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => e.isFile());
    const def = defined.get(relative) || {};

    const node = {
      path: relative,
      name: path.basename(full),
      description: def.description || "",
      note: def.note || "",
      dynamic: def.dynamic || null,
      defined: defined.has(relative),
      fileCount: files.length,
      files: files.slice(0, 200).map((f) => {
        const st = fs.statSync(path.join(full, f.name));
        return { name: f.name, size: st.size, date: st.mtime.toISOString() };
      }),
      ch: [],
    };
    if (depth < maxDepth) {
      for (const f of folders) {
        const sub = walk(relative ? `${relative}/${f.name}` : f.name, depth + 1);
        if (sub) node.ch.push(sub);
      }
    } else if (folders.length) {
      node.more = folders.length;
    }
    node.totalFiles = node.fileCount + node.ch.reduce((a, c) => a + (c.totalFiles || 0), 0);
    return node;
  };

  if (!fs.existsSync(root)) return { notBuilt: true, ch: [] };
  const top = walk("", 0);
  return { notBuilt: false, root, ch: top ? top.ch : [], totalFiles: top?.totalFiles || 0 };
}

/** Finds a free name by appending " (2)", " (3)" on conflict. */
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = name, i = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem} (${i})${ext}`;
    i += 1;
    if (i > 999) throw new Error("Too many files with the same name.");
  }
  return candidate;
}

/** Moves an uploaded temp file into the target folder. Returns: { path, name, size, fullPath } */
export function placeFile(root, tempPath, targetFolder, newName) {
  const dir = fullPath(root, targetFolder);
  fs.mkdirSync(dir, { recursive: true });
  const name = freeName(dir, safeName(newName));
  const target = path.join(dir, name);
  try {
    fs.renameSync(tempPath, target);
  } catch {
    fs.copyFileSync(tempPath, target);
    fs.unlinkSync(tempPath);
  }
  const st = fs.statSync(target);
  return { path: `${targetFolder}/${name}`, name, size: st.size, fullPath: target };
}

/** Renames a record's folder when its name changes. */
export function renameFolder(root, type, oldRow, newRow) {
  const from = dynamicPath(type, oldRow);
  const to = dynamicPath(type, newRow);
  if (!from || !to || from === to) return null;
  const fromFull = fullPath(root, from);
  const toFull = fullPath(root, to);
  if (fs.existsSync(fromFull) && !fs.existsSync(toFull)) {
    fs.renameSync(fromFull, toFull);
    return { from, to };
  }
  return null;
}

/** Every folder a document can be filed into — the list offered to the AI. */
export function targetFolders(root) {
  const out = [];
  for (const d of flatTree()) {
    if (d.dynamic) continue;
    if (d.target) out.push({ path: d.path, description: d.description, keywords: d.keywords });
  }
  const types = [
    ["employee", "employees", (r) => `${r.code} — ${r.name}`],
    ["project", "projects", (r) => r.name],
    ["vehicle", "vehicles", (r) => `${r.plate} ${r.make || ""}`.trim()],
    ["client", "clients", (r) => r.name],
    ["house", "houses", (r) => `${r.code} ${r.name}`],
  ];
  for (const [type, tableName, label] of types) {
    for (const row of db.table(tableName)) {
      const base = dynamicPath(type, row);
      if (!base) continue;
      for (const sub of TEMPLATES[type]) {
        out.push({
          path: `${base}/${sub.c} ${sub.n}`,
          description: `${label(row)} — ${sub.d}`,
          keywords: sub.keywords,
          owner: { type, id: row._id, label: label(row) },
        });
      }
    }
  }
  return out;
}

export function explorerPath(root, relative) {
  return fullPath(root, relative);
}

/* ------------------------------------------------------------------ */
/* Deleting documents: files are not removed, they move to "_Deleted". */
/* The original location is kept as folders: _Deleted/<folder>/<name>  */
/* ------------------------------------------------------------------ */

export const DELETED = "_Deleted";

const inDeleted = (relative) => String(relative || "").split(/[/\\]/).filter(Boolean)[0] === DELETED;

/** Full path of a single file in a folder; the file name cannot escape into a sub-folder. */
function fileFullPath(root, folder, name) {
  if (!name || /[/\\]/.test(name) || name === "." || name === "..") throw new Error("Invalid file name.");
  const full = path.join(fullPath(root, folder), name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`File not found: ${name}`);
  return full;
}

function move(source, targetDir, name) {
  fs.mkdirSync(targetDir, { recursive: true });
  const newName = freeName(targetDir, name);
  const target = path.join(targetDir, newName);
  try {
    fs.renameSync(source, target);
  } catch (e) {
    if (["EBUSY", "EPERM"].includes(e.code)) throw new Error(`"${name}" is open in another program. Close it and try again.`);
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
  return newName;
}

/** Moves a file under _Deleted. Returns: { path, folder, name } (relative, inside _Deleted). */
export function deleteFile(root, folder, name) {
  if (inDeleted(folder)) throw new Error("This file is already in Deleted. Use \"Delete permanently\" to remove it for good.");
  const source = fileFullPath(root, folder, name);
  const targetFolder = [DELETED, ...String(folder).split(/[/\\]/).filter(Boolean)].join("/");
  const newName = move(source, fullPath(root, targetFolder), name);
  return { path: `${targetFolder}/${newName}`, folder: targetFolder, name: newName };
}

/** Puts a file from Deleted back into its original folder. Returns: { path, folder, name }. */
export function restoreFile(root, folder, name) {
  if (!inDeleted(folder)) throw new Error("Only files in the Deleted folder can be restored.");
  const source = fileFullPath(root, folder, name);
  const original = String(folder).split(/[/\\]/).filter(Boolean).slice(1).join("/");
  const newName = move(source, fullPath(root, original), name);
  return { path: original ? `${original}/${newName}` : newName, folder: original, name: newName };
}

/** Removes a file in Deleted from disk for good. */
export function purgeFile(root, folder, name) {
  if (!inDeleted(folder)) throw new Error("Permanent deletion only works inside the Deleted folder. Delete the file first.");
  const full = fileFullPath(root, folder, name);
  try { fs.unlinkSync(full); }
  catch (e) {
    if (["EBUSY", "EPERM"].includes(e.code)) throw new Error(`"${name}" is open in another program. Close it and try again.`);
    throw e;
  }
  // Folders left empty (inside Deleted) are cleaned up.
  let dir = path.dirname(full);
  const limit = fullPath(root, DELETED);
  while (dir.startsWith(limit + path.sep) && !fs.readdirSync(dir).length) { fs.rmdirSync(dir); dir = path.dirname(dir); }
}

/**
 * Moves the document root aside as "<root> (old 2026-10-14)" (used by reset). Nothing is deleted;
 * the user can remove it by hand. Returns: the new name.
 */
export function setRootAside(root) {
  if (!fs.existsSync(root)) return null;
  const date = new Date().toISOString().slice(0, 10);
  const parent = path.dirname(root), name = path.basename(root);
  let target = path.join(parent, `${name} (old ${date})`), i = 2;
  while (fs.existsSync(target)) target = path.join(parent, `${name} (old ${date} ${i++})`);
  try { fs.renameSync(root, target); }
  catch (e) {
    if (["EBUSY", "EPERM", "EACCES"].includes(e.code)) {
      throw new Error("The document folder could not be moved aside: a file or folder inside it is open (Excel, an Explorer window…). " +
        "Close open windows and try again. No records were deleted.");
    }
    throw e;
  }
  return target;
}
