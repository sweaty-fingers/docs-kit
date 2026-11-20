/* docs-kit site behaviour (Astro edition). No dependencies; everything works with mouse, touch and pen (Pointer
   Events) and with the keyboard (prd.md FR-UI-5..7). Pages read fine without it. */
(function () {
	"use strict";
	var root = document.documentElement;
	var body = document.body;
	var up = body.dataset.up || "";
	var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	function isDark() {
		var t = root.dataset.theme;
		if (t) return t === "dark";
		return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	}

	/* ---- theme ------------------------------------------------------------ */
	document.querySelectorAll("[data-kit-theme]").forEach(function (b) {
		b.addEventListener("click", function () {
			var next = isDark() ? "light" : "dark";
			root.dataset.theme = next;
			try { localStorage.setItem("kit-theme", next); } catch (e) {}
			renderMermaid(true);
		});
	});

	/* ---- drawer (below 960px): burger opens, scrim / Esc / back closes -------- */
	var drawer = document.getElementById("kit-drawer");
	var burger = document.querySelector("[data-kit-open-drawer]");
	function openDrawer() {
		if (!drawer) return;
		drawer.hidden = false;
		burger && burger.setAttribute("aria-expanded", "true");
		body.style.overflow = "hidden";
		try { history.pushState({ kitDrawer: 1 }, ""); } catch (e) {}
		var cur = drawer.querySelector('[aria-current="page"]');
		(cur || drawer.querySelector("a,button")).focus();
		if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "center" });
	}
	function closeDrawer(fromHistory) {
		if (!drawer || drawer.hidden) return;
		drawer.hidden = true;
		burger && burger.setAttribute("aria-expanded", "false");
		body.style.overflow = "";
		if (!fromHistory && history.state && history.state.kitDrawer) history.back();
		burger && burger.focus();
	}
	burger && burger.addEventListener("click", openDrawer);
	document.querySelectorAll("[data-kit-close-drawer]").forEach(function (el) { el.addEventListener("click", function () { closeDrawer(false); }); });
	window.addEventListener("popstate", function () { closeDrawer(true); closeSearch(true); });

	/* ---- "이 페이지" follows the scroll -------------------------------------------- */
	var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".kit-toc a"));
	if (tocLinks.length && "IntersectionObserver" in window) {
		var heads = tocLinks.map(function (a) { return document.getElementById(decodeURIComponent(a.hash.slice(1))); }).filter(Boolean);
		var visible = new Set();
		var obs = new IntersectionObserver(function (entries) {
			entries.forEach(function (e) { if (e.isIntersecting) visible.add(e.target.id); else visible.delete(e.target.id); });
			var firstVisible = heads.find(function (h) { return visible.has(h.id); });
			var active = firstVisible;
			if (!active) { // between headings: the last one above the viewport
				for (var i = heads.length - 1; i >= 0; i--) if (heads[i].getBoundingClientRect().top < 120) { active = heads[i]; break; }
			}
			tocLinks.forEach(function (a) { a.classList.toggle("is-active", !!active && a.hash === "#" + encodeURIComponent(active.id) || (!!active && a.hash === "#" + active.id)); });
		}, { rootMargin: "-100px 0px -60% 0px" });
		heads.forEach(function (h) { obs.observe(h); });
	}
	document.querySelectorAll(".kit-toc-mobile a").forEach(function (a) {
		a.addEventListener("click", function () { var d = a.closest("details"); if (d) d.open = false; });
	});

	/* ---- back to top ----------------------------------------------------------- */
	var top = document.querySelector("[data-kit-top]");
	if (top) {
		var onScroll = function () { top.hidden = window.scrollY < 600; };
		window.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });
	}

	/* ---- code copy buttons ------------------------------------------------------ */
	var COPY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h10v12H9zM5 15V3h10"/></svg>';
	var DONE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
	document.querySelectorAll(".kit-code").forEach(function (box) {
		var pre = box.querySelector("pre");
		if (!pre) return;
		var b = document.createElement("button");
		b.type = "button"; b.className = "kit-copy"; b.setAttribute("aria-label", "코드 복사"); b.innerHTML = COPY;
		b.addEventListener("click", function () {
			var text = pre.innerText.replace(/\n$/, "");
			var done = function () { b.innerHTML = DONE; b.classList.add("is-done"); setTimeout(function () { b.innerHTML = COPY; b.classList.remove("is-done"); }, 1500); };
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
			else {
				var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
				try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(ta);
			}
		});
		box.appendChild(b);
	});

	/* ---- content tabs (===) ------------------------------------------------------- */
	document.querySelectorAll("[data-kit-tabs]").forEach(function (set) {
		var tabs = set.querySelectorAll(":scope > .kit-tabs__bar > .kit-tabs__tab");
		var panels = set.querySelectorAll(":scope > .kit-tabs__panel");
		function select(i) {
			tabs.forEach(function (t, k) { t.setAttribute("aria-selected", String(k === i)); t.tabIndex = k === i ? 0 : -1; });
			panels.forEach(function (p, k) { p.hidden = k !== i; });
			setTimeout(scanDiagrams, 50);
		}
		tabs.forEach(function (t, k) {
			t.tabIndex = k === 0 ? 0 : -1;
			t.addEventListener("click", function () { select(k); });
			t.addEventListener("keydown", function (e) {
				if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
					var n = (k + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
					select(n); tabs[n].focus(); e.preventDefault();
				}
			});
		});
	});

	/* ---- Mermaid: ES module loaded on pages that have diagrams, colours from the site theme ----- */
	var mermaidSources = [];
	var mermaidLib = null;
	function token(name, fallback) {
		var v = getComputedStyle(root).getPropertyValue(name).trim();
		return v || fallback;
	}
	function mermaidTheme() {
		var bg = token("--kit-bg", "#ffffff"), fg = token("--kit-fg", "#111111"), sub = token("--kit-subtle", "#f4f4f4");
		var line = token("--kit-muted", "#666666"), border = token("--kit-accent", "#b9784c"), faint = token("--kit-border", "#dddddd");
		return {
			darkMode: isDark(), background: bg, fontFamily: getComputedStyle(body).fontFamily, fontSize: "15px",
			primaryColor: sub, primaryBorderColor: border, primaryTextColor: fg, secondaryColor: bg, secondaryBorderColor: faint,
			secondaryTextColor: fg, tertiaryColor: sub, tertiaryBorderColor: faint, tertiaryTextColor: fg, lineColor: line, textColor: fg,
			mainBkg: sub, nodeBorder: border, clusterBkg: bg, clusterBorder: faint, titleColor: fg, edgeLabelBackground: bg,
			noteBkgColor: sub, noteBorderColor: faint, noteTextColor: fg, actorBkg: sub, actorBorder: border, actorTextColor: fg,
			signalColor: line, signalTextColor: fg, labelBoxBkgColor: sub, labelTextColor: fg
		};
	}
	function renderMermaid(again) {
		var blocks = document.querySelectorAll("pre.mermaid");
		if (!blocks.length || !body.dataset.mermaid) return;
		var go = function (mermaid) {
			blocks.forEach(function (b, i) {
				if (mermaidSources[i] === undefined) mermaidSources[i] = b.textContent;
				if (again) { b.removeAttribute("data-processed"); b.textContent = mermaidSources[i]; }
			});
			mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: mermaidTheme(), securityLevel: "strict" });
			mermaid.run({ nodes: blocks }).then(function () {
				document.querySelectorAll(".dk-diagram").forEach(function (f) { if (f.dkZoom) f.dkZoom.reset(); });
				scanDiagrams();
			}).catch(function (e) { console.error("mermaid:", e); });
		};
		if (mermaidLib) return go(mermaidLib);
		import(new URL(body.dataset.mermaid, location.href).href).then(function (m) { mermaidLib = m.default; go(mermaidLib); })
			.catch(function (e) { console.error("mermaid: could not load", e); });
	}
	renderMermaid(false);
	if (window.matchMedia) {
		var mq = window.matchMedia("(prefers-color-scheme: dark)");
		var onMq = function () { if (!root.dataset.theme) renderMermaid(true); };
		if (mq.addEventListener) mq.addEventListener("change", onMq);
	}

	/* ---- diagram frame: − / + / 맞춤 / 100% / 전체 화면, drag, pinch, double tap -------- */
	var MIN = 0.25, MAX = 8, STEP = 1.25;
	function button(label, title, onClick) {
		var b = document.createElement("button");
		b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
		b.addEventListener("click", onClick);
		return b;
	}
	function wrap(host) {
		var svg = host.querySelector("svg");
		if (!svg) return false;
		var rect = host.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return false;
		var baseW = rect.width, baseH = rect.height, s = 1;
		var frame = document.createElement("div"); frame.className = "dk-diagram";
		var bar = document.createElement("div"); bar.className = "dk-diagram__bar";
		var view = document.createElement("div"); view.className = "dk-diagram__view";
		var sizer = document.createElement("div"); sizer.className = "dk-diagram__sizer";
		var pct = document.createElement("span"); pct.className = "dk-diagram__pct";
		host.parentNode.insertBefore(frame, host);
		sizer.appendChild(host); view.appendChild(sizer); frame.appendChild(bar); frame.appendChild(view);
		host.style.width = baseW + "px"; host.style.transformOrigin = "0 0";
		function apply(next, cx, cy) {
			next = Math.min(MAX, Math.max(MIN, next));
			var px = cx === undefined ? view.clientWidth / 2 : cx, py = cy === undefined ? view.clientHeight / 2 : cy;
			var fx = (view.scrollLeft + px) / s, fy = (view.scrollTop + py) / s;
			s = next;
			host.style.transform = "scale(" + s + ")";
			sizer.style.width = baseW * s + "px"; sizer.style.height = baseH * s + "px";
			view.scrollLeft = fx * s - px; view.scrollTop = fy * s - py;
			pct.textContent = Math.round(s * 100) + "%";
		}
		function fit() {
			var sw = (view.clientWidth - 2) / baseW, sh = (view.clientHeight - 2) / baseH;
			apply(document.fullscreenElement === frame ? Math.min(sw, sh) : Math.min(1, sw));
			view.scrollLeft = 0; view.scrollTop = 0;
		}
		bar.appendChild(button("−", "축소", function () { apply(s / STEP); }));
		bar.appendChild(pct);
		bar.appendChild(button("+", "확대", function () { apply(s * STEP); }));
		bar.appendChild(button("맞춤", "화면에 맞추기", fit));
		bar.appendChild(button("100%", "페이지 너비 그대로", function () { apply(1); view.scrollLeft = 0; view.scrollTop = 0; }));
		if (frame.requestFullscreen) {
			bar.appendChild(button("전체 화면", "전체 화면 (Esc로 닫기)", function () {
				if (document.fullscreenElement === frame) document.exitFullscreen(); else frame.requestFullscreen();
			}));
			frame.addEventListener("fullscreenchange", function () { setTimeout(fit, 50); });
		}
		var hint = document.createElement("span"); hint.className = "dk-diagram__hint";
		hint.textContent = "끌어서 이동 · Ctrl/⌘+휠 또는 두 손가락으로 확대 · 두 번 눌러 맞춤";
		bar.appendChild(hint);
		view.addEventListener("wheel", function (e) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			var r = view.getBoundingClientRect();
			apply(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
		}, { passive: false });
		// pointers: one = pan (mouse / pen; touch pans natively), two = pinch zoom
		var pts = new Map(), drag = null, pinch = null, lastTap = 0;
		view.addEventListener("pointerdown", function (e) {
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pts.size === 2) {
				var a = Array.from(pts.values());
				pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: s };
				view.style.touchAction = "none";
				drag = null;
			} else if (e.pointerType !== "touch" && e.button === 0) {
				drag = { x: e.clientX, y: e.clientY, l: view.scrollLeft, t: view.scrollTop };
				view.setPointerCapture(e.pointerId); view.classList.add("is-dragging");
			}
			if (e.pointerType === "touch" && pts.size === 1) {
				var now = Date.now();
				if (now - lastTap < 300) { fit(); lastTap = 0; } else lastTap = now;
			}
		});
		view.addEventListener("pointermove", function (e) {
			if (!pts.has(e.pointerId)) return;
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch && pts.size === 2) {
				var a = Array.from(pts.values());
				var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
				var r = view.getBoundingClientRect();
				apply(pinch.s * d / pinch.d, (a[0].x + a[1].x) / 2 - r.left, (a[0].y + a[1].y) / 2 - r.top);
				e.preventDefault();
			} else if (drag) {
				view.scrollLeft = drag.l - (e.clientX - drag.x); view.scrollTop = drag.t - (e.clientY - drag.y);
			}
		});
		function end(e) {
			pts.delete(e.pointerId);
			if (pts.size < 2 && pinch) { pinch = null; view.style.touchAction = ""; }
			drag = null; view.classList.remove("is-dragging");
		}
		view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
		view.addEventListener("dblclick", fit);
		apply(1);
		frame.dkZoom = { apply: apply, fit: fit, scale: function () { return s; }, reset: function () {
			host.style.transform = ""; host.style.width = "";
			var r2 = host.getBoundingClientRect(); baseW = r2.width || baseW; baseH = r2.height || baseH;
			host.style.width = baseW + "px"; apply(1);
		} };
		return true;
	}
	function scanDiagrams() {
		document.querySelectorAll(".kit-mermaid:not([data-dk-zoom])").forEach(function (host) {
			if (host.closest(".dk-diagram")) return;
			if (wrap(host)) host.setAttribute("data-dk-zoom", "1");
		});
	}
	document.addEventListener("toggle", function () { setTimeout(scanDiagrams, 50); }, true);

	/* ---- links to the project's other servers, short addresses, dev-only blocks ---- */
	var h = location.hostname || "localhost";
	/* Rerun: local = viewer and file server on the reader's host; hosted = app.rerun.io opens the file from this site */
	function rerunUrls(file, d) {
		if (d.viewer === "hosted") {
			var f = /^https?:\/\//.test(file) ? file : new URL(up + file, location.href).href;
			return { file: f, viewer: d.hosted + "?url=" + encodeURIComponent(f) };
		}
		var lf = "http://" + h + ":" + d.filePort + "/" + file;
		return { file: lf, viewer: "http://" + h + ":" + d.webPort + "/?url=" + encodeURIComponent(lf) };
	}
	document.querySelectorAll("a[data-kit-rerun]").forEach(function (a) {
		a.href = rerunUrls(a.dataset.kitRerun, a.dataset).viewer; a.target = "_blank"; a.rel = "noopener";
	});
	document.querySelectorAll("a[data-kit-catalog]").forEach(function (a) {
		a.href = "http://" + h + ":" + a.dataset.webPort + "/?url=" + encodeURIComponent("rerun+http://" + h + ":" + a.dataset.kitCatalog);
		a.target = "_blank"; a.rel = "noopener";
	});
	document.querySelectorAll("a[data-kit-port]").forEach(function (a) {
		a.href = location.protocol + "//" + h + ":" + a.dataset.kitPort + a.dataset.kitPath; a.target = "_blank"; a.rel = "noopener";
	});
	document.querySelectorAll("a.kit-short[data-path]").forEach(function (a) {
		var basePath = new URL(up || "./", location.href).pathname.replace(/\/$/, "");
		a.textContent = location.origin + basePath + a.dataset.path;
	});
	document.querySelectorAll(".kit-dev-only").forEach(function (d) {
		var shared = d.dataset.sharedPort;
		if (!shared || location.port !== String(shared)) { d.classList.add("is-shown"); return; }
		d.querySelectorAll("[id]").forEach(function (el) {   // hidden: take its headings out of "이 페이지"
			document.querySelectorAll('.kit-toc a[href="#' + el.id + '"], .kit-toc-mobile a[href="#' + el.id + '"]').forEach(function (l) {
				(l.closest("li") || l).style.display = "none";
			});
		});
	});

	/* ---- Rerun recording boxes: nothing loads until "뷰어 불러오기" ------------------ */
	document.querySelectorAll(".rerun-embed").forEach(function (box) {
		var u = rerunUrls(box.dataset.file, box.dataset);
		var file = u.file, viewer = u.viewer;
		var state = box.querySelector(".rerun-embed__state"), load = box.querySelector(".rerun-embed__load");
		var open = box.querySelector(".rerun-embed__open"), off = box.querySelector(".rerun-embed__off"), frame = box.querySelector(".rerun-embed__frame");
		open.href = viewer;
		fetch(file, { method: "HEAD", cache: "no-store" }).then(function (r) {
			if (!r.ok) throw new Error(String(r.status));
			var mb = Number(r.headers.get("content-length") || 0) / 1e6;
			state.textContent = "준비됨" + (mb ? " · " + mb.toFixed(1) + " MB" : "");
			box.classList.add("is-ready"); load.disabled = false;
		}).catch(function () { state.textContent = "서버 꺼짐"; box.classList.add("is-off"); off.hidden = false; });
		load.addEventListener("click", function () {
			if (frame.firstChild) return;
			var f = document.createElement("iframe");
			f.src = viewer; f.title = "Rerun viewer: " + box.dataset.file; f.style.height = box.dataset.height + "px"; f.setAttribute("allow", "fullscreen");
			frame.appendChild(f); load.disabled = true; state.textContent = "불러오는 중… (처음은 수십 MB를 받음)";
		});
	});

	/* ---- search: Pagefind, loaded from the site on first use ---------------------- */
	var search = document.getElementById("kit-search");
	var searchUi = document.getElementById("kit-search-ui");
	var searchLoaded = false;
	function openSearch() {
		if (!search) return;
		search.hidden = false; body.style.overflow = "hidden";
		try { history.pushState({ kitSearch: 1 }, ""); } catch (e) {}
		if (!searchLoaded) {
			searchLoaded = true;
			var bundle = searchUi.dataset.bundle;
			var css = document.createElement("link"); css.rel = "stylesheet"; css.href = bundle + "pagefind-ui.css"; document.head.appendChild(css);
			var s = document.createElement("script"); s.src = bundle + "pagefind-ui.js";
			s.onload = function () {
				/* global PagefindUI */
				new PagefindUI({ element: "#kit-search-ui", bundlePath: bundle, showSubResults: true, showImages: false, autofocus: true,
					translations: { placeholder: "문서 검색", zero_results: "[SEARCH_TERM]: 찾은 문서 없음", many_results: "[COUNT]개 문서", one_result: "1개 문서", load_more: "더 보기", clear_search: "지우기" } });
				var input = searchUi.querySelector("input"); input && input.focus();
			};
			s.onerror = function () {
				searchUi.innerHTML = '<p class="kit-search__msg">검색 색인이 없습니다. 검색은 빌드된 사이트(<code>docs.sh build</code>)에서 동작합니다.</p>';
			};
			document.body.appendChild(s);
		} else {
			var input = searchUi.querySelector("input"); input && input.focus();
		}
	}
	function closeSearch(fromHistory) {
		if (!search || search.hidden) return;
		search.hidden = true; body.style.overflow = "";
		if (!fromHistory && history.state && history.state.kitSearch) history.back();
	}
	document.querySelectorAll("[data-kit-search]").forEach(function (b) { b.addEventListener("click", openSearch); });
	document.querySelectorAll("[data-kit-close-search]").forEach(function (b) { b.addEventListener("click", function () { closeSearch(false); }); });
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape") { closeSearch(false); closeDrawer(false); }
		var t = e.target;
		var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
		if (!typing && (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); openSearch(); }
	});
})();
