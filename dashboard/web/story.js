/* Story tab, added for this workspace (not part of the upstream template).

   A story is told in scenes, each one H3 clip (up to 15 s). The story itself holds what every
   scene shares: who is in it (a photo keeps a face the same from scene to scene), where and when
   it happens, and how it looks. Each scene is a list of shots with camera, action and dialogue,
   and can carry a blocking render from Blender as <Video 1>: H3's prompt guide uses a reference
   video for "the original video's camera movement, cuts, rhythm, or temporal structure", so the
   grey animatic sets the camera and the blocking while the photos set the faces and the place.

   The H3 prompt is written here in the browser (the same document shape prompt_build.py makes)
   and sent as a free prompt to beginner/start, with the pictures in `refs` and the blocking video
   in `ref_videos` (backend/ in this repo patches server.py and h3_workflows.py for that). The clip
   lands in the shared Queue and in Outputs like any other. Export story packs it all into one
   .story.zip for the pod.

   The story is kept in this browser's localStorage, pictures included (scaled down), so it
   outlives a terminated pod: a picture is uploaded again the first time it is used on another
   pod. A blocking video is too big for that and has to be added again on a new pod. */
(() => {
  "use strict";

  const A = window.AiAngel;
  if (!A) return;
  const { api, el, $, $$, toast, copy, DEMO } = A;

  /* ---------------- what the form offers ---------------- */

  const LOOKS = {
    film: "Live-action, photorealistic, cinematic film look, anamorphic lens, natural film grain, motivated lighting",
    drama: "Live-action, photorealistic, Thai TV drama look, soft flattering light, clean colors",
    vlog: "Live-action, photorealistic, shot on a smartphone, handheld, natural light, social-media vlog style",
    cg: "Stylized 3D animated film, soft global illumination, expressive characters, rich colors",
    anime: "2D anime style, clean line art, cel shading, painted backgrounds",
  };
  const SIZES = ["Extreme wide shot", "Wide shot", "Full shot", "Medium shot", "Medium close-up",
    "Close-up", "Extreme close-up", "Over-the-shoulder shot", "POV shot", "Top-down shot", "Low-angle shot"];
  // [label, what H3 is told]
  const MOVES = {
    blocking: ["As in the blocking video", "camera exactly as in <Video 1>"],
    static: ["Static", "static camera"],
    push: ["Push in", "slow push-in"],
    pull: ["Pull out", "slow pull-out"],
    panl: ["Pan left", "pan left"],
    panr: ["Pan right", "pan right"],
    tiltu: ["Tilt up", "tilt up"],
    tiltd: ["Tilt down", "tilt down"],
    track: ["Tracking", "tracking shot following the action"],
    hand: ["Handheld", "handheld camera"],
    orbit: ["Orbit", "camera orbits around the subject"],
    craneu: ["Crane up", "crane up"],
    craned: ["Crane down", "crane down"],
  };
  // how closely H3 is told to follow the blocking render (retention terms from H3's prompt guide)
  const FOLLOW = {
    camera: "The camera path, framing and cuts come from the video. What people do comes from the shots below.",
    full: "The camera, and where each character stands and moves, come from the video. The shots below say who they are and what they do.",
    timing: "Only the rhythm of the cuts is borrowed, loosely. For a rough animatic.",
  };
  const SHAPES = { "9:16": [576, 1024], "16:9": [1024, 576], "1:1": [768, 768] };  // h3_workflows.SIZES
  const MAX_SECONDS = 15;  // server.py CLIP_SECONDS_MAX
  const MAX_CAST = 16;  // a clip only carries the ones in it, so the story itself can hold more
  const MAX_TAKES = 4;     // server.py MAX_TAKES
  const FPS = 24;

  /* ---------------- state ---------------- */
  const KEY = "aiangel.story.v1";
  const CHARS_KEY = "aiangel.story.chars.v1";
  const SHOPEE_LIB = "aiangel.shopee.library.v1";  // the Shopee tab's saved characters, offered here too

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newShot = (seconds = 3) => ({ id: uid(), seconds, size: "Medium shot", move: "static", what: "", lines: [] });
  const newScene = (n = 1) => ({
    id: uid(), title: `Scene ${n}`, where: "", when: "", sound: "",
    shots: [newShot(3), newShot(3)],
    blocking: null,  // {file, pod, name, duration, width, height, follow}
    // pictures the clip opens and ends exactly on; empty = H3 designs the shot from the text
    frames: { start: null, end: null },  // each {file, pod, thumb, name, width, height}
    // <Audio 1>: another scene's finished clip (`from`, a scene id: a second camera angle on the
    // same dialogue) or an uploaded sound file; `mode` "exact" copies it as the clip's sound,
    // "voices" only borrows the voices. {mode, from, file, pod, name, output, duration}
    audio: null,
    location: null,  // the id of one of S.locations; none = the story's place, or H3 designs it
  });
  const blank = () => ({
    title: "", logline: "", where: "", when: "", look: "film", lookText: "", aspect: "16:9",
    music: "", takes: 1, res: "768", steps: 8, fast: false, sparse: false,
    place: null,  // {file, pod, thumb, what}: the story's own place, for scenes without a location
    // Location photos, each stored once however many scenes use it (a story's scenes would
    // otherwise copy the same picture into localStorage dozens of times). {id, what, name, file, pod, thumb}
    locations: [],
    cast: [],     // [{id, libId, name, who, voice, file, pod, thumb}]
    scenes: [newScene(1)], at: 0,
  });

  const loadJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const saveJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  const FRAME_KEYS = ["start", "end"];
  // every start and end frame of a story, for the loops that upload, export or import pictures
  const frameItems = (st) => st.scenes.flatMap((sc) => FRAME_KEYS.map((k) => sc.frames?.[k])).filter(Boolean);

  // what only lives while a picture or video is uploading; and frames for scenes made before them
  const settle = (st) => {
    for (const sc of st.scenes) sc.frames = { start: sc.frames?.start || null, end: sc.frames?.end || null };
    for (const x of [st.place, ...st.cast, ...frameItems(st), ...st.scenes.flatMap((sc) => [sc.blocking, sc.audio])]) if (x) delete x.busy;
    if (st.place && !st.place.thumb) st.place = null;
    st.locations = (st.locations || []).filter((l) => l.thumb);
    for (const l of st.locations) delete l.busy;
    for (const sc of st.scenes) {
      if (!st.locations.some((l) => l.id === sc.location)) sc.location = null;
      if (sc.blocking && !sc.blocking.file) sc.blocking = null;
      if (sc.audio && !sc.audio.from && !sc.audio.file) sc.audio = null;
      for (const k of FRAME_KEYS) if (sc.frames[k] && !sc.frames[k].thumb) sc.frames[k] = null;
    }
    return st;
  };

  // a story saved before Size and Steps existed: its 720p box becomes the 720 size. Runs on the
  // saved object itself, before the defaults are merged in, so an old choice is not lost.
  const sizeOf = (st) => {
    if (!st) return st;
    if (!["576", "720", "768"].includes(st.res) && typeof st.hd === "boolean") st.res = st.hd ? "720" : "576";
    delete st.hd;
    if (st.steps !== undefined && ![8, 12, 16, 20].includes(Number(st.steps))) delete st.steps;
    return st;
  };
  let S = settle(Object.assign(blank(), sizeOf(loadJson(KEY, {}))));
  if (!S.scenes.length) S.scenes = [newScene(1)];
  S.at = Math.min(S.at || 0, S.scenes.length - 1);
  const scene = () => S.scenes[S.at];

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!saveJson(KEY, S)) toast("The browser's storage is full: remove a character photo", true);
    }, 200);
  }

  // blob URLs of the blocking videos picked in this page session, by filename on the pod
  const videoUrls = new Map();
  // the same for uploaded sound files (<Audio 1>)
  const audioUrls = new Map();
  // the photos as they were picked in this page session (full size), by filename on the pod, so
  // an exported story carries them rather than the 1024 px copy kept in localStorage
  const originals = new Map();
  const pod = () => ($("#podId")?.textContent || "").trim();

  /* ---------------- pictures and videos ---------------- */

  // a picture shrunk to fit `max` px, as a JPEG data URL — small enough for localStorage
  function shrink(src, max = 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = () => reject(new Error("could not read that picture"));
      img.src = src;
    });
  }

  async function upload(file) {
    if (DEMO) return `demo_${Math.random().toString(36).slice(2, 8)}${/\.\w+$/.exec(file.name)?.[0] || ".png"}`;
    return A.uploadPicture(file);  // the same upload route; backend/server.py lets it take a video
  }

  // a stored picture's file on THIS pod: uploaded again from its thumbnail when it was put on
  // another pod
  async function onPod(item, name) {
    if (item.busy) throw new Error(`${name}: the picture is still uploading`);
    if (item.file && (item.pod === pod() || DEMO)) return item.file;
    if (!item.thumb) throw new Error(`${name}: the picture is gone, add it again`);
    const blob = await (await fetch(item.thumb)).blob();
    item.file = await upload(new File([blob], `${name.replace(/\W+/g, "_") || "picture"}.jpg`, { type: "image/jpeg" }));
    item.pod = pod();
    save();
    return item.file;
  }

  async function pickPicture(f) {
    const url = URL.createObjectURL(f);
    try {
      const [file, thumb] = await Promise.all([upload(f), shrink(url, 1024)]);
      originals.set(file, f);
      return { file, thumb, pod: pod() };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function videoInfo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => reject(new Error("this browser cannot read the video; export it as an H.264 MP4"));
      v.src = url;
    });
  }

  /* ---------------- the prompt ---------------- */

  // H3 renders on the 17k+5 frame grid at 24 fps (prompt_build.clip_seconds)
  const clipSeconds = (s) => {
    const f = Math.max(5, Math.round(s * FPS));
    // Python's % never goes negative; JavaScript's does, so it is brought back into 0..16
    return (f + (((5 - (f % 17)) % 17) + 17) % 17) / FPS;
  };
  const timecode = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  const sceneSeconds = (sc = scene()) => sc.shots.reduce((n, s) => n + (Number(s.seconds) || 0), 0);
  const isThai = (t) => /[฀-๿]/.test(t);
  const end = (t) => { t = t.trim().replace(/[ ,;:]+$/, ""); return !t || /[.!?]$/.test(t) ? t : t + "."; };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const trim = (t) => (t || "").trim().replace(/[ .,]+$/, "");
  const look = () => trim(S.lookText) || LOOKS[S.look];
  const shape = () => ({ "9:16": "vertical", "16:9": "horizontal", "1:1": "square" })[S.aspect];
  const castName = (c, i) => c.name.trim() || `Character ${i + 1}`;

  // "@Mali" written in a shot, for a name exactly (so "@Mali" is not found inside "@Mali Jr")
  const mentionOf = (name, flags = "gi") =>
    new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w\\u0E00-\\u0E7F])`, flags);

  // Who a scene uses: everyone @mentioned in its shots or speaking one of its lines, in story
  // order. Only they get a <Subject N> definition and send their photo, so a story with a big cast
  // does not put everyone into every clip (and a clip stays inside H3's 9 pictures).
  function sceneCast(sc) {
    let text = sc.shots.map((s) => s.what).join("\n");
    const hit = new Set();
    // the longest names first, and each match taken out, so "@Mali Jr" never also counts as Mali
    const order = S.cast.map((c, i) => [castName(c, i), i]).sort((a, b) => b[0].length - a[0].length);
    for (const [name, i] of order) {
      if (mentionOf(name, "i").test(text)) hit.add(i);
      text = text.replace(mentionOf(name), " ");
    }
    for (const s of sc.shots) {
      for (const l of s.lines) {
        const i = S.cast.findIndex((c) => c.id === l.who);
        if (i >= 0 && l.text.trim()) hit.add(i);
      }
    }
    return [...hit].sort((a, b) => a - b);
  }

  // the pictures in the order H3 numbers them for a scene: its cast with a photo, then the place
  const locOf = (sc) => S.locations.find((l) => l.id === sc?.location) || null;

  function refsFor(sc = scene()) {
    const files = [], picOf = new Map(), cast = sceneCast(sc);
    for (const i of cast) if (S.cast[i].thumb || S.cast[i].file) picOf.set(S.cast[i].id, files.push(S.cast[i]));
    const place = locOf(sc) || S.place;
    const placePic = place?.thumb || place?.file ? files.push(place) : 0;
    return { files, picOf, placePic, cast, place };
  }

  function buildPrompt(sc = scene()) {
    const { picOf, placePic, cast, place } = refsFor(sc);
    // story index -> this scene's <Subject N> and (SN) number
    const slot = new Map(cast.map((i, j) => [i, j + 1]));
    const blk = sc.blocking?.file ? sc.blocking : null;
    const follow = blk?.follow || "full";
    const where = trim(sc.where) || trim(S.where);
    const when = trim(sc.when) || trim(S.when);
    const aud = sc.audio && (sc.audio.file || sc.audio.from) ? sc.audio : null;
    const exact = aud && aud.mode !== "voices";
    const anyRef = picOf.size > 0 || placePic > 0 || !!blk || !!aud;
    // who speaks in this scene, in cast order: the voices <Audio 1> stands for
    const speakers = [...new Set(sc.shots.flatMap((s) => s.lines.filter((l) => l.text.trim())
      .map((l) => S.cast.findIndex((c) => c.id === l.who))))].filter((k) => slot.has(k)).sort((a, b) => a - b);

    // Who a character is called in the text. With any reference, H3 gets <Subject N> definitions
    // (as prompt_build.py does); with none it is plain text-to-video, so a character is named by
    // their own description the first time and by name after that.
    const seen = new Set();
    const call = (i) => {
      if (anyRef) return `<Subject ${slot.get(i)}>`;
      const c = S.cast[i], name = castName(c, i);
      const about = [trim(c.who), trim(c.outfit) && `wearing ${trim(c.outfit)}`].filter(Boolean).join(", ");
      if (seen.has(i) || !about) return name;
      seen.add(i);
      return `${name} (${about})`;
    };
    // "@Mali" in the user's words; the longest names first, so "@Mali Jr" is not read as "@Mali"
    const mentions = (text) => {
      const order = cast.map((i) => [castName(S.cast[i], i), i]).sort((a, b) => b[0].length - a[0].length);
      let out = text;
      for (const [name, i] of order) out = out.replace(mentionOf(name), () => call(i));
      return out;
    };

    const parts = [];
    if (anyRef) {
      parts.push("subject_definitions:");
      for (const i of cast) {
        const c = S.cast[i], n = `<Subject ${slot.get(i)}>`, pic = picOf.get(c.id), who = trim(c.who);
        const outfit = trim(c.outfit);
        if (pic && outfit) {
          // the photo is for the face; the clothes are this story's (a sheet in another costume)
          parts.push(`${n} is ${castName(c, i)}${who ? `, ${who},` : ""} in <Picture ${pic}>. Use <Picture ${pic}> as the exact reference for their face and hair only; they wear ${outfit}, not the clothes in <Picture ${pic}>.`);
        } else if (pic) {
          parts.push(`${n} is ${castName(c, i)}${who ? `, ${who},` : ""} in <Picture ${pic}>. Use <Picture ${pic}> as the exact reference for their face, hair and outfit.`);
        } else {
          parts.push(`${n} is ${castName(c, i)}${who ? `, ${who}` : ""}${outfit ? `, wearing ${outfit}` : ""}. No reference picture — invent their appearance and keep it the same in every shot.`);
        }
      }
      if (placePic) {
        const what = trim(place.what) || where || "the location";
        parts.push(`The scene takes place in the location shown in <Picture ${placePic}>: ${what}. Use <Picture ${placePic}> as the exact reference for the setting, not for anyone's face.`);
      }
      if (blk) {
        const use = {
          camera: "Use <Video 1> only as the reference for the camera movement, the framing and the cuts, in time.",
          full: "Use <Video 1> as the reference for the camera movement, the framing, the cuts, and where each character stands and moves, in time; its grey figures stand for the characters defined here.",
          timing: "Use <Video 1> only loosely, for the rhythm and pacing of the cuts.",
        }[follow];
        parts.push(`<Video 1> is an untextured grey 3D blocking animation (previz) of this scene. ${use} Do not copy its grey, untextured look: the real characters, the place and the light replace the blocking shapes.`);
      }
      if (aud) {
        // the guide's own audio wording: a voice-timbre reference, or the complete final track
        const who = speakers.map((k) => `<Subject ${slot.get(k)}> (S${slot.get(k)})`);
        parts.push(exact
          ? "<Audio 1> is the finished soundtrack of this same scene, made for another camera angle: the same dialogue, voices, timing and sounds."
          : `<Audio 1> is the voice-timbre reference for ${who.length > 1 ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}` : who[0] || "the speaking characters"}.`);
      }
      parts.push("");
    }

    // the summary carries the story, so a scene is never shot without its context
    const first = sc.shots.find((s) => s.what.trim());
    const title = sc.title.trim() ? ` "${sc.title.trim()}"` : "";
    const opens = !!sc.frames?.start, ends = !!sc.frames?.end;
    const kind = anyRef ? "[reference generation]"
      : opens && ends ? "[first and last frame to video]"
        : opens ? "[first frame to video]" : ends ? "[keyframe to video]" : "[text to video]";
    const summary = [
      `${kind} A ${/photoreal/i.test(look()) ? "photorealistic " : ""}${shape()} story scene${title}${where ? ` in ${where}` : ""}.`,
      when && `It is ${when}.`,
      first && end(cap(mentions(first.what.trim()))),
    ].filter(Boolean).join(" ");
    parts.push("summary:", summary, "");

    // The frames are not <Picture N>: H3 gets each picture as that frame itself, so the text only
    // says what it means for the clip (prompt_build.py's keyframes block, word for word).
    if (opens || ends) {
      parts.push("keyframes:");
      if (opens) parts.push("00:00.00: the clip opens exactly on the supplied first frame. Everything in it — faces, hair, clothing, the place and the light — continues unchanged from there.");
      if (ends) parts.push(`${timecode(clipSeconds(sceneSeconds(sc) || 1))}: the clip ends exactly on the supplied last frame.`);
      parts.push("");
    }

    if (anyRef) {
      parts.push("retention_analysis:");
      for (const i of cast) {
        const c = S.cast[i], n = `<Subject ${slot.get(i)}>`, pic = picOf.get(c.id), outfit = trim(c.outfit);
        parts.push(pic && outfit
          ? `${n}: fully_preserved - face, hairstyle and skin tone from <Picture ${pic}> stay identical in every frame; the outfit is ${outfit}.`
          : pic
            ? `${n}: fully_preserved - face, hairstyle, skin tone and outfit from <Picture ${pic}> stay identical in every frame.`
            : `${n}: their invented appearance stays the same in every frame.`);
      }
      if (placePic) parts.push(`setting: fully_preserved - the location from <Picture ${placePic}> stays identical in every frame.`);
      if (blk) {
        parts.push({
          camera: "<Video 1> (camera movement, framing and cuts): partially_preserved - follow its camera path in time; its grey untextured look is not kept.",
          full: "<Video 1> (camera movement, blocking and timing): partially_preserved - follow its camera path and the characters' positions in time; its grey untextured look is not kept.",
          timing: "<Video 1> (cut and pacing structure): weak_reference",
        }[follow]);
      }
      if (aud) {
        parts.push(exact
          ? "<Audio 1>: fully_copy - the complete audio of <Audio 1> is this clip's complete final audio track; lips, faces and actions follow its dialogue and timing exactly."
          : "<Audio 1>: reference - only the voices' timbre is referenced; the dialogue below is spoken anew in those voices.");
      }
      parts.push("");
    }

    // each shot's share of the real, quantised clip length, so the last one ends on it
    const total = sceneSeconds(sc) || 1, length = clipSeconds(total);
    let at = 0;
    const shots = sc.shots.map((s, i) => {
      const start = (length * at) / total;
      at += Number(s.seconds) || 0;
      const stop = (length * at) / total;
      const move = s.move === "blocking" && !blk ? "static" : s.move;
      let line = `[Shot ${i + 1}] ${timecode(start)}-${timecode(stop)}: ${s.size}, ${MOVES[move]?.[1] || "static camera"}.`;
      const what = mentions(s.what.trim());
      if (what) line += ` ${end(cap(what))}`;
      for (const ln of s.lines) {
        const text = ln.text.trim();
        if (!text) continue;
        const k = S.cast.findIndex((c) => c.id === ln.who);
        // (S1) names who speaks; the tagged form is the one measured to come back word for word
        line += ` ${slot.has(k) ? call(k) : "The narrator"} says (S${slot.get(k) || 1}) <d>[${isThai(text) ? "Thai" : "English"}] ${text}</d>.`;
      }
      return line;
    });
    parts.push("detailed_description:",
      [look(), when && cap(when), `${shape()} ${S.aspect}`].filter(Boolean).join(", ") + ".",
      ...shots, "");

    const speaks = sc.shots.some((s) => s.lines.some((l) => l.text.trim()));
    const voices = speaks
      ? cast.map((i) => S.cast[i].voice.trim() && `${call(i)}'s voice: ${trim(S.cast[i].voice)}`).filter(Boolean) : [];
    const sound = trim(sc.sound) || trim(S.music) || "Ambient sound that matches the setting";
    parts.push("overall_soundscape:", exact
      ? "The complete audio of <Audio 1>, unchanged: the same dialogue, voices and sounds at the same moments."
      : [sound, ...voices].map(cap).join(". ") + ".");
    return parts.join("\n");
  }

  /* ---------------- drawing ---------------- */

  const setSeg = (id, key, value) =>
    $$(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", b.dataset[key] === String(value)));
  const msg = (t) => { $("#stMsg").textContent = t; };

  function thumb(src, n, onRemove, busy) {
    return el("span", { class: `sp-thumb${busy ? " busy" : ""}`, title: n ? `Picture ${n}` : null },
      src ? el("img", { src, alt: n ? `Picture ${n}` : "" }) : el("span", { class: "st-nopic", text: "+ photo" }),
      n ? el("b", { text: String(n) }) : null,
      onRemove ? el("button", { class: "x", type: "button", title: "Remove the photo", onclick: onRemove }, "×") : null);
  }

  const input = (value, placeholder, onInput, cls = "") => {
    const i = el("input", { class: cls, spellcheck: "false", placeholder, value });
    i.addEventListener("input", () => onInput(i.value));
    return i;
  };

  function drawCast() {
    const { picOf } = refsFor(scene());
    $("#stCast").replaceChildren(...S.cast.map((c, i) => {
      const file = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
      file.addEventListener("change", async () => {
        const f = file.files[0];
        if (!f) return;
        c.busy = true;
        drawCast();
        try { Object.assign(c, await pickPicture(f)); } catch (e) { msg(`${f.name}: ${e.message}`); }
        delete c.busy;
        changed(true);
      });
      const pic = thumb(c.thumb, picOf.get(c.id), c.thumb ? () => {
        Object.assign(c, { file: null, thumb: null, pod: null });
        changed(true);
      } : null, c.busy);
      pic.classList.add("st-pick");
      pic.title = c.thumb ? `Picture ${picOf.get(c.id)} · click to change` : "Add a photo of their face";
      pic.addEventListener("click", (e) => { if (!e.target.closest(".x")) file.click(); });
      return el("div", { class: "st-member", "data-id": c.id },
        pic, file,
        el("div", { class: "st-member-fields" },
          // the speaker lists show the name; the cast itself is not redrawn under the cursor
          input(c.name, "Name, e.g. Mali", (v) => { c.name = v; drawShots(); changed(); }, "st-name"),
          input(c.who, "Who they are, e.g. a shy Thai student, 20, in a school uniform", (v) => { c.who = v; changed(); }),
          input(c.voice, "Voice, e.g. a soft, nervous young woman's voice", (v) => { c.voice = v; changed(); }),
          input(c.outfit || "", "Outfit, only if not the photo's: e.g. modern clothes, a white T-shirt and jeans", (v) => { c.outfit = v; changed(); })),
        el("div", { class: "st-member-acts" },
          el("span", { class: "tag mono st-stag", title: "Speaker tag in the open scene's prompt" }),
          el("button", { class: "link", type: "button", title: "Keep in this browser for other stories", onclick: () => saveChar(c) }, "Save"),
          el("button", { class: "x", type: "button", title: "Remove from the story", onclick: () => {
            S.cast.splice(i, 1);
            for (const sc of S.scenes) for (const s of sc.shots) s.lines = s.lines.filter((l) => l.who !== c.id);
            changed(true);
          } }, "×")));
    }));
    if (!S.cast.length) {
      $("#stCast").append(el("p", { class: "empty", text: "Nobody yet. Add the people in the story; a photo keeps the same face in every scene." }));
    }
    $("#stAddCast").hidden = S.cast.length >= MAX_CAST;
    drawSaved();
    markCast();
  }

  // Which characters the open scene uses: their picture number and speaker tag in its prompt;
  // the others are dimmed. Updated in place, so typing in a shot never redraws the cast fields.
  function markCast() {
    const { picOf, cast } = refsFor(scene());
    const slot = new Map(cast.map((i, j) => [S.cast[i].id, j + 1]));
    for (const row of $$("#stCast .st-member")) {
      const id = row.dataset.id, n = picOf.get(id);
      row.classList.toggle("off", !slot.has(id));
      row.title = slot.has(id) ? "" : "Not in the open scene: write @Name in a shot or give them a line";
      const tag = row.querySelector(".st-stag");
      if (tag) tag.textContent = slot.has(id) ? `S${slot.get(id)}` : "—";
      const thumbEl = row.querySelector(".sp-thumb");
      let b = thumbEl?.querySelector("b");
      if (thumbEl && n && !b) thumbEl.append(b = el("b"));
      if (b) n ? (b.textContent = String(n)) : b.remove();
    }
  }

  const savedChars = () => loadJson(CHARS_KEY, []);
  function drawSaved() {
    const shopee = (loadJson(SHOPEE_LIB, {}).chars || []).map((c) => ({ ...c, shopee: true }));
    const inStory = new Set(S.cast.map((c) => c.libId));
    const chips = [...savedChars(), ...shopee].filter((c) => !inStory.has(c.id)).map((c) =>
      el("span", { class: "sp-chip" },
        el("button", { class: "sp-chip-use", type: "button", title: c.shopee ? "Saved in the Shopee tab" : "Add to the story", onclick: () => {
          if (S.cast.length >= MAX_CAST) return toast(`Up to ${MAX_CAST} characters`, true);
          S.cast.push({ id: uid(), libId: c.id, name: c.name, who: c.who || "", voice: c.voiceText || "", thumb: c.img || null, file: null, pod: null });
          changed(true);
        } }, c.img ? el("img", { src: c.img, alt: "" }) : null, el("span", { text: c.name })),
        c.shopee ? null : el("button", { class: "x", type: "button", title: "Delete from this browser", onclick: () => {
          if (!confirm(`Delete the saved character "${c.name}"?`)) return;
          saveJson(CHARS_KEY, savedChars().filter((x) => x.id !== c.id));
          drawSaved();
        } }, "×")));
    $("#stSaved").replaceChildren(...chips);
    $("#stSaved").hidden = !chips.length;
  }

  function saveChar(c) {
    if (!c.name.trim()) return toast("Give them a name first", true);
    const item = { id: c.libId || uid(), name: c.name.trim(), who: c.who.trim(), voiceText: c.voice.trim(), img: c.thumb };
    const list = savedChars().filter((x) => x.id !== item.id && x.name !== item.name);
    if (!saveJson(CHARS_KEY, [...list, item])) return toast("The browser's storage is full", true);
    c.libId = item.id;
    toast(`Saved ${item.name}`);
    save();
  }

  function drawPlace() {
    const { placePic } = refsFor();
    const p = S.place;
    $("#stPlacePic").replaceChildren(p
      ? thumb(p.thumb, placePic, p.busy ? null : () => { S.place = null; changed(true); }, p.busy)
      : el("span", { class: "sp-nophoto", text: "no photo" }));
    $("#stPlaceWhat").hidden = !p;
    if ($("#stPlaceWhat").value !== (p?.what || "")) $("#stPlaceWhat").value = p?.what || "";
  }

  function drawScenes() {
    $("#stScenes").replaceChildren(...S.scenes.map((sc, i) => {
      const b = el("button", { type: "button", "aria-pressed": String(i === S.at), title: `${sceneSeconds(sc)} s` },
        el("b", { class: "mono", text: String(i + 1) }), el("span", { text: sc.title.trim() || `Scene ${i + 1}` }),
        sc.blocking?.file ? el("i", { class: "st-has-video", title: "has a blocking video", text: "▶" }) : null,
        sc.state ? el("i", { class: `st-state ${sc.state}`, text: sc.state }) : null);
      b.addEventListener("click", () => { S.at = i; drawScenes(); drawScene(); drawPreview(); save(); });
      return b;
    }));
  }

  // the clip's shape, as CSS: a frame is shown the way the pod will cut it (cover, centred)
  const shapeRatio = () => ({ "9:16": "9 / 16", "16:9": "16 / 9", "1:1": "1 / 1" })[S.aspect];

  function drawFrames() {
    const sc = scene(), prev = S.scenes[S.at - 1];
    const [w, h] = SHAPES[S.aspect];
    const notes = [];
    for (const key of FRAME_KEYS) {
      const fr = sc.frames[key];
      const label = key === "start" ? "First frame" : "Last frame";
      const box = el("button", { class: "st-frame-box", type: "button", style: `aspect-ratio: ${shapeRatio()}`,
        title: fr ? `${label} · click to change` : `Add the picture the clip ${key === "start" ? "opens" : "ends"} on`,
        onclick: () => { frameKey = key; $("#stFrameFile").click(); } },
      fr?.thumb ? el("img", { src: fr.thumb, alt: label }) : el("span", { class: "st-nopic", text: fr?.busy ? "uploading…" : "+ picture" }));
      if (fr?.busy) box.classList.add("busy");
      const acts = [];
      if (fr) {
        acts.push(el("button", { class: "x", type: "button", title: "Remove", onclick: () => {
          sc.frames[key] = null; drawFrames(); changed();
        } }, "×"));
      }
      // continuity: the next scene opens where this one ended
      if (key === "start" && prev?.frames?.end && prev.frames.end.thumb !== fr?.thumb) {
        acts.push(el("button", { class: "link", type: "button", title: "Start this scene exactly where the previous one ends",
          onclick: () => { sc.frames.start = { ...prev.frames.end }; drawFrames(); changed(); } }, `Use scene ${S.at}'s last frame`));
      }
      $(key === "start" ? "#stFrameStart" : "#stFrameEnd").replaceChildren(
        el("span", { class: "opt-k", text: label }), box, el("div", { class: "row tight st-frame-acts" }, ...acts));
      if (fr?.width && Math.abs(fr.width / fr.height - w / h) > 0.02) {
        notes.push(`The ${label.toLowerCase()} is ${fr.width}×${fr.height}; its edges outside ${S.aspect} are cut off, as shown.`);
      }
    }
    $("#stFramesNote").textContent = notes.join(" ")
      || (sc.frames.start || sc.frames.end
        ? "The clip opens or ends exactly on these pictures. Describe the first and last shot to match them."
        : "Leave them empty and H3 designs the shot from the text. A Blender render, a still from an earlier clip, or a picture from the Create tab works.");
  }

  async function setFrame(key, f) {
    const sc = scene();
    sc.frames[key] = { busy: true, name: f.name };
    drawFrames();
    try {
      const bitmap = await createImageBitmap(f);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      sc.frames[key] = { ...(await pickPicture(f)), name: f.name, ...size };
    } catch (e) {
      sc.frames[key] = null;
      msg(`${f.name}: ${e.message}`);
    }
    if (sc === scene()) drawFrames();
    changed();
  }
  let frameKey = "start";

  const sceneNo = (id) => S.scenes.findIndex((x) => x.id === id) + 1;
  const isClip = (path) => VIDEO_EXT.test(path || "");
  // what a scene's dialogue says, to tell whether two angles still match
  const dialogue = (sc) => sc.shots.flatMap((s) => s.lines.map((l) => `${l.who}:${l.text.trim()}`)).join("|");

  function mediaDuration(url) {
    return new Promise((resolve) => {
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => resolve(null);
      a.src = url;
    });
  }

  // a scene's finished clips, newest last, from the queue the server keeps (its tag names the scene)
  async function madeClips(id) {
    const jobs = DEMO ? [] : (await api("beginner/status")).jobs || [];
    const mine = jobs.filter((j) => j.tag === `story:${id}`);
    const made = mine.filter((j) => j.state === "finished")
      .flatMap((j) => (j.outputs || []).filter((o) => isClip(o.path)).map((o) => ({ path: o.path, seed: j.seed })));
    return { made: made.reverse(), busy: mine.some((j) => j.state === "queued" || j.state === "running") };
  }

  function drawAudio() {
    const sc = scene(), a = sc.audio;
    $("#stAudioRemove").hidden = !a;
    $("#stAudioModeRow").hidden = !a;
    const src = el("select", { title: "Where this scene's sound comes from" },
      el("option", { value: "", text: "None: H3 makes the sound" }),
      ...S.scenes.filter((x) => x !== sc).map((x) =>
        el("option", { value: x.id, text: `Scene ${sceneNo(x.id)}'s clip · ${x.title.trim() || "untitled"}` })),
      a && !a.from ? el("option", { value: "upload", text: `Uploaded: ${a.name || "sound"}` }) : null);
    src.value = a ? a.from || "upload" : "";
    src.addEventListener("change", () => {
      sc.audio = src.value && src.value !== "upload"
        ? { mode: a?.mode || "exact", from: src.value, file: null, pod: null, output: null } : src.value ? a : null;
      drawAudio();
      changed();
    });
    const rows = [el("div", { class: "row tight st-audio-src" }, el("span", { class: "opt-k", text: "Sound" }), src)];
    if (a) {
      setSeg("stAudioMode", "mode", a.mode || "exact");
      $("#stAudioModeNote").textContent = a.mode === "voices"
        ? "Only the voices are borrowed; H3 speaks the dialogue again, so the timing can differ."
        : "Copied as this clip's sound: H3 moves the lips and the action to it, so the angles cut together.";
    }
    if (a?.from) {
      const n = sceneNo(a.from), source = S.scenes[n - 1];
      const line = el("p", { class: "small dim", text: a.output
        ? `Scene ${n}'s clip ${a.output.split("/").pop()}.`
        : `Taken from scene ${n}'s finished clip when this scene is queued. Make all scenes waits for that clip.` });
      rows.push(line);
      if (a.output && !DEMO) rows.push(el("audio", { controls: true, preload: "none", src: `api/outputs/file?path=${encodeURIComponent(a.output)}` }));
      if (source && Math.abs(sceneSeconds(source) - sceneSeconds(sc)) > 0.01) {
        rows.push(el("p", { class: "small warn-note", text: `Scene ${n} is ${sceneSeconds(source)} s and this one ${sceneSeconds(sc)} s: keep the same shot lengths so the sound lines up.` }));
      }
      if (source && dialogue(source) !== dialogue(sc)) {
        rows.push(el("p", { class: "small warn-note", text: `The dialogue differs from scene ${n}. Keep the same lines (the camera can change).` }));
      }
      // which take, once scene n has more than one finished
      madeClips(a.from).then(({ made }) => {
        if (made.length < 2 || sc !== scene()) return;
        const pick = el("select", { title: "Which take's sound" },
          el("option", { value: "", text: "the first finished take" }),
          ...made.map((m, k) => el("option", { value: m.path, text: `take ${k + 1} · seed ${m.seed} · ${m.path.split("/").pop()}` })));
        pick.value = made.some((m) => m.path === a.output) ? a.output : "";
        pick.addEventListener("change", () => { Object.assign(a, { output: pick.value || null, file: null, pod: null }); drawAudio(); changed(); });
        line.after(el("div", { class: "row tight st-audio-src" }, el("span", { class: "opt-k", text: "Take" }), pick));
      }).catch(() => {});
    } else if (a) {
      const url = a.file && audioUrls.get(a.file);
      rows.push(el("p", { class: "small dim", text: [a.name, a.duration && `${a.duration.toFixed(2)} s`, a.busy ? "uploading…" : "<Audio 1>"].filter(Boolean).join(" · ") }));
      if (url) rows.push(el("audio", { controls: true, preload: "metadata", src: url }));
      if (a.duration && Math.abs(a.duration - sceneSeconds(sc)) > 0.25) {
        rows.push(el("p", { class: "small warn-note", text: `The sound is ${a.duration.toFixed(1)} s and the scene ${sceneSeconds(sc)} s; it is cut to the scene's length.` }));
      }
    } else {
      rows.push(el("p", { class: "small dim", text: "For a second camera on the same dialogue, use + Another angle: that scene takes this one's sound, so both clips have the same voices and timing." }));
    }
    $("#stAudio").replaceChildren(...rows);
  }

  async function setAudioUpload(f) {
    const sc = scene();
    const url = URL.createObjectURL(f);
    const duration = await mediaDuration(url);
    sc.audio = { mode: sc.audio?.mode || "exact", from: null, file: null, pod: null, name: f.name, duration, busy: true };
    drawAudio();
    try {
      const file = await upload(f);
      audioUrls.set(file, url);
      Object.assign(sc.audio, { file, pod: pod() });
      delete sc.audio.busy;
      msg("The sound is in. It goes to H3 as <Audio 1>.");
    } catch (e) {
      sc.audio = null;
      URL.revokeObjectURL(url);
      msg(/unsupported file type/.test(e.message)
        ? "This pod's image cannot take a sound file yet: start the pod from the latest Shopee ComfyPod image."
        : `${f.name}: ${e.message}`);
    }
    if (sc === scene()) drawAudio();
    changed();
  }

  // a second camera on the scene that is open: the same shots, lines and seconds, its sound taken
  // from that scene's finished clip; an angle of an angle shares the first one's sound
  function addAngle() {
    const src = scene();
    const root = src.audio?.from && src.audio.mode !== "voices" ? src.audio.from : src.id;
    const twin = JSON.parse(JSON.stringify(src));
    const n = S.scenes.filter((x) => x.audio?.from === root).length + 2;
    const base = (S.scenes.find((x) => x.id === root)?.title || src.title).trim() || `Scene ${sceneNo(root)}`;
    Object.assign(twin, {
      id: uid(), title: `${base} · angle ${n}`, blocking: null, frames: { start: null, end: null },
      audio: { mode: "exact", from: root, file: null, pod: null, output: null },
    });
    delete twin.state;
    for (const s of twin.shots) {
      s.id = uid();
      if (s.move === "blocking") s.move = "static";
    }
    S.scenes.splice(S.at + 1, 0, twin);
    goScene(S.at + 1);
    msg(`Scene ${S.at + 1} is angle ${n} of scene ${sceneNo(root)}: change each shot's camera, keep the dialogue and the seconds. It takes scene ${sceneNo(root)}'s sound once that clip is made.`);
  }

  function drawLocation() {
    const sc = scene(), l = locOf(sc);
    const pick = el("select", { title: "This scene's location photo" },
      el("option", { value: "", text: S.place?.thumb ? "The story's place" : "None: H3 designs the place" }),
      ...S.locations.map((x) => el("option", { value: x.id, text: (x.what || "").trim() || x.name || "location" })),
      el("option", { value: "+new", text: "+ New location photo…" }));
    pick.value = l ? l.id : "";
    pick.addEventListener("change", () => {
      if (pick.value === "+new") {
        pick.value = l ? l.id : "";
        return $("#stLocFile").click();
      }
      sc.location = pick.value || null;
      drawLocation();
      changed();
    });
    const users = l ? S.scenes.filter((x) => x.location === l.id).length : 0;
    $("#stLocation").replaceChildren(el("div", { class: "st-loc" },
      l ? el("span", { class: `sp-thumb st-loc-thumb${l.busy ? " busy" : ""}` }, l.thumb ? el("img", { src: l.thumb, alt: "" }) : null)
        : el("span", { class: "sp-nophoto st-loc-thumb", text: "no photo" }),
      el("div", { class: "st-loc-body" },
        el("div", { class: "row tight st-audio-src" }, el("span", { class: "opt-k", text: "Location" }), pick),
        l ? input(l.what || "", "what the place is, e.g. Mali's small open-plan condo", (v) => { l.what = v; changed(); }) : null,
        el("p", { class: "small dim", text: l
          ? `${users} scene${users === 1 ? " uses" : "s use"} this location; a change to it applies to all of them.`
          : "A photo of the place keeps it the same in every scene and angle that uses it." }))));
  }

  async function addLocation(f) {
    const sc = scene();
    const loc = { id: uid(), what: trim(sc.where) || "", name: f.name, file: null, pod: null, thumb: null, busy: true };
    S.locations.push(loc);
    sc.location = loc.id;
    drawLocation();
    try {
      Object.assign(loc, await pickPicture(f));
      delete loc.busy;
    } catch (e) {
      S.locations = S.locations.filter((x) => x !== loc);
      sc.location = null;
      msg(`${f.name}: ${e.message}`);
    }
    drawLocation();
    changed();
  }

  function drawScene() {
    const sc = scene();
    $("#stSceneNo").textContent = String(S.at + 1);
    $("#stSceneTitle").value = sc.title;
    $("#stSceneWhere").value = sc.where;
    $("#stSceneWhere").placeholder = trim(S.where) || "where this scene happens";
    $("#stSceneWhen").value = sc.when;
    $("#stSceneWhen").placeholder = trim(S.when) || "e.g. the next morning";
    $("#stSceneSound").value = sc.sound;
    $("#stSceneSound").placeholder = trim(S.music) || "Ambient sound that matches the setting";
    $("#stDelScene").hidden = S.scenes.length < 2;
    drawLocation();
    drawFrames();
    drawAudio();
    drawBlocking();
    drawShots();
    markCast();
  }

  function drawShots() {
    const sc = scene();
    const video = !!sc.blocking?.file;
    $("#stShots").replaceChildren(...sc.shots.map((s, i) => {
      const secs = el("input", { type: "number", min: "0.5", max: String(MAX_SECONDS), step: "0.5", value: String(s.seconds), title: "Seconds" });
      secs.addEventListener("input", () => { s.seconds = Math.max(0, Number(secs.value) || 0); changed(); });
      const size = el("select", { title: "Shot size" }, ...SIZES.map((n) => el("option", { value: n, text: n })));
      size.value = s.size;
      size.addEventListener("change", () => { s.size = size.value; changed(); });
      const move = el("select", { title: "Camera" },
        ...Object.entries(MOVES).filter(([k]) => k !== "blocking" || video).map(([k, [label]]) => el("option", { value: k, text: label })));
      move.value = s.move === "blocking" && !video ? "static" : s.move;
      move.addEventListener("change", () => { s.move = move.value; changed(); });
      const what = el("textarea", { class: "sp-what", rows: "2", spellcheck: "false",
        placeholder: i === 0 ? "@Mali runs into the rain-soaked alley and stops when she sees @Ken" : "what happens, in English; @Name for a character" });
      what.value = s.what;
      what.addEventListener("input", () => { s.what = what.value; changed(); });
      const lines = s.lines.map((ln, j) => {
        const who = el("select", { title: "Who says it" }, ...S.cast.map((c, k) => el("option", { value: c.id, text: castName(c, k) })));
        if (!S.cast.some((c) => c.id === ln.who) && S.cast[0]) ln.who = S.cast[0].id;
        who.value = ln.who;
        who.addEventListener("change", () => { ln.who = who.value; changed(); });
        return el("div", { class: "st-line" }, who,
          input(ln.text, "what they say, Thai or English", (v) => { ln.text = v; changed(); }, "sp-line"),
          el("button", { class: "x", type: "button", title: "Remove the line", onclick: () => { s.lines.splice(j, 1); drawShots(); changed(); } }, "×"));
      });
      return el("div", { class: "sp-shot" },
        el("div", { class: "sp-shot-head st-shot-head" },
          el("span", { class: "shot-no mono", text: String(i + 1) }),
          size, move,
          el("label", { class: "st-secs" }, secs, el("span", { text: "s" })),
          el("span", { class: "spacer" }),
          i > 0 ? el("button", { class: "x", type: "button", title: "Move up", onclick: () => {
            sc.shots.splice(i - 1, 0, sc.shots.splice(i, 1)[0]); drawShots(); changed();
          } }, "↑") : null,
          sc.shots.length > 1 ? el("button", { class: "x", type: "button", title: "Remove this shot", onclick: () => {
            sc.shots.splice(i, 1); drawShots(); changed();
          } }, "×") : null),
        el("label", { class: "sp-sub" }, el("span", { text: "What happens" }), what),
        lines.length ? el("div", { class: "sp-sub" }, el("span", { text: "Dialogue" }), el("div", { class: "st-lines" }, ...lines)) : null,
        S.cast.length ? el("div", { class: "row tight st-shot-acts" },
          el("button", { class: "link", type: "button", onclick: () => {
            // the next line goes to the next person, so a conversation is typed straight down
            const last = s.lines[s.lines.length - 1];
            const next = last ? S.cast[(S.cast.findIndex((c) => c.id === last.who) + 1) % S.cast.length] : S.cast[0];
            s.lines.push({ who: next.id, text: "" });
            drawShots();
            changed();
            $$(".sp-line", $("#stShots").children[i]).pop()?.focus();
          } }, "+ Dialogue line")) : null);
    }));
    drawLength();
  }

  function drawLength() {
    const n = sceneSeconds();
    $("#stLength").textContent = `${Math.round(n * 10) / 10}s`;
    const blk = scene().blocking;
    const notes = [];
    if (n > MAX_SECONDS) notes.push(`H3 makes up to ${MAX_SECONDS} s a scene: shorten a shot or split the scene`);
    if (blk?.duration && Math.abs(blk.duration - n) > 0.25) notes.push(`the blocking video is ${blk.duration.toFixed(1)} s`);
    $("#stLengthNote").textContent = notes.join(" · ");
    $("#stStart").disabled = n > MAX_SECONDS || n < 1;
    $("#stStart").textContent = S.takes > 1 ? `Make ${S.takes} takes` : "Make this scene";
    $("#stAll").textContent = `Make all ${S.scenes.length} scenes`;
    $("#stAll").hidden = S.scenes.length < 2;
  }

  function drawBlocking() {
    const blk = scene().blocking;
    $("#stFollowRow").hidden = !blk?.file;
    $("#stBlockingFit").hidden = !blk?.duration;
    $("#stBlockingRemove").hidden = !blk;
    $("#stBlockingBtn").textContent = blk ? "Replace video" : "+ Add blocking video";
    if (!blk) {
      $("#stBlocking").replaceChildren(el("p", { class: "empty", text: "No blocking video. H3 frames each shot from the camera and action written below." }));
      return;
    }
    setSeg("stFollow", "follow", blk.follow || "full");
    $("#stFollowNote").textContent = FOLLOW[blk.follow || "full"];
    const url = videoUrls.get(blk.file);
    const [w, h] = SHAPES[S.aspect];
    const warn = [];
    if (blk.width && Math.abs(blk.width / blk.height - w / h) > 0.02) {
      warn.push(`It is ${blk.width}×${blk.height} and the scene is ${S.aspect}, so its sides get cropped. Render it at ${w}×${h}.`);
    }
    if (blk.file && blk.pod && blk.pod !== pod() && !DEMO) warn.push("It was uploaded to another pod: add it again.");
    $("#stBlocking").replaceChildren(el("div", { class: "st-video" },
      url ? el("video", { src: url, controls: true, muted: true, loop: true, playsinline: true, preload: "metadata" })
        : el("div", { class: "st-video-gone mono", text: blk.busy ? "uploading…" : "on the pod" }),
      el("div", { class: "st-video-info" },
        el("b", { text: blk.name || "blocking video" }),
        el("span", { class: "small dim mono", text: [blk.duration && `${blk.duration.toFixed(2)} s`, blk.width && `${blk.width}×${blk.height}`, blk.busy ? "uploading…" : "<Video 1>"].filter(Boolean).join(" · ") }),
        ...warn.map((t) => el("span", { class: "small warn-note", text: t })))));
  }

  function drawPreview() {
    $("#stPreview").textContent = buildPrompt();
    const { files } = refsFor();
    const vid = scene().blocking?.file ? " + 1 video" : "";
    $("#stRefsNote").textContent = `scene ${S.at + 1} · ${files.length} picture${files.length === 1 ? "" : "s"}${vid}`;
  }

  function drawAll() {
    $("#stTitle").value = S.title;
    $("#stLogline").value = S.logline;
    $("#stWhere").value = S.where;
    $("#stWhen").value = S.when;
    $("#stLookText").value = S.lookText;
    $("#stLookText").placeholder = LOOKS[S.look];
    $("#stMusic").value = S.music;
    setSeg("stAspect", "aspect", S.aspect);
    setSeg("stLook", "look", S.look);
    setSeg("stTakes", "takes", S.takes);
    $("#stRes").value = S.res;
    $("#stSteps").value = String(S.steps);
    $("#stSparse").checked = S.sparse === true;
    const needsFast = (A.needs().fast || []).length > 0;
    $("#stFast").disabled = needsFast;
    $("#stFast").checked = S.fast && !needsFast;
    $("#stFastRow").title = needsFast ? "Fast needs the h3fast models: download them in Models" : "4 steps instead of 8: about 1.5x faster.";
    drawCast();
    drawPlace();
    drawScenes();
    drawScene();
    drawPreview();
  }

  // `cast` = picture numbers, names or the speaker lists may have changed
  function changed(cast = false) {
    if (cast) { drawCast(); drawPlace(); drawShots(); }
    markCast();
    // an edited scene is no longer the one that was queued
    if (scene().state) { delete scene().state; drawScenes(); }
    if (scene().audio?.from) drawAudio();
    drawLength();
    drawPreview();
    save();
  }

  /* ---------------- blocking video ---------------- */

  async function setBlocking(f) {
    const sc = scene();
    const url = URL.createObjectURL(f);
    let meta = {};
    try { meta = await videoInfo(url); } catch (e) { msg(e.message); }
    sc.blocking = { file: null, pod: null, name: f.name, follow: sc.blocking?.follow || "full", busy: true, ...meta };
    drawBlocking();
    try {
      const file = await upload(f);
      videoUrls.set(file, url);
      Object.assign(sc.blocking, { file, pod: pod() });
      // a new blocking video takes over the camera of every shot still on the default
      for (const s of sc.shots) if (s.move === "static") s.move = "blocking";
      msg(meta.duration && Math.abs(meta.duration - sceneSeconds(sc)) > 0.25
        ? `The video is ${meta.duration.toFixed(1)} s and the shots add up to ${sceneSeconds(sc)} s: "Fit shots to the video" lines them up.`
        : "The blocking video is in. It goes to H3 as <Video 1>.");
    } catch (e) {
      sc.blocking = null;
      URL.revokeObjectURL(url);
      msg(/unsupported file type/.test(e.message)
        ? "This pod's image cannot take a video yet: start the pod from the latest Shopee ComfyPod image."
        : `${f.name}: ${e.message}`);
    }
    if (sc.blocking) delete sc.blocking.busy;
    if (sc === scene()) drawScene();
    drawScenes();
    changed();
  }

  // scale every shot so they add up to the video's length (at most 15 s), in half seconds
  function fitToVideo() {
    const sc = scene(), d = sc.blocking?.duration;
    if (!d) return;
    const target = Math.min(Math.round(d * 2) / 2, MAX_SECONDS), total = sceneSeconds(sc) || 1;
    let left = target;
    sc.shots.forEach((s, i) => {
      const rest = sc.shots.length - 1 - i;  // half a second kept for every shot still to come
      const share = i === sc.shots.length - 1 ? left : Math.round((s.seconds / total) * target * 2) / 2;
      s.seconds = Math.max(0.5, Math.min(share, left - rest * 0.5));
      left -= s.seconds;
    });
    drawShots();
    changed();
    msg(d > MAX_SECONDS
      ? `The video is ${d.toFixed(1)} s; H3 makes ${MAX_SECONDS} s at most, so only its first ${MAX_SECONDS} s are used.`
      : `The shots now add up to ${sceneSeconds(sc)} s.`);
  }

  function blenderScript() {
    const [w, h] = SHAPES[S.aspect];
    const secs = Math.min(sceneSeconds() || 5, MAX_SECONDS);
    const n = S.at + 1;
    return `# Blocking render for ${scene().title.trim() || `scene ${n}`}. Paste into Blender's Scripting tab,
# press Run Script, then Render > Render Animation.
import bpy
s = bpy.context.scene
s.render.fps, s.render.fps_base = ${FPS}, 1   # H3 makes 24 fps: the guide lines up frame for frame
s.render.resolution_x, s.render.resolution_y = ${w}, ${h}   # the clip's ${S.aspect} size
s.render.resolution_percentage = 100
s.frame_end = s.frame_start + ${Math.round(secs * FPS)} - 1   # ${secs} s
s.render.engine = "BLENDER_WORKBENCH"   # quick grey previz
s.display.shading.light = "STUDIO"
s.display.shading.color_type = "OBJECT"   # each figure keeps its own flat colour
if hasattr(s.render.image_settings, "media_type"):   # Blender 5
    s.render.image_settings.media_type = "VIDEO"
s.render.image_settings.file_format = "FFMPEG"
s.render.ffmpeg.format, s.render.ffmpeg.codec = "MPEG4", "H264"
s.render.ffmpeg.constant_rate_factor = "MEDIUM"
s.render.ffmpeg.audio_codec = "NONE"
s.render.filepath = "//blocking_scene${n}_"
`;
  }

  /* ---------------- making ---------------- */

  // a scene's <Audio 1> as a file on this pod. Another scene's clip is copied in once it is
  // finished; until then the error carries `wait`, and the scene is tried again with the others.
  async function audioFile(sc) {
    const a = sc.audio;
    if (!a) return null;
    if (a.busy) throw new Error("its sound is still uploading");
    if (a.file && (a.pod === pod() || DEMO)) return a.file;
    if (!a.from) {
      const url = a.file && audioUrls.get(a.file);
      if (!url) throw new Error("its sound file is on another pod: upload it again");
      const blob = await (await fetch(url)).blob();
      a.file = await upload(new File([blob], a.name || "sound.wav", { type: blob.type }));
      a.pod = pod();
      audioUrls.set(a.file, url);
      save();
      return a.file;
    }
    const n = sceneNo(a.from);
    if (!n) throw new Error("the scene it takes its sound from was deleted");
    const { made, busy } = await madeClips(a.from);
    const path = made.find((m) => m.path === a.output)?.path || made[0]?.path;
    if (!path) {
      if (!busy) throw new Error(`make scene ${n} first: this scene takes its sound from that clip`);
      const e = new Error(`scene ${n}'s clip is not finished yet`);
      e.wait = true;
      throw e;
    }
    const r = await api("beginner/ref-from-output", { path });
    Object.assign(a, { file: r.filename, pod: pod(), output: path });
    save();
    if (sc === scene()) drawAudio();
    return a.file;
  }

  async function requestFor(sc, i) {
    const seconds = sceneSeconds(sc);
    if (seconds > MAX_SECONDS) throw new Error(`it is ${seconds} s; H3 makes up to ${MAX_SECONDS} s`);
    if (seconds < 1) throw new Error("give its shots some seconds");
    if (!sc.shots.some((s) => s.what.trim())) throw new Error("say what happens in at least one shot");
    const blk = sc.blocking;
    if (blk?.busy) throw new Error("its blocking video is still uploading");
    if (blk?.file && blk.pod && blk.pod !== pod() && !DEMO) throw new Error("its blocking video is on another pod: add it again");
    const audio = await audioFile(sc);
    const refs = [];
    for (const item of refsFor(sc).files) {
      refs.push(await onPod(item, item === S.place || S.locations.includes(item) ? "location" : item.name || "character"));
    }
    // first frame = 0, last frame = -1 (server.py counts a negative index back from the end)
    const keyframes = [];
    for (const [key, frame] of [["start", 0], ["end", -1]]) {
      const fr = sc.frames?.[key];
      if (fr) keyframes.push({ file: await onPod(fr, `scene${i + 1}-${key}`), frame });
    }
    return {
      mode: "free", prompt: buildPrompt(sc), seconds, aspect: S.aspect, refs, keyframes,
      ref_videos: blk?.file ? [blk.file] : [],
      ref_audios: audio ? [audio] : [],
      // the queue hands this back, so another angle can find this scene's finished clip
      tag: `story:${sc.id}`,
      label: `${S.title.trim() ? S.title.trim() + " · " : ""}${i + 1}. ${sc.title.trim() || `Scene ${i + 1}`}`,
      // sparse attention only when asked for: it is faster on long clips, at a small cost in detail
      count: S.takes, res: S.res, hd: S.res === "720", fast: S.fast && !$("#stFast").disabled,
      // the model's own steps unless more were asked for (8, or 4 with Fast)
      steps: S.steps !== 8 ? S.steps : undefined, sparse: S.sparse === true, upscale: false, loras: [],
      // stored beside the clip, so "Use this recipe" in Outputs brings the story back here
      form: { story: snapshot(i) },
    };
  }

  // the story as it was for this clip, without the pictures themselves (a recipe is capped at
  // 64 KB): the files on the pod stand for them
  function snapshot(i) {
    const strip = (x) => x && { ...x, thumb: undefined, busy: undefined };
    return {
      ...S, at: i, place: strip(S.place), cast: S.cast.map(strip), locations: S.locations.map(strip),
      scenes: S.scenes.map((sc) => ({
        ...sc, state: undefined, blocking: strip(sc.blocking), audio: strip(sc.audio),
        frames: { start: strip(sc.frames?.start), end: strip(sc.frames?.end) },
      })),
    };
  }

  // What server.py says while the pod is still starting or downloading the clip models. Those are
  // the only refusals that fix themselves, so only they are retried.
  const NOT_READY = /ComfyUI is not up yet|models not downloaded yet/;
  const RETRY_MS = 20000;
  let waitTimer = null;
  const stopWaiting = () => { clearTimeout(waitTimer); waitTimer = null; };

  // the scenes still to queue are sent by themselves once the pod is ready, so a story imported
  // during the first boot's downloads starts the moment it can
  function waitFor(rest, why, queued) {
    const n = rest.length;
    if (!n) return;
    // by id, not position: a scene added or deleted meanwhile must not shift which ones go
    const ids = rest.map((i) => S.scenes[i].id);
    $("#stMsg").replaceChildren(
      `${queued ? `${queued} queued. ` : ""}Waiting: ${why}. ${n === 1 ? "1 scene will queue by itself" : `${n} scenes will queue by themselves`} when ready; keep this tab open. `,
      el("button", { class: "link", type: "button", onclick: () => {
        stopWaiting();
        msg("Stopped waiting. Make all scenes queues them when you are ready.");
      } }, "Stop waiting"));
    waitTimer = setTimeout(() => makeScenes(ids.map((id) => S.scenes.findIndex((sc) => sc.id === id)).filter((i) => i >= 0)), RETRY_MS);
  }

  // a scene that takes its sound from another one in the same run goes after it
  function sourcesFirst(indexes) {
    const out = [], seen = new Set();
    const visit = (i) => {
      if (seen.has(i)) return;
      seen.add(i);
      const j = S.scenes.findIndex((x) => x.id === S.scenes[i].audio?.from);
      if (j >= 0 && indexes.includes(j)) visit(j);
      out.push(i);
    };
    indexes.forEach(visit);
    return out;
  }

  async function makeScenes(indexes) {
    stopWaiting();
    $("#stStart").disabled = $("#stAll").disabled = true;
    msg("");
    let queued = 0, why = "";
    const later = [];
    indexes = sourcesFirst(indexes);
    try {
      for (const [pos, i] of indexes.entries()) {
        const sc = S.scenes[i];
        try {
          const r = await api("beginner/start", await requestFor(sc, i));
          queued += r.jobs?.length || S.takes;
          sc.state = "queued";
        } catch (e) {
          // the pod is not ready: everything left waits; an angle whose source clip is not
          // finished: only it waits, the others still go
          if (NOT_READY.test(e.message)) {
            later.push(...indexes.slice(pos));
            why = `the pod (${e.message})`;
            break;
          }
          if (e.wait) {
            later.push(i);
            why = why || e.message;
            sc.state = "waiting";
            continue;
          }
          sc.state = "failed";
          throw new Error(`Scene ${i + 1}: ${e.message}`);
        } finally {
          drawScenes();
        }
      }
      if (later.length) return waitFor(later, why, queued);
      msg(`Queued ${queued} clip${queued === 1 ? "" : "s"}. ${indexes.length > 1 ? "The scenes run one after another" : "It shows up"} in the Queue, then in Outputs.`);
      A.genPoll();
    } catch (e) {
      msg((queued ? `${queued} queued, then: ` : "") + e.message);
    } finally {
      $("#stAll").disabled = false;
      drawLength();
      save();
    }
  }

  function loadRecipe(r) {
    const st = r.form?.story;
    if (!st) return;
    const busy = S.scenes.some((sc) => sc.shots.some((s) => s.what.trim()));
    if (busy && !confirm("Replace the story in the Story tab with the one this clip was made from?")) return;
    const here = pod();
    // the recipe names files on the pod it was made on; they show here through refUrl
    const keep = (x) => x && { ...x, pod: here, thumb: x.file && !DEMO ? A.refUrl(x.file) : null };
    S = settle(Object.assign(blank(), sizeOf({ ...st }), {
      place: keep(st.place), cast: (st.cast || []).map(keep), locations: (st.locations || []).map(keep),
      scenes: (st.scenes || []).map((sc) => ({
        ...sc, blocking: sc.blocking && { ...sc.blocking, pod: here },
        audio: sc.audio && { ...sc.audio, pod: here },
        frames: { start: keep(sc.frames?.start), end: keep(sc.frames?.end) },
      })),
    }));
    if (!S.scenes.length) S.scenes = [newScene(1)];
    S.at = Math.min(st.at || 0, S.scenes.length - 1);
    // a refUrl thumbnail is a link to this pod; keep a copy of the picture so the story outlives it
    for (const item of [S.place, ...S.cast, ...S.locations, ...frameItems(S)].filter((x) => x?.thumb)) {
      shrink(item.thumb, 1024).then((t) => { item.thumb = t; save(); }).catch(() => {});
    }
    drawAll();
    save();
    msg(r.missing_refs?.length
      ? "Some of its pictures are not on this pod: add them again."
      : `Scene ${S.at + 1} of the story this clip was made from is back.`);
  }

  /* ---------------- export / import ----------------
     One .story.zip carries a whole story to another browser or pod, written on a PC in demo mode
     and imported on the pod:

       story.json        the words and settings; pictures and videos are named by their path here
       photos/…          each character's photo and the place, at full size when this page still
                         has the original, otherwise the 1024 px copy the story keeps
       videos/…          each blocking video this page still has
       prompts/…         what H3 is sent for each scene, to read (import ignores it)

     The zip is written uncompressed (photos and videos are compressed already) by the few lines
     below, so nothing is loaded from outside. Import reads stored and deflated entries, so a zip
     that was unpacked, edited and zipped again by Windows still loads. The older .story.json
     (everything inline as data URLs) still imports. */
  const FILE_FORMAT = "aiangel-story";
  const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;  // server.py ALLOWED_VIDEO_EXT
  const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;    // server.py ALLOWED_REF_EXT
  const AUDIO_TYPES = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska" };

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (u8) => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // [{name, data: Uint8Array}] -> a zip Blob, every entry stored
  function zipFiles(files) {
    const enc = new TextEncoder(), now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const body = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2],
        [14, crc, 4], [18, size, 4], [22, size, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([at, v, n]) => (n === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)));
      body.push(local, name, f.data);
      const dir = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2],
        [14, date, 2], [16, crc, 4], [20, size, 4], [24, size, 4], [28, name.length, 2], [42, offset, 4]]
        .forEach(([at, v, n]) => (n === 4 ? dir.setUint32(at, v, true) : dir.setUint16(at, v, true)));
      central.push(dir, name);
      offset += 30 + name.length + size;
    }
    const size = central.reduce((n, part) => n + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...body, ...central, end], { type: "application/zip" });
  }

  // a zip Blob -> Map(path -> Uint8Array); folders are left out, paths use "/"
  async function unzipFiles(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("it is not a zip file");
    const dec = new TextDecoder(), out = new Map();
    let p = dv.getUint32(e + 16, true);
    for (let i = dv.getUint16(e + 10, true); i > 0; i--) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("the zip file is damaged");
      const method = dv.getUint16(p + 10, true), packed = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), skip = dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
      const local = dv.getUint32(p + 42, true);
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      let data = buf.subarray(start, start + packed);
      if (method === 8) {
        data = new Uint8Array(await new Response(new Blob([data]).stream()
          .pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      } else if (method !== 0) {
        throw new Error(`${name} is packed in a way this page cannot read; zip it again`);
      }
      if (!name.endsWith("/")) out.set(name, data);
      p += 46 + nlen + skip;
    }
    return out;
  }

  const bytes = async (src) => new Uint8Array(await (await fetch(src)).arrayBuffer());
  // a file name that survives any unzip tool: Latin letters and digits, or the fallback
  const safeName = (text, fallback) =>
    (text || "").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback;

  async function exportStory() {
    msg("Packing the story…");
    const files = [], missing = [], taken = new Set();
    const add = (path, data) => {
      let name = path, n = 2;
      while (taken.has(name)) name = path.replace(/(\.\w+)?$/, `-${n++}$1`);
      taken.add(name);
      files.push({ name, data });
      return name;
    };
    // file names only mean something on the pod they were uploaded to, so none travel
    const story = JSON.parse(JSON.stringify(S));
    const photo = async (x, saved, base) => {
      if (!x) return;
      const original = saved.file && originals.get(saved.file);
      const ext = original ? (/\.\w+$/.exec(original.name)?.[0] || ".jpg").toLowerCase() : ".jpg";
      if (original || saved.thumb) {
        x.photo = add(`photos/${base}${ext}`, original ? new Uint8Array(await original.arrayBuffer()) : await bytes(saved.thumb));
      }
      Object.assign(x, { file: null, pod: null, thumb: null });
    };
    for (const [i, c] of story.cast.entries()) await photo(c, S.cast[i], safeName(c.name, `character-${i + 1}`));
    await photo(story.place, S.place || {}, "place");
    for (const [i, l] of (story.locations || []).entries()) {
      // named after the picture it came from (a description makes a long, unreadable file name)
      const base = safeName((l.name || "").replace(/\.\w+$/, "") || l.what, String(i + 1)).slice(0, 48);
      await photo(l, S.locations[i], base.startsWith("location") ? base : `location-${base}`);
    }
    for (const [i, sc] of story.scenes.entries()) {
      delete sc.state;
      for (const key of FRAME_KEYS) await photo(sc.frames?.[key], S.scenes[i].frames?.[key] || {}, `scene-${i + 1}-${key}-frame`);
      const blk = S.scenes[i].blocking, url = blk?.file && videoUrls.get(blk.file);
      if (url) {
        const ext = (VIDEO_EXT.exec(blk.name || "")?.[0] || ".mp4").toLowerCase();
        sc.blocking.video = add(`videos/scene-${i + 1}-${safeName((blk.name || "").replace(VIDEO_EXT, ""), "blocking")}${ext}`, await bytes(url));
        Object.assign(sc.blocking, { file: null, pod: null });
      } else if (sc.blocking) {
        missing.push(i + 1);
        sc.blocking = null;
      }
      const aud = S.scenes[i].audio;
      if (aud && !aud.from) {
        const aurl = aud.file && audioUrls.get(aud.file);
        if (aurl) {
          const ext = (/\.\w+$/.exec(aud.name || "")?.[0] || ".wav").toLowerCase();
          sc.audio.path = add(`audio/scene-${i + 1}-${safeName((aud.name || "").replace(/\.\w+$/, ""), "sound")}${ext}`, await bytes(aurl));
          Object.assign(sc.audio, { file: null, pod: null });
        } else {
          missing.push(`${i + 1} (sound)`);
          sc.audio = null;
        }
      } else if (aud) {
        // another scene's clip: made again on the pod the story goes to
        Object.assign(sc.audio, { file: null, pod: null, output: null });
      }
      add(`prompts/scene-${i + 1}.txt`, new TextEncoder().encode(buildPrompt(S.scenes[i])));
    }
    const enc = new TextEncoder();
    files.unshift({ name: "story.json", data: enc.encode(JSON.stringify({ format: FILE_FORMAT, version: 2, saved: new Date().toISOString(), story }, null, 1)) });
    const name = `${safeName(S.title, "story")}.story.zip`;
    const a = el("a", { href: URL.createObjectURL(zipFiles(files)), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    msg(missing.length
      ? `Saved ${name} without the blocking video of scene ${missing.join(", ")}: this page no longer has it. Add it again and export to include it.`
      : `Saved ${name}. On the pod, open the Story tab and import it.`);
  }

  // what a story file holds, either shape: {story, photo(path), video(path)} with Blobs
  async function readStoryFile(f) {
    if (/\.zip$/i.test(f.name)) {
      const entries = await unzipFiles(f);
      // a zip made from the unpacked folder has that folder in front of every path
      const json = [...entries.keys()].find((k) => /(^|\/)story\.json$/.test(k));
      if (!json) throw new Error("it has no story.json inside");
      const root = json.slice(0, -"story.json".length);
      const data = JSON.parse(new TextDecoder().decode(entries.get(json)));
      const blob = (path, type) => {
        const d = path && entries.get(root + path);
        return d ? new Blob([d], { type }) : null;
      };
      return {
        data,
        photo: (x) => blob(x?.photo, /\.png$/i.test(x?.photo || "") ? "image/png" : /\.webp$/i.test(x?.photo || "") ? "image/webp" : "image/jpeg"),
        video: (sc) => blob(sc.blocking?.video, /\.webm$/i.test(sc.blocking?.video || "") ? "video/webm" : "video/mp4"),
        audio: (sc) => blob(sc.audio?.path, AUDIO_TYPES[(/\.\w+$/.exec(sc.audio?.path || "")?.[0] || "").toLowerCase()] || "audio/wav"),
      };
    }
    const data = JSON.parse(await f.text());
    const inline = async (src) => (src ? (await fetch(src)).blob() : null);
    return { data, photo: (x) => inline(x?.thumb), video: (sc) => inline(data.videos?.[sc.id]), audio: () => null };
  }

  async function importStory(f) {
    let pack;
    try {
      pack = await readStoryFile(f);
    } catch (e) {
      return msg(`${f.name} could not be read: ${e.message}`);
    }
    const st = pack.data?.story;
    if (pack.data?.format !== FILE_FORMAT || !Array.isArray(st?.scenes)) {
      return msg(`${f.name} is not a story file exported from this tab.`);
    }
    const busy = S.scenes.some((sc) => sc.shots.some((s) => s.what.trim()));
    if (busy && !confirm(`Replace the story in this tab with ${f.name}?`)) return;
    stopWaiting();

    // the media first, while the story is still the file's own objects
    const problems = [];
    const photos = new Map(), videos = new Map();
    for (const x of [st.place, ...(st.cast || []), ...(st.locations || []), ...frameItems(st)]) if (x) photos.set(x, await pack.photo(x));
    const sounds = new Map();
    for (const sc of st.scenes) if (sc.blocking) videos.set(sc, await pack.video(sc));
    for (const sc of st.scenes) if (sc.audio && !sc.audio.from) sounds.set(sc, await pack.audio(sc));

    S = Object.assign(blank(), sizeOf(st), { at: 0 });
    S.locations = S.locations || [];
    for (const x of [S.place, ...S.cast, ...S.locations, ...frameItems(S)]) {
      if (!x) continue;
      const blob = photos.get(x);
      Object.assign(x, { file: null, pod: null, thumb: null });
      delete x.busy;
      delete x.photo;
      if (blob) {
        const url = URL.createObjectURL(blob);
        try { x.thumb = await shrink(url, 1024); } catch { problems.push(`${x.name || "the place"}: the photo cannot be read`); }
        URL.revokeObjectURL(url);
        x.blob = blob;
      }
    }
    if (S.place && !S.place.thumb) S.place = null;
    S.locations = S.locations.filter((l) => l.thumb);
    for (const sc of S.scenes) {
      delete sc.state;
      if (!S.locations.some((l) => l.id === sc.location)) sc.location = null;
      sc.frames = { start: sc.frames?.start?.thumb ? sc.frames.start : null, end: sc.frames?.end?.thumb ? sc.frames.end : null };
      const blob = sc.blocking && videos.get(sc);
      if (blob) Object.assign(sc.blocking, { file: null, pod: null, busy: true, blob });
      else sc.blocking = null;
      if (sc.blocking) delete sc.blocking.video;
      const sound = sc.audio && !sc.audio.from && sounds.get(sc);
      if (sc.audio?.from) Object.assign(sc.audio, { file: null, pod: null, output: null });
      else if (sound) Object.assign(sc.audio, { file: null, pod: null, busy: true, blob: sound });
      else sc.audio = null;
      if (sc.audio) delete sc.audio.path;
    }
    if (!S.scenes.length) S.scenes = [newScene(1)];
    drawAll();

    // everything goes up to this pod now, so queueing does not wait on uploads
    for (const [i, sc] of S.scenes.entries()) {
      const blk = sc.blocking;
      if (!blk) continue;
      const blob = blk.blob;
      delete blk.blob;
      msg(`Uploading the blocking video of scene ${i + 1}…`);
      try {
        const name = VIDEO_EXT.test(blk.name || "") ? blk.name : `scene${i + 1}.mp4`;
        const file = await upload(new File([blob], name, { type: blob.type || "video/mp4" }));
        videoUrls.set(file, URL.createObjectURL(blob));
        Object.assign(blk, { file, pod: pod() });
        delete blk.busy;
      } catch (e) {
        sc.blocking = null;
        for (const s of sc.shots) if (s.move === "blocking") s.move = "static";
        problems.push(/unsupported file type/.test(e.message)
          ? `scene ${i + 1}: this pod's image cannot take a video yet`
          : `scene ${i + 1}: ${e.message}`);
      }
      drawScenes();
      if (sc === scene()) drawScene();
    }
    for (const [i, sc] of S.scenes.entries()) {
      const a = sc.audio;
      if (!a?.blob) continue;
      const blob = a.blob;
      delete a.blob;
      msg(`Uploading the sound of scene ${i + 1}…`);
      try {
        const file = await upload(new File([blob], a.name || `scene${i + 1}.wav`, { type: blob.type }));
        audioUrls.set(file, URL.createObjectURL(blob));
        Object.assign(a, { file, pod: pod() });
        delete a.busy;
      } catch (e) {
        sc.audio = null;
        problems.push(`scene ${i + 1}'s sound: ${e.message}`);
      }
    }
    msg("Uploading the pictures…");
    for (const x of [S.place, ...S.cast, ...S.locations, ...frameItems(S)]) {
      if (!x?.blob) continue;
      const blob = x.blob;
      delete x.blob;
      try {
        const type = blob.type || "image/jpeg";
        const name = `${safeName((x.name || "").replace(/\.\w+$/, ""), "picture")}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
        const original = new File([blob], name, { type });
        x.file = await upload(original);
        x.pod = pod();
        originals.set(x.file, original);
      } catch (e) {
        problems.push(`${x.name || "the place"}: ${e.message}`);
      }
    }
    drawAll();
    save();
    const n = S.scenes.length;
    msg(`Imported ${f.name}: ${n} scene${n === 1 ? "" : "s"}.${problems.length ? ` Not loaded: ${problems.join("; ")}.` : ""}`);
    if (!DEMO && confirm(`Queue all ${n} scene${n === 1 ? "" : "s"} now${S.takes > 1 ? `, ${S.takes} takes each` : ""}? If the pod is still starting, they queue by themselves when it is ready.`)) {
      makeScenes(S.scenes.map((_, i) => i));
    }
  }

  /* ---------------- wiring ---------------- */

  const bindText = (id, key) => $(id).addEventListener("input", (e) => { S[key] = e.target.value; changed(); });
  bindText("#stTitle", "title");
  bindText("#stLogline", "logline");
  bindText("#stWhere", "where");
  bindText("#stWhen", "when");
  bindText("#stLookText", "lookText");
  bindText("#stMusic", "music");
  // the scene's own fields show the story's values as their placeholders
  for (const id of ["#stWhere", "#stWhen", "#stMusic"]) $(id).addEventListener("change", drawScene);

  const bindScene = (id, key) => $(id).addEventListener("input", (e) => {
    scene()[key] = e.target.value;
    if (key === "title") drawScenes();
    changed();
  });
  bindScene("#stSceneTitle", "title");
  bindScene("#stSceneWhere", "where");
  bindScene("#stSceneWhen", "when");
  bindScene("#stSceneSound", "sound");

  $$("#stAspect button").forEach((b) => b.addEventListener("click", () => {
    S.aspect = b.dataset.aspect;
    setSeg("stAspect", "aspect", S.aspect);
    drawFrames();
    drawBlocking();
    if ($("#stBlenderShow").open) $("#stBlenderCode").textContent = blenderScript();
    changed();
  }));
  $$("#stLook button").forEach((b) => b.addEventListener("click", () => {
    S.look = b.dataset.look;
    setSeg("stLook", "look", S.look);
    $("#stLookText").placeholder = LOOKS[S.look];
    changed();
  }));
  $$("#stTakes button").forEach((b) => b.addEventListener("click", () => {
    S.takes = Math.min(MAX_TAKES, Number(b.dataset.takes));
    setSeg("stTakes", "takes", S.takes);
    changed();
  }));
  $$("#stFollow button").forEach((b) => b.addEventListener("click", () => {
    if (!scene().blocking) return;
    scene().blocking.follow = b.dataset.follow;
    drawBlocking();
    changed();
  }));
  $$("#stWhenChips button").forEach((b) => b.addEventListener("click", () => {
    const now = trim(S.when);
    S.when = now ? `${now}, ${b.textContent}` : b.textContent;
    $("#stWhen").value = S.when;
    drawScene();
    changed();
  }));
  $("#stRes").addEventListener("change", (e) => { S.res = e.target.value; save(); });
  $("#stSteps").addEventListener("change", (e) => { S.steps = Number(e.target.value); save(); });
  $("#stSparse").addEventListener("change", (e) => { S.sparse = e.target.checked; save(); });
  $("#stFast").addEventListener("change", (e) => { S.fast = e.target.checked; save(); });

  $("#stAddCast").addEventListener("click", () => {
    if (S.cast.length >= MAX_CAST) return;
    S.cast.push({ id: uid(), name: "", who: "", voice: "", file: null, thumb: null, pod: null });
    changed(true);
    $$("#stCast .st-name").pop()?.focus();
  });
  $("#stPlaceBtn").addEventListener("click", () => $("#stPlaceFile").click());
  $("#stPlaceFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    S.place = { what: S.place?.what || trim(S.where), busy: true };
    drawPlace();
    try {
      Object.assign(S.place, await pickPicture(f));
      delete S.place.busy;
    } catch (err) {
      S.place = null;
      msg(`${f.name}: ${err.message}`);
    }
    changed(true);
  });
  $("#stPlaceWhat").addEventListener("input", (e) => { if (S.place) { S.place.what = e.target.value; changed(); } });

  function goScene(i) {
    S.at = i;
    drawScenes();
    drawScene();
    changed();
  }
  $("#stAddScene").addEventListener("click", () => {
    const sc = newScene(S.scenes.length + 1);
    sc.sound = scene().sound;
    sc.location = scene().location;  // a new scene usually goes on in the same place
    S.scenes.splice(S.at + 1, 0, sc);
    goScene(S.at + 1);
    $("#stSceneTitle").select();
  });
  $("#stAngle").addEventListener("click", addAngle);
  $("#stLocFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) addLocation(f);
  });
  $("#stAudioUpload").addEventListener("click", () => $("#stAudioFile").click());
  $("#stAudioFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) setAudioUpload(f);
  });
  $("#stAudioRemove").addEventListener("click", () => { scene().audio = null; drawAudio(); changed(); });
  $$("#stAudioMode button").forEach((b) => b.addEventListener("click", () => {
    if (!scene().audio) return;
    scene().audio.mode = b.dataset.mode;
    drawAudio();
    changed();
  }));

  $("#stDupScene").addEventListener("click", () => {
    const twin = JSON.parse(JSON.stringify(scene()));
    Object.assign(twin, { id: uid(), title: `${twin.title} (copy)` });
    if (twin.audio?.from === scene().id) twin.audio = null;
    delete twin.state;
    S.scenes.splice(S.at + 1, 0, twin);
    goScene(S.at + 1);
  });
  $("#stDelScene").addEventListener("click", () => {
    const angles = S.scenes.filter((x) => x.audio?.from === scene().id).length;
    if (S.scenes.length < 2 || !confirm(`Delete scene ${S.at + 1}?${angles ? ` ${angles} other angle${angles > 1 ? "s take" : " takes"} its sound and will have none.` : ""}`)) return;
    for (const x of S.scenes) if (x.audio?.from === scene().id) x.audio = null;
    S.scenes.splice(S.at, 1);
    goScene(Math.max(0, S.at - 1));
  });
  $("#stAddShot").addEventListener("click", () => {
    const s = newShot(3);
    if (scene().blocking?.file) s.move = "blocking";
    scene().shots.push(s);
    drawShots();
    changed();
    $$("#stShots .sp-what").pop()?.focus();
  });

  $("#stFrameFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) setFrame(frameKey, f);
  });

  $("#stBlockingBtn").addEventListener("click", () => $("#stBlockingFile").click());
  $("#stBlockingFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) setBlocking(f);
  });
  $("#stBlockingRemove").addEventListener("click", () => {
    const sc = scene();
    sc.blocking = null;
    for (const s of sc.shots) if (s.move === "blocking") s.move = "static";
    drawScene();
    drawScenes();
    changed();
  });
  $("#stBlockingFit").addEventListener("click", fitToVideo);
  $("#stBlenderCopy").addEventListener("click", () => copy(blenderScript(), "Blender script"));
  $("#stBlenderShow").addEventListener("toggle", (e) => {
    if (e.target.open) $("#stBlenderCode").textContent = blenderScript();
  });

  $("#stExport").addEventListener("click", () => exportStory().catch((e) => msg(e.message)));
  $("#stImport").addEventListener("click", () => $("#stImportFile").click());
  $("#stImportFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importStory(f);
  });

  // dropped on the form: a story file is imported, a video is this scene's blocking render
  const card = $("#stCard");
  card.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
  card.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    if (/\.(zip|json)$/i.test(f.name)) importStory(f);
    else if (f.type.startsWith("video/")) setBlocking(f);
    else toast("Drop a story file or a blocking video here; photos go on a character or the place", true);
  });

  $("#stStart").addEventListener("click", () => makeScenes([S.at]));
  $("#stAll").addEventListener("click", () => {
    const n = S.scenes.length;
    if (confirm(`Queue all ${n} scenes, ${S.takes} take${S.takes > 1 ? "s" : ""} each?`)) makeScenes(S.scenes.map((_, i) => i));
  });
  $("#stCopyPrompt").addEventListener("click", () => copy(buildPrompt(), "Prompt"));
  $("#stNew").addEventListener("click", () => {
    if (!confirm("Start a new story? This one is cleared; saved characters stay.")) return;
    stopWaiting();
    S = blank();
    drawAll();
    save();
    msg("");
  });

  window.StoryTab = { shown: drawAll, loadRecipe, importStory };
  drawAll();
})();
