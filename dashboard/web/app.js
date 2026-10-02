/* AI Angel ComfyPod dashboard front end. No build step, no framework.
   Contract: docs/dashboard-api.md. `?demo` renders built-in sample data without a server. */
(() => {
  "use strict";

  const DEMO = new URLSearchParams(location.search).has("demo");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : String(kid));
    return n;
  };

  const GB = 1024 ** 3;
  const fmtBytes = (b) => {
    if (b == null) return "—";
    if (b >= GB) return (b / GB).toFixed(b >= 100 * GB ? 0 : 1) + " GB";
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(0) + " MB";
    if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
    return b + " B";
  };
  const fmtDur = (s) => {
    if (s == null) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${Math.floor(s % 60)}s` : `${Math.floor(s)}s`;
  };
  const fmtAgo = (t) => {
    const s = Date.now() / 1000 - t;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return new Date(t * 1000).toLocaleDateString();
  };
  const pct = (a, b) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

  let toastTimer;
  const toast = (text, err = false) => {
    const t = $("#toast");
    t.textContent = text;
    t.classList.toggle("err", err);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  };
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const a = el("textarea", {}, text);
      document.body.append(a);
      a.select();
      document.execCommand("copy");
      a.remove();
    }
    toast(`${what} copied`);
  };

  /* ---------------- API ---------------- */
  async function api(path, body) {
    if (DEMO) return demoApi(path, body);
    const opt = body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    const r = await fetch("api/" + path, opt);
    let data = {};
    try { data = await r.json(); } catch { /* empty body */ }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  const fileUrl = (p, download) =>
    DEMO ? "" : `api/outputs/file?path=${encodeURIComponent(p)}${download ? "&download=1" : ""}`;

  /* ---------------- tabs + keyboard ---------------- */
  const TABS = ["overview", "create", "shopee", "story", "models", "outputs", "keys", "logs"];
  // the Queue card lives in whichever making tab is open; the others keep an empty slot for it
  const QUEUE_SLOTS = { shopee: "spQueueSlot", story: "stQueueSlot" };
  function showTab(name) {
    for (const t of TABS) $("#tab-" + t).hidden = t !== name;
    for (const b of $$(".tabs button")) b.setAttribute("aria-selected", b.dataset.tab === name);
    history.replaceState(null, "", "#" + name + (DEMO ? "" : ""));
    if (name === "outputs") loadOutputs();
    if (name === "create") { loadLoraChoices(); loadImageModels(); }
    if (name === "logs") loadLog();
    // one queue for every making tab: the card moves to whichever of them is open
    const queueCard = $("#queueCard");
    const from = queueCard.closest(".tab").id.slice(4);
    if ((name === "create" || QUEUE_SLOTS[name]) && from !== name) {
      if (QUEUE_SLOTS[from]) queueCard.replaceWith(el("div", { id: QUEUE_SLOTS[from] }));
      if (name === "create") $("#createSide").prepend(queueCard);
      else $("#" + QUEUE_SLOTS[name]).replaceWith(queueCard);
    }
    if (name === "shopee") window.ShopeeTab?.shown();
    if (name === "story") window.StoryTab?.shown();
    // a clip started before this tab was opened (or before a reload) is still ours to show
    if (name === "create" || QUEUE_SLOTS[name]) genPoll();
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = Number(e.key);
    if (i >= 1 && i <= TABS.length) showTab(TABS[i - 1]);
  });

  /* ---------------- state render ---------------- */
  let state = null;
  // set by renderState, read by "Make it 720p"; declared here because the first poll can land
  // before the clip section's code has run
  let upscaleReady = false, pendingUpscale = false;
  // which Create options still need a download (/api/state needs), and the GPU for the estimate
  let createNeeds = {}, gpuName = "";
  const HERO = {
    ready: ["ComfyUI is ready", "Open it in a new tab. Nothing here stops while you work there."],
    starting: ["ComfyUI is starting", "Usually under a minute. Models keep downloading in the background either way."],
    down: ["ComfyUI is stopped", "Restart it here, or read the ComfyUI log to see why it stopped."],
  };

  function renderState(s) {
    state = s;
    const comfy = s.services.find((x) => x.key === "comfyui") || {};
    $("#podId").textContent = s.pod.id || "local";
    // the release number a user quotes when something goes wrong ("1.00", "1.01 dev")
    $("#appVersion").textContent = s.pod.image ? `v${s.pod.image}` : "";
    $("#appVersion").hidden = !s.pod.image;
    const [title, sub] = HERO[comfy.state] || HERO.down;
    const h1 = $("#heroTitle");
    const [lead, word] = [title.slice(0, title.lastIndexOf(" ") + 1), title.slice(title.lastIndexOf(" ") + 1)];
    const wordClass = { ready: "word-ok", starting: "word-run" }[comfy.state] || "word-bad";
    h1.replaceChildren(el("span", { class: "dot " + (comfy.state || "down"), "aria-hidden": "true" }),
      lead, el("span", { class: wordClass, text: word }));
    $("#heroSub").textContent = sub;
    // the 720p checkbox renders natively and needs nothing extra; only "Make it 720p" on a
    // finished clip uses the upscaler, so only that button depends on it
    upscaleReady = !!s.upscale_ready;
    createNeeds = s.needs || {};
    gpuName = s.pod.gpu || "";
    renderNeeds();
    for (const a of [$("#openComfy"), $("#openComfyTop")]) {
      // ComfyUI's own template link: opens the default workflow in a new tab
      a.href = comfy.url ? comfy.url + "?template=AiAngelH3-Clip&source=ComfyUI-AiAngel" : "#";
      a.classList.toggle("is-disabled", comfy.state !== "ready");
    }

    const p = s.pod;
    const sized = (d) => (d && d.total != null ? d : null);
    const wsElastic = !!p.disk?.workspace?.elastic;
    const ws = sized(p.disk?.workspace), ct = sized(p.disk?.container);
    const meter = (k, v, sub, fill, warn, color) =>
      el("div", { class: "meter", style: color ? `--c:${color}` : null },
        el("div", { class: "k", text: k }),
        el("div", { class: "v" }, v, sub ? el("small", {}, " " + sub) : null),
        fill == null ? null : el("div", { class: "bar-track" },
          el("div", { class: "bar-fill" + (warn ? " warn" : ""), style: `width:${fill}%` })));
    const gpuShort = (p.gpu || "no GPU").replace(/^NVIDIA\s+/, "").replace(/ Blackwell.*$/, "");
    $("#meters").replaceChildren(
      meter(p.gpu_util != null ? `GPU · ${p.gpu_util}% busy` : "GPU", gpuShort, "",
        p.gpu_util != null ? p.gpu_util : null, false, "var(--violet)"),
      meter("VRAM", p.vram_total_mb ? fmtBytes(p.vram_used_mb * 1024 ** 2) : "—",
        p.vram_total_mb ? "/ " + fmtBytes(p.vram_total_mb * 1024 ** 2) : "",
        p.vram_total_mb ? pct(p.vram_used_mb, p.vram_total_mb) : null, false, "var(--cyan)"),
      meter("Disk /workspace", ws ? fmtBytes(ws.total - ws.used) : "—",
        ws ? "free" : wsElastic ? "size not reported" : "",
        ws ? pct(ws.used, ws.total) : null, ws && ws.total - ws.used < 10 * GB, "var(--wait)"),
      meter("Container disk", ct ? fmtBytes(ct.total - ct.used) : "—", ct ? "free" : "",
        ct ? pct(ct.used, ct.total) : null, ct && ct.total - ct.used < 3 * GB, "var(--run)"),
      meter("Uptime", fmtDur(p.uptime_s), "", null, false, "var(--ok)"),
      meter("Image", p.cuda ? "CUDA " + p.cuda : "—", p.image || "", null, false, "var(--pink)"),
    );

    renderServices(s.services);
    renderPresets(s);
    renderJobs(s.jobs);
    renderKeys(s.keys);
    $("#outputsSub").textContent =
      `${s.outputs.count} files · ${fmtBytes(s.outputs.bytes)}. Pick files, or take them all, as ZIP.`;
  }

  function renderServices(list) {
    const rows = list.map((svc) => {
      const row = el("div", { class: "svc" },
        el("span", { class: "state " + svc.state, title: svc.state }),
        el("div", {}, el("span", { class: "name", text: svc.name }), " ",
          el("span", { class: "port", text: ":" + svc.port })),
        el("a", { class: "btn", href: svc.url, target: "_blank", rel: "noopener" }, "Open ↗"));
      if (svc.secret) {
        let shown = false;
        const code = el("code", { text: "••••••••••••" });
        const toggle = el("button", {
          class: "mini", text: "Show",
          onclick: () => { shown = !shown; code.textContent = shown ? svc.secret : "••••••••••••"; toggle.textContent = shown ? "Hide" : "Show"; },
        });
        row.append(el("div", { class: "secret" },
          svc.user ? el("span", {}, `user ${svc.user} ·`) : null,
          svc.key === "jupyter" ? "token" : "password", code, toggle,
          el("button", { class: "mini", text: "Copy", onclick: () => copy(svc.secret, svc.name + " password") })));
      }
      return row;
    });
    $("#services").replaceChildren(...rows);
  }

  const fileState = (f) => {
    if (f.state === "have") return fmtBytes(f.size);
    if (f.state === "downloading") return `${pct(f.have_bytes, f.size).toFixed(0)}%`;
    return f.state;
  };

  function renderPresets(s) {
    $("#modelsEnv").textContent = "MODELS=" + (s.models_env || "(empty)");
    const summary = s.presets.filter((p) => p.in_env).map((p) => {
      const total = p.files.reduce((a, f) => a + f.size, 0);
      const have = p.files.reduce((a, f) => a + Math.min(f.have_bytes, f.size), 0);
      const all = p.files.every((f) => f.state === "have");
      return el("div", { class: "summary-row" },
        el("span", { class: "mono", text: p.name }),
        el("div", { class: "bar-track" }, el("div", { class: "bar-fill " + (all ? "ok" : "run"), style: `width:${pct(have, total)}%` })),
        el("span", { class: "mono small " + (all ? "" : "dim"), text: all ? fmtBytes(total) : `${fmtBytes(have)} / ${fmtBytes(total)}` }));
    });
    $("#presetSummary").replaceChildren(...(summary.length ? summary : [el("p", { class: "empty", text: "No presets set. Add one in Models." })]));

    const cards = s.presets.map((p) => {
      const total = p.files.reduce((a, f) => a + f.size, 0);
      const missing = p.files.filter((f) => f.state === "missing" || f.state === "failed");
      const busy = p.files.some((f) => f.state === "downloading" || f.state === "queued");
      const btn = missing.length
        ? el("button", { class: "btn" + (busy ? "" : " primary"), disabled: busy, onclick: () => addPreset(p.name) },
          busy ? "Downloading…" : `Download ${fmtBytes(missing.reduce((a, f) => a + f.size, 0))}`)
        : el("span", { class: "tag " + (busy ? "run" : "ok"), text: busy ? "downloading" : "ready" });
      return el("div", { class: "preset" },
        el("div", { class: "preset-head" },
          el("span", { class: "preset-name", text: p.name }),
          p.in_env ? el("span", { class: "tag env", text: "MODELS" }) : null,
          el("span", { class: "preset-size", text: fmtBytes(total) }),
          btn),
        el("div", { class: "files" }, p.files.map((f) =>
          el("div", { class: "file" },
            el("span", { class: "fname", title: `${f.folder}/${f.name}`, text: `${f.folder}/${f.name}` }),
            el("span", { class: "fstate " + f.state, text: fileState(f) }),
            f.state === "downloading" ? el("div", { class: "bar-track" },
              el("div", { class: "bar-fill run", style: `width:${pct(f.have_bytes, f.size)}%` })) : null))));
    });
    $("#presets").replaceChildren(...cards);
  }

  function renderJobs(jobs) {
    const active = jobs.filter((j) => !["done", "failed"].includes(j.state)).length;
    $("#jobsHint").textContent = jobs.length ? `${active} running or queued` : "";
    const rows = [...jobs].reverse().map((j) =>
      el("div", { class: "job" },
        el("span", { class: "label", title: j.url, text: j.label || j.url }),
        el("span", { class: "jstate " + j.state, text: j.state === "downloading" && j.size ? `${pct(j.done_bytes, j.size).toFixed(0)}%` : j.state }),
        j.state === "downloading" ? el("div", { class: "bar-track" }, el("div", { class: "bar-fill run", style: `width:${pct(j.done_bytes, j.size)}%` })) : null,
        j.message && j.state === "failed" ? el("span", { class: "jmsg", text: j.message }) : null));
    $("#jobs").replaceChildren(...(rows.length ? rows : [el("p", { class: "empty", text: "Nothing downloading." })]));
  }

  function renderKeys(keys) {
    for (const pill of $$(".state-pill")) {
      const v = keys[pill.dataset.for];
      pill.textContent = v ? "saved " + v : "not set";
      pill.classList.toggle("set", !!v);
    }
  }

  /* ---------------- actions ---------------- */
  async function addPreset(name) {
    try {
      const r = await api("preset", { name });
      toast(r.queued ? `${name}: ${r.queued} file(s) queued` : `${name} is already on the volume`);
      poll();
    } catch (e) { toast(e.message, true); }
  }

  $("#queueLinks").addEventListener("click", async () => {
    const text = $("#linkText").value.trim();
    const msg = $("#linkMsg");
    if (!text) { msg.textContent = "Paste at least one link."; msg.className = "msg err"; return; }
    try {
      const r = await api("download", { text });
      msg.textContent = `${r.queued} download(s) queued.`;
      msg.className = "msg";
      $("#linkText").value = "";
      poll();
    } catch (e) { msg.textContent = e.message; msg.className = "msg err"; }
  });

  /* Two link lists, loaded into the box the same way: each row needs the user's own Civitai key,
     which is exactly why they are not presets. `extras` is not adult — it is the Krea 2 image
     LoRAs whose authors forbid re-hosting, so they could not ride along in the krea2 preset the
     way the rest now do (owner 2026-09-20). */
  const loadList = (buttonId, kit, note) => $("#" + buttonId).addEventListener("click", async () => {
    try {
      const r = await api("kit/" + kit);
      const box = $("#linkText");
      box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + r.text.trim();
      $("#linkMsg").textContent = note;
      $("#linkMsg").className = "msg";
    } catch (e) { toast(e.message, true); }
  });
  loadList("loadNsfw", "nsfw",
    "Adult model list added. Civitai files need your Civitai key (Keys tab).");
  loadList("loadExtras", "extras",
    "Extra image LoRAs added. Civitai files need your Civitai key (Keys tab).");

  $("#restartComfy").addEventListener("click", async (e) => {
    if (!confirm("Restart ComfyUI? A running job will stop.")) return;
    e.target.disabled = true;
    try { await api("comfy/restart", {}); toast("Restarting ComfyUI…"); poll(); }
    catch (err) { toast(err.message, true); }
    setTimeout(() => (e.target.disabled = false), 5000);
  });

  for (const card of $$(".key-card")) {
    const input = $("input", card);
    const send = async (value) => {
      try {
        const keys = await api("keys", { [card.dataset.site]: value });
        renderKeys(keys);
        input.value = "";
        toast(value === "-" ? "Key removed" : "Key saved");
      } catch (e) { toast(e.message, true); }
    };
    $(".save-key", card).addEventListener("click", () => input.value.trim() && send(input.value.trim()));
    $(".clear-key", card).addEventListener("click", () => send("-"));
  }

  /* ---------------- outputs ---------------- */
  let files = [];
  const selected = new Set();
  let kind = "all";

  async function loadOutputs() {
    try {
      files = (await api("outputs")).files;
    } catch (e) { toast(e.message, true); return; }
    for (const p of [...selected]) if (!files.some((f) => f.path === p)) selected.delete(p);
    renderGallery();
    renderLatest();
  }

  /* The clip you just made, as a real player: controls, and sound. The gallery tiles have to be
     muted because a browser refuses to autoplay a video with audio on hover — but that made the
     finished clip look silent when its file has a voice in it (owner 2026-09-16). */
  /* "Make it 720p" only on clips that are not 720p already, however they got there (owner
     2026-09-17): our own -720p_ file names, and any other video with 720p's pixel count (704x1280
     = 900k, in any frame shape), read from the file itself once the browser has its size. */
  function make720Button(f, video, attrs) {
    if (f.path.includes("-720p_")) return null;
    const b = el("button", { type: "button", text: "Make it 720p", ...attrs });
    const check = () => {
      if (video.videoWidth * video.videoHeight >= 850000) b.remove();
    };
    if (video.readyState >= 1) check();
    else video.addEventListener("loadedmetadata", check, { once: true });
    return b;
  }

  function clipPlayer(f) {
    const v = el("video", { class: "player", src: fileUrl(f.path), controls: true, playsinline: true });
    const name = f.path.split("/").pop();
    return el("div", { class: "clip-result" }, v,
      el("div", { class: "meta" },
        el("span", { class: "tname", title: f.path, text: name }),
        el("button", { class: "link", type: "button", text: "Use this recipe", onclick: () => useRecipe(f.path) }),
        make720Button(f, v, { class: "link", onclick: () => make720(f.path) }),
        el("a", { class: "link", href: fileUrl(f.path, true), download: name, text: "Download" })));
  }

  function tile(f, small = false) {
    const media = el("div", { class: "media" });
    let v = null;
    if (!DEMO && f.kind === "image") media.append(el("img", { src: fileUrl(f.path), loading: "lazy", alt: "" }));
    else if (!DEMO && f.kind === "video") {
      v = el("video", { src: fileUrl(f.path) + "#t=0.5", preload: "metadata", muted: true, playsinline: true, loop: true });
      v.muted = true;
      media.append(v);
      media.addEventListener("mouseenter", () => v.play().catch(() => {}));
      media.addEventListener("mouseleave", () => v.pause());
    } else media.append(el("span", { class: "glyph", text: f.kind === "other" ? f.path.split(".").pop() : f.kind }));
    if (f.kind !== "other") media.append(el("span", { class: "kind " + f.kind, text: f.kind }));
    const name = f.path.split("/").pop();
    const t = el("div", { class: "tile" + (selected.has(f.path) ? " selected" : ""), tabindex: 0, role: "button", "aria-pressed": selected.has(f.path) },
      media,
      small ? null : el("span", { class: "check", text: "✓", "aria-hidden": "true" }),
      small ? null : el("a", { class: "dl", href: fileUrl(f.path, true), download: name, title: "Download this file", onclick: (e) => e.stopPropagation() }, "↓"),
      el("div", { class: "meta" },
        el("span", { class: "tname", title: f.path, text: name }),
        el("span", { class: "tsub", text: `${fmtBytes(f.size)} · ${fmtAgo(f.mtime)}` }),
        // a made clip can start the next one; the tile itself is a select toggle, so this must not reach it
        !small && f.kind === "video"
          ? el("div", { class: "reuse-row" },
              el("button", { class: "reuse", type: "button", text: "Use this recipe",
                onclick: (e) => { e.stopPropagation(); useRecipe(f.path); } }),
              v ? make720Button(f, v, { class: "reuse",
                onclick: (e) => { e.stopPropagation(); make720(f.path); } }) : null)
          : !small && f.kind === "image"
            ? el("div", { class: "reuse-row" },
                el("button", { class: "reuse", type: "button", text: "Make a clip from this",
                  onclick: (e) => { e.stopPropagation(); imageToClip(f.path); } }),
                el("button", { class: "reuse", type: "button", text: "Edit this image",
                  onclick: (e) => { e.stopPropagation(); imageToEdit(f.path); } }),
                el("button", { class: "reuse", type: "button", text: "Upscale this",
                  onclick: (e) => { e.stopPropagation(); upscaleImage(f.path); } }),
                el("button", { class: "reuse", type: "button", text: "Custom upscale",
                  onclick: (e) => { e.stopPropagation(); upscaleImage(f.path, true); } }))
            : null));
    const toggle = () => {
      if (small) { showTab("outputs"); return; }
      selected.has(f.path) ? selected.delete(f.path) : selected.add(f.path);
      t.classList.toggle("selected", selected.has(f.path));
      t.setAttribute("aria-pressed", selected.has(f.path));
      updateSel();
    };
    t.addEventListener("click", toggle);
    t.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
    return t;
  }

  const visible = () => files.filter((f) => kind === "all" || f.kind === kind);
  function renderGallery() {
    const list = visible();
    $("#gallery").replaceChildren(...(list.length ? list.map((f) => tile(f)) : [el("p", { class: "empty", text: "No outputs yet. Run a workflow in ComfyUI; results appear here." })]));
    updateSel();
  }
  function renderLatest() {
    const list = files.filter((f) => f.kind !== "other").slice(0, 10);
    $("#latestOutputs").replaceChildren(...(list.length ? list.map((f) => tile(f, true)) : [el("p", { class: "empty", text: "Nothing generated yet." })]));
  }
  function chosen() {
    return selected.size ? files.filter((f) => selected.has(f.path)) : visible();
  }
  function updateSel() {
    const c = chosen();
    const bytes = c.reduce((a, f) => a + f.size, 0);
    $("#selInfo").textContent = selected.size
      ? `${selected.size} selected · ${fmtBytes(bytes)}`
      : `0 selected · ZIP = all ${c.length} (${fmtBytes(bytes)})`;
    $("#parts").hidden = true;
  }

  $$("#kindFilter button").forEach((b) => b.addEventListener("click", () => {
    kind = b.dataset.kind;
    $$("#kindFilter button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderGallery();
  }));
  $("#selectAll").addEventListener("click", () => { visible().forEach((f) => selected.add(f.path)); renderGallery(); });
  // "New since last ZIP": this browser remembers when it last downloaded a ZIP from this pod.
  const LAST_KEY = "aiangel-last-zip-" + location.host;
  const lastZip = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; } };
  $("#selectNew").addEventListener("click", () => {
    const since = lastZip();
    selected.clear();
    visible().filter((f) => f.mtime > since).forEach((f) => selected.add(f.path));
    renderGallery();
    toast(since ? `${selected.size} new since your last ZIP (${fmtAgo(since)})` : `No ZIP downloaded from this browser yet: all ${selected.size} selected`);
  });
  $("#selectNone").addEventListener("click", () => { selected.clear(); renderGallery(); });

  function splitParts(list, rule) {
    if (rule === "0") return [list];
    const parts = [];
    let cur = [], size = 0;
    const byCount = rule.startsWith("count");
    const limit = byCount ? Number(rule.slice(5)) : Number(rule) * GB;
    for (const f of [...list].sort((a, b) => a.mtime - b.mtime)) {
      const over = byCount ? cur.length >= limit : cur.length && size + f.size > limit;
      if (over) { parts.push(cur); cur = []; size = 0; }
      cur.push(f);
      size += f.size;
    }
    if (cur.length) parts.push(cur);
    return parts;
  }

  function postZip(list) {
    try {
      const newest = Math.max(...list.map((f) => f.mtime));
      if (newest > lastZip()) localStorage.setItem(LAST_KEY, String(newest));
    } catch { /* storage blocked: the button just selects everything next time */ }
    if (DEMO) { toast(`Demo: would download ${list.length} files`); return; }
    const form = el("form", { method: "POST", action: "api/outputs/zip", hidden: true },
      el("input", { name: "files", value: JSON.stringify(list.map((f) => f.path)) }));
    document.body.append(form);
    form.submit();
    form.remove();
  }

  $("#zipSelected").addEventListener("click", () => {
    const list = chosen();
    if (!list.length) { toast("No outputs to download", true); return; }
    const parts = splitParts(list, $("#partSize").value);
    if (parts.length === 1) { postZip(parts[0]); toast(`Preparing ZIP of ${list.length} files…`); return; }
    const box = $("#parts");
    box.replaceChildren(el("span", { class: "lead", text: `${parts.length} parts, oldest first. Download each:` }),
      ...parts.map((p, i) => {
        const b = el("button", { class: "btn", text: `Part ${i + 1} · ${p.length} files · ${fmtBytes(p.reduce((a, f) => a + f.size, 0))}` });
        b.addEventListener("click", () => { postZip(p); b.classList.add("ghost"); b.textContent = "✓ " + b.textContent; });
        return b;
      }));
    box.hidden = false;
  });

  /* Deleting takes the same selection as the ZIP, with two differences (owner 2026-09-18): it
     never falls back to "everything visible" the way the ZIP does — nothing is deleted that was
     not ticked — and it happens only after the confirm bar is answered. */
  function askDelete() {
    const list = files.filter((f) => selected.has(f.path));
    if (!list.length) { toast("Tick the files to delete first", true); return; }
    const bytes = list.reduce((a, f) => a + f.size, 0);
    $("#deleteAsk").textContent = `Delete ${list.length} file(s) · ${fmtBytes(bytes)}?`;
    $("#deleteConfirm").hidden = false;
  }
  $("#deleteSelected").addEventListener("click", askDelete);
  $("#deleteCancel").addEventListener("click", () => { $("#deleteConfirm").hidden = true; });
  $("#deleteGo").addEventListener("click", async () => {
    const list = files.filter((f) => selected.has(f.path)).map((f) => f.path);
    $("#deleteConfirm").hidden = true;
    if (!list.length) return;
    if (DEMO) { toast(`Demo: would delete ${list.length} files`); return; }
    $("#deleteSelected").disabled = true;
    try {
      const r = await api("outputs/delete", { files: list });
      selected.clear();
      toast(`Deleted ${r.deleted} file(s)`);
      await loadOutputs();
    } catch (e) {
      toast(e.message, true);
    } finally {
      $("#deleteSelected").disabled = false;
    }
  });

  /* ---------------- logs ---------------- */
  let logName = "boot";
  async function loadLog() {
    const box = $("#logBox");
    try {
      const r = await api(`logs?name=${logName}&lines=400`);
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      const tone = (line) =>
        /FAILED|ERROR|Traceback|Exception|exited \(code [1-9]/i.test(line) ? "l-bad"
          : /WARNING|MISMATCH|unknown preset/i.test(line) ? "l-warn"
            : /READY|synced|\bgot\b|\bhave\b|started/i.test(line) ? "l-ok"
              : /download|fetching|starting|install/i.test(line) ? "l-run" : null;
      box.replaceChildren(...(r.lines.length
        ? r.lines.map((line) => el("span", { class: tone(line) }, line + "\n"))
        : ["(empty)"]));
      if (atBottom) box.scrollTop = box.scrollHeight;
    } catch (e) { box.textContent = e.message; }
  }
  $$("#logPick button").forEach((b) => b.addEventListener("click", () => {
    logName = b.dataset.log;
    $$("#logPick button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("#logBox").textContent = "Loading…";
    loadLog();
  }));

  /* ---------------- make a clip ----------------
     The beginner path. Everything it needs the server already decides: the guided fields become
     the structured H3 prompt there, the real clip length comes back quantised, and the produced
     file is named the way Outputs names it. This file never composes a prompt of its own.

     genCast is the one list behind section 1: everything in the clip, in the order it was added.
     An entry may carry an uploaded picture or not, and its kind decides what the picture is FOR
     — a face to copy, a place to shoot in, an outfit to wear, an object to show. Picture numbers
     are positions among the entries that have a file, so <Picture 1> in the prompt is the first
     photo in this list, top to bottom. */
  let genMode = "guided", genCast = [], genPolling = false;
  let genShots = [{ what: "", seconds: 5, lines: [{ speaker: 1, text: "", language: "auto" }] }];
  // declared up here because the first draw already asks for a preview
  let previewTimer, previewBusy = false;

  const KINDS = [["person", "Person"], ["place", "Place"], ["outfit", "Outfit"], ["object", "Object"]];
  const LANGUAGE_CHOICES = [["auto", "Auto"], ["Thai", "ไทย"], ["English", "English"]];
  const PLACEHOLDER = {
    person: "who this is, e.g. a woman in her twenties",
    place: "where this is, e.g. a hotel room in Chiang Mai",
    outfit: "what this is, e.g. a white shirt and a black skirt",
    object: "what this is, e.g. a green coffee bag",
  };

  /* @mentions. The action and every shot are a small editor where typing @ lists everyone and
     every picture from step 1; the pick becomes a coloured chip that is deleted as one piece
     (owner 2026-09-16). Guessing that the words "thai man" meant Picture 1 was the bug this
     replaces: the user says who they mean, so nothing has to guess.

     A field's value is stored with `@{uid}` where a chip sits. uid belongs to the genCast entry,
     not its position, so removing or reordering step 1 can never point a chip at somebody else;
     only when the request is built does it become @[subject:N] or @[picture:N], which the
     server turns into <Subject N> / <Picture N>. */
  let nextUid = 1;
  const newEntry = (fields) => ({ uid: nextUid++, file: null, kind: "person", text: "", wornBy: null, ...fields });
  const byUid = (uid) => genCast.find((c) => c.uid === uid);
  // what can be mentioned: every person, and every picture that is something else
  const mentionable = () => genCast.filter((c) => c.kind === "person" || c.file);
  const TOKEN = /@\{(\d+)\}/g;

  function mentionsForServer(value) {
    return value.replace(TOKEN, (_, uid) => {
      const item = byUid(Number(uid));
      if (!item) return "";
      return item.kind === "person" ? `@[subject:${castNo(item)}]` : `@[picture:${pictureNo(item)}]`;
    });
  }

  function mentionLabel(item) {
    if (item.kind === "person") return castLabel(item, castNo(item) - 1);
    return item.text.trim() || `Picture ${pictureNo(item)}`;
  }

  function chip(item) {
    const n = el("span", { class: `chip k-${item.kind}`, contenteditable: "false", "data-uid": item.uid });
    fillChip(n, item);
    return n;
  }

  function fillChip(n, item) {
    n.className = `chip k-${item.kind}`;
    const face = item.url
      ? el("img", { src: item.url, alt: "" })
      : el("i", { text: item.kind === "person" ? "@" : "#" });
    n.replaceChildren(face, el("b", { text: mentionLabel(item) }),
      el("button", { type: "button", tabindex: "-1", title: "Remove", "aria-label": "Remove" }, "×"));
  }

  const menu = el("div", { class: "mention-menu", role: "listbox", hidden: true });
  document.body.append(menu);
  let menuFor = null, menuPick = 0, menuQuery = "";

  function closeMenu() { menu.hidden = true; menuFor = null; }

  function menuItems() {
    const q = menuQuery.toLowerCase();
    return mentionable().filter((c) => !q || mentionLabel(c).toLowerCase().includes(q));
  }

  function drawMenu() {
    const items = menuItems();
    menuPick = Math.min(menuPick, Math.max(items.length - 1, 0));
    menu.replaceChildren(...(items.length ? items.map((item, i) => {
      const row = el("div", { class: "opt" + (i === menuPick ? " on" : ""), role: "option" },
        item.url ? el("img", { src: item.url, alt: "" }) : el("i", { class: `k-${item.kind}`, text: "@" }),
        el("span", { text: mentionLabel(item) }),
        el("em", { text: KINDS.find(([v]) => v === item.kind)[1] }));
      // mousedown, not click: the editor must keep its caret for the chip to land there
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pickMention(item); });
      return row;
    }) : [el("div", { class: "none", text: genCast.length ? "Nobody by that name" : "Add someone or a photo in step 1 first" })]));
  }

  function caretQuery(box) {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE || !box.contains(node)) return null;
    const before = node.nodeValue.slice(0, sel.anchorOffset);
    // names have spaces in them ("thai woman"), so the query may too — but once it has a space
    // and matches nobody, the @ was just an @ and the list gets out of the way
    const m = before.replace(/ /g, " ").match(/(?:^|[\s(])@([^@\n]{0,30})$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    if (/\s/.test(q) && !mentionable().some((c) => mentionLabel(c).toLowerCase().includes(q))) return null;
    return { node, end: sel.anchorOffset, query: m[1] };
  }

  function pickMention(item) {
    const box = menuFor;
    const at = box && caretQuery(box);
    closeMenu();
    if (!at) return;
    const range = document.createRange();
    range.setStart(at.node, at.end - at.query.length - 1);
    range.setEnd(at.node, at.end);
    range.deleteContents();
    const c = chip(item);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(c);
    const sel = getSelection();
    sel.collapse(space, 1);
    box.sync();
  }

  function mentionBox({ value, placeholder, multiline, onChange }) {
    const box = el("div", { class: "mention-box" + (multiline ? " multi" : ""), contenteditable: "true",
      role: "textbox", "aria-multiline": multiline ? "true" : "false", spellcheck: "false", placeholder });

    function render(v) {
      const parts = [];
      let last = 0;
      for (const m of v.matchAll(TOKEN)) {
        parts.push(v.slice(last, m.index));
        const item = byUid(Number(m[1]));
        if (item) parts.push(chip(item));
        last = m.index + m[0].length;
      }
      parts.push(v.slice(last));
      box.replaceChildren(...parts.flatMap((p) => typeof p !== "string" ? [p]
        : p.split("\n").flatMap((t, i) => (i ? [el("br"), t] : [t])).filter((x) => x !== "")));
    }

    function read(node) {
      let out = "";
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
        else if (n.classList && n.classList.contains("chip")) out += `@{${n.dataset.uid}}`;
        else if (n.nodeName === "BR") out += "\n";
        // Chrome wraps a new line of a contenteditable in a <div>
        else if (n.nodeName === "DIV") out += (out && !out.endsWith("\n") ? "\n" : "") + read(n);
        else out += read(n);
      }
      return out;
    }

    box.sync = () => {
      const v = read(box).replace(/ /g, " ").replace(/\n+$/, "");
      box.classList.toggle("is-empty", !v.trim());
      onChange(v);
      // a chip picked or removed by mouse fires no input event, so the preview is asked here
      schedulePreview();
    };
    // after step 1 changes: relabel chips, and drop the ones whose person or picture is gone
    box.refresh = () => {
      let dropped = false;
      box.querySelectorAll(".chip").forEach((n) => {
        const item = byUid(Number(n.dataset.uid));
        if (item && (item.kind === "person" || item.file)) fillChip(n, item);
        else { n.remove(); dropped = true; }
      });
      if (dropped) box.sync();
    };

    box.addEventListener("input", () => {
      box.sync();
      const at = caretQuery(box);
      if (!at) return closeMenu();
      if (menuFor !== box || menuQuery !== at.query) menuPick = 0;
      menuFor = box;
      menuQuery = at.query;
      drawMenu();
      const r = document.createRange();
      r.setStart(at.node, at.end);
      const rect = r.getClientRects()[0] || box.getBoundingClientRect();
      menu.hidden = false;
      const left = Math.min(rect.left, innerWidth - menu.offsetWidth - 8);
      menu.style.left = `${Math.max(left, 8) + scrollX}px`;
      menu.style.top = `${rect.bottom + 6 + scrollY}px`;
    });
    box.addEventListener("keydown", (e) => {
      if (menuFor === box && !menu.hidden) {
        const n = menuItems().length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (n) menuPick = (menuPick + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
          return drawMenu();
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const item = menuItems()[menuPick];
          if (item) { e.preventDefault(); return pickMention(item); }
        }
        if (e.key === "Escape") { e.preventDefault(); return closeMenu(); }
      }
      if (e.key === "Enter" && !multiline) e.preventDefault();
    });
    box.addEventListener("click", (e) => {
      const x = e.target.closest(".chip button");
      if (!x) return;
      x.parentElement.remove();
      box.sync();
    });
    // plain text only: pasted markup would carry styles and stray elements into the prompt
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      let text = e.clipboardData.getData("text/plain");
      if (!multiline) text = text.replace(/\s*\n\s*/g, " ");
      document.execCommand("insertText", false, text);
    });
    box.addEventListener("blur", () => setTimeout(() => menuFor === box && closeMenu(), 120));

    // a restored recipe replaces the whole field
    box.setValue = (v) => {
      render(v);
      box.classList.toggle("is-empty", !v.trim());
      onChange(v);
    };

    render(value);
    box.classList.toggle("is-empty", !value.trim());
    return box;
  }

  const refreshMentions = () => $$(".mention-box").forEach((b) => b.refresh());

  const pictures = () => genCast.filter((c) => c.file);
  const pictureNo = (item) => (item.file ? pictures().indexOf(item) + 1 : null);
  const castOnly = () => genCast.filter((c) => c.kind === "person");
  const castNo = (item) => castOnly().indexOf(item) + 1;

  function castLabel(item, i) {
    // their own words identify them; the picture number only stands in when there are none
    const text = item.text.trim();
    const pic = pictureNo(item);
    return text || (pic ? `<Picture ${pic}>` : `Person ${i + 1}`);
  }

  /* Section 1: one row per person or picture. */
  function drawGenCast() {
    const people = castOnly();
    $("#genCast").replaceChildren(...genCast.map((item) => {
      const pic = pictureNo(item);
      // the picture itself, straight from the file the browser already holds — no round trip,
      // and it is the only way to be sure Picture 2 is the photo you think it is
      const tag = item.url
        ? el("span", { class: "thumb", title: `Picture ${pic}` },
            el("img", { src: item.url, alt: `Picture ${pic}` }),
            el("b", { text: pic }))
        : el("span", { class: "ref" + (item.file ? "" : " ghost"),
            text: item.file ? `Picture ${pic}` : "no photo" });
      const kind = el("select", { class: "reftype", title: "What this picture is for" });
      kind.replaceChildren(...KINDS
        .filter(([v]) => item.file || v === "person")   // no photo, nothing to reference
        .map(([v, t]) => el("option", { value: v, text: t })));
      kind.value = item.kind;
      kind.addEventListener("change", () => {
        item.kind = kind.value;
        if (item.kind !== "outfit") item.wornBy = null;
        drawGenCast();
        drawGenShots();
        refreshMentions();
      });
      const text = el("input", { class: "what", value: item.text, placeholder: PLACEHOLDER[item.kind] });
      text.addEventListener("input", () => {
        item.text = text.value;
        refreshLabels();
        refreshMentions();
      });
      // the pickers stay together on the left, so a narrow card wraps the long text field and
      // its remove button as one piece instead of stranding the ×
      const row = [tag, kind];
      if (item.kind === "outfit" && people.length) {
        const worn = el("select", { class: "wornby", title: "Who wears it" });
        worn.replaceChildren(...people.map((p, i) =>
          el("option", { value: String(i + 1), text: `worn by ${castLabel(p, i)}` })));
        worn.value = String(Math.min(item.wornBy || 1, people.length));
        item.wornBy = Number(worn.value);
        worn.addEventListener("change", () => { item.wornBy = Number(worn.value); });
        row.push(worn);
      }
      row.push(text);
      row.push(el("button", { class: "x", type: "button", title: "Remove",
        onclick: () => {
          genCast = genCast.filter((x) => x !== item);
          drawGenCast();
          drawGenShots();
          refreshMentions();
        } }, "×"));
      return el("div", { class: "castrow" }, ...row);
    }));
    if (!genCast.length) {
      $("#genCast").append(el("p", { class: "empty",
        text: "Nobody yet — H3 will invent whoever the clip needs." }));
    }
    schedulePreview();
  }

  /* ---------------- pinned frames ----------------
     The other way to give H3 a picture (owner 2026-09-18). A reference tells it what someone or
     somewhere looks like; a pin says "this picture IS frame N of the clip", which is what people
     mean by starting a clip from an image. The frame number is typed, not guessed: 0 is the
     first frame, -1 the last, and anything in between is a middle frame H3 has to reach. The
     server turns a pin at the first or the last frame into the model's own first_frame /
     last_frame input and anchors the rest with Add Guide nodes. */
  let genPins = [];

  // what LENGTH_EXPR works out to on the server: H3 renders whole 17k+5 frames at 24 fps
  function frameCount(seconds) {
    const frames = Math.max(5, Math.round(seconds * 24));
    // JS keeps the sign of the left operand in %, so the shift up to the next 5-mod-17 frame
    // count is wrapped back into 0..16 — Python's % does that on its own, this has to be told
    return frames + ((((5 - (frames % 17)) % 17) + 17) % 17);
  }

  function drawPinRange() {
    const frames = frameCount(clipSeconds());
    $("#genFrameHint").textContent = `${frames} frames at 24 fps · 0 to ${frames - 1}`;
    for (const row of $$("#genPins .pinrow")) row.refreshWhere?.();
  }

  function pinWhere(pin) {
    const frames = frameCount(clipSeconds());
    const at = pin.frame < 0 ? frames + pin.frame : pin.frame;
    if (!(at >= 0 && at < frames)) return "outside this clip";
    if (at === 0) return "first frame";
    if (at === frames - 1) return "last frame";
    return `${(at / 24).toFixed(2)}s in`;
  }

  function drawGenPins() {
    drawPinRange();
    $("#genPins").replaceChildren(...genPins.map((pin) => {
      const idx = el("input", { class: "idx mono", type: "number", step: "1", value: String(pin.frame),
        title: "Which frame this picture is" });
      const where = el("span", { class: "where small dim" });
      const showWhere = () => {
        const text = pinWhere(pin);
        where.textContent = text;
        where.classList.toggle("bad", text === "outside this clip");
      };
      idx.addEventListener("input", () => {
        pin.frame = idx.value.trim() === "" || Number.isNaN(Number(idx.value)) ? 0 : Math.trunc(Number(idx.value));
        showWhere();
      });
      showWhere();
      const thumb = pin.url
        ? el("button", { class: "thumb pin-thumb", type: "button", title: "Crop this frame",
            onclick: () => openCrop(pin) }, el("img", { src: pin.url, alt: "Pinned frame" }))
        : el("span", { class: "ref ghost", text: "uploading…" });
      const row = el("div", { class: "castrow pinrow" }, thumb,
        el("span", { class: "opt-k", text: "frame" }), idx, where,
        el("button", { class: "link crop-link", type: "button", text: "Crop",
          onclick: () => openCrop(pin) }),
        el("button", { class: "x", type: "button", title: "Remove",
          onclick: () => { genPins = genPins.filter((x) => x !== pin); drawGenPins(); } }, "×"));
      // the clip's length changes while these rows sit there, and a pin's "0.42s in" with it
      row.refreshWhere = showWhere;
      return row;
    }));
    if (!genPins.length) {
      $("#genPins").append(el("p", { class: "empty",
        text: "No frame pinned yet — add a picture and say which frame it is." }));
    }
  }

  async function uploadPicture(file) {
    const form = new FormData();
    form.append("file", file, file.name);
    const r = await fetch("api/beginner/upload", { method: "POST", body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data.filename;
  }

  /* Section 3: shots, each with the lines spoken inside it. The clip's length is split evenly
     between the shots on the server, so the timecodes here are what H3 will be told. */
  const SHOT_SECONDS = [2, 3, 4, 5, 6, 8, 10];
  const clipSeconds = () => genShots.reduce((n, s) => n + s.seconds, 0);

  function shotTimes(i) {
    const before = genShots.slice(0, i).reduce((n, s) => n + s.seconds, 0);
    const at = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    return `${at(before)}–${at(before + genShots[i].seconds)}`;
  }

  function drawClipLength() {
    const total = clipSeconds();
    $("#genLength").textContent = `${total}s`;
    // 15 s is the longest anyone has measured on this template; past that it is the user's risk
    $("#genLengthNote").textContent = total > 15 ? "longer than 15s may run out of memory" : "";
    // a shorter clip can put a pinned frame past the end, so the rows say so as it changes
    drawPinRange();
  }

  function lineRow(ln, shot, people) {
    const parts = [];
    if (people.length) {
      const pick = el("select", { class: "who" });
      pick.replaceChildren(...people.map((p, i) =>
        el("option", { value: String(i + 1), text: castLabel(p, i) })));
      pick.value = String(Math.min(ln.speaker, people.length));
      ln.speaker = Number(pick.value);
      pick.addEventListener("change", () => { ln.speaker = Number(pick.value); });
      parts.push(pick);
    }
    const lang = el("select", { class: "lang", title: "Which language this line is spoken in" });
    lang.replaceChildren(...LANGUAGE_CHOICES.map(([v, t]) => el("option", { value: v, text: t })));
    lang.value = ln.language || "auto";
    lang.addEventListener("change", () => { ln.language = lang.value; });
    const text = el("input", { class: "say", value: ln.text, placeholder: "สวัสดีค่ะ" });
    text.addEventListener("input", () => { ln.text = text.value; });
    parts.push(lang, text);
    if (shot.lines.length > 1) {
      parts.push(el("button", { class: "x", type: "button", title: "Remove this line",
        onclick: () => { shot.lines.splice(shot.lines.indexOf(ln), 1); drawGenShots(); } }, "×"));
    }
    return el("div", { class: "sayrow" }, ...parts);
  }

  // what the server needs: shots in order, each with only the lines that have words in them
  const shotsForServer = () =>
    genShots.map((s) => ({
      what: mentionsForServer(s.what),
      seconds: s.seconds,
      lines: s.lines.filter((ln) => ln.text.trim()),
    }));

  function drawGenShots() {
    const people = castOnly();
    $("#genShots").replaceChildren(...genShots.map((shot, i) => {
      const secs = el("select", { class: "secs", title: "How long this shot runs" });
      secs.replaceChildren(...SHOT_SECONDS.map((n) =>
        el("option", { value: String(n), text: `${n}s` })));
      secs.value = String(shot.seconds);
      secs.addEventListener("change", () => {
        shot.seconds = Number(secs.value);
        drawGenShots();
      });
      const head = el("div", { class: "shot-head" },
        el("span", { class: "shot-no", text: `Shot ${i + 1}` }),
        secs,
        el("span", { class: "shot-time mono", text: shotTimes(i) }));
      if (genShots.length > 1) {
        head.append(el("button", { class: "x", type: "button", title: "Remove this shot",
          onclick: () => { genShots.splice(i, 1); drawGenShots(); } }, "×"));
      }
      const what = mentionBox({ value: shot.what, multiline: false,
        placeholder: i === 0 ? "what happens here — blank uses step 2" : "what happens in this shot",
        onChange: (v) => { shot.what = v; } });
      what.classList.add("what");
      return el("div", { class: "shot" }, head, what,
        ...shot.lines.map((ln) => lineRow(ln, shot, people)),
        el("div", { class: "row tight" },
          el("button", { class: "link", type: "button",
            onclick: () => {
              // a reply usually comes from the other person, so the next line starts on them
              const last = shot.lines[shot.lines.length - 1];
              const next = people.length > 1 && last ? (last.speaker % people.length) + 1 : 1;
              shot.lines.push({ speaker: next, text: "", language: "auto" });
              drawGenShots();
            } }, "+ Add a line")));
    }));
    drawClipLength();
    schedulePreview();
  }

  // typing a description renames that person everywhere they are referred to, without
  // rebuilding the row being typed in
  function refreshLabels() {
    const people = castOnly();
    for (const pick of $$("#genShots .who, #genCast .wornby")) {
      const prefix = pick.classList.contains("wornby") ? "worn by " : "";
      [...pick.options].forEach((o, i) => (o.textContent = prefix + castLabel(people[i], i)));
    }
  }

  $("#genAddPhoto").addEventListener("click", () => $("#genRefs").click());

  $("#genAddPerson").addEventListener("click", () => {
    genCast.push(newEntry({}));
    drawGenCast();
    drawGenShots();
  });

  $("#genAddShot").addEventListener("click", () => {
    // a new shot usually answers the last one, so it starts on the other person
    const people = castOnly().length;
    const said = genShots.flatMap((s) => s.lines).filter((ln) => ln.text.trim());
    const last = said[said.length - 1];
    const next = people > 1 && last ? (last.speaker % people) + 1 : 1;
    genShots.push({ what: "", seconds: 5, lines: [{ speaker: next, text: "", language: "auto" }] });
    drawGenShots();
  });

  let genAction = "";
  /* Measured on a pod 2026-09-18: with the same seed, the same reference picture and the same
     Thai spoken line, an English action was performed (she turned, smiled, tucked her hair) while
     the Thai translation of it came back as her talking and nothing else. The prompt's shape is
     identical in both languages, so this is H3 reading Thai prose as speech, not our wording —
     and it is only this field: Thai works in the spoken lines, and Krea 2 reads Thai prompts
     fine. Nothing is blocked, because the user may know better than we do for their own sentence. */
  const THAI = /[฀-๿]/;
  const actionBox = mentionBox({ value: "", multiline: true,
    placeholder: "sit by the window of a cafe, look up from their coffee and smile",
    onChange: (v) => {
      genAction = v;
      $("#genActionThai").hidden = !THAI.test(v);
    } });
  $("#genActionField").append(actionBox);
  /* The look and the sound start filled with what the template does by default and are the
     user's to rewrite (owner 2026-09-16). These two strings match prompt_build.DEFAULT_STYLE /
     DEFAULT_SOUND; the voices are added on the server whenever someone speaks. */
  let genStyle = "Live-action, photorealistic";
  const styleBox = mentionBox({ value: genStyle, multiline: false,
    placeholder: "e.g. Live-action, photorealistic, golden hour",
    onChange: (v) => { genStyle = v; } });
  $("#genStyleField").append(styleBox);
  let genSound = "Ambient sound that matches the setting";
  const soundBox = mentionBox({ value: genSound, multiline: false,
    placeholder: "e.g. birds, a sitcom laugh track after the last line",
    onChange: (v) => { genSound = v; } });
  $("#genSoundField").append(soundBox);

  /* LoRAs: a stack on top of the model, the same control for a clip and for an image (owner
     2026-09-20 — an image had none at all, which is why NSFW would not come out). The files come
     from the pod's models/loras, read fresh when the tab opens; picking a file the owner has a
     recipe for starts it at that strength and shows its trigger word, which the user types in
     themselves. The server sets the ceiling; it is six, because concept LoRAs are normally
     stacked rather than used one at a time. */
  let loraChoices = [], loraMax = 6;
  const loraStacks = [];

  let loraDrawn = false;

  async function loadLoraChoices() {
    let r;
    try {
      r = await api("beginner/loras");
    } catch {
      return; /* the pod is starting; the next poll tries again, and nothing on screen changes */
    }
    const same = r.max === loraMax
      && r.loras.length === loraChoices.length
      // family too: a file still arriving reads as unplaced and gains its family when it finishes
      && r.loras.every((c, i) => c.name === loraChoices[i].name && c.family === loraChoices[i].family);
    loraChoices = r.loras;
    loraMax = r.max;
    // the image form opens with a prompt-unlock LoRA already in it when the pod has one (owner
    // 2026-09-20), and only until the user has touched that stack themselves. Those LoRAs are
    // Krea 2's, so the row is not seeded when the form is on another model.
    const seeded = r.image_default && imgFamily() === "krea2"
      ? imgLoraStack.seed([r.image_default]) : false;
    // redraw only when what is on offer really changed: this runs on the poll, and a redraw
    // would throw away whatever the user is typing into a picker right now
    if (!same || seeded || !loraDrawn) {
      loraDrawn = true;
      loraStacks.forEach((s) => s.draw());
    }
  }

  /* `family` is the base model this form runs: a LoRA trained on the other one cannot load, so
     offering it is offering a failed job (owner 2026-09-20). The server reads each file to say
     which it is; one it cannot place comes back null and is offered in both, because an unplaced
     LoRA is most likely the user's own and hiding it would be worse than listing it.
     It may be a function, because the image form's family follows its model row. */
  function loraStack(listId, addId, onChange, family) {
    let rows = [], touched = false;
    const familyNow = () => (typeof family === "function" ? family() : family);
    const forThisForm = () => loraChoices.filter((c) => !c.family || c.family === familyNow());
    const hint = (name) => forThisForm().find((c) => c.name === name) || {};

    /* The file picker is a box you type into, not a dropdown (owner 2026-09-20: "lora dashboard
       เรา มัน search ได้ไหมนะ"). A <select> only jumps to what a name STARTS with, and these
       names do not start with the word you remember them by — the kit's Realism Enhancer is
       called SummerVibesHM_krea2_epoch8. So typing matches anywhere in the name, and every word
       you type has to appear, which is how "phone 2020" finds one file out of four. */
    function comboBox(lo, onPick) {
      const known = forThisForm().map((c) => c.name);
      // a restored recipe may name a file this pod does not have; it stays pickable, marked
      const names = lo.name && !known.includes(lo.name) ? [lo.name, ...known] : known;
      const label = (n) => (known.includes(n) ? n : `${n} (not on this pod)`);
      const box = el("input", {
        class: "lora-file", type: "text", autocomplete: "off", spellcheck: "false",
        placeholder: "Pick a LoRA", value: lo.name, title: "LoRA file in models/loras",
      });
      const list = el("div", { class: "combo-list", hidden: true });
      let shown = [], active = -1;

      const choose = (name) => {
        box.value = name;
        list.hidden = true;
        onPick(name);
      };

      function render() {
        // every typed word must appear somewhere in the name, in any order
        const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
        shown = names.filter((n) => {
          const hay = n.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        active = shown.length ? 0 : -1;
        list.replaceChildren(...(shown.length
          ? shown.map((n, i) => el("button", {
            class: "combo-opt" + (i === active ? " on" : ""), type: "button",
            // mousedown, not click: blur would close the list before a click landed
            onmousedown: (e) => { e.preventDefault(); choose(n); },
          }, label(n)))
          // an empty list has two quite different reasons, and the user can act on only one of
          // them: nothing MATCHES what they typed, or this model has no LoRA on the pod at all —
          // which is where Qwen Image 2.1 stands today, since nobody has trained one for it yet
          : [el("p", { class: "small dim empty", text: names.length
            ? "No LoRA matches that."
            : "No LoRA on this pod fits this model." })]));
      }

      const mark = () => $$(".combo-opt", list).forEach(
        (b, i) => b.classList.toggle("on", i === active));

      // opening it empties the box so the whole list is there to browse; leaving without picking
      // puts the row's own file back, so a click that changes nothing changes nothing
      box.addEventListener("focus", () => { box.value = ""; render(); list.hidden = false; });
      box.addEventListener("input", () => { render(); list.hidden = false; });
      box.addEventListener("blur", () => {
        list.hidden = true;
        // half-typed text is not a choice; the box goes back to what the row actually holds
        if (box.value !== lo.name) box.value = lo.name;
      });
      box.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!shown.length) return;
          list.hidden = false;
          active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
          mark();
          $$(".combo-opt", list)[active].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" || e.key === "Return") {
          e.preventDefault();
          if (!list.hidden && active >= 0) choose(shown[active]);
        } else if (e.key === "Escape" || e.key === "Esc") {
          list.hidden = true;
          box.value = lo.name;
          box.blur();
        }
      });
      return el("div", { class: "combo" }, box, list);
    }

    function draw() {
      $("#" + listId).replaceChildren(...rows.map((lo) => {
        const strength = el("input", { class: "lora-strength", type: "number", step: "0.05",
          min: "-2", max: "2", value: String(lo.strength), title: "Strength" });
        const trigger = hint(lo.name).trigger;
        const pick = comboBox(lo, (name) => {
          touched = true;
          lo.name = name;
          if (hint(name).strength !== undefined) lo.strength = hint(name).strength;
          draw();
          if (onChange) onChange();
        });
        strength.addEventListener("input", () => {
          touched = true;
          lo.strength = Number(strength.value);
        });
        return el("div", { class: "lorarow" }, pick, strength,
          el("button", { class: "x", type: "button", title: "Remove",
            onclick: () => { touched = true; rows.splice(rows.indexOf(lo), 1); draw(); } }, "×"),
          trigger ? el("span", { class: "small dim lora-trigger" }, "trigger word ",
            el("b", { class: "mono", text: trigger })) : null);
      }));
      $("#" + addId).hidden = rows.length >= loraMax;
      if (!forThisForm().length && !rows.length) {
        $("#" + listId).append(el("p", { class: "small dim empty",
          text: "No LoRA files on this pod yet." }));
      }
    }

    $("#" + addId).addEventListener("click", () => {
      if (rows.length >= loraMax) return;
      touched = true;
      rows.push({ name: "", strength: 1 });
      draw();
    });

    const stack = {
      draw,
      forServer: () => rows.filter((lo) => lo.name)
        .map((lo) => ({ name: lo.name, strength: lo.strength })),
      // a recipe replaces the stack outright and counts as the user's own doing, so a replay of a
      // picture made without LoRAs never has one added back
      set: (list) => {
        touched = true;
        rows = (list || []).slice(0, loraMax).map((lo) => ({ name: lo.name, strength: lo.strength }));
        draw();
      },
      // the suggested opening row: only before the user has touched this stack at all.
      // Returns whether it took, so the caller knows a redraw is needed.
      seed: (list) => {
        if (touched || rows.length) return false;
        rows = list.map((lo) => ({ name: lo.name, strength: lo.strength }));
        return true;
      },
      // after the form switches model family: drop the rows that cannot load on the new one.
      // A file the server could not place stays, as it does in the picker.
      dropForeign: () => {
        const ok = new Set(forThisForm().map((c) => c.name));
        rows = rows.filter((lo) => !lo.name || ok.has(lo.name));
      },
    };
    loraStacks.push(stack);
    return stack;
  }

  const genLoraStack = loraStack("genLoras", "genAddLora", schedulePreview, "h3");
  // the image form's family is whichever model its own row has selected
  const imgLoraStack = loraStack("imgLoras", "imgAddLora", null, () => imgFamily());
  const lorasForServer = () => genLoraStack.forServer();

  /* Recipes: a finished clip keeps the form it was made from (the server writes it beside the
     file), and "Use this recipe" in Outputs puts it back. A clip with no stored form — made in
     ComfyUI, or copied from another pod — still carries its H3 prompt, which comes back as one
     block in "Write the prompt myself" (owner 2026-09-16). */
  /* The clip's Seed field works like the image one: empty means a new clip every time, a typed
     number gives the same clip back (Takes add 1, 2, 3 to it), and the last seed used — a made
     clip's, or a loaded recipe's — is one click away rather than filled in for you. */
  let lastClipSeed = null;

  function offerClipSeed(seed) {
    if (!Number.isInteger(seed)) return;
    lastClipSeed = seed;
    $("#genSeedLast").textContent = `reuse ${seed}`;
    $("#genSeedLast").hidden = false;
  }

  $("#genSeedLast").addEventListener("click", () => {
    if (lastClipSeed !== null) $("#genSeed").value = lastClipSeed;
  });

  // the browser's own state, stored as it is; uids stay, so the @ chips point at the same entries
  const formState = () => ({
    cast: genCast.map(({ uid, kind, text, file, wornBy }) => ({ uid, kind, text, file, wornBy })),
    action: genAction, style: genStyle, sound: genSound, loras: lorasForServer(),
    shots: JSON.parse(JSON.stringify(genShots)),
    // which of the two picture modes the form was in, and the pins as they were typed
    source: clipSource,
    pins: genPins.filter((p) => p.file).map(({ file, frame }) => ({ file, frame })),
  });

  const refUrl = (name) => (DEMO ? "" : `api/beginner/ref?name=${encodeURIComponent(name)}`);

  /* "Make it 720p": the same recipe and the same seed with the upscaler on. H3 then renders the
     same shots at 704x1280, so this is a re-run in one click, not a filter over the old file.
     It must stay the upscale route: native 720p with the same seed is a different clip
     (measured 2026-09-17), which is not what someone who liked this clip asked for. */
  async function make720(path) {
    const r = await useRecipe(path);
    if (!r) return;
    const fail = (text) => { $("#genMsg").textContent = text; };
    if (r.upscale || r.hd) return fail("This clip is already 720p.");
    if (!Number.isInteger(r.seed)) return fail("This clip has no seed, so the same shots cannot be made again.");
    if ((r.missing_refs || []).length) return fail("Its reference pictures are not on this pod, so it cannot be remade.");
    if (!upscaleReady) return fail("720p needs h3upscaler in MODELS when the pod starts.");
    $("#genSeed").value = r.seed;
    $("#genUpscale").checked = false;
    pendingUpscale = true;
    $("#genStart").click();
  }

  async function useRecipe(path) {
    let r;
    try {
      r = await api(`outputs/recipe?path=${encodeURIComponent(path)}`);
    } catch (e) { toast(e.message, true); return null; }
    const missing = new Set(r.missing_refs || []);
    const name = path.split("/").pop();
    // A clip the Shopee or Story tab made goes back into that tab's form, not the Create form.
    // Nothing is returned, so "Make it 720p" stops here instead of pressing the Create form's
    // button on whatever that form holds; the tab's own 720p box remakes it.
    if (r.form?.shopee && window.ShopeeTab) {
      showTab("shopee");
      window.ShopeeTab.loadRecipe(r, name);
      return null;
    }
    if (r.form?.story && window.StoryTab) {
      showTab("story");
      window.StoryTab.loadRecipe(r, name);
      return null;
    }
    if (r.kind === "image") {
      setMedium("image");
      $("#imgPrompt").value = r.prompt || "";
      setSeg("imgAspect", "aspect", r.aspect || "9:16");
      imgLoraStack.set(r.loras);
      loadLoraChoices();
      // the model comes back first, because it decides how many pictures the form takes
      await loadImageModels(r.unet);
      setImgMode(r.mode === "edit" ? "edit" : "t2i");
      const refs = r.refs || [];
      const here = refs.filter((f) => !missing.has(f));
      // keep the FIRST pictures, not the last: with Qwen 2.1 the first one sets the size, and a
      // one-picture model must not end up holding what was <image2>
      imgSources = here.slice(0, imgSourceMax());
      drawImgSources();
      const lost = refs.length - here.length;
      $("#imgMsg").textContent = lost
        ? `Loaded ${name}. ${lost === refs.length ? "Its photo is" : `${lost} of its photos are`}`
          + " not on this pod — pick again."
        : `Loaded ${name}.`;
      showTab("create");
      return r;
    }
    setMedium("clip");
    setSeg("genAspect", "aspect", r.aspect || "9:16");
    // the pins come from the recipe itself (or, for an older clip, out of its own graph), so a
    // remake anchors the same pictures at the same frames
    genPins = (r.keyframes || [])
      .filter((k) => !missing.has(k.file))
      .map((k) => ({ file: k.file, frame: k.frame, url: refUrl(k.file), src: refUrl(k.file) }));
    // the picture on the pod is already a finished frame, so it is not re-uploaded; loading it
    // is only so the crop window can open on it
    genPins.forEach((pin) => loadImage(pin.src).then((img) => { pin.img = img; }).catch(() => {}));
    setClipSource(genPins.length ? "frame" : "ref");
    $("#genFast").checked = r.fast === true && !(createNeeds.fast || []).length;
    // `=== true`, not `!== false`: a recipe saved before sparse attention existed has no such
    // field at all, and that clip was made dense. Falling back to the new default would replay
    // it as a different render under the same "use this recipe" button.
    $("#genSparse").checked = r.sparse === true;
    if (r.form) {
      const f = r.form;
      // a picture this pod no longer has cannot come back; a person keeps their words without it
      genCast = (f.cast || [])
        .map((c) => ({ ...c, file: c.file && !missing.has(c.file) ? c.file : null }))
        .filter((c) => c.file || c.kind === "person")
        .map((c) => ({ ...c, kind: c.file ? c.kind : "person", url: c.file ? refUrl(c.file) : undefined }));
      nextUid = Math.max(0, ...genCast.map((c) => c.uid || 0)) + 1;
      genShots = f.shots && f.shots.length ? f.shots : genShots;
      actionBox.setValue(f.action || "");
      styleBox.setValue(f.style ?? "");
      soundBox.setValue(f.sound ?? "");
      if (r.mode === "free") $("#genPrompt").value = r.prompt || "";
    } else {
      // no form: the prompt as one block, with its pictures in the same order so <Picture N> holds
      genCast = r.refs.filter((f) => !missing.has(f)).map((file) => newEntry({ file, url: refUrl(file) }));
      $("#genPrompt").value = r.prompt || "";
      const secs = Math.round(r.seconds || 0);
      if (secs) genShots = [{ what: "", seconds: SHOT_SECONDS.includes(secs) ? secs : 5, lines: [] }];
    }
    // the recipe's own LoRA list wins: it is what the graph actually loaded
    genLoraStack.set(r.loras);
    loadLoraChoices();
    drawGenCast();
    drawGenShots();
    const mode = r.form ? r.mode : "free";
    $$("#genMode button").forEach((b) => b.dataset.mode === mode && b.click());
    $("#genSeed").value = "";
    if (Number.isInteger(r.seed)) offerClipSeed(r.seed);
    $("#genMsg").textContent = missing.size
      ? `Loaded ${name}. ${missing.size} reference picture(s) are not on this pod — add them again.`
      : `Loaded ${name}.`;
    $("#genUpscale").checked = r.hd === true;
    drawEstimate();
    showTab("create");
    schedulePreview();
    return r;
  }

  drawGenCast();
  drawGenShots();

  const genSet = (id, value) => $$("#" + id + " button").forEach((b) => b.setAttribute("aria-pressed", b === value));

  $$("#genMode button").forEach((b) => b.addEventListener("click", () => {
    genMode = b.dataset.mode;
    genSet("genMode", b);
    $("#genGuided").hidden = genMode !== "guided";
    $("#genFree").hidden = genMode !== "free";
  }));


  /* Reference or Frame: the same clip form, told what the pictures in it mean.

     In Frame mode the pinned pictures already say what everyone looks like, so step 1 stops
     asking for photos (a photo there would be a reference, which is the other mode) and asks
     only for the people who speak — their words are what the dialogue picker and the @ list are
     built from, and the prompt names them <Subject 1>.. with no <Picture N> at all. The step
     numbers are drawn from whichever steps are showing, so Frame mode reads 1-2-3-4. */
  let clipSource = "ref";
  const CAST_COPY = {
    ref: ["Who is in it",
      "A photo keeps a real face across every frame. Someone without a photo is invented by H3 — fine for the other half of a conversation."],
    frame: ["Who is in it",
      "The pinned frames already say what everyone looks like. Add them here to give each person a name you can @mention below — and to pick who says which line."],
  };
  function numberSteps() {
    const steps = $$("#clipCard .step").filter((s) => !s.hidden && s.offsetParent !== null);
    steps.forEach((s, i) => { const n = $(".n", s); if (n) n.textContent = String(i + 1); });
  }
  function setClipSource(s) {
    clipSource = s;
    genSet("clipSource", $(`#clipSource button[data-source="${s}"]`));
    $("#genFrameStep").hidden = s !== "frame";
    $("#genAddPhoto").hidden = s === "frame";
    $("#clipSourceNote").textContent = s === "frame"
      ? "Each picture is pinned to one frame of the clip, so the clip really starts (or ends) on it."
      : "H3 copies the face, the place or the outfit out of a reference picture, but nothing says which frame it belongs to.";
    const [title, help] = CAST_COPY[s];
    $("#genCastTitle").textContent = title;
    $("#genCastHelp").textContent = help;
    if (s === "frame") drawGenPins();
    numberSteps();
    schedulePreview();
  }
  $$("#clipSource button").forEach((b) => b.addEventListener("click", () => setClipSource(b.dataset.source)));

  /* ---------------- the crop window ----------------
     A pinned picture becomes a frame of the clip, so it has to have the clip's shape. The crop
     happens here in the browser and what gets uploaded IS the finished frame (owner 2026-09-18:
     "ทำไมไม่ crop จากฝั่ง ui ไปเลย") — nothing downstream has to guess what was meant, and the
     graph carries one plain picture per pin.

     The window is the clip's shape and the picture moves under it, the way a profile-photo
     cropper works: no box to line up, and no way to choose a rectangle that is the wrong shape.
     A pin keeps the original picture and its view (zoom + offset), so changing Shape re-cuts
     every pin from the original instead of cutting an already-cut picture. */
  const CLIP_SIZES = {
    "9:16": { normal: [576, 1024], hd: [704, 1280] },
    "16:9": { normal: [1024, 576], hd: [1280, 704] },
    "1:1": { normal: [768, 768], hd: [960, 960] },
  };
  const STAGE_MAX = { w: 300, h: 380 };
  let cropping = null;  // the pin the window is open for

  /* The clip's real pixel size, 720p included: a pin is cut to exactly this, so the picture the
     graph loads never has to be resized up. (The graph still fits every pin to the clip's size
     as a backstop — a picture from a hand-built graph, or a recipe reused at another shape — but
     that path can only cost sharpness or crop, never distort.) */
  const clipSize = () => {
    const shape = CLIP_SIZES[segValue("genAspect", "aspect") || "9:16"];
    return $("#genUpscale").checked ? shape.hd : shape.normal;
  };

  function stageSize() {
    const [w, h] = clipSize();
    const scale = Math.min(STAGE_MAX.w / w, STAGE_MAX.h / h);
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  const loadImage = (url) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("this file could not be read as a picture"));
    img.src = url;
  });

  /** The view that shows as much of the picture as its shape allows, centred. */
  function fitView(pin, stage) {
    const cover = Math.max(stage.w / pin.img.naturalWidth, stage.h / pin.img.naturalHeight);
    return { zoom: 1, tx: (stage.w - pin.img.naturalWidth * cover) / 2,
             ty: (stage.h - pin.img.naturalHeight * cover) / 2, cover };
  }

  function clampView(pin, stage) {
    const v = pin.view;
    const s = v.cover * v.zoom;
    const w = pin.img.naturalWidth * s, h = pin.img.naturalHeight * s;
    v.tx = Math.min(0, Math.max(stage.w - w, v.tx));
    v.ty = Math.min(0, Math.max(stage.h - h, v.ty));
  }

  /** Draw the part of the picture the window shows, at the clip's own pixel size. */
  async function renderPin(pin) {
    const stage = stageSize();
    if (!pin.view || pin.view.aspect !== segValue("genAspect", "aspect")) {
      pin.view = { ...fitView(pin, stage), aspect: segValue("genAspect", "aspect") };
    }
    clampView(pin, stage);
    const [W, H] = clipSize();
    const s = pin.view.cover * pin.view.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    canvas.getContext("2d").drawImage(
      pin.img, -pin.view.tx / s, -pin.view.ty / s, stage.w / s, stage.h / s, 0, 0, W, H);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.95));
    pin.url = canvas.toDataURL("image/jpeg", 0.7);   // the row's thumbnail, no round trip
    pin.file = await uploadPicture(new File([blob], "frame.jpg", { type: "image/jpeg" }));
  }

  async function addPin(src, label) {
    // a new pin lands on the first frame, then the last, then the middle of what is left:
    // the frame numbers people actually want, and every one of them still editable
    const used = new Set(genPins.map((p) => p.frame));
    const frame = !used.has(0) ? 0 : !used.has(-1) ? -1 : Math.round(frameCount(clipSeconds()) / 2);
    const pin = { file: null, url: null, frame, src };
    genPins.push(pin);
    drawGenPins();
    try {
      pin.img = await loadImage(src);
      await renderPin(pin);
    } catch (err) {
      genPins = genPins.filter((x) => x !== pin);
      $("#genMsg").textContent = `${label} — ${err.message}`;
    }
    drawGenPins();
    return pin;
  }

  function drawCrop() {
    const pin = cropping;
    if (!pin) return;
    const stage = stageSize(), [W, H] = clipSize();
    const box = $("#cropStage"), img = $("#cropImg");
    box.style.width = stage.w + "px";
    box.style.height = stage.h + "px";
    $("#cropSize").textContent = `${segValue("genAspect", "aspect")} · ${W}×${H}`;
    clampView(pin, stage);
    const s = pin.view.cover * pin.view.zoom;
    img.src = pin.src;
    img.style.width = pin.img.naturalWidth * s + "px";
    img.style.height = pin.img.naturalHeight * s + "px";
    img.style.transform = `translate(${pin.view.tx}px, ${pin.view.ty}px)`;
    $("#cropZoom").value = String(Math.round(pin.view.zoom * 100));
  }

  function openCrop(pin) {
    if (!pin.img) return;
    cropping = pin;
    // edits apply on "Use this crop", so Cancel really does leave the pin as it was
    cropping.saved = { ...pin.view };
    $("#cropSheet").hidden = false;
    drawCrop();
  }

  function closeCrop(keep) {
    if (cropping && !keep) cropping.view = cropping.saved;
    cropping = null;
    $("#cropSheet").hidden = true;
  }

  $("#cropZoom").addEventListener("input", () => {
    if (!cropping) return;
    const stage = stageSize();
    const before = cropping.view.zoom;
    const after = Number($("#cropZoom").value) / 100;
    // zoom around the middle of the window, so the face you centred stays centred
    const k = after / before;
    cropping.view.zoom = after;
    cropping.view.tx = stage.w / 2 - (stage.w / 2 - cropping.view.tx) * k;
    cropping.view.ty = stage.h / 2 - (stage.h / 2 - cropping.view.ty) * k;
    drawCrop();
  });
  $("#cropReset").addEventListener("click", () => {
    if (!cropping) return;
    cropping.view = { ...fitView(cropping, stageSize()), aspect: segValue("genAspect", "aspect") };
    drawCrop();
  });
  $("#cropCancel").addEventListener("click", () => closeCrop(false));
  $("#cropSheet").addEventListener("mousedown", (e) => {
    if (e.target === $("#cropSheet")) closeCrop(false);
  });
  $("#cropSave").addEventListener("click", async () => {
    const pin = cropping;
    closeCrop(true);
    $("#cropSave").disabled = true;
    try {
      await renderPin(pin);
    } catch (err) {
      $("#genMsg").textContent = err.message;
    }
    $("#cropSave").disabled = false;
    drawGenPins();
  });

  // drag the picture under the window
  (() => {
    const stage = $("#cropStage");
    let from = null;
    stage.addEventListener("mousedown", (e) => {
      if (!cropping) return;
      e.preventDefault();
      from = { x: e.clientX, y: e.clientY, tx: cropping.view.tx, ty: cropping.view.ty };
    });
    window.addEventListener("mousemove", (e) => {
      if (!from || !cropping) return;
      cropping.view.tx = from.tx + (e.clientX - from.x);
      cropping.view.ty = from.ty + (e.clientY - from.y);
      drawCrop();
    });
    window.addEventListener("mouseup", () => { from = null; });
  })();

  $("#genAddPin").addEventListener("click", () => $("#genPinFiles").click());
  $("#genPinFiles").addEventListener("change", async (e) => {
    const picked = [...e.target.files];
    e.target.value = "";
    for (const file of picked) await addPin(URL.createObjectURL(file), file.name);
  });

  $("#genRefs").addEventListener("change", async (e) => {
    const picked = [...e.target.files];
    e.target.value = "";
    for (const file of picked) {
      const item = newEntry({ url: URL.createObjectURL(file) });
      genCast.push(item);
      drawGenCast();
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const r = await fetch("api/beginner/upload", { method: "POST", body: form });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        item.file = data.filename;
      } catch (err) {
        genCast = genCast.filter((x) => x !== item);
        $("#genMsg").textContent = `${file.name} — ${err.message}`;
      }
      drawGenCast();
      drawGenShots();
      refreshMentions();
    }
  });

  $("#genLoadExample").addEventListener("click", async () => {
    // the example lives with the graph builder on the server, so there is one copy of it
    try {
      const r = await api("beginner/example");
      $("#genPrompt").value = r.prompt;
    } catch (e) { toast(e.message, true); }
  });

  $("#genCopyPrompt").addEventListener("click", () => {
    $("#genPrompt").value = $("#genPreview").textContent;
    $$("#genMode button").forEach((b) => b.dataset.mode === "free" && b.click());
  });

  /* ---------------- render settings shared by clips and images ---------------- */
  const segValue = (id, key) => $(`#${id} button[aria-pressed="true"]`)?.dataset[key];
  function setSeg(id, key, value) {
    $$(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", b.dataset[key] === value));
  }
  for (const [id, key] of [["genAspect", "aspect"], ["genTakes", "takes"], ["imgAspect", "aspect"],
    ["imgTakes", "takes"], ["imgMegapixels", "megapixels"]]) {
    $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
      setSeg(id, key, b.dataset[key]);
      if (id === "genAspect") { schedulePreview(); recutPins(); }
      if (id === "imgAspect" || id === "imgMegapixels") drawImgSize();
      drawEstimate();
    }));
  }

  /* The size the picture will really come out at. Both graphs need each side to be a multiple of
     32, so the arithmetic here is the server's (image_workflows._size) — shown rather than
     described, because "2 MP" tells nobody whether their 9:16 wallpaper will be tall enough. */
  function drawImgSize() {
    const mp = Number(segValue("imgMegapixels", "megapixels") || 1);
    const [w, h] = { "9:16": [768, 1344], "16:9": [1344, 768], "1:1": [1024, 1024] }[
      segValue("imgAspect", "aspect") || "9:16"] || [1024, 1024];
    const hint = $("#imgSizeHint");
    if (!hint) return;
    if (mp === 1) { hint.textContent = `${w} × ${h}`; return; }
    const ratio = w / h;
    const total = mp * 1024 * 1024;
    const round32 = (n) => Math.max(32, Math.round(n / 32) * 32);
    hint.textContent = `${round32(Math.sqrt(total * ratio))} × ${round32(Math.sqrt(total / ratio))}`;
  }

  /* The clip's shape changed, so every pinned frame is cut again from its ORIGINAL picture —
     cutting the already-cut one would crop a crop. A pin restored from a recipe has only the
     picture on the pod, which is already a frame; re-cutting that is the best there is. */
  async function recutPins() {
    if (clipSource !== "frame" || !genPins.length) return;
    for (const pin of genPins) {
      if (!pin.img) continue;
      try {
        await renderPin(pin);
      } catch (err) {
        $("#genMsg").textContent = err.message;
      }
    }
    drawGenPins();
  }
  for (const id of ["genUpscale", "genFast", "genSparse"]) $("#" + id).addEventListener("change", drawEstimate);
  // 720p renders at 704x1280 instead of 576x1024, so the pinned frames are cut again at that size
  // rather than being handed to the graph small and upscaled there
  $("#genUpscale").addEventListener("change", () => recutPins());

  /* Clip or image: one tab, two forms, one queue. */
  let medium = "clip";
  function setMedium(m) {
    medium = m;
    setSeg("createMedium", "medium", m);
    $("#clipCard").hidden = m !== "clip";
    $("#imageCard").hidden = m !== "image";
    $("#promptCard").hidden = m !== "clip";
    drawEstimate();
  }
  $$("#createMedium button").forEach((b) => b.addEventListener("click", () => setMedium(b.dataset.medium)));

  /* What still has to be downloaded, straight from /api/state: Fast needs h3fast, image mode
     needs krea2 (+ krea2edit to edit). A missing one is offered as a download right there
     instead of a button that fails (owner 2026-09-17). */
  const presetBytes = (names) => (state?.presets || [])
    .filter((p) => names.includes(p.name))
    .flatMap((p) => p.files.filter((f) => f.state !== "have"))
    .reduce((a, f) => a + f.size - Math.min(f.have_bytes, f.size), 0);
  const presetBusy = (names) => (state?.presets || [])
    .filter((p) => names.includes(p.name))
    .some((p) => p.files.some((f) => f.state === "downloading" || f.state === "queued"));

  function renderNeeds() {
    const fastNeeds = createNeeds.fast || [];
    const fastOff = fastNeeds.length > 0;
    $("#genFast").disabled = fastOff;
    if (fastOff) $("#genFast").checked = false;
    $("#genFastRow").classList.toggle("is-disabled", fastOff);
    const getFast = $("#genFastGet");
    getFast.hidden = !fastOff;
    getFast.disabled = presetBusy(fastNeeds);
    getFast.textContent = presetBusy(fastNeeds)
      ? "Fast models downloading…" : `Download Fast models (${fmtBytes(presetBytes(fastNeeds))})`;

    // what the model the form is ON still needs — picking Qwen 2.1 on a pod that only has Krea 2
    // is how a user asks for it, and this is the answer
    const needs = imgFamilyNeeds(imgMode === "edit" ? "edit" : "t2i");
    const box = $("#imgNeed");
    box.hidden = !needs.length;
    $("#imgStart").disabled = needs.length > 0;
    // with the model already here, only the edit's extra LoRA is missing: say that, not
    // "no image models"
    $("#imgNeedTitle").textContent = imgMode === "edit" && !imgFamilyNeeds("t2i").length
      ? "Editing needs one more model" : "Image models are not on this pod yet";
    if (needs.length) {
      const busy = presetBusy(needs);
      $("#imgNeedText").textContent = busy
        ? `Downloading ${needs.join(" + ")} — this unlocks by itself when it finishes.`
        : `${imgMode === "edit" ? "Editing" : "Making an image"} needs ${needs.join(" + ")} · ${fmtBytes(presetBytes(needs))}. No restart needed.`;
      $("#imgNeedGet").disabled = busy;
      $("#imgNeedGet").textContent = busy ? "Downloading…" : "Download";
    }
  }
  async function getPresets(names) {
    for (const name of names) await addPreset(name);
  }
  $("#genFastGet").addEventListener("click", () => getPresets(createNeeds.fast || []));
  $("#imgNeedGet").addEventListener("click", () =>
    getPresets(imgFamilyNeeds(imgMode === "edit" ? "edit" : "t2i")));

  /* Estimate: warm times measured on an RTX PRO 6000 (2026-09-14..17). 576p and native 720p
     fitted as a*s + b*s² through the 5 s and 10 s clips (a 5 s native 720p clip then measured
     59.7 s against 55 s here); each picture adds ~0.45 s per clip second at 720p; Fast took 0.6x then (see drawEstimate);
     Krea 2 measured 2.2-2.4 s an image and 9.5 s an edit. The first job after a boot also loads
     the model (13 s for Krea 2, ~23 s for H3), which these leave out. */
  function gpuFactor() {
    if (/PRO 6000/i.test(gpuName)) return [1, ""];
    if (/5090/.test(gpuName)) return [2.5, ""];
    return [1, gpuName ? "; measured on an RTX PRO 6000, yours may differ" : ""];
  }
  const fmtEst = (s) => {
    if (s < 10) return `${Math.max(1, Math.round(s))} s`;
    if (s < 60) return `${Math.round(s / 5) * 5} s`;
    const m = Math.floor(s / 60), rest = Math.round((s % 60) / 10) * 10;
    return rest && rest < 60 ? `${m} min ${rest} s` : `${rest === 60 ? m + 1 : m} min`;
  };

  function drawEstimate() {
    const [k, note] = gpuFactor();
    const takes = Number(segValue(medium === "clip" ? "genTakes" : "imgTakes", "takes") || 1);
    let each;
    if (medium === "clip") {
      const s = clipSeconds();
      const hd = $("#genUpscale").checked;
      if ($("#genSparse").checked) {
        // Sparse attention on, fitted the same way through a pod matrix on 2026-09-23 (PRO 6000,
        // warm, dashboard's own start button, queue row finished - started): 5 s 31.1 / 49.0 s and
        // 10 s 67.2 / 109.3 s at normal / 720p with one picture, each extra picture +2.6 / +5.9 s
        // at 10 s. The 2 s clip, the one form clip under the node's min_tokens, runs dense, but
        // the two fits differ by under a second there, so it needs no branch of its own.
        each = hd ? 8.08 * s + 0.227 * s * s : 5.46 * s + 0.101 * s * s;
        each += pictures().length * s * (hd ? 0.585 : 0.26);
      } else {
        each = hd ? 8.1 * s + 0.58 * s * s : 4.7 * s + 0.3 * s * s;
        each += pictures().length * 0.45 * s * (hd ? 1 : 0.55);
      }
      // Fast against the same clip without it, pod 2026-09-23 (4 shapes, with and without a
      // picture): 0.68x with sparse on, 0.65x with it off — sparse already took some of what Fast
      // saves. The older 0.6 was measured before sparse existed.
      if ($("#genFast").checked) each *= $("#genSparse").checked ? 0.68 : 0.65;
    } else if (imgFamily() === "qwen21") {
      // Measured on a pod 2026-09-20 (PRO 6000, warm): 5.2-5.4 s a picture at every shape,
      // 10.4-10.7 s an edit whether it takes one picture or two. Takes batch well — 8.9 s for
      // two, 15.6 s for four — so the per-take figure below is deliberately under the single one.
      if (imgMode === "edit") each = 10.5;
      else each = takes > 1 ? 4.0 : 5.3;
    } else {
      // Krea 2, measured on a PRO 6000, warm: 2.2-2.4 s an image and 9.5 s an edit on 2026-09-17,
      // but 5.5-5.8 s an image on 2026-09-20 under ComfyUI 0.36 — same card, same 1024x1024, two
      // runs apart. The newer pair of readings is what this image ships on, so they are the ones
      // shown; why the picture got slower is not established.
      each = imgMode === "edit" ? 10 : 5.5;
    }
    each *= k;
    const box = $(medium === "clip" ? "#genEstimate" : "#imgEstimate");
    // images make their takes as one batch, which is quicker than that many runs, so the total
    // for them is an upper bound; clips really are one run each
    box.textContent = takes > 1
      ? `≈ ${fmtEst(each)} each · ${takes} takes ${medium === "image" ? "under" : "≈"} ${fmtEst(each * takes)}`
      : `≈ ${fmtEst(each)} each`;
    box.title = `Warm GPU, after the first job has loaded the model${note}`;
  }

  /* ---------------- clip: start, or build the workflow only ---------------- */
  function clipBody() {
    const body = { mode: genMode, seconds: clipSeconds(), refs: pictures().map((c) => c.file), form: formState() };
    // pins travel only in Frame mode, and only once their upload has come back with a name
    if (clipSource === "frame") {
      body.keyframes = genPins.filter((p) => p.file).map((p) => ({ file: p.file, frame: p.frame }));
    }
    const seed = $("#genSeed").value.trim();
    if (seed !== "") body.seed = seed;
    // the checkbox = native 720p; the upscale only comes from "Make it 720p", once
    body.upscale = pendingUpscale;
    body.hd = !pendingUpscale && $("#genUpscale").checked;
    body.fast = $("#genFast").checked;
    body.sparse = $("#genSparse").checked;
    body.aspect = segValue("genAspect", "aspect");
    body.count = Number(segValue("genTakes", "takes"));
    body.loras = lorasForServer();
    if (genMode === "free") body.prompt = $("#genPrompt").value;
    else {
      body.action = mentionsForServer(genAction);
      body.sound = mentionsForServer(genSound);
      body.style = mentionsForServer(genStyle);
      body.cast = castOnly().map((c) => ({ who: c.text, picture: pictureNo(c) }));
      body.props = genCast
        .filter((c) => c.file && c.kind !== "person")
        .map((c) => ({ kind: c.kind, picture: pictureNo(c), what: c.text, worn_by: c.wornBy }));
      body.shots = shotsForServer();
    }
    return body;
  }

  $("#genStart").addEventListener("click", async () => {
    const body = clipBody();
    // "Make it 720p" re-makes one clip, whatever the Takes say
    if (pendingUpscale) body.count = 1;
    pendingUpscale = false;
    $("#genMsg").textContent = "";
    $("#genStart").disabled = true;
    try {
      const r = await api("beginner/start", body);
      $("#genMsg").textContent = r.jobs.length > 1
        ? `Queued ${r.jobs.length} takes · ${r.seconds.toFixed(2)} s each`
        : `Queued · ${r.seconds.toFixed(2)} s clip`;
      offerClipSeed(r.jobs[0] && r.jobs[0].seed);
      showGenPrompt(r.prompt);
      genPoll();
    } catch (e) {
      $("#genMsg").textContent = e.message;
    } finally {
      $("#genStart").disabled = false;
    }
  });

  /* "Workflow only" (owner 2026-09-17): the same graph the button would run, without running
     it — opened in ComfyUI (the node's aiangel.js lays it out) or saved as a file. */
  function wireWorkflowMenu(buttonId, bodyFn, msgId) {
    const btn = $("#" + buttonId);
    const pop = btn.nextElementSibling;
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; });
    document.addEventListener("click", () => (pop.hidden = true));
    $$("button", pop).forEach((item) => item.addEventListener("click", async () => {
      pop.hidden = true;
      const comfy = (state?.services || []).find((x) => x.key === "comfyui");
      // opened before the request, or the browser counts it as a popup and blocks it
      const win = item.dataset.wf === "open" ? window.open("", "_blank") : null;
      try {
        const r = await api("workflow", bodyFn());
        if (win) {
          if (!comfy?.url) throw new Error("ComfyUI's address is not known yet");
          win.location = `${comfy.url}?aiangel_graph=${encodeURIComponent(r.file)}`;
          $("#" + msgId).textContent = comfy.state === "ready"
            ? `Opened ${r.file} in ComfyUI.` : `Saved ${r.file}; it opens once ComfyUI is up.`;
        } else {
          const blob = new Blob([JSON.stringify(r.graph, null, 1)], { type: "application/json" });
          const a = el("a", { href: URL.createObjectURL(blob), download: r.file });
          document.body.append(a);
          a.click();
          a.remove();
          $("#" + msgId).textContent = `${r.file} — drop it onto ComfyUI to open it.`;
        }
      } catch (err) {
        if (win) win.close();
        $("#" + msgId).textContent = err.message;
      }
    }));
  }
  wireWorkflowMenu("genWorkflow", () => ({ ...clipBody(), kind: "clip" }), "genMsg");

  /* ---------------- image: Krea 2, a new picture or an edit that keeps the face ---------------- */
  let imgMode = "t2i", imgSources = [];
  // Krea 2 edits one photo. Qwen Image 2.1's encoder reads several at once, which is what makes
  // "put the shirt from <image2> on the person in <image1>" a thing you can ask for.
  const imgSourceMax = () => (imgFamily() === "qwen21" ? 16 : 1);
  function setImgMode(m) {
    imgMode = m;
    const many = imgSourceMax() > 1;
    setSeg("imgMode", "mode", m);
    $("#imgSourceStep").hidden = m !== "edit";
    $("#imgSourceTitle").textContent = many ? "The photos to edit" : "The photo to edit";
    $("#imgSourceHint").textContent = many
      ? "The first photo sets the result's size. Refer to them in your instruction as <image1>, "
        + "<image2>, … — a second photo can be the outfit, the place or the thing to add."
      : "The person in it keeps their face; your instruction changes the rest — the outfit, "
        + "the place, the light, the pose.";
    // a Qwen 2.1 edit comes out at the first photo's own shape and size, so neither is a choice
    const qwenEdit = m === "edit" && imgFamily() === "qwen21";
    $("#imgAspectRow").hidden = qwenEdit;
    $("#imgSizeRow").hidden = qwenEdit;
    drawImgSize();
    // An edit must not be given the seed that made the picture it is editing — the result comes
    // out broken (owner 2026-09-20, on a pod). Leaving it empty is always safe.
    $("#imgSeedHint").textContent = m === "edit"
      ? "leave it empty — the seed that made the photo breaks the edit"
      : "the same number gives the same picture back";
    $("#imgPromptTitle").replaceChildren(el("b", { text: m === "edit" ? "2" : "1" }),
      m === "edit" ? " What to change" : " Describe the picture");
    $("#imgPrompt").placeholder = m === "edit"
      ? (many
        ? "Put the shirt from <image2> on the person in <image1>, keep her face and the background"
        : "Put her in a red evening dress on a rooftop at night, city lights behind")
      : "A raw phone photo of a young Thai woman by a sunny cafe window, soft daylight";
    drawImgSources();
    renderNeeds();
    drawEstimate();
  }
  $$("#imgMode button").forEach((b) => b.addEventListener("click", () => setImgMode(b.dataset.mode)));

  const imgUrls = new Map(); /* file name -> object URL of the upload, so it shows before it is served */

  function drawImgSources() {
    const box = $("#imgSource");
    if (!imgSources.length) {
      box.replaceChildren(el("p", { class: "empty", text: "No photo yet." }));
      return;
    }
    const many = imgSourceMax() > 1;
    box.replaceChildren(...imgSources.map((file, i) => el("div", { class: "img-source-item" }, [
      el("img", { src: imgUrls.get(file) || refUrl(file), alt: `Picture ${i + 1}` }),
      // the number is the name the prompt uses, so it is worth showing when several are allowed
      ...(many ? [el("span", { class: "small dim", text: `<image${i + 1}>` })] : []),
      el("button", {
        class: "link", type: "button", text: "Remove",
        onclick: () => { imgSources.splice(i, 1); drawImgSources(); },
      }),
    ])));
  }

  function addImgSource(file, url) {
    if (!file) { imgSources = []; drawImgSources(); return; }
    if (url) imgUrls.set(file, url);
    // one model takes one photo, so a new pick replaces it; the other stacks up to its ceiling
    imgSources = imgSourceMax() === 1 ? [file] : [...imgSources, file].slice(0, imgSourceMax());
    drawImgSources();
  }
  const setImgSource = addImgSource; /* older call sites: a single picture */
  drawImgSources();

  $("#imgUpload").addEventListener("click", () => $("#imgFile").click());
  $("#imgFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const r = await fetch("api/beginner/upload", { method: "POST", body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setImgSource(data.filename, URL.createObjectURL(file));
    } catch (err) { $("#imgMsg").textContent = `${file.name} — ${err.message}`; }
  });
  $("#imgFromOutputs").addEventListener("click", async () => {
    const picker = $("#imgPicker");
    if (!picker.hidden) { picker.hidden = true; return; }
    await loadOutputs();
    const images = files.filter((f) => f.kind === "image").slice(0, 30);
    picker.replaceChildren(...(images.length ? images.map((f) =>
      el("button", { type: "button", title: f.path, onclick: () => { picker.hidden = true; imageToEdit(f.path); } },
        el("img", { src: fileUrl(f.path), loading: "lazy", alt: "" })))
      : [el("p", { class: "empty", text: "No images in Outputs yet." })]));
    picker.hidden = false;
  });

  /* A typed seed is how you find out what one word did: same seed, one word changed, and the
     difference is the word rather than the dice. Empty means a new picture every time, which is
     what most people want most of the time — so the field starts empty and the last seed used is
     one click away instead of being remembered for you. */
  let lastImageSeed = null;

  function offerImageSeed(seed) {
    if (!Number.isInteger(seed)) return;
    lastImageSeed = seed;
    $("#imgSeedLast").textContent = `reuse ${seed}`;
    $("#imgSeedLast").hidden = false;
  }

  $("#imgSeedLast").addEventListener("click", () => {
    if (lastImageSeed !== null) $("#imgSeed").value = lastImageSeed;
  });

  /* Which model makes the picture, and so which graph runs. Two families are offered: Qwen Image
     2.1, which the template downloads by default and which does both jobs from one model, and
     Krea 2, the earlier pair. Any other file on the pod joins the list — that is how the NSFW
     kit's uncensored Krea 2 arrives (owner 2026-09-20: the image side "gen nsfw ไม่ออก"). A LoRA
     on top of a censored model is not the same lever: on the owner's own machine the NSFW-native
     model is what changed the result, with the bypass LoRA left at zero.
     Changing the model changes which LoRAs fit, which preset the form needs, and whether an edit
     has a shape of its own, so everything downstream is redrawn with it. */
  let imageModels = [], imgUnet = "";
  // before the list has arrived, assume the template's own default rather than the older family,
  // so the form does not flash Krea 2's wording on a pod that runs Qwen 2.1
  const imgFamily = () =>
    (imageModels.find((m) => m.name === imgUnet) || {}).family || "qwen21";
  const imgFamilyNeeds = (mode) =>
    createNeeds[`image_${mode}_${imgFamily()}`] || createNeeds[`image_${mode}`] || [];

  let imageModelsDrawn = false;

  async function loadImageModels(prefer) {
    let r;
    try {
      r = await api("image/models");
    } catch {
      return; /* the pod is starting; the next poll tries again */
    }
    const next = r.models || [];
    const same = next.length === imageModels.length
      && next.every((m, i) => m.name === imageModels[i].name);
    imageModels = next;
    if (prefer && imageModels.some((m) => m.name === prefer)) imgUnet = prefer;
    else if (!imageModels.some((m) => m.name === imgUnet)) imgUnet = r.default || "";
    // as with the LoRA list: this runs on the poll, so redraw only when the choices changed
    if (!same || prefer || !imageModelsDrawn) {
      imageModelsDrawn = true;
      drawImageModels();
      // the form is built before this answer arrives, so its wording, its shape row and the
      // preset it asks for were all decided without knowing the model. Say them again now.
      setImgMode(imgMode);
    }
  }

  // the stock file of a family reads as its name, because "qwen_image_2.1_int8_convrot" is not
  // what a person calls it; anything else is the user's own file and keeps its file name
  const FAMILY_LABEL = { qwen21: "Qwen Image 2.1", krea2: "Krea 2" };
  const modelLabel = (m) => (m.stock ? FAMILY_LABEL[m.family] || m.name : m.name);

  function drawImageModels() {
    const row = $("#imgModelRow");
    row.hidden = imageModels.length < 2;
    if (row.hidden) return;
    const pick = el("select", { class: "model-file", title: "model in models/diffusion_models" });
    pick.replaceChildren(
      ...imageModels.map((m) => el("option", { value: m.name, text: modelLabel(m) })));
    pick.value = imgUnet;
    pick.addEventListener("change", () => {
      imgUnet = pick.value;
      // a LoRA of the family we just left cannot load on this model, so those rows go
      imgLoraStack.dropForeign();
      loraStacks.forEach((s) => s.draw());
      setImgMode(imgMode);
    });
    $("#imgModel").replaceChildren(pick);
  }

  const imgBody = () => {
    const body = {
      kind: "image", mode: imgMode, prompt: $("#imgPrompt").value,
      megapixels: Number(segValue("imgMegapixels", "megapixels") || 1),
      // `source` stays for the one-picture case this route has always taken; `sources` carries
      // the whole list, which only Qwen 2.1 accepts past the first
      source: imgSources[0] || null, sources: imgSources,
      aspect: segValue("imgAspect", "aspect"), count: Number(segValue("imgTakes", "takes")),
      loras: imgLoraStack.forServer(),
    };
    if (imgUnet) body.unet = imgUnet;
    const seed = $("#imgSeed").value.trim();
    if (seed !== "") body.seed = seed;
    return body;
  };
  $("#imgStart").addEventListener("click", async () => {
    $("#imgMsg").textContent = "";
    $("#imgStart").disabled = true;
    try {
      const r = await api("image/start", imgBody());
      offerImageSeed(r.jobs[0] && r.jobs[0].seed);
      $("#imgMsg").textContent = r.jobs.length > 1 ? `Queued ${r.jobs.length} takes` : "Queued";
      genPoll();
    } catch (e) {
      $("#imgMsg").textContent = e.message;
    } finally {
      renderNeeds();
      if (!$("#imgNeed").hidden) return;
      $("#imgStart").disabled = false;
    }
  });
  $("#imgPrompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("#imgStart").click();
  });
  wireWorkflowMenu("imgWorkflow", imgBody, "imgMsg");

  /* A made image goes on: into a clip as a person with a photo, or back into an edit. The
     server copies it into input/, so the output file itself is never touched. */
  async function outputAsRef(path) {
    try { return (await api("beginner/ref-from-output", { path })).filename; }
    catch (e) { toast(e.message, true); return null; }
  }
  async function imageToClip(path) {
    const file = await outputAsRef(path);
    if (!file) return;
    genCast.push(newEntry({ file, url: refUrl(file) }));
    setMedium("clip");
    $$("#genMode button").forEach((b) => b.dataset.mode === "guided" && b.click());
    drawGenCast();
    drawGenShots();
    refreshMentions();
    drawEstimate();
    $("#genMsg").textContent = "Added as a person with a photo. Say who they are in step 1, then what happens.";
    showTab("create");
  }
  /* Make a bigger version of a picture with Qwen Image 2.1 itself (owner 2026-09-20).

     "Upscale this" asks nothing: 4 MP at full strength, the owner's pick after seeing the three
     strengths side by side — a full re-render still comes back as the same picture, measured 2 px
     from the plain enlargement. "Custom upscale" asks for the two numbers first, because those
     are the only two things there are to choose.

     Both buttons run on Qwen Image 2.1 whatever model made the picture, so they need that preset
     even on a pod whose image form sits on Krea 2 — and the Create tab's own download box cannot
     answer for them, because it is about the model the FORM is on. Without this the button was a
     dead end that said "image models not downloaded yet: qwen21" and left the user to find the
     Models tab themselves (owner 2026-09-21). */
  const upscaleNeeds = () => createNeeds.image_t2i_qwen21 || [];
  async function haveUpscaleModels() {
    const needs = upscaleNeeds();
    if (!needs.length) return true;
    if (presetBusy(needs)) {
      toast(`${needs.join(" + ")} is downloading — upscaling works as soon as it finishes.`, true);
      return false;
    }
    const ok = confirm(
      `Upscaling runs on Qwen Image 2.1, whatever made the picture, and this pod does not have it yet.\n\n`
      + `Download ${needs.join(" + ")} (${fmtBytes(presetBytes(needs))})? No restart needed — `
      + `keep working while it arrives, then press Upscale again.`);
    if (ok) { await getPresets(needs); showTab("models"); }
    return false;
  }
  async function upscaleImage(path, ask) {
    // asked before the two questions, so nobody types numbers only to be told no
    if (!(await haveUpscaleModels())) return;
    let megapixels, denoise;
    if (ask) {
      const mp = prompt("Size in megapixels (0.25 to 4):", "4");
      if (mp === null) return;
      const dn = prompt("Strength, 0.05 to 1. Lower keeps more of the original's own texture:", "1");
      if (dn === null) return;
      megapixels = Number(mp);
      denoise = Number(dn);
      if (!(megapixels > 0) || !(denoise > 0)) { toast("Those need to be numbers.", true); return; }
    }
    const file = await outputAsRef(path);
    if (!file) return;
    try {
      const body = { kind: "image", mode: "upscale", source: file };
      if (ask) Object.assign(body, { megapixels, denoise });
      await api("image/start", body);
      showTab("create");
      setMedium("image");
      genPoll();
    } catch (e) { toast(e.message, true); }
  }

  async function imageToEdit(path) {
    const file = await outputAsRef(path);
    if (!file) return;
    setMedium("image");
    setImgMode("edit");
    setImgSource(file);
    // The seed that MADE this picture must not be reused to edit it — the edit comes out broken
    // (owner 2026-09-20, on a pod). So the field is cleared on the way in, and the one-click
    // "reuse" of that seed goes away with it. An edit's own seed is a different thing and is
    // still offered once the edit has run.
    $("#imgSeed").value = "";
    $("#imgSeedLast").hidden = true;
    $("#imgMsg").textContent = "Now say what to change.";
    showTab("create");
    $("#imgPrompt").focus();
  }

  function showGenPrompt(text, state) {
    if (!text) return;
    $("#genPreview").textContent = text;
    $("#genCopyPrompt").hidden = false;
    $("#genPreviewState").textContent = state || "sent";
  }

  /* Live preview: the server composes it with the same function the start route uses, so what
     is read here is what would be queued. Debounced, and only while the guided form is open. */
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 250);
    if (typeof drawEstimate === "function") setTimeout(drawEstimate, 0);
  }

  async function runPreview() {
    if (genMode !== "guided") return;
    // a request already in flight would otherwise swallow this change and never show it
    if (previewBusy) return schedulePreview();
    previewBusy = true;
    try {
      const r = await api("beginner/preview", {
        seconds: clipSeconds(),
        refs: pictures().map((c) => c.file),
        action: mentionsForServer(genAction),
        sound: mentionsForServer(genSound),
        style: mentionsForServer(genStyle),
        aspect: segValue("genAspect", "aspect"),
        cast: castOnly().map((c) => ({ who: c.text, picture: pictureNo(c) })),
        props: genCast.filter((c) => c.file && c.kind !== "person")
          .map((c) => ({ kind: c.kind, picture: pictureNo(c), what: c.text, worn_by: c.wornBy })),
        shots: shotsForServer(),
        // the pinned frames change what the prompt says, so the preview has to carry them too
        keyframes: clipSource === "frame"
          ? genPins.filter((p) => p.file).map((p) => ({ file: p.file, frame: p.frame })) : [],
      });
      if (r.prompt) showGenPrompt(r.prompt, "preview");
      else $("#genPreviewState").textContent = "waiting for step 2";
    } catch { /* the pod is busy or restarting; the next keystroke tries again */ }
    previewBusy = false;
  }

  $("#genGuided").addEventListener("input", schedulePreview);
  $("#genGuided").addEventListener("change", schedulePreview);

  /* ---------------- the queue ----------------
     Every job this dashboard queued, newest on top, polled while any is still waiting or
     running. A finished job's row is built once and kept, so a playing clip is not reset by the
     next poll; only rows that are still moving are redrawn. */
  const queueRows = new Map();
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* How long the work itself took — from the moment ComfyUI started on it, not from the press,
     so a job that sat behind three others is not reported as a slow one. A finished row says it
     because that is the number worth comparing: fast against normal, 576p against 720p, this
     card against the next one. */
  function jobTook(j) {
    if (j.state !== "finished" || !j.finished) return null;
    const from = j.started || j.created;
    if (!from || j.finished <= from) return null;
    return `took ${fmtClock(j.finished - from)}`;
  }

  function jobSummary(j) {
    if (j.kind === "image") {
      // takes are one batched job, so the row says how many pictures it is making
      return [j.mode === "edit" ? "edit" : "image", j.aspect,
        j.batch > 1 ? `×${j.batch}` : null, `seed ${j.seed}`, jobTook(j)].filter(Boolean);
    }
    return [`${(j.seconds || 0).toFixed(1)} s`, j.aspect, j.hd || j.upscale ? "720p" : null,
      j.fast ? "fast" : null, j.sparse === false ? "dense" : null,
      `seed ${j.seed}`, jobTook(j)].filter(Boolean);
  }

  function queueRow(j) {
    const tone = { queued: "wait", running: "run", finished: "ok", failed: "bad" }[j.state];
    const word = { queued: j.ahead ? `waiting · ${j.ahead} ahead` : "next", running: "running", finished: "done", failed: "failed" }[j.state];
    const label = j.kind === "image" ? j.prompt : (j.label || "guided clip");
    const row = el("div", { class: "qjob" },
      el("div", { class: "qhead" },
        el("span", { class: `tag ${j.kind}`, text: j.kind }),
        el("span", { class: "qlabel", title: j.prompt || "", text: label || "" }),
        el("span", { class: `tag ${tone}`, text: word })),
      el("div", { class: "qmeta" }, ...jobSummary(j).map((t) => el("span", { text: t }))));
    if (j.state === "running" || (j.state === "queued" && j.progress)) {
      const p = j.progress || {};
      const elapsed = p.started ? Date.now() / 1000 - p.started : 0;
      const stepText = p.max ? `${p.node || "working"} ${p.value}/${p.max}` : (p.node || "starting");
      // node progress carries the bar; a sampler's steps fill the node it is on
      const fill = p.nodes_total
        ? pct((p.nodes_done || 0) + (p.max ? p.value / p.max : 0), p.nodes_total) : 0;
      row.append(el("div", { class: "qprog" },
        el("div", { class: "qstep" }, el("span", { text: stepText }), el("span", { text: fmtClock(elapsed) })),
        el("div", { class: "bar-track" }, el("div", { class: "bar-fill run", style: `width:${fill}%` }))));
    }
    // a job still in flight can be stopped (owner 2026-09-20: once started there was no way out).
    // The button sits on the row itself, so "this one" needs no picking.
    if (j.state === "running" || j.state === "queued") {
      row.append(el("div", { class: "qactions" },
        el("button", {
          class: "link", type: "button", text: "Cancel",
          onclick: (e) => cancelJobs({ id: j.id }, e.target),
        })));
    }
    if (j.state === "cancelled") row.append(el("p", { class: "empty", text: "Cancelled." }));
    if (j.state === "failed") row.append(el("p", { class: "qerr", text: j.error || "Failed." }));
    if (j.state === "finished") {
      const made = j.outputs || [];
      if (!made.length) row.append(el("p", { class: "empty", text: "Finished, but ComfyUI saved no file." }));
      for (const f of made) {
        if (f.kind === "video") row.append(clipPlayer(f));
        else if (f.kind === "image") {
          const name = f.path.split("/").pop();
          row.append(el("div", { class: "img-result" },
            el("a", { href: fileUrl(f.path), target: "_blank", rel: "noopener" },
              el("img", { src: fileUrl(f.path), alt: "" }))),
          el("div", { class: "qactions" },
            el("button", { class: "link", type: "button", text: "Make a clip from this", onclick: () => imageToClip(f.path) }),
            el("button", { class: "link", type: "button", text: "Edit this image", onclick: () => imageToEdit(f.path) }),
            el("button", { class: "link", type: "button", text: "Upscale this", onclick: () => upscaleImage(f.path) }),
            el("button", { class: "link", type: "button", text: "Custom upscale", onclick: () => upscaleImage(f.path, true) }),
            el("button", { class: "link", type: "button", text: "Use this recipe", onclick: () => useRecipe(f.path) }),
            el("a", { class: "link", href: fileUrl(f.path, true), download: name, text: "Download" })));
        } else row.append(tile(f, true));
      }
    }
    return row;
  }

  /* Stop work that is already going. The server works out what each job needs — a pending one is
     dropped from ComfyUI's queue, the one in the sampler is interrupted — so the page only says
     which jobs. Cancelling something that just finished is not an error, it simply stopped none. */
  async function cancelJobs(what, button) {
    if (button) { button.disabled = true; button.textContent = "Cancelling…"; }
    try {
      const r = await api("beginner/cancel", what);
      if (!r.cancelled) toast("Nothing left to cancel — it had already finished.");
      genPoll();
    } catch (e) {
      toast(e.message, true);
      if (button) { button.disabled = false; button.textContent = "Cancel"; }
    }
  }

  $("#genCancelAll").addEventListener("click", (e) => cancelJobs({ all: true }, e.target));

  function renderQueue(jobs) {
    const box = $("#genQueue");
    // the Cancel all button belongs to the queue, so it appears only while something is in flight
    const live = jobs.filter((j) => j.state === "running" || j.state === "queued").length;
    $("#genCancelAll").hidden = live === 0;
    $("#genCancelAll").textContent = live > 1 ? `Cancel all (${live})` : "Cancel";
    if (!jobs.length) return;
    const keep = new Set();
    const rows = jobs.map((j) => {
      keep.add(j.id);
      const key = `${j.state}|${j.ahead}|${JSON.stringify(j.progress)}`;
      const old = queueRows.get(j.id);
      // a finished row never changes, and redrawing it would restart its player
      if (old && (old.key === key || (old.state === "finished" && j.state === "finished"))) return old.node;
      const node = queueRow(j);
      queueRows.set(j.id, { key, state: j.state, node });
      return node;
    });
    for (const id of [...queueRows.keys()]) if (!keep.has(id)) queueRows.delete(id);
    // move rows into order without detaching the ones already in place
    rows.forEach((node, i) => { if (box.children[i] !== node) box.insertBefore(node, box.children[i] || null); });
    while (box.children.length > rows.length) box.lastChild.remove();
  }

  let lastFinished = 0;
  async function genPoll() {
    if (genPolling) return;
    genPolling = true;
    try {
      for (;;) {
        const s = await api("beginner/status");
        const jobs = s.jobs || [];
        const live = jobs.filter((j) => j.state === "queued" || j.state === "running");
        const running = jobs.find((j) => j.state === "running");
        $("#genStateHint").textContent = !jobs.length ? "Nothing running"
          : live.length ? `${running ? "1 running" : "starting"}${live.length > 1 ? ` · ${live.length - (running ? 1 : 0)} waiting` : ""}`
            : "All done";
        renderQueue(jobs);
        const finished = jobs.filter((j) => j.state === "finished").length;
        if (finished !== lastFinished) { lastFinished = finished; loadOutputs(); }
        if (!live.length) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      $("#genMsg").textContent = e.message;
    } finally {
      genPolling = false;
    }
  }


  /* ---------------- polling ---------------- */
  let pollTimer, outputsTick = 0;
  async function poll() {
    clearTimeout(pollTimer);
    try {
      renderState(await api("state"));
      if (!$("#tab-logs").hidden) loadLog();
      if (outputsTick++ % 5 === 0 && $("#tab-outputs").hidden) loadOutputs();
      // A fresh pod finishes downloading while the Create tab is already open, so the LoRA list
      // and the Krea 2 models cannot be read once and left: a user sitting on this tab would be
      // told there are no LoRAs for as long as they stayed on it, and would never get the
      // prompt-unlock row the form is supposed to open with (found on a pod 2026-09-20).
      // Re-read while that tab is open. Both only redraw when what they offer has changed, so a
      // half-typed search is never wiped out from under the user.
      if (!$("#tab-create").hidden && outputsTick % 3 === 0) {
        await loadLoraChoices();
        await loadImageModels();
      }
    } catch (e) {
      $("#heroTitle").textContent = "Dashboard lost the pod";
      $("#heroSub").textContent = e.message + " · retrying";
    }
    pollTimer = setTimeout(poll, document.hidden ? 10000 : 2000);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && poll());

  // what shopee.js builds on: it sends the same requests the Create tab does
  window.AiAngel = {
    api, el, $, $$, toast, copy, DEMO, showTab, genPoll, uploadPicture, refUrl,
    needs: () => createNeeds,
  };

  const start = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  showTab(start);
  poll();
  drawEstimate();

  /* ---------------- demo data ---------------- */
  function demoApi(path) {
    const now = Date.now() / 1000;
    if (path === "beginner/status") {
      // a live-looking queue: one running with sampler progress, two waiting, one done, one failed
      const step = Math.floor((now % 16) / 2) + 1;
      const job = (id, fields) => ({ id, kind: "clip", mode: "guided", aspect: "9:16", seconds: 10.208,
        hd: false, fast: false, upscale: false, seed: 4100 + id, outputs: null, error: null, progress: null, ahead: 0, ...fields });
      const jobs = [
        job(5, { kind: "image", mode: "t2i", state: "queued", ahead: 2, prompt: "A raw phone photo of a young Thai woman by a sunny cafe window" }),
        job(4, { state: "queued", ahead: 1, aspect: "16:9", fast: true }),
        job(3, { state: "running", hd: true, progress: { started: now - 42, node: "Sample", value: step, max: 8, nodes_done: 14, nodes_total: 24 } }),
        job(2, { state: "failed", error: "Allocation on device: out of memory (a 15 s clip at 720p)" }),
        job(1, { state: "finished", started: now - 451, finished: now - 300,
          outputs: [{ path: "AiAngel/aiangelh3_00014_.mp4", size: 2400000, mtime: now - 300, kind: "video" }] }),
      ];
      return Promise.resolve({ ...jobs[2], jobs });
    }
    if (path === "workflow") return Promise.reject(new Error("Demo mode does not build workflows — open this on a pod."));
    if (path === "image/start") return Promise.reject(new Error("Demo mode does not run ComfyUI — open this on a pod."));
    // a fresh pod on the template's default MODELS has no LoRA of its own, so the picker is
    // empty; both families' stock models are always offered, which is what the Model row shows
    if (path === "beginner/loras") {
      return Promise.resolve({ max: 6, loras: [], image_default: null });
    }
    if (path === "image/models") {
      const qwen = "qwen_image_2.1_int8_convrot.safetensors";
      const krea = "krea2_turbo_int8_convrot.safetensors";
      return Promise.resolve({
        default: qwen,
        families: { qwen21: { t2i: ["qwen21"], edit: ["qwen21"] },
          krea2: { t2i: ["krea2"], edit: ["krea2", "krea2edit"] } },
        models: [{ name: qwen, family: "qwen21", stock: true },
          { name: krea, family: "krea2", stock: true }],
      });
    }
    if (path === "beginner/example") {
      return Promise.resolve({ prompt: "subject_definitions:\n<Subject 1> is the woman in <Picture 1>…\n\n(the real example comes from the pod)" });
    }
    if (path === "beginner/start") {
      return Promise.reject(new Error("Demo mode does not run ComfyUI — open this on a pod."));
    }
    if (path === "state") {
      const t = (now % 60) / 60;
      return Promise.resolve({
        pod: { id: "l45bp7l06j9ekz", gpu: "NVIDIA RTX PRO 6000 Blackwell Server Edition", vram_used_mb: 41210, vram_total_mb: 97887, gpu_util: 97, cuda: "13.0", image: "1.01", uptime_s: 812, disk: { workspace: { used: 65.4 * GB, total: 100 * GB }, container: { used: 9.4 * GB, total: 30 * GB } } },
        services: [
          { key: "comfyui", name: "ComfyUI", port: 8188, url: "#", state: "ready" },
          { key: "filebrowser", name: "FileBrowser", port: 8080, url: "#", state: "ready", user: "admin", secret: "6bce9425055c16d9" },
          { key: "jupyter", name: "JupyterLab", port: 8888, url: "#", state: "ready", secret: "9792a18f1b924b14" },
        ],
        models_env: "h3core,aiangelh3,h3upscaler,qwen21",
        presets: [
          { name: "h3core", in_env: true, files: [
            { folder: "text_encoders", name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", size: 15687142551, have_bytes: 15687142551, state: "have" },
            { folder: "vae", name: "minimax_h3_video_vae_fp16.safetensors", size: 5207808496, have_bytes: 5207808496, state: "have" },
            { folder: "vae", name: "minimax_h3_audio_vae_fp32.safetensors", size: 605254808, have_bytes: 605254808, state: "have" }] },
          { name: "aiangelh3", in_env: true, files: [
            { folder: "diffusion_models", name: "AiAngelH3-v1-int8.safetensors", size: 20970427336, have_bytes: 20970427336, state: "have" }] },
          { name: "h3upscaler", in_env: true, files: [
            { folder: "latent_upscale_models", name: "minimax_h3_latent_upscaler_3d_bf16.safetensors", size: 690592992, have_bytes: 690592992, state: "have" }] },
          { name: "scail", in_env: false, files: [
            { folder: "diffusion_models", name: "wan2.1_scail2_14B_fp8.safetensors", size: 16 * GB, have_bytes: t * 16 * GB, state: "downloading" },
            { folder: "text_encoders", name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", size: 6.7 * GB, have_bytes: 0, state: "queued" }] },
          // not in the template's default MODELS (owner 2026-09-18): the demo shows it the way a
          // fresh pod does, as a preset one button away
          { name: "h3fast", in_env: false, files: [
            { folder: "loras", name: "taomate_h3_3step_comfy.safetensors", size: 2481007456, have_bytes: 0, state: "missing" },
            { folder: "loras", name: "FastH3_comfyui.safetensors", size: 1045859336, have_bytes: 0, state: "missing" }] },
          { name: "qwen21", in_env: true, files: [
            { folder: "diffusion_models", name: "qwen_image_2.1_int8_convrot.safetensors", size: 7256783064, have_bytes: 7256783064, state: "have" },
            { folder: "text_encoders", name: "qwen3vl_8b_int8_convrot.safetensors", size: 9350798360, have_bytes: 9350798360, state: "have" },
            { folder: "vae", name: "qwen_image_2.1_vae_bf16.safetensors", size: 675509688, have_bytes: 675509688, state: "have" }] },
          // the earlier image pair, no longer in MODELS: a fresh pod shows them as missing
          { name: "krea2", in_env: false, files: [
            { folder: "diffusion_models", name: "krea2_turbo_int8_convrot.safetensors", size: 13492686496, have_bytes: 0, state: "missing" },
            { folder: "text_encoders", name: "qwen3vl_4b_fp8_scaled.safetensors", size: 5242467968, have_bytes: 0, state: "missing" },
            { folder: "vae", name: "qwen_image_vae.safetensors", size: 253806246, have_bytes: 0, state: "missing" }] },
          { name: "krea2edit", in_env: false, files: [
            { folder: "loras", name: "krea2_identity_edit_v1_2.safetensors", size: 1828256432, have_bytes: 0, state: "missing" }] },
        ],
        needs: { clip: [], fast: ["h3fast"], image_t2i: [], image_edit: [],
          image_t2i_qwen21: [], image_edit_qwen21: [],
          image_t2i_krea2: ["krea2"], image_edit_krea2: ["krea2", "krea2edit"] },
        jobs: [
          { id: 1, label: "loras/mystic_xxx_v2.safetensors", url: "https://civitai.com/models/1", state: "done", size: 1.2 * GB, done_bytes: 1.2 * GB },
          { id: 2, label: "loras/private_repo.safetensors", url: "https://huggingface.co/x", state: "failed", message: "HTTP 401: this repo is gated, save a Hugging Face token in Keys" },
          { id: 3, label: "diffusion_models/wan2.1_scail2_14B_fp8.safetensors", url: "https://huggingface.co/y", state: "downloading", size: 16 * GB, done_bytes: t * 16 * GB },
        ],
        keys: { civitai: "3f9a…c21e", huggingface: null },
        outputs: { count: 14, bytes: 51 * 1024 ** 2 },
      });
    }
    if (path === "outputs") {
      return Promise.resolve({ files: Array.from({ length: 14 }, (_, i) => ({
        path: `AiAngel/${i % 3 ? "aiangelh3" : "aiangelh3-extend"}_${String(14 - i).padStart(5, "0")}_.${i % 4 === 3 ? "png" : "mp4"}`,
        size: (i % 4 === 3 ? 1.1 : 2.4 + i * 0.3) * 1024 ** 2, mtime: now - i * 900, kind: i % 4 === 3 ? "image" : "video" })) });
    }
    if (path.startsWith("logs")) {
      return Promise.resolve({ name: logName, lines: [
        "[aiangel 2026-09-15T17:12:41Z +0s] boot start pod=l45bp7l06j9ekz data=/workspace/aiangel",
        "[aiangel 2026-09-15T17:12:41Z +0s] models at /workspace/aiangel/models",
        "[aiangel 2026-09-15T17:13:52Z +71s] custom nodes synced from image",
        "[aiangel 2026-09-15T17:13:55Z +74s] dashboard on :8189",
        "  FileBrowser  :8080  user admin  password ••••",
        "[aiangel 2026-09-15T17:14:02Z +81s] downloading models in background",
        "[aiangel 2026-09-15T17:14:26Z +105s] ComfyUI READY on :8188"] });
    }
    if (path === "kit/nsfw") return Promise.resolve({ text: "loras https://civitai.com/models/123?modelVersionId=456" });
    if (path === "kit/extras") return Promise.resolve({ text: "loras https://civitai.com/models/789?modelVersionId=321" });
    return Promise.resolve({ queued: 1, ok: true, civitai: "3f9a…c21e", huggingface: null });
  }
})();
