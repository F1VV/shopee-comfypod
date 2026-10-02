/* Doodle pop-ups for the Shopee tab, added for this workspace (not part of the upstream template).

   Hand-drawn pop lines, sparkles, hearts, arrows, circles, squiggles and text stickers that pop
   in over a finished clip: the "look at this!" marks short-video sellers draw on by hand. H3 is
   not asked to draw them, because a video model does not draw clean graphics on cue. They are
   drawn in the browser on top of the finished clip and saved as a new MP4 (Chrome's own
   MediaRecorder, sound included), so server.py stays unchanged.

   Each pop-up says what (kind, text, colour), when (start, seconds on screen) and where
   (x, y as a fraction of the frame, size as a fraction of its width, angle). "Rebuild from the
   script" places a set on the shots' own timecodes; until the user edits one, a script change
   rebuilds them. The set is kept in localStorage and in the clip's recipe. */
(() => {
  "use strict";

  const A = window.AiAngel;
  if (!A) return;
  const { api, el, $, toast, DEMO } = A;

  // `angle`: which way the pop lines or the arrow point (degrees, 0 = right, 90 = down); for the
  // others a tilt. `size`: a fraction of the frame's width (the text's height, for text).
  const KINDS = {
    burst: { label: "Pop lines", size: 0.2, angle: 225, dur: 1.4 },
    sparkle: { label: "Sparkles", size: 0.18, angle: 0, dur: 1.8 },
    heart: { label: "Heart", size: 0.16, angle: -8, dur: 1.6 },
    arrow: { label: "Arrow", size: 0.22, angle: 90, dur: 2 },
    circle: { label: "Circle", size: 0.36, angle: -6, dur: 1.6 },
    underline: { label: "Squiggle", size: 0.36, angle: -4, dur: 1.6 },
    text: { label: "Text", size: 0.072, angle: -5, dur: 2, text: "ของมันต้องมี!" },
  };
  const COLORS = ["#ffffff", "#ffd400", "#ff4d8d", "#ee4d2d", "#22c55e", "#111111"];
  const TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

  /* ---------------- drawing ---------------- */

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
  const rad = (deg) => (deg * Math.PI) / 180;
  const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
  function rng(seed) {  // mulberry32: the same wobble for the same item at the same moment
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // a stroke through points, drawn only up to `upto` (0..1) of its length: the pen moving
  function pen(ctx, pts, upto = 1) {
    const n = Math.max(2, Math.ceil(pts.length * upto));
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  /* One pop-up at time `t` (seconds into the clip) on a W x H frame. `mode`: "time" draws it
     only inside its own moment; "all" draws it held, as if mid-moment (placing pop-ups with no
     clip); "ghost" draws it held at half strength (the selected one, outside its moment). */
  function drawItem(ctx, it, t, W, H, mode = "time") {
    let lt = t - it.start;
    const outside = lt < 0 || lt > it.dur;
    if (mode === "time" && outside) return;
    if (mode === "all" || (mode === "ghost" && outside)) lt = Math.min(0.9, it.dur / 2);
    const pIn = clamp01(lt / 0.3), pOut = clamp01((it.dur - lt) / 0.25);
    const draw = easeOutCubic(clamp01(lt / 0.4));
    const pop = easeOutBack(pIn);
    const S = Math.max(8, it.size * W);
    // a hand-drawn line never sits still: it is redrawn ("boils") 8 times a second
    const rand = rng(hash(it.id) + Math.floor((it.start + lt) * 8) * 7919);
    const j = () => (rand() - 0.5) * S * 0.035;

    ctx.save();
    ctx.globalAlpha = Math.min(1, pIn * 2.5) * pOut * (mode === "ghost" && outside ? 0.5 : 1);
    ctx.translate(it.x * W, it.y * H);
    ctx.strokeStyle = ctx.fillStyle = it.color;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, S * 0.065);
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = S * 0.06;
    ctx.shadowOffsetY = S * 0.012;

    if (it.kind === "burst") {
      // five strokes fanned out around `angle`, drawn outward, then pulled away to the outside
      const spread = [-56, -28, 0, 28, 56], lens = [0.78, 1, 1.12, 1, 0.78];
      const pulse = Math.sin(lt * 9) * S * 0.035 * (draw >= 1 ? 1 : 0);
      spread.forEach((d, i) => {
        const a = rad(it.angle + d) + (rand() - 0.5) * 0.08;
        const r0 = S * 0.42 + pulse, r1 = r0 + S * 0.42 * lens[i];
        const from = r0 + (r1 - r0) * (1 - pOut), to = r0 + (r1 - r0) * draw;
        if (to - from < 1) return;
        pen(ctx, [[Math.cos(a) * from + j(), Math.sin(a) * from + j()], [Math.cos(a) * to + j(), Math.sin(a) * to + j()]]);
      });
    } else if (it.kind === "sparkle") {
      ctx.rotate(rad(it.angle) + lt * 0.4);
      [[0, 0, 1], [0.6, -0.45, 0.55], [-0.55, 0.42, 0.45]].forEach(([x, y, k], i) => {
        const p = easeOutBack(clamp01((lt - i * 0.12) / 0.3));
        const s = S * 0.5 * k * p * (0.8 + 0.2 * Math.sin(lt * 7 + i * 2.1)) * (0.4 + 0.6 * pOut);
        if (s <= 0.5) return;
        const cx = x * S + j(), cy = y * S + j();
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.quadraticCurveTo(cx, cy, cx + s, cy);
        ctx.quadraticCurveTo(cx, cy, cx, cy + s);
        ctx.quadraticCurveTo(cx, cy, cx - s, cy);
        ctx.quadraticCurveTo(cx, cy, cx, cy - s);
        ctx.fill();
      });
    } else if (it.kind === "heart") {
      const beat = 1 + 0.1 * Math.max(0, Math.sin(lt * 7)) ** 6;
      ctx.rotate(rad(it.angle));
      ctx.scale(pop * beat * (0.6 + 0.4 * pOut), pop * beat * (0.6 + 0.4 * pOut));
      ctx.beginPath();
      ctx.moveTo(j(), S * 0.38);
      ctx.bezierCurveTo(-S * 0.62 + j(), -S * 0.02 + j(), -S * 0.34 + j(), -S * 0.55 + j(), j(), -S * 0.2);
      ctx.bezierCurveTo(S * 0.34 + j(), -S * 0.55 + j(), S * 0.62 + j(), -S * 0.02 + j(), j(), S * 0.38);
      ctx.stroke();
      pen(ctx, [[-S * 0.3, -S * 0.2], [-S * 0.22, -S * 0.3]]);  // the shine
    } else if (it.kind === "arrow") {
      // a curved arrow along `angle`, drawn tail first; once drawn it keeps nudging forward
      ctx.rotate(rad(it.angle));
      ctx.translate(draw >= 1 ? Math.max(0, Math.sin(lt * 7)) * S * 0.08 : 0, 0);
      const P0 = [-S * 0.5, -S * 0.2], P1 = [-S * 0.05, S * 0.32], P2 = [S * 0.45, 0];
      const pts = Array.from({ length: 24 }, (_, i) => {
        const u = i / 23;
        return [(1 - u) ** 2 * P0[0] + 2 * u * (1 - u) * P1[0] + u * u * P2[0] + j() * 0.5,
          (1 - u) ** 2 * P0[1] + 2 * u * (1 - u) * P1[1] + u * u * P2[1] + j() * 0.5];
      });
      pen(ctx, pts, draw);
      if (draw > 0.9) {
        const a = Math.atan2(P2[1] - P1[1], P2[0] - P1[0]), h = S * 0.22 * clamp01((draw - 0.9) * 10);
        for (const side of [-1, 1]) {
          pen(ctx, [P2, [P2[0] + Math.cos(a + side * 2.55) * h + j(), P2[1] + Math.sin(a + side * 2.55) * h + j()]]);
        }
      }
    } else if (it.kind === "circle") {
      // a scribbled ring, a little more than once round so its ends overlap like a pen's would
      ctx.rotate(rad(it.angle));
      const pts = Array.from({ length: 48 }, (_, i) => {
        const u = i / 47, a = rad(-100) + u * Math.PI * 2 * 1.15, k = (1 + u * 0.07) * (1 + (rand() - 0.5) * 0.04);
        return [Math.cos(a) * S * 0.5 * k, Math.sin(a) * S * 0.36 * k];
      });
      pen(ctx, pts, draw);
    } else if (it.kind === "underline") {
      ctx.rotate(rad(it.angle));
      const pts = Array.from({ length: 32 }, (_, i) => {
        const u = i / 31;
        return [(u - 0.5) * S + j() * 0.4, Math.sin(u * Math.PI * 4) * S * 0.07 + j() * 0.4];
      });
      pen(ctx, pts, draw);
    } else if (it.kind === "text") {
      ctx.rotate(rad(it.angle + Math.sin(lt * 5) * 2));
      const k = pop * (0.6 + 0.4 * pOut);
      ctx.scale(k, k);
      ctx.font = `800 ${S}px "Noto Sans Thai", "Leelawadee UI", "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = String(it.text || "").split("\n");
      const dark = isDark(it.color);
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * S * 1.15;
        ctx.lineWidth = S * 0.22;
        ctx.strokeStyle = dark ? "#ffffff" : "#111111";
        ctx.strokeText(line, 0, y);
        ctx.shadowColor = "transparent";
        ctx.fillText(line, 0, y);
      });
    }
    ctx.restore();
  }

  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 90;
  }

  // roughly how far a pop-up reaches from its centre, for clicking on it and for the ring
  function reach(ctx, it, W) {
    if (it.kind !== "text") return Math.max(it.size * W * 0.75, 18);
    ctx.save();
    ctx.font = `800 ${it.size * W}px "Noto Sans Thai", "Leelawadee UI", sans-serif`;
    const wide = Math.max(...String(it.text || " ").split("\n").map((l) => ctx.measureText(l).width));
    ctx.restore();
    return Math.max(wide / 2 + 8, 18);
  }

  /* ---------------- state ---------------- */

  const KEY = "aiangel.shopee.doodles.v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch { /* full or blocked */ } };

  let D = load() || { on: false, items: [], edited: false };
  let sel = null;          // the selected pop-up's id
  let clip = null;         // the chosen clip's path in Outputs
  let picked = false;      // the user chose a clip; a newer one then does not take over
  let exporting = false;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const make = (kind, over = {}) => ({
    id: uid(), kind, x: 0.5, y: 0.45, size: KINDS[kind].size, angle: KINDS[kind].angle,
    color: "#ffffff", text: KINDS[kind].text || "", start: 0, dur: KINDS[kind].dur, ...over,
  });
  const round = (v) => Math.round(v * 10) / 10;

  /* A set placed on the script's own shots. Times are scaled onto the chosen clip, whose real
     length H3 rounds (5.0 s asked = 5.21 s made). */
  function auto() {
    const tl = window.ShopeeTab?.timeline();
    if (!tl || !tl.shots.length) return [];
    const video = $("#dlVideo");
    const k = clip && video.duration ? video.duration / tl.total : 1;
    const end = tl.total * k;
    const shot = (role) => tl.shots.find((s) => s.role === role);
    const at = (s) => round(s * k);
    const len = (s) => Math.max(0.8, round((s.end - s.start) * k - 0.4));
    const items = [];
    const h = shot("hook"), d = shot("demo"), p = shot("proof"), c = shot("cta");
    if (h) {
      items.push(make("text", { text: "ของมันต้องมี!", y: 0.14, start: at(h.start) + 0.2, dur: len(h) }));
      items.push(make("burst", { x: 0.64, y: 0.44, start: at(h.start) + 0.6, dur: 1.4 }));
    }
    if (d) items.push(make("sparkle", { x: 0.7, y: 0.34, start: at(d.start) + 0.4, dur: Math.min(2, len(d)) }));
    if (p) items.push(make("circle", { x: 0.5, y: 0.5, start: at(p.start) + 0.2, dur: Math.min(1.8, len(p)) }));
    const beforeCta = [...tl.shots].reverse().find((s) => s.role !== "cta" && s.role !== "hook");
    if (tl.price && beforeCta) {
      items.push(make("text", { text: tl.price, color: "#ffd400", y: 0.8, start: at(beforeCta.start) + 0.4, dur: len(beforeCta) }));
    }
    if (c) {
      items.push(make("text", { text: "กดตะกร้าเลย 🛒", color: "#ffd400", y: 0.66, start: at(c.start) + 0.1, dur: round(end - at(c.start) - 0.1) }));
      items.push(make("arrow", { x: 0.5, y: 0.8, start: at(c.start) + 0.4, dur: round(end - at(c.start) - 0.4) }));
    }
    return items.map((it) => ({ ...it, start: round(it.start), dur: round(Math.min(it.dur, end - it.start)) }))
      .filter((it) => it.dur > 0.3);
  }

  function rebuild() {
    D.items = auto();
    D.edited = false;
    sel = null;
    save();
    drawItems();
  }

  /* ---------------- the stage ---------------- */

  const video = $("#dlVideo"), canvas = $("#dlCanvas"), stage = $("#dlStage");
  const fileUrl = (p) => `api/outputs/file?path=${encodeURIComponent(p)}`;

  function shape() {
    if (clip && video.videoWidth) return [video.videoWidth, video.videoHeight];
    const [w, h] = (window.ShopeeTab?.aspect() || "9:16").split(":").map(Number);
    return [w, h];
  }

  function fitStage() {
    const [w, h] = shape();
    stage.style.aspectRatio = `${w} / ${h}`;
    $(".dl-body").classList.toggle("wide", w > h);
    const photo = !clip && window.ShopeeTab?.photo();
    stage.style.backgroundImage = photo ? `url("${photo}")` : "";
    stage.classList.toggle("placeholder", !clip);
  }

  function paint() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const t = clip ? video.currentTime : 0;
    for (const it of D.items) {
      drawItem(ctx, it, t, W, H, !clip ? "all" : it.id === sel && video.paused ? "ghost" : "time");
    }
    const s = D.items.find((x) => x.id === sel);
    if (s) {
      ctx.save();
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = "rgba(167, 139, 250, 0.9)";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, reach(ctx, s, W), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (clip) {
      $("#dlSeek").value = String(video.currentTime);
      $("#dlTime").textContent = `${video.currentTime.toFixed(1)} / ${(video.duration || 0).toFixed(1)} s`;
    }
  }

  const visible = () => !$("#dlCard").hidden && !$("#tab-shopee").hidden && !document.hidden;
  (function loop() {
    if (visible() && !exporting) paint();
    requestAnimationFrame(loop);
  })();

  // click: pick the pop-up under the pointer, or move the selected one there; drag moves it
  let dragging = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e);
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext("2d");
    const t = clip ? video.currentTime : 0;
    const shown = D.items.filter((it) => !clip || it.id === sel || (t >= it.start && t <= it.start + it.dur));
    const hit = [...shown].reverse().find((it) => Math.hypot((it.x - x) * W, (it.y - y) * H) <= reach(ctx, it, W));
    const target = hit || D.items.find((it) => it.id === sel);
    if (!target) return;
    if (hit && hit.id !== sel) { sel = hit.id; drawItems(); }
    if (!hit) { target.x = x; target.y = y; }
    dragging = { id: target.id, dx: target.x - x, dy: target.y - y };
    canvas.setPointerCapture(e.pointerId);
    edited();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const it = D.items.find((x) => x.id === dragging.id);
    if (!it) return;
    const [x, y] = at(e);
    it.x = clamp01(x + dragging.dx);
    it.y = clamp01(y + dragging.dy);
  });
  canvas.addEventListener("pointerup", () => { if (dragging) { dragging = null; edited(); } });

  $("#dlPlay").addEventListener("click", () => {
    if (!clip) return;
    if (video.paused) video.play().catch((e) => toast(e.message, true));
    else video.pause();
  });
  video.addEventListener("play", () => { $("#dlPlay").textContent = "❚❚"; });
  video.addEventListener("pause", () => { $("#dlPlay").textContent = "▶"; });
  $("#dlSeek").addEventListener("input", (e) => { if (clip) video.currentTime = Number(e.target.value); });
  video.addEventListener("loadedmetadata", () => {
    $("#dlSeek").max = String(video.duration || 10);
    fitStage();
    // the auto set follows the clip's real length, unless the user has changed it
    if (D.on && !D.edited) rebuild();
  });

  /* ---------------- the list ---------------- */

  function edited() {
    D.edited = true;
    save();
  }

  function drawItems() {
    const list = $("#dlItems");
    if (!D.items.length) {
      list.replaceChildren(el("p", { class: "empty", text: "No pop-ups. Add one below, or rebuild them from the script." }));
      return;
    }
    list.replaceChildren(...D.items.map((it) => {
      const num = (field, attrs) => {
        const input = el("input", { type: "number", class: "mono", value: String(it[field]), ...attrs });
        input.addEventListener("input", () => {
          const v = Number(input.value);
          if (Number.isFinite(v)) { it[field] = v; edited(); }
        });
        return input;
      };
      const range = (field, label, attrs) => {
        const input = el("input", { type: "range", value: String(it[field]), "aria-label": label, title: label, ...attrs });
        input.addEventListener("input", () => { it[field] = Number(input.value); edited(); });
        return el("label", { class: "dl-range" }, el("span", { text: label }), input);
      };
      const kind = el("select", { "aria-label": "Kind" },
        ...Object.entries(KINDS).map(([k, v]) => el("option", { value: k, text: v.label })));
      kind.value = it.kind;
      kind.addEventListener("change", () => {
        // a new kind starts from its own size and angle, at the same place and moment
        Object.assign(it, { kind: kind.value, size: KINDS[kind.value].size, angle: KINDS[kind.value].angle });
        if (kind.value === "text" && !it.text) it.text = KINDS.text.text;
        edited();
        drawItems();
      });
      const swatches = el("span", { class: "dl-swatches" }, ...COLORS.map((c) =>
        el("button", {
          type: "button", class: "dl-swatch" + (c === it.color ? " on" : ""), style: `--sw:${c}`,
          title: c, "aria-label": `Colour ${c}`,
          onclick: () => { it.color = c; edited(); drawItems(); },
        })));
      const text = it.kind === "text" ? el("textarea", { class: "dl-text", rows: "1", spellcheck: "false" }) : null;
      if (text) {
        text.value = it.text;
        text.addEventListener("input", () => { it.text = text.value; edited(); });
      }
      const row = el("div", { class: "dl-item" + (it.id === sel ? " on" : "") },
        el("button", { class: "x dl-x", type: "button", title: "Remove", "aria-label": "Remove", onclick: (e) => {
          e.stopPropagation();
          D.items = D.items.filter((x) => x !== it);
          if (sel === it.id) sel = null;
          edited();
          drawItems();
        } }, "×"),
        el("div", { class: "dl-line" }, kind, swatches),
        text,
        el("div", { class: "dl-line small" },
          el("span", { class: "dim", text: "at" }), num("start", { min: "0", step: "0.1", title: "Starts at (seconds into the clip)" }),
          el("span", { class: "dim", text: "s · for" }), num("dur", { min: "0.3", step: "0.1", title: "Stays on screen for (seconds)" }),
          el("span", { class: "dim", text: "s" }),
          el("button", { class: "link", type: "button", text: "⏱ now", title: "Start it where the clip is paused",
            onclick: () => { if (clip) { it.start = round(video.currentTime); edited(); drawItems(); } } })),
        el("div", { class: "dl-line small" },
          range("size", "Size", { min: it.kind === "text" ? "0.03" : "0.05", max: it.kind === "text" ? "0.2" : "0.7", step: "0.005" }),
          range("angle", it.kind === "burst" || it.kind === "arrow" ? "Points" : "Tilt", { min: "-180", max: "360", step: "1" })));
      // picking a row selects it and, with a clip, jumps to its moment so it can be seen
      row.addEventListener("pointerdown", (e) => {
        if (sel === it.id) return;
        sel = it.id;
        if (clip && !e.target.closest("input, select, textarea, button")) {
          video.pause();
          video.currentTime = Math.min(it.start + Math.min(0.9, it.dur / 2), video.duration || it.start);
        }
        $$items().forEach((r) => r.classList.toggle("on", r === row));
      });
      return row;
    }));
  }
  const $$items = () => [...document.querySelectorAll("#dlItems .dl-item")];

  $("#dlAddKind").replaceChildren(...Object.entries(KINDS).map(([k, v]) => el("option", { value: k, text: v.label })));
  $("#dlAdd").addEventListener("click", () => {
    const it = make($("#dlAddKind").value, { start: clip ? round(video.currentTime) : 0 });
    D.items.push(it);
    sel = it.id;
    edited();
    drawItems();
  });
  $("#dlAuto").addEventListener("click", () => {
    if (D.edited && D.items.length && !confirm("Replace your pop-ups with a new set from the script?")) return;
    rebuild();
  });

  /* ---------------- clips ---------------- */

  async function refreshClips() {
    let files = [];
    try { files = (await api("outputs")).files || []; } catch { /* the pod is restarting */ }
    const videos = files.filter((f) => f.kind === "video");
    const select = $("#dlClip");
    const ago = (t) => {
      const s = Date.now() / 1000 - t;
      return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t * 1000).toLocaleDateString();
    };
    select.replaceChildren(
      el("option", { value: "", text: videos.length ? "No clip: place pop-ups on the product photo" : "No clip yet: make one first" }),
      ...videos.map((f) => el("option", { value: f.path, text: `${f.path.split("/").pop()} · ${ago(f.mtime)}` })));
    // the newest clip is the one just made, unless the user picked another
    const want = picked && videos.some((f) => f.path === clip) ? clip : videos[0]?.path || "";
    select.value = want;
    if (want !== (clip || "")) useClip(want);
    $("#dlExport").disabled = !clip || exporting;
  }

  function useClip(path) {
    clip = path || null;
    video.pause();
    if (clip) {
      video.src = fileUrl(clip);
    } else {
      video.removeAttribute("src");
      video.load();
      $("#dlTime").textContent = "no clip";
    }
    $("#dlSeek").disabled = !clip;
    $("#dlPlay").disabled = !clip;
    $("#dlExport").disabled = !clip || exporting;
    fitStage();
  }

  $("#dlClip").addEventListener("change", (e) => { picked = true; useClip(e.target.value); });
  $("#dlClip").addEventListener("focus", () => refreshClips());
  $("#dlReload").addEventListener("click", () => refreshClips());

  /* ---------------- saving the new clip ----------------
     The clip is played once, start to end, into a canvas at its own size with the pop-ups drawn
     on every frame; the canvas and the clip's own sound are recorded as one MP4. It runs in real
     time, so a 10 s clip takes about 10 s, and the tab has to stay in front while it runs. */
  const once = (target, event) => new Promise((resolve, reject) => {
    target.addEventListener(event, resolve, { once: true });
    target.addEventListener("error", () => reject(new Error("the clip could not be read")), { once: true });
  });

  async function exportClip() {
    if (!clip || exporting) return;
    const type = TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!type) return toast("This browser cannot record video; use Chrome or Edge", true);
    exporting = true;
    video.pause();
    const btn = $("#dlExport");
    btn.disabled = true;
    const msg = $("#dlMsg");
    const src = document.createElement("video");
    src.preload = "auto";
    src.playsInline = true;
    src.src = fileUrl(clip);
    let audio;
    try {
      await once(src, "loadeddata");
      const W = src.videoWidth, H = src.videoHeight;
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d");
      // the sound goes straight into the recording, not to the speakers
      audio = new AudioContext();
      const dest = audio.createMediaStreamDestination();
      audio.createMediaElementSource(src).connect(dest);
      const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6, audioBitsPerSecond: 192e3 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const frame = () => {
        ctx.drawImage(src, 0, 0, W, H);
        for (const it of D.items) drawItem(ctx, it, src.currentTime, W, H);
      };
      src.currentTime = 0;
      await once(src, "seeked");
      frame();
      const ended = once(src, "ended");
      rec.start(250);
      const tick = () => {
        frame();
        msg.textContent = `Recording ${src.currentTime.toFixed(1)} / ${src.duration.toFixed(1)} s · keep this tab open`;
        if (!src.ended) src.requestVideoFrameCallback(tick);
      };
      src.requestVideoFrameCallback(tick);
      await audio.resume();
      await src.play();
      await ended;
      frame();
      await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); });
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      const name = `${clip.split("/").pop().replace(/\.[^.]+$/, "")}-popups.${type.startsWith("video/mp4") ? "mp4" : "webm"}`;
      const a = el("a", { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      msg.textContent = `Saved ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB) to your downloads.`;
      window.Doodles.lastExport = { name, size: blob.size, type: blob.type, url: a.href };
    } catch (e) {
      msg.textContent = `Could not save: ${e.message}`;
    } finally {
      audio?.close();
      src.removeAttribute("src");
      exporting = false;
      btn.disabled = !clip;
    }
  }
  $("#dlExport").addEventListener("click", exportClip);

  /* ---------------- the checkbox and the Shopee tab ---------------- */

  function setOn(on) {
    D.on = on;
    $("#spDoodles").checked = on;
    $("#dlCard").hidden = !on;
    if (on && !D.items.length) rebuild();
    save();
    if (on) { drawItems(); refreshClips(); fitStage(); }
  }
  $("#spDoodles").addEventListener("change", (e) => setOn(e.target.checked));

  window.Doodles = {
    KINDS, drawItem,
    get: () => JSON.parse(JSON.stringify(D)),
    set(d) {
      D = { on: !!d.on, items: Array.isArray(d.items) ? d.items : [], edited: !!d.edited };
      sel = null;
      setOn(D.on);
      drawItems();
    },
    // the script changed: a set nobody has touched follows it
    scriptChanged() {
      if (D.on && !D.edited) rebuild();
      if (!clip) fitStage();
    },
    shown() { if (D.on) { refreshClips(); fitStage(); } },
  };

  setOn(D.on);
  drawItems();
  if (DEMO) $("#dlExport").title = "Demo mode has no clips to save";
})();
