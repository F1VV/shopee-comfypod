/* Shopee affiliate tab, added for this workspace (not part of the upstream template).

   Product photos and a few words in, a vertical H3 clip out: a hook, the product working, and a
   call to the basket, spoken in Thai. It sends the same guided request the Create tab sends
   (beginner/upload, beginner/preview, beginner/start, and image/start for the cover), so
   server.py is unchanged and the clip lands in the shared Queue and in Outputs like any other.

   Saved characters and products live in this browser's localStorage, pictures included (scaled
   down), so they outlive a terminated pod: each picture is uploaded again the first time it is
   used on a pod. */
(() => {
  "use strict";

  const A = window.AiAngel;
  if (!A) return;
  const { api, el, $, $$, toast, copy, DEMO } = A;

  /* ---------------- what the form offers ---------------- */

  // `person`: whether the clip has someone on camera, so step 2 is shown
  const STYLES = {
    pov: { person: false, note: "Filmed from your eyes: only hands and the product are seen, your voice explains it. The quickest kind to make look real." },
    presenter: { person: true, note: "Someone talks to the camera and shows the product. A saved character keeps the same face across every product you sell." },
    unboxing: { person: false, note: "Hands open an orange Shopee parcel and take the product out. Good for anything that arrives in a box." },
    tryon: { person: true, note: "The presenter wears it and turns to show the fit. Uses the first product photo as the outfit." },
    showcase: { person: false, note: "No people: slow, ad-style shots of the product with a voice-over. Good for home, gadgets and beauty." },
  };

  // `use` is what the hands do with the product in the demo shot; {P} is the product
  const CATS = {
    beauty: { label: "Beauty & skincare", tag: "#บิวตี้ #สกินแคร์ #ป้ายยา",
      setting: "a bright, clean bathroom with soft morning daylight",
      use: "dab a little of {P} onto the back of a hand and blend it in, showing the smooth texture" },
    fashion: { label: "Fashion & accessories", tag: "#แฟชั่น #เสื้อผ้า #ของมันต้องมี",
      setting: "a bright bedroom with a full-length mirror",
      use: "hold {P} up close and show the fabric, the stitching and the details" },
    gadget: { label: "Gadgets & electronics", tag: "#แกดเจ็ต #ไอที #ของดีบอกต่อ",
      setting: "a tidy home office with a soft desk lamp",
      use: "switch {P} on and use it, showing how it works" },
    home: { label: "Home & kitchen", tag: "#ของใช้ในบ้าน #ไอเทมเด็ด #ของมันต้องมี",
      setting: "a clean, modern kitchen",
      use: "use {P} for its everyday job, showing how quick and easy it is" },
    food: { label: "Food & snacks", tag: "#ของกิน #ขนม #ของอร่อยบอกต่อ",
      setting: "a cozy kitchen with a wooden table",
      use: "open {P} and show the food up close, then lift a piece toward the camera" },
    family: { label: "Mom, baby & pets", tag: "#แม่และลูก #สัตว์เลี้ยง #ของใช้เด็ก",
      setting: "a bright, cozy living room",
      use: "show {P} being used, gently and happily" },
    other: { label: "Other", tag: "#ของดีบอกต่อ #รีวิว",
      setting: "a bright, tidy room",
      use: "use {P}, showing how it works" },
  };

  const LOOKS = {
    ugc: "Live-action, photorealistic, shot on a smartphone, authentic social-media UGC style, natural handheld camera, bright natural light",
    studio: "Live-action, photorealistic, clean studio product commercial, soft even lighting, crisp detail, bright and colorful",
    cinematic: "Live-action, photorealistic, cinematic product ad, shallow depth of field, soft dramatic light",
  };

  const VOICES = {
    female: { k: "ค่ะ", nk: "นะคะ", presenter: "a cheerful Thai woman in her mid-twenties", narrator: "a young Thai woman" },
    male: { k: "ครับ", nk: "นะครับ", presenter: "a friendly Thai man in his late twenties", narrator: "a young Thai man" },
  };

  // Thai is written without spaces between words, but a Latin brand name needs one on the side
  // where it touches Thai text ("ใครยังไม่มี Anker ต้องดู")
  const pad = (s) => `${/^[A-Za-z0-9]/.test(s) ? " " : ""}${s}${/[A-Za-z0-9]$/.test(s) ? " " : ""}`;
  const tidy = (s) => s.replace(/\s{2,}/g, " ").trim();

  const HOOKS = [
    (n, v) => `ใครยังไม่มี${pad(n)} ต้องดูคลิปนี้${v.k}`,
    (n, v) => `หยุดเลื่อนก่อน${v.nk} ${pad(n)}ตัวนี้คุ้มมาก`,
    (n, v) => `ของมันต้องมี ${pad(n)}ตัวนี้ดีจริง${v.nk}`,
    (n) => `ไม่คิดว่า${pad(n)}จะดีขนาดนี้`,
    (n, v) => `ป้ายยา${pad(n)}ตัวนี้ให้ทุกคนเลย${v.k}`,
    (n) => `ใช้มาแล้ว บอกเลยว่า${pad(n)}ตัวนี้ไม่ผิดหวัง`,
  ];
  const CTAS = [
    (p, v) => `${p ? `ตอนนี้${pad(p)} ` : ""}กดตะกร้าด้านล่างได้เลย${v.k}`,
    (p, v) => `สนใจจิ้มตะกร้าเลย${p ? ` ${pad(p)}` : ""} ของมีจำกัด${v.nk}`,
    (p, v) => `${p ? `${pad(p)} ` : ""}รีบกดตะกร้าก่อนหมดโปร${v.nk}`,
  ];

  /* Shot templates. `c.P` is "the <product>", `c.S` the presenter's @mention, `c.set` where it
     is filmed, `c.use` the category's demo action. A "proof" shot is only added when there is a
     third selling point to say in it. */
  const SCRIPTS = {
    pov: {
      hook: (c) => `First-person POV in ${c.set}, the phone held at chest height. Hands bring ${c.P} into frame and hold it up close to the camera, turning it so the light catches it.`,
      demo: (c) => `Close-up POV: the hands ${c.use}.`,
      proof: (c) => `Close-up POV: the hands turn ${c.P} to show its best detail up close.`,
      cta: (c) => `POV: the hands set ${c.P} down in the middle of the frame and point at it while the camera moves in slightly.`,
    },
    presenter: {
      hook: (c) => `Medium close-up in ${c.set}. ${c.S} looks straight into the camera, excited, and holds ${c.P} up beside their face.`,
      demo: (c) => `Close-up of ${c.S}'s hands as they ${c.use}, then back to ${c.S} nodding, impressed.`,
      proof: (c) => `${c.S} holds ${c.P} close to the camera and points at its best detail.`,
      cta: (c) => `${c.S} holds ${c.P} toward the camera, smiles and points down to the bottom of the screen.`,
    },
    unboxing: {
      hook: (c) => `Top-down first-person POV in ${c.set}: hands tear open an orange Shopee parcel bag.`,
      demo: (c) => `The hands pull ${c.P} out of the parcel and lift it toward the camera, slowly turning it to show every side.`,
      proof: (c) => `Close-up POV: the hands ${c.use}.`,
      cta: (c) => `The hands place ${c.P} beside the open parcel and give a thumbs up to the camera.`,
    },
    tryon: {
      hook: (c) => `${c.S} stands in front of a full-length mirror in ${c.set}, holds ${c.P} up against their body and looks at the camera.`,
      demo: (c) => `${c.S} now wears ${c.P} and turns slowly to show the fit from the front, the side and the back.`,
      proof: (c) => `Close-up of ${c.S} wearing ${c.P}, showing the fabric and details as they move.`,
      cta: (c) => `${c.S} walks toward the camera wearing ${c.P}, smiles and points down to the bottom of the screen.`,
    },
    showcase: {
      hook: (c) => `Slow cinematic push-in on ${c.P} standing in ${c.set}, soft light sweeping across it.`,
      demo: (c) => `Macro close-up gliding over the details and texture of ${c.P}.`,
      proof: (c) => `${c.P[0].toUpperCase() + c.P.slice(1)} in use in ${c.set}, shown simply and clearly.`,
      cta: (c) => `${c.P[0].toUpperCase() + c.P.slice(1)} turns slowly in the middle of the frame, ${c.set} softly blurred behind it.`,
    },
  };
  const ROLE_LABEL = { hook: "Hook", demo: "Show it", proof: "Proof", cta: "Call to action", extra: "Extra shot" };
  const ROLE_SECONDS = { hook: 3, demo: 4, proof: 3, cta: 3, extra: 3 };
  const SHOT_SECONDS = [2, 3, 4, 5, 6, 8];
  const MAX_SECONDS = 15;  // server.py CLIP_SECONDS_MAX
  const MAX_PHOTOS = 4;

  /* ---------------- state ---------------- */
  const DRAFT_KEY = "aiangel.shopee.draft.v1";
  const LIB_KEY = "aiangel.shopee.library.v1";

  const S = {
    style: "pov", aspect: "9:16", voice: "female", variants: 1, look: "ugc",
    category: "beauty", en: "", th: "", price: "", points: "",
    setting: CATS.beauty.setting, settingEdited: false, music: true,
    photos: [],                   // [{file, url, thumb}] — file is the name on the pod
    person: { who: "", file: null, url: null, thumb: null, edited: false },
    shots: [], scriptEdited: false, hookIx: 0, ctaIx: 0,
    caption: "", captionEdited: false,
  };

  const loadJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const saveJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  // the words of the form survive a reload; the pictures do not (they are files on one pod)
  const DRAFT_FIELDS = ["style", "aspect", "voice", "variants", "look", "category", "en", "th",
    "price", "points", "setting", "settingEdited", "music", "shots", "scriptEdited", "hookIx",
    "ctaIx", "caption", "captionEdited"];
  function saveDraft() {
    const d = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, S[k]]));
    d.personWho = S.person.who;
    d.personEdited = S.person.edited;
    saveJson(DRAFT_KEY, d);
  }

  let lib = loadJson(LIB_KEY, { chars: [], products: [] });
  // which saved pictures are already on this pod: "<item id>:<n>" -> filename
  const onPod = new Map();

  /* ---------------- pictures ---------------- */

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
    if (DEMO) return `demo_${Math.random().toString(36).slice(2, 8)}.png`;
    return A.uploadPicture(file);
  }

  async function dataUrlToFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || "image/jpeg" });
  }

  // a library picture, uploaded to this pod the first time it is used here
  async function libPicture(key, dataUrl) {
    if (onPod.has(key)) return onPod.get(key);
    const file = await upload(await dataUrlToFile(dataUrl, `${key.replace(/\W/g, "_")}.jpg`));
    onPod.set(key, file);
    return file;
  }

  async function addPhotos(files) {
    const room = MAX_PHOTOS - S.photos.length;
    const take = [...files].slice(0, Math.max(room, 0));
    if (files.length > take.length) toast(`Up to ${MAX_PHOTOS} product photos`, true);
    for (const f of take) {
      const url = URL.createObjectURL(f);
      const item = { file: null, url, thumb: null };
      S.photos.push(item);
      drawPhotos();
      try {
        [item.file, item.thumb] = await Promise.all([upload(f), shrink(url, 768)]);
      } catch (e) {
        S.photos = S.photos.filter((p) => p !== item);
        $("#spMsg").textContent = `${f.name}: ${e.message}`;
      }
      drawPhotos();
      changed();
    }
  }

  async function setPersonPhoto(f) {
    const url = URL.createObjectURL(f);
    S.person = { ...S.person, file: null, url, thumb: null };
    drawPerson();
    try {
      [S.person.file, S.person.thumb] = await Promise.all([upload(f), shrink(url, 1024)]);
    } catch (e) {
      S.person = { ...S.person, file: null, url: null, thumb: null };
      $("#spMsg").textContent = `${f.name}: ${e.message}`;
    }
    drawPerson();
    changed();
  }

  /* ---------------- the script ---------------- */

  const voice = () => VOICES[S.voice];
  // the full description defines the product once, next to its photo; the shots then call it by
  // a short name, so "a vitamin C face serum in a small glass dropper bottle" is "the vitamin C
  // face serum" in every sentence after that
  const productPhrase = () => `the ${S.en.trim().replace(/^(the|a|an)\s+/i, "") || "product"}`;
  const productShort = () =>
    productPhrase().split(/\s+(?:in|with|that|which|for|from|made of)\s+|[,(;:]/i)[0].trim();
  const points = () => S.points.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const thaiName = () => S.th.trim() || "ของชิ้นนี้";
  const usesPerson = () => STYLES[S.style].person;

  const hookLine = (ix) => tidy(HOOKS[ix % HOOKS.length](thaiName(), voice()));
  const ctaLine = (ix) => tidy(CTAS[ix % CTAS.length](S.price.trim(), voice()));

  function context() {
    const P = productShort();
    return {
      P, S: "@Presenter", set: S.setting.trim() || CATS[S.category].setting,
      use: CATS[S.category].use.replace("{P}", P),
    };
  }

  function lineFor(role) {
    const pts = points();
    if (role === "hook") return hookLine(S.hookIx);
    if (role === "demo") return tidy(pts.slice(0, 2).join(" ")) || "ใช้ง่ายมาก คุ้มราคาสุด ๆ";
    if (role === "proof") return pts[2] || "";
    if (role === "cta") return ctaLine(S.ctaIx);
    return "";
  }

  function buildScript() {
    const t = SCRIPTS[S.style], c = context();
    const roles = ["hook", "demo", ...(points().length > 2 ? ["proof"] : []), "cta"];
    S.shots = roles.map((role) => ({
      role, seconds: ROLE_SECONDS[role], what: t[role](c), line: lineFor(role),
    }));
    S.scriptEdited = false;
  }

  const clipSeconds = () => S.shots.reduce((n, s) => n + Number(s.seconds || 0), 0);

  /* ---------------- the request ---------------- */

  // the pictures in the order H3 numbers them: the presenter first, then the product
  function pictures() {
    const person = usesPerson() && S.person.file ? [S.person.file] : [];
    const product = S.photos.filter((p) => p.file).map((p) => p.file);
    return { person, product: S.style === "tryon" ? product.slice(0, 1) : product };
  }

  // Short on purpose: with no product photo H3 is told who acts by this description itself, in
  // the summary and in front of every spoken line. That only the hands show is the action's job.
  function narrator() {
    const v = voice();
    return S.style === "showcase" ? `an off-screen narrator (${v.narrator}'s voice)` : v.narrator;
  }

  function sound() {
    return S.music
      ? "Upbeat, trendy background music at low volume under the voice, with light ambient sound that matches the setting"
      : "Ambient sound that matches the setting";
  }

  // The script says "@Presenter" (readable, and anyone can type it); the server's prompt builder
  // wants the Create tab's mention form, which it turns into <Subject 1>
  const mention = (text) => text.replace(/@presenter\b/gi, "@[subject:1]");

  function request(variant = 0) {
    const pics = pictures();
    const refs = [...pics.person, ...pics.product];
    const first = pics.person.length + 1;
    const cast = usesPerson()
      // with a photo and no words, the photo says who it is ("the person in <Picture 1>")
      ? [{ who: S.person.who.trim() || (pics.person.length ? "" : voice().presenter), picture: pics.person.length ? 1 : null }]
      : [{ who: narrator(), picture: null }];
    const props = pics.product.map((_, i) => S.style === "tryon"
      ? { kind: "outfit", picture: first + i, what: productPhrase(), worn_by: 1 }
      : { kind: "object", picture: first + i, what: productPhrase() });
    const P = productShort();
    const action = {
      pov: `@[subject:1] films a short first-person POV video showing off ${P} for a Shopee review; only their hands are visible.`,
      presenter: `@[subject:1] presents ${P} to the camera in a short, upbeat Shopee product review.`,
      unboxing: `@[subject:1] unboxes ${P} from a Shopee parcel in first-person POV; only their hands are visible.`,
      tryon: `@[subject:1] tries on ${P} and shows how it fits in a short Shopee try-on video.`,
      showcase: `A short product showcase of ${P}, narrated off-screen by @[subject:1].`,
    }[S.style];
    // each version opens on its own hook; version 1 keeps whatever the hook line says now
    const shots = S.shots.map((s) => {
      const line = s.role === "hook" && variant > 0 ? hookLine(S.hookIx + variant) : s.line;
      return {
        what: mention(s.what), seconds: Number(s.seconds),
        lines: line.trim() ? [{ speaker: 1, text: line.trim(), language: "auto" }] : [],
      };
    });
    return {
      mode: "guided", seconds: clipSeconds(), aspect: S.aspect, refs, cast, props, action, shots,
      style: LOOKS[S.look], sound: sound(),
      count: 1, hd: $("#spHd").checked, fast: $("#spFast").checked, sparse: true, upscale: false,
      loras: [],
      // stored beside the clip, so "Use this recipe" in Outputs brings the whole form back here
      form: { shopee: snapshot() },
    };
  }

  function snapshot() {
    return {
      ...Object.fromEntries(DRAFT_FIELDS.map((k) => [k, S[k]])),
      shots: S.shots.map((s) => ({ ...s })),
      photos: S.photos.filter((p) => p.file).map((p) => p.file),
      person: { who: S.person.who, file: S.person.file, edited: S.person.edited },
      doodles: window.Doodles?.get() ?? null,
    };
  }

  // when each shot starts and ends, for the doodle pop-ups to follow (doodle.js)
  function timeline() {
    let at = 0;
    const shots = S.shots.map((s) => {
      const start = at;
      at += Number(s.seconds || 0);
      return { role: s.role, start, end: at };
    });
    return { shots, total: at, name: S.th.trim(), price: S.price.trim(), voice: S.voice };
  }

  /* ---------------- drawing ---------------- */

  const setSeg = (id, key, value) =>
    $$(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", b.dataset[key] === String(value)));

  function thumb(url, n, onRemove) {
    return el("span", { class: "sp-thumb", title: n ? `Picture ${n}` : null },
      el("img", { src: url, alt: n ? `Picture ${n}` : "" }),
      n ? el("b", { text: String(n) }) : null,
      onRemove ? el("button", { class: "x", type: "button", title: "Remove", onclick: onRemove }, "×") : null);
  }

  function drawPhotos() {
    const first = usesPerson() && S.person.file ? 2 : 1;
    $("#spPhotos").replaceChildren(...S.photos.map((p, i) => {
      const t = thumb(p.url || p.thumb, first + i, () => {
        S.photos.splice(i, 1);
        drawPhotos();
        changed();
      });
      if (!p.file) t.classList.add("busy");
      if (S.style === "tryon" && i > 0) t.classList.add("unused");
      return t;
    }));
    if (!S.photos.length) {
      $("#spPhotos").append(el("p", { class: "empty", text: "No product photo yet. Without one, H3 invents what the product looks like." }));
    }
    $("#spAddPhoto").hidden = S.photos.length >= MAX_PHOTOS;
  }

  function drawPerson() {
    const box = $("#spPerson");
    const who = el("input", {
      class: "what", spellcheck: "false", value: S.person.who,
      placeholder: S.person.file ? "who this is, e.g. a cheerful Thai woman in her twenties" : voice().presenter,
    });
    who.addEventListener("input", () => {
      S.person.who = who.value;
      S.person.edited = who.value.trim() !== "";
      changed(false);
    });
    const pic = S.person.url || S.person.thumb;
    box.replaceChildren(el("div", { class: "sp-person" },
      pic
        ? thumb(pic, 1, () => {
          S.person = { ...S.person, file: null, url: null, thumb: null };
          drawPerson();
          changed();
        })
        : el("span", { class: "sp-nophoto", text: "no photo" }),
      who));
    if (pic && !S.person.file) box.querySelector(".sp-thumb").classList.add("busy");
    $("#spSaveChar").hidden = !S.person.thumb;
    $("#spPersonStep").querySelector("p.small").textContent = S.person.file
      ? "This face is kept in every frame. Say who they are in a few words; their voice follows."
      : "A photo keeps the same face in every clip. Save it once as a character and reuse it for every product. With no photo, H3 invents the person described here.";
  }

  function drawLibrary() {
    const chip = (label, img, onUse, onDelete) =>
      el("span", { class: "sp-chip" },
        el("button", { class: "sp-chip-use", type: "button", title: "Use this", onclick: onUse },
          img ? el("img", { src: img, alt: "" }) : null, el("span", { text: label })),
        el("button", { class: "x", type: "button", title: "Delete from library", onclick: onDelete }, "×"));
    $("#spCharLib").replaceChildren(...lib.chars.map((c) => chip(c.name, c.img, () => useChar(c), () => {
      if (!confirm(`Delete the character "${c.name}" from this browser?`)) return;
      lib.chars = lib.chars.filter((x) => x !== c);
      saveJson(LIB_KEY, lib);
      drawLibrary();
    })));
    $("#spProductLib").replaceChildren(...lib.products.map((p) => chip(p.th || p.en, p.imgs[0], () => useProduct(p), () => {
      if (!confirm(`Delete "${p.th || p.en}" from this browser?`)) return;
      lib.products = lib.products.filter((x) => x !== p);
      saveJson(LIB_KEY, lib);
      drawLibrary();
    })));
    $("#spCharLib").hidden = !lib.chars.length;
    $("#spProductLib").hidden = !lib.products.length;
  }

  function drawShots() {
    $("#spShots").replaceChildren(...S.shots.map((s, i) => {
      const secs = el("select", { title: "How long this shot runs" },
        ...SHOT_SECONDS.map((n) => el("option", { value: String(n), text: `${n} s` })));
      secs.value = String(s.seconds);
      secs.addEventListener("change", () => { s.seconds = Number(secs.value); edited(); });
      const what = el("textarea", { class: "sp-what", rows: "3", spellcheck: "false" });
      what.value = s.what;
      what.addEventListener("input", () => { s.what = what.value; edited(); });
      const line = el("input", { class: "sp-line", spellcheck: "false", value: s.line,
        placeholder: "what is said (Thai), or leave empty for no talking" });
      line.addEventListener("input", () => { s.line = line.value; edited(); });
      return el("div", { class: "sp-shot" },
        el("div", { class: "sp-shot-head" },
          el("span", { class: "shot-no mono", text: String(i + 1) }),
          el("span", { class: `tag sp-role-${s.role}`, text: ROLE_LABEL[s.role] || "Shot" }),
          el("span", { class: "spacer" }),
          secs,
          S.shots.length > 1
            ? el("button", { class: "x", type: "button", title: "Remove this shot", onclick: () => {
              S.shots.splice(i, 1);
              drawShots();
              edited();
            } }, "×")
            : null),
        el("label", { class: "sp-sub" }, el("span", { text: "What happens" }), what),
        el("label", { class: "sp-sub" }, el("span", { text: "Says" }), line));
    }));
    drawLength();
  }

  function drawLength() {
    const n = clipSeconds();
    $("#spLength").textContent = `${n}s`;
    const over = n > MAX_SECONDS;
    $("#spLengthNote").textContent = over ? `H3 makes up to ${MAX_SECONDS} s; shorten a shot` : "";
    $("#spStart").disabled = over || n < 1;
    const v = S.variants;
    $("#spStart").textContent = v > 1 ? `Make ${v} versions` : "Make the clip";
  }

  function drawMode() {
    const person = usesPerson();
    $("#spPersonStep").hidden = !person;
    $("#spScriptNo").textContent = person ? "3" : "2";
    $("#spLookNo").textContent = person ? "4" : "3";
    $("#spStyleNote").textContent = STYLES[S.style].note;
    const needsFast = (A.needs().fast || []).length > 0;
    $("#spFast").disabled = needsFast;
    if (needsFast) $("#spFast").checked = false;
    $("#spFastRow").title = needsFast
      ? "Fast needs the h3fast models: download them in Models"
      : "4 steps instead of 8: about 1.5x faster.";
  }

  // the caption the form's product and hook would get
  function captionText() {
    return [
      hookLine(S.hookIx),
      "",
      ...points().map((p) => `✅ ${p}`),
      S.price.trim() ? `💸 ${S.price.trim()}` : null,
      `🛒 กดตะกร้าด้านล่างได้เลย${voice().k}`,
      "",
      `#shopee #ช้อปปี้ #ShopeeAffiliate #ShopeeVideo #รีวิว ${CATS[S.category].tag}`,
    ].filter((x) => x !== null).join("\n");
  }

  function drawCaption() {
    if (!S.captionEdited) S.caption = captionText();
    const box = $("#spCaption");
    if (box.value !== S.caption) box.value = S.caption;
  }

  function drawAll() {
    setSeg("spStyle", "style", S.style);
    setSeg("spAspect", "aspect", S.aspect);
    setSeg("spVoice", "voice", S.voice);
    setSeg("spVariants", "variants", S.variants);
    setSeg("spLook", "look", S.look);
    $("#spCat").value = S.category;
    $("#spEn").value = S.en;
    $("#spTh").value = S.th;
    $("#spPrice").value = S.price;
    $("#spPoints").value = S.points;
    $("#spSetting").value = S.setting;
    $("#spMusic").checked = S.music;
    drawMode();
    drawPhotos();
    drawPerson();
    drawLibrary();
    drawShots();
    drawCaption();
    drawScriptNote();
  }

  function drawScriptNote() {
    $("#spScriptNote").hidden = !S.scriptEdited;
    $("#spScriptNote").textContent =
      "You changed the script, so it no longer follows step 1. Reset script rebuilds it from there.";
  }

  /* ---------------- changes ---------------- */

  let previewTimer;
  // `rescript` = false for edits that cannot change the script (the presenter's description)
  function changed(rescript = true) {
    if (rescript && !S.scriptEdited) {
      buildScript();
      drawShots();
    }
    drawCaption();
    drawLength();
    saveDraft();
    window.Doodles?.scriptChanged();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 300);
  }

  // the user typed in the script itself: from now on step 1 no longer rewrites it
  function edited() {
    S.scriptEdited = true;
    drawScriptNote();
    changed(false);
  }

  let previewBusy = false;
  async function runPreview() {
    if ($("#tab-shopee").hidden) return;
    if (previewBusy) { previewTimer = setTimeout(runPreview, 300); return; }
    previewBusy = true;
    try {
      const r = await api("beginner/preview", request(0));
      if (r.prompt) {
        $("#spPreview").textContent = r.prompt;
        $("#spPreviewState").textContent = "preview";
      } else {
        $("#spPreviewState").textContent = DEMO ? "needs the pod" : "waiting";
      }
    } catch (e) {
      $("#spPreviewState").textContent = e.message;
    }
    previewBusy = false;
  }

  /* ---------------- library ---------------- */

  async function useChar(c) {
    try {
      $("#spMsg").textContent = `Loading ${c.name}…`;
      S.person = { who: c.who, file: null, url: null, thumb: c.img, edited: true };
      if (c.voice) S.voice = c.voice;
      drawPerson();
      S.person.file = await libPicture(`char-${c.id}`, c.img);
      $("#spMsg").textContent = `${c.name} is in.`;
    } catch (e) {
      $("#spMsg").textContent = e.message;
    }
    setSeg("spVoice", "voice", S.voice);
    drawPerson();
    drawPhotos();
    changed();
  }

  function saveChar() {
    if (!S.person.thumb) return toast("Add a photo first", true);
    const name = prompt("Name this character (only you see it):", S.person.who.split(",")[0].slice(0, 30));
    if (!name) return;
    // the same name again replaces that character, so a better photo is an update, not a twin
    const existing = lib.chars.find((x) => x.name === name.trim());
    const c = { id: existing?.id || Date.now().toString(36), name: name.trim(), who: S.person.who.trim(), voice: S.voice, img: S.person.thumb };
    const before = lib.chars;
    lib.chars = [...lib.chars.filter((x) => x !== existing), c];
    if (!saveJson(LIB_KEY, lib)) {
      lib.chars = before;
      return toast("The browser's library is full: delete a character or product first", true);
    }
    onPod.set(`char-${c.id}`, S.person.file);
    drawLibrary();
    toast(`Saved ${c.name}`);
  }

  async function useProduct(p) {
    Object.assign(S, {
      en: p.en, th: p.th, price: p.price || "", points: p.points || "",
      category: CATS[p.category] ? p.category : "other",
    });
    if (!S.settingEdited) S.setting = CATS[S.category].setting;
    S.photos = p.imgs.map((img) => ({ file: null, url: null, thumb: img }));
    S.scriptEdited = false;
    S.captionEdited = false;
    drawAll();
    $("#spMsg").textContent = `Loading ${p.th || p.en}…`;
    try {
      for (const [i, item] of S.photos.entries()) {
        item.file = await libPicture(`prod-${p.id}-${i}`, item.thumb);
        drawPhotos();
      }
      $("#spMsg").textContent = `${p.th || p.en} is in.`;
    } catch (e) {
      $("#spMsg").textContent = e.message;
    }
    changed();
  }

  function saveProduct() {
    if (!S.en.trim() && !S.th.trim()) return toast("Say what the product is first", true);
    const imgs = S.photos.map((p) => p.thumb).filter(Boolean);
    const existing = lib.products.find((p) => (p.th || p.en) === (S.th.trim() || S.en.trim()));
    const p = {
      id: existing?.id || Date.now().toString(36),
      en: S.en.trim(), th: S.th.trim(), price: S.price.trim(), points: S.points,
      category: S.category, imgs,
    };
    const before = lib.products;
    lib.products = [...lib.products.filter((x) => x !== existing), p];
    if (!saveJson(LIB_KEY, lib)) {
      lib.products = before;
      return toast("The browser's library is full: delete a character or product first", true);
    }
    S.photos.forEach((ph, i) => ph.file && onPod.set(`prod-${p.id}-${i}`, ph.file));
    drawLibrary();
    toast(existing ? `Updated ${p.th || p.en}` : `Saved ${p.th || p.en}`);
  }

  /* ---------------- making ---------------- */

  // every picture the form shows has come back from the pod with a filename
  const uploaded = () => !(S.photos.some((p) => !p.file) || (S.person.url && !S.person.file));

  async function start() {
    if (!uploaded()) {
      return ($("#spMsg").textContent = "A picture is still uploading, try again in a moment.");
    }
    const btn = $("#spStart");
    btn.disabled = true;
    $("#spMsg").textContent = "";
    let queued = 0;
    try {
      for (let v = 0; v < S.variants; v++) {
        const r = await api("beginner/start", request(v));
        queued += r.jobs.length;
        if (v === 0 && r.prompt) $("#spPreview").textContent = r.prompt;
      }
      $("#spMsg").textContent = queued > 1
        ? `Queued ${queued} versions · ${clipSeconds()} s each. They show up in the Queue, then Outputs.`
        : `Queued · ${clipSeconds()} s clip. It shows up in the Queue, then Outputs.`;
      $("#spPreviewState").textContent = "sent";
      A.genPoll();
    } catch (e) {
      $("#spMsg").textContent = (queued ? `${queued} queued, then: ` : "") + e.message;
    } finally {
      drawLength();
    }
  }

  async function cover() {
    const pics = pictures();
    if (!pics.product.length) return ($("#spMsg").textContent = "Add a product photo first.");
    const sources = [...pics.person, pics.product[0]];
    const set = S.setting.trim() || CATS[S.category].setting;
    const prompt = pics.person.length
      ? `A bright, eye-catching social-media cover photo: the person from <image1> smiles at the camera and holds the product from <image2> up beside their face. Keep the person's face and the product exactly as they are. ${set} softly blurred behind them, bright natural light, sharp detail.`
      : `A bright, eye-catching product cover photo: the product from <image1> held up in one hand in ${set}, centered, sharp and exactly as it is, bright natural light, softly blurred background.`;
    const btn = $("#spCover");
    btn.disabled = true;
    try {
      await api("image/start", { mode: "edit", sources, prompt, aspect: S.aspect, count: 1, loras: [] });
      $("#spMsg").textContent = "Cover image queued. It takes the shape of the first photo.";
      A.genPoll();
    } catch (e) {
      $("#spMsg").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- batch ----------------
     A list of clips set up one after another and queued at once. Each entry freezes the form as
     it was when added (its requests, its caption, its recipe), so the form can move on to the
     next product straight away. Kept in localStorage; the pictures it names are files on this
     pod, so a batch carried to another pod fails with "not found" until they are added again. */

  const BATCH_KEY = "aiangel.shopee.batch.v1";
  const STYLE_LABEL = { pov: "POV hands", presenter: "Presenter", unboxing: "Unboxing", tryon: "Try-on", showcase: "Showcase" };
  let batch = loadJson(BATCH_KEY, []);
  const saveBatch = () => saveJson(BATCH_KEY, batch) || toast("The batch is too big to keep after a reload", true);

  async function entryFromForm() {
    const src = S.photos.map((p) => p.thumb || p.url).find(Boolean);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: S.th.trim() || S.en.trim() || "Product",
      meta: `${STYLE_LABEL[S.style]} · ${clipSeconds()} s · ${S.aspect}${S.variants > 1 ? ` · ×${S.variants}` : ""}`,
      thumb: src ? await shrink(src, 96).catch(() => null) : null,
      caption: captionText(),
      bodies: Array.from({ length: S.variants }, (_, v) => request(v)),
      snap: snapshot(),
      state: "ready",
    };
  }

  function checkForm(msgEl) {
    if (!uploaded()) { msgEl.textContent = "A picture is still uploading, try again in a moment."; return false; }
    const n = clipSeconds();
    if (n < 1 || n > MAX_SECONDS) { msgEl.textContent = `The script runs ${n} s; keep it between 1 and ${MAX_SECONDS} s.`; return false; }
    return true;
  }

  async function addToBatch() {
    if (!checkForm($("#spMsg"))) return;
    const e = await entryFromForm();
    batch.push(e);
    saveBatch();
    drawBatch();
    $("#spMsg").textContent = `Added ${e.label} to the batch. Change the form and add the next one.`;
  }

  /* Saved products, each with a fresh script for its own selling points and its own hook, all
     with the form's current video type, presenter, voice and look. The form itself is put back
     exactly as it was afterwards. */
  async function addProducts(chosen) {
    const keep = { ...S };
    const msg = $("#spBatchMsg");
    let added = 0;
    const failed = [];
    try {
      for (const [i, p] of chosen.entries()) {
        msg.textContent = `Preparing ${p.th || p.en} (${i + 1} / ${chosen.length})…`;
        try {
          Object.assign(S, {
            en: p.en, th: p.th, price: p.price || "", points: p.points || "",
            category: CATS[p.category] ? p.category : "other",
            hookIx: keep.hookIx + batch.length + i,
            setting: keep.settingEdited ? keep.setting : CATS[CATS[p.category] ? p.category : "other"].setting,
          });
          S.photos = await Promise.all(p.imgs.map(async (img, n) =>
            ({ file: await libPicture(`prod-${p.id}-${n}`, img), url: null, thumb: img })));
          buildScript();
          if (clipSeconds() > MAX_SECONDS) throw new Error(`its script runs ${clipSeconds()} s`);
          batch.push(await entryFromForm());
          added++;
        } catch (e) {
          failed.push(`${p.th || p.en}: ${e.message}`);
        }
      }
    } finally {
      Object.assign(S, keep);
    }
    saveBatch();
    drawBatch();
    msg.textContent = `Added ${added} product(s).` + (failed.length ? ` Skipped: ${failed.join("; ")}` : "");
  }

  function drawPicker() {
    const box = $("#spBatchPick");
    if (!lib.products.length) {
      box.replaceChildren(el("p", { class: "empty", text: "No saved products yet. Use “Save product to library” in step 1 first." }),
        el("button", { class: "link", type: "button", text: "Close", onclick: () => { box.hidden = true; } }));
      return;
    }
    const boxes = lib.products.map((p) => {
      const cb = el("input", { type: "checkbox", value: p.id });
      return el("label", { class: "sp-pick-item" }, cb,
        p.imgs[0] ? el("img", { src: p.imgs[0], alt: "" }) : null, el("span", { text: p.th || p.en }));
    });
    const go = el("button", { class: "btn primary", type: "button", text: "Add to batch" });
    const count = () => boxes.filter((b) => b.querySelector("input").checked).length;
    const relabel = () => { const n = count(); go.textContent = n ? `Add ${n} to batch` : "Add to batch"; go.disabled = !n; };
    boxes.forEach((b) => b.querySelector("input").addEventListener("change", relabel));
    go.addEventListener("click", async () => {
      const ids = new Set(boxes.map((b) => b.querySelector("input")).filter((c) => c.checked).map((c) => c.value));
      go.disabled = true;
      await addProducts(lib.products.filter((p) => ids.has(p.id)));
      box.hidden = true;
    });
    relabel();
    box.replaceChildren(
      el("p", { class: "small dim", text: "One clip per product, with the video type, presenter, voice and look set in the form now." }),
      el("div", { class: "sp-pick-list" }, ...boxes),
      el("div", { class: "row tight" }, go,
        el("button", { class: "link", type: "button", text: "Select all", onclick: () => {
          boxes.forEach((b) => { b.querySelector("input").checked = true; });
          relabel();
        } }),
        el("button", { class: "link", type: "button", text: "Cancel", onclick: () => { box.hidden = true; } })));
  }

  function drawBatch() {
    const waiting = batch.filter((e) => e.state !== "queued");
    const clips = waiting.reduce((n, e) => n + e.bodies.length, 0);
    $("#spBatchCount").textContent = batch.length ? `${batch.length} · ${clips} to queue` : "";
    $("#spBatchGo").disabled = !clips;
    $("#spBatchGo").textContent = clips ? `Queue all (${clips} clip${clips > 1 ? "s" : ""})` : "Queue all";
    $("#spBatchClear").hidden = !batch.length;
    if (!batch.length) {
      $("#spBatchList").replaceChildren(el("p", { class: "empty",
        text: "Set up a clip and press “+ Add to batch”. Change the product, the hook or the presenter and add again, or add saved products, then queue them all at once." }));
      return;
    }
    $("#spBatchList").replaceChildren(...batch.map((e) => el("div", { class: "sp-bitem" },
      e.thumb ? el("img", { src: e.thumb, alt: "" }) : el("span", { class: "sp-bthumb" }),
      el("div", { class: "sp-binfo" },
        el("b", { text: e.label }),
        el("span", { class: "small dim", text: e.meta }),
        e.state === "queued" ? el("span", { class: "tag ok", text: "queued" }) : null,
        e.state === "failed" ? el("span", { class: "tag bad", title: e.error || "", text: "failed" }) : null,
        e.state === "failed" && e.error ? el("span", { class: "small qerr", text: e.error }) : null),
      el("div", { class: "sp-bacts" },
        el("button", { class: "link", type: "button", text: "Edit", title: "Put it back in the form, out of the batch",
          onclick: () => {
            batch = batch.filter((x) => x !== e);
            saveBatch();
            drawBatch();
            loadRecipe({ form: { shopee: e.snap }, missing_refs: [] }, e.label);
            $("#spMsg").textContent = `${e.label} is back in the form. Add it to the batch again when it is right.`;
          } }),
        el("button", { class: "link", type: "button", text: "Caption", title: "Copy this clip's caption",
          onclick: () => copy(e.caption, "Caption") }),
        el("button", { class: "x", type: "button", title: "Remove from the batch", "aria-label": "Remove",
          onclick: () => { batch = batch.filter((x) => x !== e); saveBatch(); drawBatch(); } }, "×")))));
  }

  async function queueAll() {
    const todo = batch.filter((e) => e.state !== "queued");
    const total = todo.reduce((n, e) => n + e.bodies.length, 0);
    const msg = $("#spBatchMsg");
    $("#spBatchGo").disabled = true;
    let done = 0, bad = 0;
    for (const e of todo) {
      try {
        // an entry with versions that half-queued is not sent again in full: what went is skipped
        for (const [i, body] of e.bodies.entries()) {
          if (i < (e.sent || 0)) continue;
          msg.textContent = `Queuing ${done + 1} / ${total}…`;
          await api("beginner/start", body);
          e.sent = i + 1;
          done++;
        }
        e.state = "queued";
        e.error = null;
      } catch (err) {
        e.state = "failed";
        e.error = err.message;
        bad++;
      }
      saveBatch();
      drawBatch();
    }
    msg.textContent = `Queued ${done} clip(s).` + (bad ? ` ${bad} failed; fix them with Edit, or press Queue all again.` : " Watch them in the Queue above.");
    A.genPoll();
  }

  $("#spAddBatch").addEventListener("click", addToBatch);
  $("#spBatchGo").addEventListener("click", queueAll);
  $("#spBatchProducts").addEventListener("click", () => {
    const box = $("#spBatchPick");
    box.hidden = !box.hidden;
    if (!box.hidden) drawPicker();
  });
  $("#spBatchClear").addEventListener("click", () => {
    const queued = batch.filter((e) => e.state === "queued").length;
    if (queued && queued < batch.length && confirm(`Remove only the ${queued} already queued?`)) {
      batch = batch.filter((e) => e.state !== "queued");
    } else if (confirm("Empty the whole batch?")) {
      batch = [];
    }
    saveBatch();
    drawBatch();
  });
  drawBatch();

  /* ---------------- "Use this recipe" from Outputs ---------------- */

  function loadRecipe(r, name) {
    const f = r.form.shopee;
    const missing = new Set(r.missing_refs || []);
    for (const k of DRAFT_FIELDS) if (f[k] !== undefined) S[k] = f[k];
    S.photos = (f.photos || []).filter((x) => !missing.has(x))
      .map((file) => ({ file, url: A.refUrl(file), thumb: null }));
    const pf = f.person?.file && !missing.has(f.person.file) ? f.person.file : null;
    S.person = { who: f.person?.who || "", file: pf, url: pf ? A.refUrl(pf) : null, thumb: null,
      edited: !!f.person?.edited };
    if (f.doodles) window.Doodles?.set(f.doodles);
    drawAll();
    $("#spMsg").textContent = missing.size
      ? `Loaded ${name}. ${missing.size} picture(s) are not on this pod; add them again.`
      : `Loaded ${name}.`;
    changed(false);
  }

  /* ---------------- wiring ---------------- */

  $("#spCat").replaceChildren(...Object.entries(CATS).map(([v, c]) => el("option", { value: v, text: c.label })));

  const segs = [["spStyle", "style"], ["spAspect", "aspect"], ["spVoice", "voice"],
    ["spVariants", "variants"], ["spLook", "look"]];
  for (const [id, key] of segs) {
    $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
      S[key] = key === "variants" ? Number(b.dataset[key]) : b.dataset[key];
      setSeg(id, key, b.dataset[key]);
      if (key === "style") { drawMode(); drawPhotos(); drawPerson(); }
      if (key === "voice") drawPerson();
      // the shape, the look and the count do not change a word of the script
      changed(key === "style" || key === "voice");
    }));
  }

  for (const [id, key] of [["spEn", "en"], ["spTh", "th"], ["spPrice", "price"], ["spPoints", "points"]]) {
    $("#" + id).addEventListener("input", (e) => { S[key] = e.target.value; changed(); });
  }
  $("#spCat").addEventListener("change", (e) => {
    S.category = e.target.value;
    if (!S.settingEdited) { S.setting = CATS[S.category].setting; $("#spSetting").value = S.setting; }
    changed();
  });
  $("#spSetting").addEventListener("input", (e) => {
    S.setting = e.target.value;
    S.settingEdited = e.target.value.trim() !== "";
    changed();
  });
  $("#spMusic").addEventListener("change", (e) => { S.music = e.target.checked; changed(false); });
  $("#spHd").addEventListener("change", () => changed(false));
  $("#spFast").addEventListener("change", () => changed(false));

  $("#spAddPhoto").addEventListener("click", () => $("#spPhotoFiles").click());
  $("#spPhotoFiles").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
  $("#spUploadPerson").addEventListener("click", () => $("#spPersonFile").click());
  $("#spPersonFile").addEventListener("change", (e) => {
    if (e.target.files[0]) setPersonPhoto(e.target.files[0]);
    e.target.value = "";
  });
  $("#spSaveChar").addEventListener("click", saveChar);
  $("#spSaveProduct").addEventListener("click", saveProduct);

  // the product photos can also be dropped straight onto step 1
  const drop = $("#spPhotos").closest(".step");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("sp-drop"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("sp-drop"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("sp-drop");
    addPhotos([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  });

  $("#spNewHook").addEventListener("click", () => {
    S.hookIx++;
    S.shots.filter((s) => s.role === "hook").forEach((s) => { s.line = hookLine(S.hookIx); });
    drawShots();
    changed(false);
  });
  $("#spNewCta").addEventListener("click", () => {
    S.ctaIx++;
    S.shots.filter((s) => s.role === "cta").forEach((s) => { s.line = ctaLine(S.ctaIx); });
    drawShots();
    changed(false);
  });
  $("#spAddShot").addEventListener("click", () => {
    // a new shot goes in before the call to action, which has to stay last
    const at = S.shots.findIndex((s) => s.role === "cta");
    const shot = { role: "extra", seconds: ROLE_SECONDS.extra, what: SCRIPTS[S.style].proof(context()), line: "" };
    S.shots.splice(at < 0 ? S.shots.length : at, 0, shot);
    drawShots();
    edited();
  });
  $("#spReset").addEventListener("click", () => {
    buildScript();
    drawShots();
    drawScriptNote();
    changed(false);
  });

  $("#spCaption").addEventListener("input", (e) => { S.caption = e.target.value; S.captionEdited = true; saveDraft(); });
  $("#spCaptionRefresh").addEventListener("click", () => { S.captionEdited = false; drawCaption(); saveDraft(); });
  $("#spCopyCaption").addEventListener("click", () => copy($("#spCaption").value, "Caption"));

  $("#spStart").addEventListener("click", start);
  $("#spCover").addEventListener("click", cover);

  /* ---------------- start ---------------- */

  const draft = loadJson(DRAFT_KEY, null);
  if (draft) {
    for (const k of DRAFT_FIELDS) if (draft[k] !== undefined) S[k] = draft[k];
    S.person.who = draft.personWho || "";
    S.person.edited = !!draft.personEdited;
    if (!CATS[S.category]) S.category = "other";
    // a setting nobody typed follows the category, also when that default was reworded since
    if (!S.settingEdited) S.setting = CATS[S.category].setting;
  }
  if (!S.shots.length) buildScript();
  drawAll();

  window.ShopeeTab = {
    loadRecipe,
    timeline,
    // a picture to place pop-ups on before any clip exists: the first product photo
    photo: () => S.photos.map((p) => p.url || p.thumb).find(Boolean) || null,
    aspect: () => S.aspect,
    // the tab was opened: what needs downloading may have changed since it was drawn
    shown() { drawMode(); runPreview(); window.Doodles?.shown(); },
  };
  if (!$("#tab-shopee").hidden) window.ShopeeTab.shown();
})();
