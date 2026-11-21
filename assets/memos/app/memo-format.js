/* The memo file format, the same as site/src/lib/memos.ts (parse, serialize) and bin/memos.py (parse), for the memo
 * app's GitHub storage, which writes the files in the browser. Front-matter values are JSON (valid YAML).
 * Works in the browser (window.MemoFormat) and in Node (require) for the tests. */
(function (root, make) {
  if (typeof module === "object" && module.exports) module.exports = make();
  else root.MemoFormat = make();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var ID = /^\d{8}-\d{6}(-\d+)?$/;
  var p2 = function (n) { return String(Math.abs(n)).padStart(2, "0"); };

  /** Local date-time with offset: 2026-11-21T15:30:12+09:00. */
  function stamp(d) {
    d = d || new Date();
    var off = -d.getTimezoneOffset();
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) +
      (off >= 0 ? "+" : "-") + p2(Math.trunc(off / 60)) + ":" + p2(off % 60);
  }
  /** The id of a memo written at `d`: YYYYMMDD-HHMMSS (local time); "-2", "-3" when `taken(id)`. */
  function newId(d, taken) {
    d = d || new Date();
    var base = "" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    var id = base;
    for (var k = 2; taken && taken(id); k++) id = base + "-" + k;
    return id;
  }
  function cleanTags(v) {
    var arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
    var out = [];
    arr.forEach(function (t) {
      var s = String(t).trim().replace(/^#+/, "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, "-").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function value(v) {
    v = v.trim();
    if (!v) return "";
    try { return JSON.parse(v); } catch (e) { /* plain YAML scalar or flow list */ }
    if (v.charAt(0) === "[" && v.charAt(v.length - 1) === "]")
      return v.slice(1, -1).split(",").map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ""); }).filter(Boolean);
    if (v === "true" || v === "false") return v === "true";
    return v.replace(/^['"]|['"]$/g, "");
  }
  function str(v) { return v === undefined || v === null ? "" : String(v); }

  function parse(id, text, rev) {
    var t = String(text).replace(/\r\n/g, "\n"), meta = {}, body = t;
    var m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
    if (m) {
      body = m[2];
      m[1].split("\n").forEach(function (line) {
        var k = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
        if (k) meta[k[1]] = value(k[2]);
      });
    }
    body = body.replace(/^\n+/, "");
    var first = body.split("\n").find(function (l) { return l.trim(); }) || "";
    return {
      id: id, title: str(meta.title) || first.replace(/^#+\s*/, "").slice(0, 80), created: str(meta.created),
      updated: str(meta.updated) || str(meta.created), work: str(meta.work), tags: cleanTags(meta.tags),
      pinned: meta.pinned === true, archived: meta.archived === true, trashed: str(meta.trashed), body: body, mtime: rev === undefined ? 0 : rev
    };
  }
  function serialize(m) {
    var j = JSON.stringify;
    return ["---", "title: " + j(m.title), "created: " + j(m.created), "updated: " + j(m.updated), "work: " + j(m.work),
      "tags: " + j(m.tags), "pinned: " + j(m.pinned), "archived: " + j(m.archived), "trashed: " + j(m.trashed), "---", "",
      m.body.replace(/\s+$/, "") + "\n"].join("\n");
  }
  /** Fields a client may set (the same rules as the preview server's API). */
  function apply(m, b) {
    if (typeof b.title === "string") m.title = b.title.slice(0, 300);
    if (typeof b.body === "string") m.body = b.body;
    if (typeof b.work === "string") m.work = b.work.trim().slice(0, 120);
    if (b.tags !== undefined) m.tags = cleanTags(b.tags).slice(0, 50);
    if (typeof b.pinned === "boolean") m.pinned = b.pinned;
    if (typeof b.archived === "boolean") m.archived = b.archived;
    if (typeof b.trashed === "boolean") m.trashed = b.trashed ? stamp() : "";
    return m;
  }
  function blank(id, now) {
    var s = stamp(now);
    return { id: id, title: "", created: s, updated: s, work: "", tags: [], pinned: false, archived: false, trashed: "", body: "", mtime: 0 };
  }
  return { ID: ID, stamp: stamp, newId: newId, cleanTags: cleanTags, parse: parse, serialize: serialize, apply: apply, blank: blank };
});
