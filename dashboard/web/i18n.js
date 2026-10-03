/* Thai for the whole dashboard, switched by the button in the top bar.

   The template's users are mostly Thai and mostly not comfortable in English (owner, 2026-09-16),
   but the page ships in English because anyone on RunPod may open it. So: English stays the
   source, and this file is a dictionary from the exact English string to its Thai.

   It translates by walking the DOM rather than by tagging every element, because the dashboard
   builds most of its text in JavaScript and re-renders on every poll — a MutationObserver keeps
   those redraws translated without app.js having to know this file exists. Only exact matches
   from the dictionary are touched, so machine values (sizes, GPU names, file names, log lines)
   are never rewritten. */
(() => {
  "use strict";

  const TH = {
    // top bar + tabs
    "Overview": "ภาพรวม",
    "Make a clip": "ทำคลิป",
    "Models": "โมเดล",
    "Outputs": "ไฟล์ที่ได้",
    "Keys": "คีย์",
    // "บันทึก" is what a Save button says (owner 2026-09-16), so the log tab keeps the English
    // word everyone already uses
    "Logs": "Log",
    "Open ComfyUI": "เปิด ComfyUI",
    "Restart ComfyUI": "รีสตาร์ท ComfyUI",

    // overview
    "Checking ComfyUI…": "กำลังตรวจ ComfyUI…",
    // the hero splits its own sentence so the last word can be coloured by state
    "ComfyUI is": "ComfyUI",
    "ready": "พร้อมแล้ว",
    "starting": "กำลังเริ่ม",
    "stopped": "หยุดอยู่",
    "down": "ไม่ทำงาน",
    "ComfyUI is ready": "ComfyUI พร้อมแล้ว",
    "ComfyUI is starting": "ComfyUI กำลังเริ่ม",
    "ComfyUI is stopped": "ComfyUI หยุดอยู่",
    "Dashboard lost the pod": "แดชบอร์ดติดต่อ pod ไม่ได้",
    "This page works even while ComfyUI starts, so you can watch the boot here.":
      "หน้านี้ใช้ได้แม้ ComfyUI ยังไม่ขึ้น ดูความคืบหน้าตอนบูตได้จากตรงนี้",
    "Open it in a new tab. Nothing here stops while you work there.":
      "เปิดในแท็บใหม่ได้เลย หน้านี้ยังทำงานต่อระหว่างที่ใช้งานอยู่ตรงนั้น",
    "Usually under a minute. Models keep downloading in the background either way.":
      "ปกติไม่ถึงหนึ่งนาที ระหว่างนี้โมเดลก็ยังโหลดอยู่เบื้องหลัง",
    "Restart it here, or read the ComfyUI log to see why it stopped.":
      "กดรีสตาร์ทที่นี่ หรือดู log ของ ComfyUI ว่าหยุดเพราะอะไร",
    "Services": "บริการบน pod",
    "Passwords are generated at first boot and kept on your volume.":
      "รหัสผ่านสร้างตอนบูตครั้งแรก และเก็บไว้บนดิสก์ของคุณเอง",
    "Models at boot": "โมเดลที่โหลดตอนบูต",
    "Manage →": "จัดการ →",
    "Latest outputs": "ไฟล์ล่าสุด",
    "All outputs →": "ดูทั้งหมด →",

    // make a clip
    "Describe it, press one button. This runs the same AiAngelH3 workflow that is in ComfyUI's Templates — open ComfyUI when you want the full graph.":
      "พิมพ์ว่าอยากได้อะไร แล้วกดปุ่มเดียว เบื้องหลังคือ workflow AiAngelH3 ตัวเดียวกับที่อยู่ใน Templates ของ ComfyUI ถ้าอยากเห็นกราฟเต็มให้เปิด ComfyUI",
    "Guided": "แบบมีคำถามนำ",
    "Write the prompt myself": "เขียน prompt เอง",
    "Pictures": "รูปที่ใส่",
    "Prompt": "Prompt",
    "Reference": "อ้างอิงหน้า/ฉาก",
    "Frame": "ปักเฟรม",
    "H3 copies the face, the place or the outfit out of a reference picture, but nothing says which frame it belongs to.":
      "รูปอ้างอิงคือรูปที่ H3 ลอกหน้า ฉาก หรือชุดออกมาใช้ แต่ไม่ได้บอกว่าเป็นเฟรมไหนของคลิป",
    "Each picture is pinned to one frame of the clip, so the clip really starts (or ends) on it.":
      "รูปที่ใส่จะถูกปักเป็นเฟรมนั้นของคลิปจริงๆ คลิปจึงเริ่ม (หรือจบ) ด้วยรูปนั้น",
    "Pinned frames": "เฟรมที่ปักไว้",
    "Each picture becomes that exact frame of the clip, and H3 fills in what happens between them. Type the frame number yourself: 0 is the first frame, and -1 is the last one.":
      "รูปที่ใส่จะกลายเป็นเฟรมนั้นของคลิปเป๊ะๆ ส่วนระหว่างเฟรม H3 จะเติมให้เอง เลขเฟรมกรอกเอง: 0 คือเฟรมแรก และ -1 คือเฟรมสุดท้าย",
    "Write what happens in English. H3 performs an English instruction, but a Thai one tends to come back spoken instead of acted — Thai belongs in the spoken lines below, where it works.":
      "ช่องนี้เขียนเป็นภาษาอังกฤษ H3 จะทำตามคำสั่งภาษาอังกฤษ แต่ประโยคภาษาไทยมักออกมาเป็นการพูดแทนการกระทำ — ภาษาไทยใส่ในบทพูดข้างล่างได้เต็มที่",
    "+ Add a frame": "+ เพิ่มเฟรม",
    "Crop": "ครอป",
    "Crop this frame": "ครอปเฟรมนี้",
    "Drag the picture to move it, and use the slider to zoom. Whatever fills the box is what the clip starts on — the rest is cut away.":
      "ลากรูปเพื่อเลื่อน และใช้แถบเลื่อนเพื่อซูม ส่วนที่อยู่ในกรอบคือภาพที่คลิปจะเริ่ม ที่เหลือถูกตัดทิ้ง",
    "Fit": "พอดีทั้งรูป",
    "Use this crop": "ใช้กรอบนี้",
    "Picture": "รูป",
    "frame": "เฟรมที่",
    "first frame": "เฟรมแรก",
    "last frame": "เฟรมสุดท้าย",
    "outside this clip": "เกินความยาวคลิป",
    "uploading…": "กำลังอัปโหลด…",
    "No frame pinned yet — add a picture and say which frame it is.":
      "ยังไม่ได้ปักเฟรมไหน — เพิ่มรูปแล้วบอกว่าเป็นเฟรมที่เท่าไหร่",
    "Who is in it": "ใครอยู่ในคลิป",
    "A photo keeps a real face across every frame. Someone without a photo is invented by H3 — fine for the other half of a conversation.":
      "ถ้าแนบรูป หน้าคนนั้นจะคงเดิมทุกเฟรม ส่วนคนที่ไม่มีรูป H3 จะคิดหน้าให้เอง ซึ่งพอใช้ได้กับคู่สนทนาอีกฝั่ง",
    "+ Add a photo": "+ เพิ่มรูป",
    "+ Add someone with no photo": "+ เพิ่มคนที่ไม่มีรูป",
    "Nobody yet — H3 will invent whoever the clip needs.":
      "ยังไม่มีใคร — H3 จะคิดตัวละครให้เองตามเนื้อเรื่อง",
    "What happens": "เกิดอะไรขึ้น",
    "Sound and music": "เสียงและดนตรี",
    "Use this recipe": "ใช้สูตรนี้",
    "+ Add a LoRA": "+ เพิ่ม LoRA",
    "Pick a LoRA": "เลือก LoRA",
    "No LoRA files on this pod yet.": "ยังไม่มีไฟล์ LoRA ใน pod นี้",
    "No LoRA matches that.": "ไม่มี LoRA ที่ตรงกับที่พิมพ์",
    "Load extra image LoRAs": "โหลด LoRA รูปเพิ่มเติม",
    "Extra image LoRAs added. Civitai files need your Civitai key (Keys tab).":
      "เพิ่ม LoRA รูปเข้าไปแล้ว ไฟล์จาก Civitai ต้องใช้คีย์ Civitai ของคุณ (แท็บคีย์)",
    "A LoRA teaches the model one look, one body or one act. They stack, so several can run at once — each at its own strength.":
      "LoRA คือตัวสอนโมเดลให้ได้หน้าตา รูปร่าง หรือท่าแบบหนึ่ง ใส่ซ้อนกันได้หลายตัว แต่ละตัวปรับความแรงเองได้",
    "Model": "โมเดล",
    "what makes the picture — it also decides which LoRAs fit":
      "ตัวที่ใช้สร้างรูป และเป็นตัวกำหนดว่า LoRA ตัวไหนใช้ได้",
    "timing not measured for this model yet": "ยังไม่ได้จับเวลาโมเดลนี้",
    "No LoRA on this pod fits this model.": "ยังไม่มี LoRA ใน pod นี้ที่ใช้กับโมเดลนี้ได้",
    "Upscale this": "ขยายรูปนี้",
    "Custom upscale": "ขยายแบบกำหนดเอง",
    "Cancel": "ยกเลิก",
    "Cancelling…": "กำลังยกเลิก…",
    "Cancelled.": "ยกเลิกแล้ว",
    "Nothing left to cancel — it had already finished.": "ไม่มีอะไรให้ยกเลิกแล้ว งานเสร็จไปก่อนหน้านี้",
    "Size": "ขนาด",
    "leave it empty — the seed that made the photo breaks the edit":
      "เว้นว่างไว้ — ถ้าใส่ seed เดียวกับตอนสร้างรูปนั้น ภาพที่แก้จะพัง",
    "The photo to edit": "รูปที่จะแก้",
    "The photos to edit": "รูปที่จะแก้",
    "The first photo sets the result's size. Refer to them in your instruction as <image1>, <image2>, … — a second photo can be the outfit, the place or the thing to add.":
      "รูปแรกเป็นตัวกำหนดขนาดของผลลัพธ์ อ้างถึงรูปในคำสั่งว่า <image1>, <image2>, … "
      + "รูปที่สองจะเป็นชุด สถานที่ หรือของที่อยากให้เพิ่มเข้าไปก็ได้",
    "trigger word": "คำเรียก (trigger word)",
    "AI Angel ComfyPod is a template that runs the prompts and pictures you give it. You are responsible for what you make with it and how you use it; its authors accept no liability for generated content.":
      "AI Angel ComfyPod เป็นแค่ template ที่ทำงานตาม prompt และรูปที่ผู้ใช้ใส่เข้ามา "
      + "ผู้ใช้รับผิดชอบต่อสิ่งที่สร้างและการนำไปใช้เอง ผู้พัฒนาไม่รับผิดชอบต่อผลลัพธ์ที่สร้างขึ้น",
    "the same number gives the same clip back": "ใส่เลขเดิมจะได้คลิปเดิม",
    "the same number gives the same picture back": "ใส่เลขเดิมจะได้รูปเดิม",
    "Make it 720p": "ทำเป็น 720p",
    "This clip is already 720p.": "คลิปนี้เป็น 720p อยู่แล้ว",
    "This clip has no seed, so the same shots cannot be made again.": "คลิปนี้ไม่มี seed เลยทำช็อตเดิมซ้ำไม่ได้",
    "Its reference pictures are not on this pod, so it cannot be remade.": "รูปอ้างอิงของคลิปนี้ไม่อยู่ใน pod นี้ เลยทำซ้ำไม่ได้",
    "720p needs h3upscaler in MODELS when the pod starts.": "720p ต้องมี h3upscaler ใน MODELS ตอนเปิด pod",
    "Look, light and time of day": "สไตล์ภาพ แสง และช่วงเวลา",
    "Shots and dialogue": "ช็อตและบทพูด",
    "Type @ to pick someone or a picture you added above, so H3 knows exactly who does what.":
      "พิมพ์ @ เพื่อเลือกคนหรือรูปที่ใส่ไว้ข้างบน H3 จะได้รู้แน่ชัดว่าใครทำอะไร",
    "The pinned frames already say what everyone looks like. Add them here to give each person a name you can @mention below — and to pick who says which line.":
      "หน้าตาทุกคนมาจากเฟรมที่ปักไว้แล้ว ตรงนี้ใส่ไว้เพื่อให้เรียกถึงเขาได้ — พิมพ์ @ อ้างถึงในช่องข้างล่าง และเลือกว่าใครพูดประโยคไหน",
    "Nobody by that name": "ไม่มีชื่อนี้",
    "Add someone or a photo in step 1 first": "เพิ่มคนหรือรูปในข้อ 1 ก่อน",
    "optional": "ไม่ใส่ก็ได้",
    "Each shot picks its own length, and the clip is as long as they add up to — that is how a back-and-forth gets paced. One shot is fine.":
      "แต่ละช็อตเลือกความยาวเองได้ และคลิปจะยาวเท่าผลรวมของทุกช็อต นี่คือวิธีคุมจังหวะบทสนทนาโต้ตอบ จะมีช็อตเดียวก็ได้",
    "Clip length": "ความยาวคลิป",
    "longer than 15s may run out of memory": "ยาวเกิน 15 วินาที อาจหน่วยความจำไม่พอ",
    "+ Add a line": "+ เพิ่มประโยค",
    "+ Add a shot": "+ เพิ่มช็อต",
    "Make the clip": "สร้างคลิป",
    "5 seconds": "5 วินาที",
    "10 seconds": "10 วินาที",
    "This clip": "คลิปนี้",
    "Nothing running": "ยังไม่มีงานที่รันอยู่",
    "Queued": "เข้าคิวแล้ว",
    "Rendering…": "กำลังเรนเดอร์…",
    "Done": "เสร็จแล้ว",
    "Failed": "ไม่สำเร็จ",
    "Your clip shows up here, and in Outputs.": "คลิปจะมาโผล่ตรงนี้ และในแท็บไฟล์ที่ได้",
    "preview": "ตัวอย่างก่อนส่ง",
    "sent": "ที่ส่งไปจริง",
    "waiting for step 2": "รอข้อ 2",
    "Edit it yourself →": "เอาไปแก้เอง →",
    "Guided mode writes the structured prompt H3 wants. It updates here as you type, so you can read it before you press the button — and take it into “Write the prompt myself” to change it.":
      "โหมดมีคำถามนำจะเขียน prompt แบบมีโครงสร้างที่ H3 ต้องการให้เอง ตรงนี้อัปเดตตามที่พิมพ์ อ่านได้ก่อนกดปุ่ม และเอาไปแก้ต่อในโหมดเขียนเองได้",
    "Load the example prompt": "โหลด prompt ตัวอย่าง",
    "Person": "คน",
    "Place": "สถานที่",
    "Outfit": "ชุด",
    "Object": "สิ่งของ",
    "Auto": "อัตโนมัติ",
    "English": "อังกฤษ",
    "no photo": "ไม่มีรูป",
    "Done — it is in Outputs too.": "เสร็จแล้ว ไฟล์อยู่ในแท็บไฟล์ที่ได้ด้วย",
    "Finished, but ComfyUI saved no file.": "รันจบแล้ว แต่ ComfyUI ไม่ได้บันทึกไฟล์ไว้",
    "Create": "สร้าง",
    "Describe it, press one button. Clips run the AiAngelH3 workflow, images run Qwen Image 2.1 — both the same graphs you can open in ComfyUI.":
      "พิมพ์ว่าอยากได้อะไร แล้วกดปุ่มเดียว คลิปใช้ workflow AiAngelH3 รูปใช้ Qwen Image 2.1 "
      + "เป็นกราฟชุดเดียวกับที่เปิดใน ComfyUI ได้",
    "Clip": "คลิป",
    // the render row's aspect picker; it was called Frame until Frame became a picture mode
    "Shape": "สัดส่วน",
    "Takes": "จำนวน",
    // owner's own wording (2026-09-17)
    "quality drops slightly": "คุณภาพ drop เล็กน้อย",
    "Fast": "เร็ว",
    // "Sparse attention" itself is left in English on purpose (owner 2026-09-22: technical terms
    // are not translated) — a key that maps a term to itself would only be noise, since a term
    // with no entry already shows as it is. Only the plain-words note beside it is translated,
    // the way "quality drops slightly" is. The owner looked at three same-seed pairs from a pod
    // and called the difference "เพี้ยนไปจากเดิมเล็กน้อย แบบแทบมองไม่เห็น".
    "faster on long clips": "คลิปยาวเร็วขึ้น ภาพต่างนิดเดียว",
    "Workflow only ▾": "สร้างแค่ workflow ▾",
    "Open in ComfyUI ↗": "เปิดใน ComfyUI ↗",
    "Download .json": "ดาวน์โหลด .json",
    "Queue": "คิวงาน",
    "What you make shows up here, and in Outputs. Press the button again any time — it waits its turn.":
      "งานที่สร้างจะขึ้นตรงนี้ และในแท็บไฟล์ที่ได้ กดปุ่มซ้ำได้ตลอด งานใหม่จะรอคิวต่อเอง",
    "All done": "เสร็จหมดแล้ว",
    "running": "กำลังรัน",
    "next": "คิวถัดไป",
    "done": "เสร็จ",
    "failed": "ไม่สำเร็จ",
    "clip": "คลิป",
    "image": "รูป",
    "edit": "แก้รูป",
    "fast": "เร็ว",
    "guided clip": "คลิปแบบมีคำถามนำ",
    "Text to image": "สร้างรูปจากข้อความ",
    "Edit a photo · keeps the face": "แก้รูป · หน้าคงเดิม",
    "Image models are not on this pod yet": "ยังไม่มีโมเดลสร้างรูปใน pod นี้",
    "Editing needs one more model": "แก้รูปต้องใช้โมเดลเพิ่มอีกตัว",
    "The photo to edit": "รูปที่จะแก้",
    "The person in it keeps their face; your instruction changes the rest — the outfit, the place, the light, the pose.":
      "คนในรูปจะหน้าเหมือนเดิม ส่วนที่เหลือเปลี่ยนตามที่สั่ง ทั้งชุด สถานที่ แสง และท่าทาง",
    "No photo yet.": "ยังไม่ได้เลือกรูป",
    "+ Upload a photo": "+ อัปโหลดรูป",
    "Pick from Outputs": "เลือกจากไฟล์ที่ได้",
    "No images in Outputs yet.": "ยังไม่มีรูปในไฟล์ที่ได้",
    "Describe the picture": "อธิบายรูปที่อยากได้",
    "What to change": "อยากเปลี่ยนอะไร",
    "Make the image": "สร้างรูป",
    "Make a clip from this": "เอารูปนี้ไปทำคลิป",
    "Edit this image": "แก้รูปนี้",
    "Downloading…": "กำลังดาวน์โหลด…",
    "Fast models downloading…": "กำลังโหลดโมเดลโหมดเร็ว…",
    "Now say what to change.": "พิมพ์ได้เลยว่าอยากเปลี่ยนอะไร",
    "Added as a person with a photo. Say who they are in step 1, then what happens.":
      "เพิ่มเป็นคนที่มีรูปแล้ว บอกว่าเป็นใครในข้อ 1 แล้วเล่าว่าเกิดอะไรขึ้น",
    "ComfyUI no longer has this job (was it restarted?)": "ComfyUI ไม่มีงานนี้แล้ว (อาจถูกรีสตาร์ท)",

    // models
    "Add a preset or paste links. Files already on the volume at full size are skipped.":
      "เลือกชุดสำเร็จรูป หรือวางลิงก์เอง ไฟล์ที่มีอยู่แล้วครบขนาดจะถูกข้าม",
    "Presets": "ชุดสำเร็จรูป",
    "Paste links": "วางลิงก์",
    "Download": "ดาวน์โหลด",
    "Downloads": "รายการดาวน์โหลด",
    "Load NSFW kit (18+)": "โหลดชุด NSFW (18+)",

    // outputs
    "Everything ComfyUI saved. Pick files, or take them all, as ZIP.":
      "ทุกไฟล์ที่ ComfyUI บันทึกไว้ เลือกทีละไฟล์หรือเอาทั้งหมดเป็น ZIP",
    "New since last ZIP": "ใหม่ตั้งแต่ ZIP ล่าสุด",
    "Select all": "เลือกทั้งหมด",
    "Clear": "ล้าง",
    "Split": "แบ่งไฟล์",
    "one ZIP": "ก้อนเดียว",
    "Download ZIP": "ดาวน์โหลด ZIP",
    "Delete": "ลบ",
    "Cancel": "ยกเลิก",
    "Yes, delete": "ยืนยัน ลบเลย",
    "They are removed from the pod for good — download the ZIP first if you want to keep them.":
      "ไฟล์จะหายจาก pod ถาวร ถ้ายังอยากเก็บไว้ให้โหลด ZIP ก่อน",
    "Tick the files to delete first": "เลือกไฟล์ที่จะลบก่อน",

    // keys
    "API keys": "คีย์ API",
    "Needed for every Civitai download. Civitai → Account settings → API Keys.":
      "ต้องใช้กับทุกการโหลดจาก Civitai: Civitai → Account settings → API Keys",
    "Only for gated or private repos. huggingface.co → Settings → Access Tokens (read).":
      "ใช้เฉพาะ repo ที่ปิดหรือส่วนตัว: huggingface.co → Settings → Access Tokens (read)",
    "Save": "บันทึก",
    "Remove": "ลบ",

    // logs
    "Boot": "ตอนบูต",
    "Loading…": "กำลังโหลด…",

    // small controls the page builds in JavaScript
    "free": "ว่าง",
    "Uptime": "เปิดมาแล้ว",
    "Show": "ดู",
    "Hide": "ซ่อน",
    "Copy": "คัดลอก",
    "Copied": "คัดลอกแล้ว",
    "Refresh": "รีเฟรช",
    "From MODELS or added here, no restart needed":
      "มาจากตัวแปร MODELS หรือเพิ่มตรงนี้ ไม่ต้องรีสตาร์ท",
    "Saved on your own volume (/workspace/aiangel/.secrets), used only for downloads, shown masked. ComfyUI's Model list and Model Manager use the same keys.":
      "เก็บไว้บนดิสก์ของคุณเอง (/workspace/aiangel/.secrets) ใช้กับการดาวน์โหลดเท่านั้น และแสดงแบบปิดบัง ทั้ง Model list และ Model Manager ใน ComfyUI ใช้คีย์ชุดเดียวกันนี้",

    // Story tab (story.js, added for this workspace)
    "Story": "เล่าเรื่อง",
    "Tell a story scene by scene: who is in it, where and when, then each shot's camera, action and dialogue. A grey blocking render from Blender can set the camera and the movement.": "เล่าเรื่องทีละฉาก: มีใคร ที่ไหน เมื่อไร แล้วแต่ละช็อตกล้องเป็นแบบไหน ใครทำอะไร พูดอะไร ใส่วิดีโอ blocking สีเทาจาก Blender เพื่อกำหนดกล้องและการเคลื่อนไหวได้",
    "each take is a new seed": "แต่ละเทคสุ่ม seed ใหม่",
    "New story": "เริ่มเรื่องใหม่",
    "The story": "เรื่องราว",
    "Title": "ชื่อเรื่อง",
    "What it is about": "เรื่องเกี่ยวกับอะไร",
    "English, one or two sentences": "ภาษาอังกฤษ หนึ่งถึงสองประโยค",
    "Where": "ที่ไหน",
    "When": "เมื่อไร",
    "time of day, era, weather": "ช่วงเวลา ยุค สภาพอากาศ",
    "A photo keeps the same face in every scene. Write @Name in a shot to point at someone.": "ใส่รูปไว้ หน้าตัวละครจะเหมือนเดิมทุกฉาก พิมพ์ @ชื่อ ในช็อตเพื่อระบุตัวละคร",
    "+ Add a character": "+ เพิ่มตัวละคร",
    "Nobody yet. Add the people in the story; a photo keeps the same face in every scene.": "ยังไม่มีตัวละคร เพิ่มคนในเรื่องได้เลย ใส่รูปไว้หน้าจะเหมือนเดิมทุกฉาก",
    "The place": "สถานที่",
    "A photo of the location keeps it the same in every scene.": "ใส่รูปสถานที่ไว้ ฉากจะเป็นที่เดิมทุกฉาก",
    "+ Photo of the place": "+ รูปสถานที่",
    "Cinematic film": "ภาพยนตร์",
    "TV drama": "ละครทีวี",
    "Phone vlog": "วล็อกมือถือ",
    "3D animated": "แอนิเมชัน 3D",
    "Anime": "อนิเมะ",
    "Look in your words": "บรรยายลุคเอง",
    "optional, replaces the choice above": "ไม่ใส่ก็ได้ ถ้าใส่จะใช้แทนตัวเลือกด้านบน",
    "Music and sound": "เพลงและเสียง",
    "for every scene": "ใช้กับทุกฉาก",
    "+ Scene": "+ ฉาก",
    "Duplicate": "ทำสำเนา",
    "Scene": "ฉาก",
    "Scene title": "ชื่อฉาก",
    "if it differs": "ถ้าต่างจากเรื่อง",
    "Sound": "เสียง",
    "Blocking video from Blender": "วิดีโอ blocking จาก Blender",
    "optional · goes to H3 as <Video 1>": "ไม่ใส่ก็ได้ · ส่งให้ H3 เป็น <Video 1>",
    "+ Add blocking video": "+ เพิ่มวิดีโอ blocking",
    "Replace video": "เปลี่ยนวิดีโอ",
    "Fit shots to the video": "ปรับความยาวช็อตให้ตรงกับวิดีโอ",
    "No blocking video. H3 frames each shot from the camera and action written below.": "ยังไม่มีวิดีโอ blocking H3 จะจัดเฟรมแต่ละช็อตตามกล้องและการกระทำที่เขียนไว้ด้านล่าง",
    "H3 follows": "ให้ H3 ตาม",
    "Camera only": "กล้องอย่างเดียว",
    "Camera + blocking": "กล้อง + ตำแหน่งตัวละคร",
    "Loose timing": "จังหวะคร่าว ๆ",
    "The camera path, framing and cuts come from the video. What people do comes from the shots below.": "เส้นทางกล้อง การจัดเฟรม และจังหวะตัดมาจากวิดีโอ ส่วนตัวละครทำอะไรมาจากช็อตด้านล่าง",
    "The camera, and where each character stands and moves, come from the video. The shots below say who they are and what they do.": "กล้อง และตำแหน่งที่ตัวละครยืนและเดิน มาจากวิดีโอ ช็อตด้านล่างบอกว่าใครเป็นใครและทำอะไร",
    "Only the rhythm of the cuts is borrowed, loosely. For a rough animatic.": "ยืมแค่จังหวะการตัดแบบคร่าว ๆ เหมาะกับ animatic หยาบ ๆ",
    "How to render it in Blender": "วิธี render ใน Blender",
    "Block the scene with simple shapes or mannequins and animate the camera. Give each character its own colour, so H3 can tell them apart.": "วางฉากด้วยรูปทรงง่าย ๆ หรือหุ่น แล้วทำแอนิเมชันกล้อง ให้ตัวละครแต่ละตัวมีสีของตัวเอง H3 จะได้แยกออก",
    "Render at 24 fps, the scene's shape and length. The script below sets that up (Workbench, H.264 MP4).": "Render ที่ 24 fps ขนาดและความยาวเท่าฉาก สคริปต์ด้านล่างตั้งค่าให้ (Workbench, H.264 MP4)",
    "Add the MP4 here (or drop it on this form) and pick what H3 should follow.": "เพิ่มไฟล์ MP4 ที่นี่ (หรือลากมาวางบนฟอร์ม) แล้วเลือกว่าจะให้ H3 ตามอะไร",
    "Copy the script": "คัดลอกสคริปต์",
    "Shots": "ช็อต",
    "English for what happens; dialogue in Thai or English": "เหตุการณ์เขียนภาษาอังกฤษ บทพูดไทยหรืออังกฤษก็ได้",
    "Dialogue": "บทพูด",
    "+ Dialogue line": "+ บทพูด",
    "Scene length": "ความยาวฉาก",
    "Make this scene": "ทำฉากนี้",
    "As in the blocking video": "ตามวิดีโอ blocking",
    "Static": "กล้องนิ่ง",
    "Push in": "ดันกล้องเข้า",
    "Pull out": "ถอยกล้องออก",
    "Pan left": "แพนซ้าย",
    "Pan right": "แพนขวา",
    "Tilt up": "ทิลต์ขึ้น",
    "Tilt down": "ทิลต์ลง",
    "Tracking": "แทร็กตาม",
    "Handheld": "กล้องมือถือ",
    "Orbit": "หมุนรอบ",
    "Crane up": "เครนขึ้น",
    "Crane down": "เครนลง",
    "The blocking video is in. It goes to H3 as <Video 1>.": "ใส่วิดีโอ blocking แล้ว ส่งให้ H3 เป็น <Video 1>",
    "This pod's image cannot take a video yet: start the pod from the latest Shopee ComfyPod image.": "อิมเมจของ pod นี้ยังรับวิดีโอไม่ได้ ให้เปิด pod จากอิมเมจ Shopee ComfyPod ล่าสุด",
    "Some of its pictures are not on this pod: add them again.": "รูปบางรูปไม่มีใน pod นี้ เพิ่มใหม่อีกครั้ง",

    // Story tab: export / import
    "Import story": "นำเข้าเรื่อง",
    "Export story": "ส่งออกเรื่อง",
    "Stop waiting": "หยุดรอ",
    "Packing the story…": "กำลังรวมไฟล์เรื่อง…",
    "Uploading the pictures…": "กำลังอัปโหลดรูป…",
    "Stopped waiting. Make all scenes queues them when you are ready.": "หยุดรอแล้ว กด ทำทั้งหมด เมื่อพร้อมเพื่อเข้าคิว",

    // Shopee affiliate tab (shopee.js, added for this workspace)
    "Shopee affiliate": "คลิป Shopee Affiliate",
    "Product photos and a few words in, a vertical clip out: a hook, the product working, and a call to the basket, spoken in Thai.":
      "ใส่รูปสินค้ากับคำไม่กี่คำ ได้คลิปแนวตั้งพร้อมโพสต์: เปิดด้วย hook โชว์สินค้าใช้งานจริง แล้วปิดด้วยชวนกดตะกร้า พูดเป็นภาษาไทย",
    "Video type": "แบบคลิป",
    "POV hands": "มุมมองมือ (POV)",
    "Presenter": "พรีเซนเตอร์",
    "Unboxing": "แกะกล่อง",
    "Try-on": "ลองใส่",
    "Showcase": "โชว์สินค้า",
    "Voice": "เสียง",
    "Female · ค่ะ": "ผู้หญิง · ค่ะ",
    "Male · ครับ": "ผู้ชาย · ครับ",
    "Versions": "จำนวนเวอร์ชัน",
    "each version opens with a different hook": "แต่ละเวอร์ชันเปิดด้วย hook ไม่ซ้ำกัน",
    "Filmed from your eyes: only hands and the product are seen, your voice explains it. The quickest kind to make look real.":
      "ถ่ายจากมุมสายตาเรา เห็นแค่มือกับสินค้า มีเสียงเราอธิบาย เป็นแบบที่ทำให้ดูสมจริงได้ง่ายที่สุด",
    "Someone talks to the camera and shows the product. A saved character keeps the same face across every product you sell.":
      "มีคนพูดกับกล้องและโชว์สินค้า ใช้ตัวละครที่บันทึกไว้ หน้าจะเหมือนเดิมทุกคลิปไม่ว่าขายสินค้าอะไร",
    "Hands open an orange Shopee parcel and take the product out. Good for anything that arrives in a box.":
      "มือแกะซองพัสดุสีส้มของ Shopee แล้วหยิบสินค้าออกมา เหมาะกับของที่ส่งมาในกล่อง",
    "The presenter wears it and turns to show the fit. Uses the first product photo as the outfit.":
      "พรีเซนเตอร์ใส่แล้วหมุนตัวโชว์ทรง ใช้รูปสินค้ารูปแรกเป็นชุด",
    "No people: slow, ad-style shots of the product with a voice-over. Good for home, gadgets and beauty.":
      "ไม่มีคน เป็นช็อตสินค้าช้า ๆ แบบโฆษณา มีเสียงพากย์ เหมาะกับของใช้ในบ้าน แกดเจ็ต และความงาม",
    "Product": "สินค้า",
    "The Shopee listing photos work best: the product alone on a plain background. H3 copies the product from them.":
      "รูปจากหน้าร้าน Shopee ใช้ได้ดีที่สุด: สินค้าชิ้นเดียวบนพื้นเรียบ H3 จะลอกหน้าตาสินค้าจากรูปเหล่านี้",
    "No product photo yet. Without one, H3 invents what the product looks like.":
      "ยังไม่มีรูปสินค้า ถ้าไม่ใส่ H3 จะคิดหน้าตาสินค้าขึ้นมาเอง",
    "+ Add product photo": "+ เพิ่มรูปสินค้า",
    "What it is": "สินค้าคืออะไร",
    "English, for the video model": "ภาษาอังกฤษ ให้โมเดลวิดีโออ่าน",
    "Name to say": "ชื่อที่จะพูดในคลิป",
    "Thai, spoken in the clip": "ภาษาไทย",
    "Category": "หมวดสินค้า",
    "Price or deal": "ราคาหรือโปร",
    "Selling points": "จุดขาย",
    "Thai, one per line, up to 3": "ภาษาไทย บรรทัดละข้อ สูงสุด 3 ข้อ",
    "Save product to library": "บันทึกสินค้าไว้ใช้ซ้ำ",
    "Beauty & skincare": "ความงาม & สกินแคร์",
    "Fashion & accessories": "แฟชั่น & เครื่องประดับ",
    "Gadgets & electronics": "แกดเจ็ต & อิเล็กทรอนิกส์",
    "Home & kitchen": "ของใช้ในบ้าน & ครัว",
    "Food & snacks": "อาหาร & ขนม",
    "Mom, baby & pets": "แม่และเด็ก & สัตว์เลี้ยง",
    "Other": "อื่น ๆ",
    "A photo keeps the same face in every clip. Save it once as a character and reuse it for every product.":
      "ใส่รูปแล้วหน้าจะเหมือนเดิมทุกคลิป บันทึกเป็นตัวละครครั้งเดียว ใช้ซ้ำได้กับทุกสินค้า",
    "A photo keeps the same face in every clip. Save it once as a character and reuse it for every product. With no photo, H3 invents the person described here.":
      "ใส่รูปแล้วหน้าจะเหมือนเดิมทุกคลิป บันทึกเป็นตัวละครครั้งเดียว ใช้ซ้ำได้กับทุกสินค้า ถ้าไม่ใส่รูป H3 จะสร้างคนตามที่เขียนไว้ตรงนี้",
    "This face is kept in every frame. Say who they are in a few words; their voice follows.":
      "หน้านี้จะคงเดิมทุกเฟรม บอกสั้น ๆ ว่าเป็นใคร เสียงพูดจะออกมาตามนั้น",
    "+ Use a photo": "+ ใช้รูปถ่าย",
    "Save as character": "บันทึกเป็นตัวละคร",
    "Script": "สคริปต์",
    "edit any line": "แก้ได้ทุกบรรทัด",
    "Written for you from step 1: grab attention, show it working, then point at the basket. What happens is in English for H3; what is said is in Thai.":
      "เขียนให้อัตโนมัติจากข้อ 1: ดึงความสนใจ โชว์การใช้งาน แล้วชวนกดตะกร้า ช่องเกิดอะไรขึ้นเป็นภาษาอังกฤษให้ H3 อ่าน ส่วนบทพูดเป็นภาษาไทย",
    "Says": "พูดว่า",
    "Show it": "โชว์การใช้งาน",
    "Proof": "ย้ำจุดขาย",
    "Call to action": "ชวนกดตะกร้า",
    "Extra shot": "ช็อตเพิ่ม",
    "↻ Another hook": "↻ เปลี่ยน hook",
    "↻ Another ending": "↻ เปลี่ยนตอนจบ",
    "Reset script": "เริ่มสคริปต์ใหม่",
    "You changed the script, so it no longer follows step 1. Reset script rebuilds it from there.":
      "แก้สคริปต์เองแล้ว สคริปต์จะไม่เปลี่ยนตามข้อ 1 อีก กด เริ่มสคริปต์ใหม่ ถ้าอยากให้เขียนใหม่จากข้อ 1",
    "Look and sound": "ภาพและเสียง",
    "Look": "สไตล์ภาพ",
    "Phone video (UGC)": "คลิปมือถือ (UGC)",
    "Studio ad": "โฆษณาสตูดิโอ",
    "Cinematic": "แบบภาพยนตร์",
    "Where it is filmed": "ถ่ายที่ไหน",
    "Upbeat background music": "ใส่เพลงประกอบจังหวะสนุก",
    "Make a cover image": "ทำภาพปก",
    "Caption & hashtags": "แคปชันและแฮชแท็ก",
    "↻ Rewrite": "↻ เขียนใหม่",
    "The prompt H3 will get shows up here as you fill the form in.":
      "prompt ที่จะส่งให้ H3 จะขึ้นตรงนี้ระหว่างกรอกฟอร์ม",
    "needs the pod": "ต้องเปิดบน pod",
    "A picture is still uploading, try again in a moment.": "ยังอัปโหลดรูปไม่เสร็จ รอสักครู่แล้วกดใหม่",
    "Add a product photo first.": "ใส่รูปสินค้าก่อน",
    "Cover image queued. It takes the shape of the first photo.": "เข้าคิวทำภาพปกแล้ว ภาพจะได้สัดส่วนเดียวกับรูปแรก",

    // Shopee batch
    "+ Add to batch": "+ เพิ่มเข้าชุดงาน",
    "Batch": "ชุดงาน",
    "+ Saved products": "+ สินค้าที่บันทึกไว้",
    "Queue all": "เข้าคิวทั้งหมด",
    "Set up a clip and press “+ Add to batch”. Change the product, the hook or the presenter and add again, or add saved products, then queue them all at once.":
      "ตั้งค่าคลิปแล้วกด “+ เพิ่มเข้าชุดงาน” เปลี่ยนสินค้า hook หรือพรีเซนเตอร์แล้วเพิ่มอีก หรือเพิ่มจากสินค้าที่บันทึกไว้ จากนั้นกดเข้าคิวทีเดียวทั้งหมด",
    "One clip per product, with the video type, presenter, voice and look set in the form now.":
      "สินค้าละ 1 คลิป ใช้แบบคลิป พรีเซนเตอร์ เสียง และสไตล์ภาพตามที่ตั้งไว้ในฟอร์มตอนนี้",
    "No saved products yet. Use “Save product to library” in step 1 first.":
      "ยังไม่มีสินค้าที่บันทึกไว้ กด “บันทึกสินค้าไว้ใช้ซ้ำ” ในข้อ 1 ก่อน",
    "Add to batch": "เพิ่มเข้าชุดงาน",
    "Edit": "แก้ไข",
    "Caption": "แคปชัน",
    "queued": "เข้าคิวแล้ว",
    "Close": "ปิด",

    // doodle pop-ups (doodle.js)
    "Doodle pop-ups": "ลายเส้นเด้งดึ๋ง (Doodle pop-ups)",
    "added on top after the clip is made": "ใส่ทับหลังทำคลิปเสร็จ",
    "drawn over a finished clip, then saved as a new video": "วาดทับคลิปที่ทำเสร็จแล้ว แล้วบันทึกเป็นวิดีโอใหม่",
    "Pop lines": "เส้นเด้ง",
    "Sparkles": "ประกายวิ้ง",
    "Heart": "หัวใจ",
    "Arrow": "ลูกศร",
    "Circle": "วงกลม",
    "Squiggle": "เส้นหยัก",
    "Text": "ข้อความ",
    "Points": "ทิศ",
    "Tilt": "เอียง",
    "at": "เริ่มที่",
    "s · for": "วิ · นาน",
    "⏱ now": "⏱ ตรงนี้",
    "+ Add at this moment": "+ เพิ่มตรงจังหวะนี้",
    "↻ Rebuild from the script": "↻ จัดใหม่ตามสคริปต์",
    "Save clip with pop-ups": "บันทึกคลิปพร้อมลายเส้น",
    "Click the picture to move the selected pop-up.": "คลิกบนภาพเพื่อย้ายลายเส้นที่เลือก ลากเพื่อจัดตำแหน่ง",
    "No pop-ups. Add one below, or rebuild them from the script.": "ยังไม่มีลายเส้น เพิ่มด้านล่าง หรือกดจัดใหม่ตามสคริปต์",
    "No clip: place pop-ups on the product photo": "ยังไม่เลือกคลิป: จัดตำแหน่งบนรูปสินค้าไปก่อน",
    "No clip yet: make one first": "ยังไม่มีคลิป: ทำคลิปก่อน",
    "no clip": "ไม่มีคลิป",
  };

  /* Words whose Thai depends on where they sit. "Image" is a kind of output file in the Outputs
     filter and the Docker image on the Overview meters — one dictionary for the whole page would
     have to pick one and be wrong on the other. */
  const SCOPED = [
    ["#kindFilter, #chips", { All: "ทั้งหมด", Video: "วิดีโอ", Image: "รูป", Audio: "เสียง" }],
    [".meter", { Image: "อิมเมจ", GPU: "GPU" }],
    ["#createMedium", { Image: "รูป" }],
  ];

  /* Text the page assembles with a number or a name in it. The capture group is put back
     untouched, so sizes and counts stay as they are. */
  const PATTERNS = [
    [/^Shot (\d+)$/, "ช็อต $1"],
    [/^reuse (\d+)$/, "ใช้ $1 อีกครั้ง"],
    [/^Loaded (.+)\. (\d+) reference picture\(s\) are not on this pod — add them again\.$/,
      "โหลดสูตรจาก $1 แล้ว แต่รูปอ้างอิง $2 รูปไม่อยู่ใน pod นี้ ต้องเพิ่มใหม่"],
    [/^Loaded (.+)\.$/, "โหลดสูตรจาก $1 แล้ว"],
    [/^(.+) \(not on this pod\)$/, "$1 (ไม่มีใน pod นี้)"],
    [/^Download ([\d.]+ .B)$/, "ดาวน์โหลด $1"],
    [/^(\d+) selected$/, "เลือกไว้ $1 ไฟล์"],
    [/^Delete (\d+) file\(s\) · (.+)\?$/, "ลบ $1 ไฟล์ · $2 ใช่ไหม"],
    [/^Deleted (\d+) file\(s\)$/, "ลบแล้ว $1 ไฟล์"],
    [/^([\d.]+)s in$/, "วินาทีที่ $1"],
    [/^(\d+) frames at 24 fps · 0 to (\d+)$/, "$1 เฟรม ที่ 24 fps · 0 ถึง $2"],
    [/^Queued · (.+)$/, "เข้าคิวแล้ว · $1"],
    [/^Already on the volume$/, "มีอยู่แล้วบนดิสก์"],
    [/^≈ (.+) each · (\d+) takes ≈ (.+)$/, "≈ $1 ต่องาน · $2 งาน ≈ $3"],
    [/^≈ (.+) each$/, "≈ $1 ต่องาน"],
    [/^waiting · (\d+) ahead$/, "รอคิว · ก่อนหน้า $1"],
    [/^(\d+) running · (\d+) waiting$/, "รันอยู่ $1 · รอ $2"],
    [/^1 running$/, "รันอยู่ 1"],
    [/^Download Fast models \((.+)\)$/, "โหลดโมเดลโหมดเร็ว ($1)"],
    [/^Queued (\d+) takes · (.+) each$/, "เข้าคิว $1 งาน · คลิปละ $2"],
    [/^Queued (\d+) takes$/, "เข้าคิว $1 งาน"],
    [/^Opened (.+) in ComfyUI\.$/, "เปิด $1 ใน ComfyUI แล้ว"],
    [/^(.+) — drop it onto ComfyUI to open it\.$/, "$1 ลากไปวางใน ComfyUI เพื่อเปิด"],
    [/^Downloading (.+) — this unlocks by itself when it finishes\.$/, "กำลังโหลด $1 เสร็จแล้วใช้ได้เองทันที"],
    [/^Editing needs (.+) · (.+)\. No restart needed\.$/, "แก้รูปต้องใช้ $1 · $2 ไม่ต้องรีสตาร์ท"],
    [/^Making an image needs (.+) · (.+)\. No restart needed\.$/, "สร้างรูปต้องใช้ $1 · $2 ไม่ต้องรีสตาร์ท"],
    // Shopee tab
    [/^Make (\d) versions$/, "ทำ $1 เวอร์ชัน"],
    [/^Queued (\d+) versions · (\d+) s each\. They show up in the Queue, then Outputs\.$/,
      "เข้าคิว $1 เวอร์ชัน · คลิปละ $2 วินาที ดูได้ในคิว แล้วจะไปอยู่ในไฟล์ที่ได้"],
    [/^Queued · (\d+) s clip\. It shows up in the Queue, then Outputs\.$/,
      "เข้าคิวแล้ว · คลิป $1 วินาที ดูได้ในคิว แล้วจะไปอยู่ในไฟล์ที่ได้"],
    [/^H3 makes up to (\d+) s; shorten a shot$/, "H3 ทำได้ไม่เกิน $1 วินาที ลดความยาวบางช็อตลง"],
    [/^Loading (.+)…$/, "กำลังโหลด $1…"],
    [/^(.+) is in\.$/, "ใส่ $1 แล้ว"],
    [/^Up to (\d+) product photos$/, "รูปสินค้าได้สูงสุด $1 รูป"],
    [/^Recording ([\d.]+) \/ ([\d.]+) s · keep this tab open$/, "กำลังบันทึก $1 / $2 วิ · อย่าสลับแท็บระหว่างนี้"],
    [/^Saved (.+) \(([\d.]+) MB\) to your downloads\.$/, "บันทึก $1 ($2 MB) ลงโฟลเดอร์ดาวน์โหลดแล้ว"],
    [/^Could not save: (.+)$/, "บันทึกไม่สำเร็จ: $1"],
    [/^Queue all \((\d+) clips?\)$/, "เข้าคิวทั้งหมด ($1 คลิป)"],
    [/^(\d+) · (\d+) to queue$/, "$1 รายการ · รอเข้าคิว $2 คลิป"],
    [/^Add (\d+) to batch$/, "เพิ่ม $1 รายการเข้าชุดงาน"],
    [/^Queuing (\d+) \/ (\d+)…$/, "กำลังเข้าคิว $1 / $2…"],
    [/^Preparing (.+) \((\d+) \/ (\d+)\)…$/, "กำลังเตรียม $1 ($2 / $3)…"],
    [/^Added (\d+) product\(s\)\.$/, "เพิ่มแล้ว $1 สินค้า"],
    [/^Added (.+) to the batch\. Change the form and add the next one\.$/, "เพิ่ม $1 เข้าชุดงานแล้ว เปลี่ยนฟอร์มแล้วเพิ่มรายการถัดไปได้เลย"],
    [/^Queued (\d+) clip\(s\)\. Watch them in the Queue above\.$/, "เข้าคิวแล้ว $1 คลิป ดูความคืบหน้าได้ในคิวด้านบน"],
    // Story tab
    [/^Make (\d) takes$/, "ทำ $1 เทค"],
    [/^Make all (\d+) scenes$/, "ทำทั้ง $1 ฉาก"],
    [/^Queued (\d+) clips?\. The scenes run one after another in the Queue, then in Outputs\.$/, "เข้าคิวแล้ว $1 คลิป ฉากจะทำต่อกันไปในคิว แล้วไปอยู่ในไฟล์ที่ได้"],
    [/^Queued (\d+) clips?\. It shows up in the Queue, then in Outputs\.$/, "เข้าคิวแล้ว $1 คลิป ดูได้ในคิว แล้วจะไปอยู่ในไฟล์ที่ได้"],
    [/^H3 makes up to (\d+) s a scene: shorten a shot or split the scene$/, "H3 ทำได้ไม่เกิน $1 วินาทีต่อฉาก ลดความยาวช็อตหรือแบ่งเป็นสองฉาก"],
    [/^the blocking video is ([\d.]+) s$/, "วิดีโอ blocking ยาว $1 วินาที"],
    [/^The shots now add up to ([\d.]+) s\.$/, "ตอนนี้ช็อตรวมกันได้ $1 วินาที"],
    [/^Scene (\d+): (.+)$/, "ฉาก $1: $2"],
    // Story tab: export / import
    [/^(.+) could not be read: (.+)$/, "อ่าน $1 ไม่ได้: $2"],
    [/^Saved (.+\.story\.zip)\. On the pod, open the Story tab and import it\.$/, "บันทึก $1 แล้ว เปิดแท็บเล่าเรื่องบน pod แล้วนำเข้าไฟล์นี้"],
    [/^Saved (.+\.story\.zip) without the blocking video of scene ([\d, ]+): this page no longer has it\. Add it again and export to include it\.$/, "บันทึก $1 แล้ว แต่ไม่มีวิดีโอ blocking ของฉาก $2 เพราะหน้านี้ไม่มีไฟล์แล้ว เพิ่มวิดีโอใหม่แล้วส่งออกอีกครั้ง"],
    [/^Uploading the blocking video of scene (\d+)…$/, "กำลังอัปโหลดวิดีโอ blocking ของฉาก $1…"],
    [/^Imported (.+): (\d+) scenes?\.$/, "นำเข้า $1 แล้ว: $2 ฉาก"],
    [/^(.+) is not a story file exported from this tab\.$/, "$1 ไม่ใช่ไฟล์เรื่องที่ส่งออกจากแท็บนี้"],
    [/^(?:(\d+) queued\. )?Waiting for the pod: (.+)\. (\d+) scenes? will queue by themselves when it is ready; keep this tab open\.$/, "กำลังรอ pod: $2 อีก $3 ฉากจะเข้าคิวเองเมื่อพร้อม อย่าปิดแท็บนี้"],
  ];

  const PH = {  // placeholders
    // the LoRA picker became a box you type into, so its prompt is a placeholder now
    "Pick a LoRA": "เลือก LoRA · พิมพ์เพื่อค้นหา",
    "e.g. birds, a sitcom laugh track after the last line": "เช่น เสียงนก เสียงหัวเราะแบบซิทคอมหลังประโยคสุดท้าย",
    "e.g. Live-action, photorealistic, golden hour": "เช่น Live-action, photorealistic, แสงเย็น",
    "sit by the window of a cafe, look up from their coffee and smile":
      "นั่งริมหน้าต่างร้านกาแฟ เงยหน้าจากแก้วกาแฟแล้วยิ้ม",
    "who this is, e.g. a woman in her twenties": "คนนี้คือใคร เช่น ผู้หญิงวัยยี่สิบ",
    "where this is, e.g. a hotel room in Chiang Mai": "ที่นี่คือที่ไหน เช่น ห้องพักโรงแรมในเชียงใหม่",
    "what this is, e.g. a white shirt and a black skirt": "ชุดอะไร เช่น เสื้อเชิ้ตขาวกับกระโปรงดำ",
    "what this is, e.g. a green coffee bag": "ของอะไร เช่น ถุงกาแฟสีเขียว",
    "what happens here — blank uses step 2": "ช็อตนี้เกิดอะไรขึ้น เว้นว่างไว้จะใช้ข้อ 2",
    "what happens in this shot": "ช็อตนี้เกิดอะไรขึ้น",
    "random": "สุ่ม",
    "Paste Civitai API key": "วางคีย์ API ของ Civitai",
    "Paste Hugging Face token": "วาง token ของ Hugging Face",
    // Shopee tab
    "a vitamin C face serum in a small glass dropper bottle": "เป็นภาษาอังกฤษ เช่น a vitamin C face serum in a small glass dropper bottle",
    "what is said (Thai), or leave empty for no talking": "บทพูด (ภาษาไทย) หรือเว้นว่างถ้าช็อตนี้ไม่พูด",
    "who this is, e.g. a cheerful Thai woman in her twenties": "เป็นใคร (ภาษาอังกฤษ) เช่น a cheerful Thai woman in her twenties",
    // Story tab
    "Rain on Soi 11": "เช่น Rain on Soi 11",
    "a narrow Bangkok alley with neon signs": "ภาษาอังกฤษ เช่น a narrow Bangkok alley with neon signs",
    "A shy student finds the street-food boy she has a crush on hiding from the rain, and finally speaks to him.": "ภาษาอังกฤษ เช่น A shy student finds the street-food boy she has a crush on hiding from the rain, and finally speaks to him.",
    "a rainy night in the 2000s": "ภาษาอังกฤษ เช่น a rainy night in the 2000s",
    "Name, e.g. Mali": "ชื่อ เช่น Mali",
    "Who they are, e.g. a shy Thai student, 20, in a school uniform": "เป็นใคร (ภาษาอังกฤษ) เช่น a shy Thai student, 20, in a school uniform",
    "Voice, e.g. a soft, nervous young woman's voice": "น้ำเสียง (ภาษาอังกฤษ) เช่น a soft, nervous young woman's voice",
    "what the place is, e.g. a street-food stall under a tin roof": "ที่นี่คืออะไร (ภาษาอังกฤษ) เช่น a street-food stall under a tin roof",
    "@Mali runs into the rain-soaked alley and stops when she sees @Ken": "ภาษาอังกฤษ เช่น @Mali runs into the rain-soaked alley and stops when she sees @Ken",
    "what happens, in English; @Name for a character": "เกิดอะไรขึ้น (ภาษาอังกฤษ) ใช้ @ชื่อ แทนตัวละคร",
    "what they say, Thai or English": "บทพูด ภาษาไทยหรืออังกฤษ",
  };

  const KEY = "aiangel.lang";
  let lang = (navigator.language || "").startsWith("th") ? "th" : "en";
  try {
    lang = localStorage.getItem(KEY) || lang;
  } catch { /* private window: the default stands, and the button still works for this visit */ }

  const EN = new Map();          // node -> its English text, so switching back is lossless
  const PH_EN = new Map();
  let busy = false;              // our own writes must not re-trigger the observer

  // the log box is raw machine output; the prompt box holds the composed prompt, which is left
  // alone by exact matching anyway — its one English sentence before a clip is written is in
  // the dictionary, so it is not skipped
  // — and a mention editor holds what the user typed, which must never be rewritten under their
  // caret (its placeholder is still translated)
  const SKIP = "pre#logBox, script, style, .mention-box";

  function translateText(node) {
    const english = EN.get(node) ?? node.nodeValue;
    const raw = english.trim();
    // HTML wraps a long sentence over several lines; the dictionary is written on one
    const key = raw.replace(/\s+/g, " ");
    if (!key) return;
    let thai;
    for (const [selector, dict] of SCOPED) {
      if (node.parentElement && node.parentElement.closest(selector) && dict[key]) {
        thai = dict[key];
        break;
      }
    }
    thai = thai || TH[key];
    if (!thai) {
      for (const [re, template] of PATTERNS) {
        if (re.test(key)) {
          thai = key.replace(re, template);
          break;
        }
      }
    }
    if (!thai) return;
    EN.set(node, english);
    const next = english.replace(raw, lang === "th" ? thai : raw);
    // writing the same value still counts as a mutation, and the observer would hand it
    // straight back — so an unchanged node is left alone
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translatePlaceholder(el) {
    const english = PH_EN.get(el) ?? el.getAttribute("placeholder");
    if (!english) return;
    const th = PH[english.trim()] || TH[english.trim()];
    if (!th) return;
    PH_EN.set(el, english);
    const next = lang === "th" ? th : english;
    if (el.getAttribute("placeholder") !== next) el.setAttribute("placeholder", next);
  }

  /* A sentence broken up by inline markup (<span class="mono">MODELS</span>) is several text
     nodes, none of which matches a dictionary entry on its own. For a short list of prose
     elements, the whole element's text is looked up instead, and the Thai replaces its contents.
     The original markup is kept so switching back to English restores it exactly. */
  const MIXED = "p.sub, span.hint, p.small";
  const HTML_EN = new Map();

  function translateMixed(el) {
    // plain text is the text walker's job — but an element we have already replaced has no
    // markup left, and still has to be able to switch back
    if (!el.firstElementChild && !HTML_EN.has(el)) return;
    const english = HTML_EN.get(el) ?? el.innerHTML;
    const key = (el.textContent || "").trim().replace(/\s+/g, " ");
    const thai = TH[key];
    if (!thai && !HTML_EN.has(el)) return;
    HTML_EN.set(el, english);
    const next = lang === "th" && thai ? thai : english;
    if (el.innerHTML !== next) el.innerHTML = next;
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches("[placeholder]")) translatePlaceholder(root);
    if (root.closest(SKIP)) return;
    root.querySelectorAll("[placeholder]").forEach(translatePlaceholder);
    if (root.matches(MIXED)) translateMixed(root);
    root.querySelectorAll(MIXED).forEach(translateMixed);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && n.parentElement.closest(SKIP)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
    texts.forEach(translateText);
  }

  function apply() {
    busy = true;
    document.documentElement.lang = lang;
    walk(document.body);
    const btn = document.getElementById("langToggle");
    if (btn) btn.textContent = lang === "th" ? "EN" : "ไทย";
    busy = false;
  }

  function toggle() {
    lang = lang === "th" ? "en" : "th";
    try { localStorage.setItem(KEY, lang); } catch { /* private window */ }
    apply();
  }

  function start() {
    const bar = document.querySelector(".bar");
    if (bar) {
      const btn = document.createElement("button");
      btn.id = "langToggle";
      btn.className = "btn ghost lang";
      btn.type = "button";
      btn.title = "ภาษาไทย / English";
      btn.addEventListener("click", toggle);
      bar.insertBefore(btn, bar.querySelector(".open-comfy"));
    }
    apply();
    // the dashboard re-renders on every poll; translate whatever it just drew
    new MutationObserver((records) => {
      if (busy) return;
      busy = true;
      for (const r of records) {
        for (const node of r.addedNodes) walk(node);
        if (r.type === "characterData") translateText(r.target);
      }
      busy = false;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
