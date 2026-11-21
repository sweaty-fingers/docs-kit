/* GitHub storage for the memo app: memos are files in a (private) repository, written from the browser with the
 * reader's own token, so the published site can be used to write memos from any device (computer, phone).
 *
 * It answers the same requests as the preview server's API (site/src/lib/memos.ts), so app.js does not care which
 * one it talks to:  GET "" -> {memos, dir}; POST "" -> 201 memo; PUT "/<id>" {fields, base, force} -> 200 memo |
 * 409 current memo; DELETE "/<id>" -> 204 (only from the trash); POST "/empty-trash" -> {deleted}.
 * A memo's version (`mtime`) is the file's blob sha: GitHub refuses an update made against an older sha, which is how
 * edits from two devices are caught. Writes go one at a time (each is a commit on the branch).
 * Reading all memos is one GraphQL request (text of every file in the folder); REST trees + blobs if that fails.
 * Works in the browser (window.MemoGitHub) and in Node 18+ (require) with a global fetch. */
(function (root, make) {
  if (typeof module === "object" && module.exports) module.exports = make;
  else root.MemoGitHub = make;
})(typeof self !== "undefined" ? self : this, function (F, cfg, token) {
  "use strict";
  var api = String(cfg.api || "https://api.github.com").replace(/\/+$/, "");
  var graphql = /api\.github\.com$/.test(api) ? api + "/graphql" : api.replace(/\/v3$/, "") + "/graphql";
  var repo = String(cfg.repo), branch = String(cfg.branch || "main"), dir = String(cfg.path || "").replace(/^\/+|\/+$/g, "");
  var owner = repo.split("/")[0], name = repo.split("/")[1];
  var server = {};            // id -> the memo as last read from / written to GitHub (its sha in mtime)
  var queue = Promise.resolve();
  var blobs = {};              // sha -> text (REST fallback cache)

  function file(id) { return (dir ? dir + "/" : "") + id + ".md"; }
  function enc(path) { return path.split("/").map(encodeURIComponent).join("/"); }
  function b64(text) {
    var bytes = new TextEncoder().encode(text), s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(b) {
    var s = atob(String(b).replace(/\s/g, "")), bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function gh(method, url, body) {
    var h = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (body !== undefined) h["Content-Type"] = "application/json";
    return fetch(/^https?:/.test(url) ? url : api + url, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" })
      .then(function (r) {
        if (r.status === 204) return { status: 204, data: null };
        return r.json().then(function (j) { return { status: r.status, data: j }; }, function () { return { status: r.status, data: null }; });
      });
  }
  function fail(r) { var e = new Error((r.data && r.data.message) || "GitHub " + r.status); e.status = r.status; throw e; }
  function serial(task) { var p = queue.then(task, task); queue = p.catch(function () {}); return p; }
  function message(verb, m) { return "memo: " + verb + " " + m.id + (m.title ? " " + m.title.slice(0, 60) : ""); }

  // ---------------------------------------------------------------- reading
  function listGraphql() {
    var q = "query($o:String!,$n:String!,$e:String!){repository(owner:$o,name:$n){object(expression:$e){... on Tree{entries{name oid type object{... on Blob{text isBinary}}}}}}}";
    return gh("POST", graphql, { query: q, variables: { o: owner, n: name, e: branch + ":" + dir } }).then(function (r) {
      if (r.status !== 200 || !r.data || r.data.errors || !r.data.data || !r.data.data.repository) throw r;
      var obj = r.data.data.repository.object;
      return (obj && obj.entries ? obj.entries : []).filter(function (e) { return e.type === "blob" && e.object && typeof e.object.text === "string"; })
        .map(function (e) { return { name: e.name, sha: e.oid, text: e.object.text }; });
    });
  }
  function listRest() {
    return gh("GET", "/repos/" + repo + "/contents/" + enc(dir) + "?ref=" + encodeURIComponent(branch)).then(function (r) {
      if (r.status === 404 && dir) return [];          // the folder does not exist yet
      if (r.status !== 200 || !Array.isArray(r.data)) fail(r);
      var files = r.data.filter(function (f) { return f.type === "file" && /\.md$/.test(f.name) && F.ID.test(f.name.slice(0, -3)); });
      return Promise.all(files.map(function (f) {
        if (blobs[f.sha] !== undefined) return { name: f.name, sha: f.sha, text: blobs[f.sha] };
        return gh("GET", "/repos/" + repo + "/git/blobs/" + f.sha).then(function (b) {
          if (b.status !== 200) fail(b);
          blobs[f.sha] = unb64(b.data.content);
          return { name: f.name, sha: f.sha, text: blobs[f.sha] };
        });
      }));
    });
  }
  function list() {
    return listGraphql().catch(function (e) {
      if (e && (e.status === 401 || e.status === 403)) fail(e);
      return listRest();
    }).then(function (files) {
      server = {};
      var memos = [];
      files.forEach(function (f) {
        var id = f.name.replace(/\.md$/, "");
        if (!/\.md$/.test(f.name) || !F.ID.test(id)) return;
        var m = F.parse(id, f.text, f.sha);
        server[id] = m;
        memos.push(Object.assign({}, m));
      });
      memos.sort(function (a, b) { return b.updated.localeCompare(a.updated); });
      return { status: 200, data: { memos: memos, dir: "GitHub " + repo + (dir ? "/" + dir : ""), writable: true } };
    });
  }
  function current(id) {
    return gh("GET", "/repos/" + repo + "/contents/" + enc(file(id)) + "?ref=" + encodeURIComponent(branch)).then(function (r) {
      if (r.status === 404) return null;
      if (r.status !== 200) fail(r);
      var m = F.parse(id, unb64(r.data.content), r.data.sha);
      server[id] = m;
      return m;
    });
  }

  // ---------------------------------------------------------------- writing
  function put(m, sha, verb) {
    var body = { message: message(verb, m), content: b64(F.serialize(m)), branch: branch };
    if (sha) body.sha = sha;
    return gh("PUT", "/repos/" + repo + "/contents/" + enc(file(m.id)), body);
  }
  function create(fields) {
    var now = new Date();
    var tryId = function (k) {
      var id = k ? F.newId(now) + "-" + (k + 1) : F.newId(now, function (x) { return !!server[x]; });
      var m = F.apply(F.blank(id, now), fields || {});
      return put(m, null, "add").then(function (r) {
        if (r.status === 422 && k < 20) return tryId(k + 1);      // a file with that name exists (another device)
        if (r.status !== 201 && r.status !== 200) fail(r);
        m.mtime = r.data.content.sha;
        server[m.id] = Object.assign({}, m);
        return { status: 201, data: m };
      });
    };
    return tryId(0);
  }
  function update(id, b) {
    var base = server[id];
    var go = function (cur) {
      if (!cur) return { status: 404, data: { error: "no such memo" } };
      if (!b.force && b.base !== undefined && b.base !== cur.mtime) return current(id).then(function (now) { return { status: 409, data: now }; });
      var m = F.apply(Object.assign({}, cur), b);
      m.updated = F.stamp();
      return put(m, cur.mtime, b.trashed === true ? "trash" : "edit").then(function (r) {
        if (r.status === 409 || (r.status === 422 && /sha/i.test((r.data && r.data.message) || ""))) {
          return current(id).then(function (now) {
            if (b.force && now) return update(id, Object.assign({}, b, { base: now.mtime }));
            return { status: 409, data: now };
          });
        }
        if (r.status !== 200 && r.status !== 201) fail(r);
        m.mtime = r.data.content.sha;
        server[id] = Object.assign({}, m);
        return { status: 200, data: m };
      });
    };
    return b.force || !base ? current(id).then(go) : Promise.resolve(go(base));
  }
  function remove(id) {
    var go = function (cur) {
      if (!cur) return { status: 404, data: { error: "no such memo" } };
      if (!cur.trashed) return { status: 409, data: { error: "move it to the trash first" } };
      return gh("DELETE", "/repos/" + repo + "/contents/" + enc(file(id)), { message: message("delete", cur), sha: cur.mtime, branch: branch }).then(function (r) {
        if (r.status === 409) return { status: 409, data: { error: "changed elsewhere" } };
        if (r.status !== 200 && r.status !== 204) fail(r);
        delete server[id];
        return { status: 204, data: null };
      });
    };
    return server[id] ? go(server[id]) : current(id).then(go);
  }

  /** The same requests as the preview server's API. */
  function request(method, path, body) {
    path = path || "";
    var id = path.replace(/^\//, "");
    if (method === "GET" && !id) return list();
    if (method === "POST" && !id) return serial(function () { return create(body); });
    if (method === "POST" && id === "empty-trash")
      return serial(function () {
        var ids = Object.keys(server).filter(function (k) { return server[k].trashed; }), n = 0;
        return ids.reduce(function (p, k) { return p.then(function () { return remove(k).then(function (r) { if (r.status === 204) n++; }); }); }, Promise.resolve())
          .then(function () { return { status: 200, data: { deleted: n } }; });
      });
    if (method === "PUT") return serial(function () { return update(decodeURIComponent(id), body || {}); });
    if (method === "DELETE") return serial(function () { return remove(decodeURIComponent(id)); });
    return Promise.resolve({ status: 405, data: { error: "method not allowed" } });
  }
  /** Is this token able to write the repository? -> {ok, why} */
  function check() {
    return gh("GET", "/repos/" + repo).then(function (r) {
      if (r.status === 401) return { ok: false, why: "토큰이 맞지 않거나 만료되었습니다" };
      if (r.status === 404 || r.status === 403) return { ok: false, why: "이 토큰으로는 " + repo + " 저장소가 보이지 않습니다(저장소 고르기를 확인)" };
      if (r.status !== 200) return { ok: false, why: "GitHub 응답 " + r.status };
      if (r.data.permissions && !r.data.permissions.push) return { ok: false, why: "읽기 권한만 있습니다: Contents를 Read and write로" };
      return { ok: true, priv: !!r.data.private, url: r.data.html_url };
    }, function () { return { ok: false, why: "GitHub에 연결하지 못했습니다(네트워크)" }; });
  }
  return { request: request, check: check, repo: repo, branch: branch, dir: dir };
});
