# Shopee ComfyPod: RunPod template

**Shopee ComfyPod** is the [AI Angel ComfyPod](https://www.thepexcel.com/aiangel-comfypod/) image with two
dashboard tabs added:

- **Shopee**: product, presenter, Thai script, batch and doodle pop-ups for affiliate clips.
- **Story**: a story told scene by scene. Characters (a photo keeps a face the same in every
  scene), where and when, then each shot's camera, action and dialogue. A scene can take a grey
  **blocking render from Blender**, which H3 gets as `<Video 1>` and follows for the camera
  movement, framing and cuts, and optionally where the characters stand and move.

Everything else is the original image (`BASE_IMAGE`, pinned to `d0aaacd`), except two backend
files the Story tab needs (see below).

- **The website** is in the image, so it is there as soon as the pod starts (port 8189).
- **The models** download when the pod starts, from the presets in `MODELS`, onto the volume.
  They are not in the image, the same as the original template.

## How the image is built

Every push to `main` runs `.github/workflows/build-image.yml`. It appends `dashboard/web/` and
`backend/opt/` as one small layer on top of the base image and pushes
`ghcr.io/<your-github-user>/<this-repo>:latest`. The base is not unpacked, so a build takes a
few minutes. Watch it under **Actions**.

To change the website: edit the files, then commit and push. `update-web.sh` copies them over
from `../aiangel-pod/dashboard/web/`, and refuses when that folder is behind this repo (it would
delete the Story tab). A pod picks up the new image the next time it is created or restarted.

### The backend patch (`backend/`)

The upstream server only takes pictures, so the Story tab's blocking video needs two files
replaced in the image:

| File in the image | Change |
|---|---|
| `/opt/aiangel/dashboard/server.py` | the upload route also takes `.mp4 .mov .webm .mkv` (up to 200 MB, streamed to disk); a clip request takes `ref_videos` (up to 3); a free-prompt clip can carry its own queue `label` |
| `/opt/comfyui/custom_nodes.baked/ComfyUI-AiAngel/h3_workflows.py` | each reference video goes `LoadVideo` → cut to the clip's frame count → fitted to the clip's size → `MiniMaxH3ReferenceToVideo`'s `ref_videos` slot |

A clip without a video builds exactly the same graph as before. `backend/original/` holds the
untouched files from `BASE_IMAGE`: `diff -u backend/original/server.py
backend/opt/aiangel/dashboard/server.py` shows the whole patch, and the build stops if the base
image's files ever differ from them.

## RunPod template settings

RunPod → **Templates** → **New Template**:

| Field | Value |
|---|---|
| Template name | Shopee ComfyPod |
| Template type | Pod |
| Container image | `ghcr.io/<your-github-user>/<this-repo>:latest` |
| Container registry credentials | only if the GitHub package is private (see below) |
| Container disk | 30 GB |
| Volume disk | 100 GB (about 64 GB of models, plus room for clips; it cannot grow later) |
| Volume mount path | `/workspace` |
| Expose HTTP ports | `8188,8080,8888,8189` |
| Expose TCP ports | `22` |
| Environment variable | `MODELS` = `h3core,aiangelh3,qwen21,h3fast` (the image already defaults to this; listing it keeps it visible) |

Everything except the image, volume size and `MODELS` matches the original template.

### MODELS: what downloads at boot

Only what the Shopee tab uses (`MODELS` file, also baked into the image as its default). Presets
download in the order listed, so clips work before the image model arrives.

| Preset | Size | Needed for |
|---|---|---|
| `h3core` | 21.5 GB | clips (text encoder and VAEs) |
| `aiangelh3` | 21.8 GB | clips (the AiAngelH3 video model) |
| `qwen21` | 17.6 GB | **Make a cover image** |
| `h3fast` | 3.5 GB | the **Fast** toggle |

Not included: `h3upscaler` (0.7 GB, only the Create tab's "Make it 720p"; the Shopee tab renders
720p natively), and SCAIL, Krea 2 and the H3 extras. Any of them can be added from the
dashboard's Models tab without a restart, or put in the template's `MODELS`.

### Private or public package

GitHub makes a new package **private**. Either:

- **Keep it private** (recommended: the dashboard and image are ThepExcel's work). In RunPod go
  to **Settings → Container Registry Auth → Add**, with registry `ghcr.io`, your GitHub user
  name, and a GitHub token (classic) with only the `read:packages` scope. Then pick that
  credential in the template.
- **Make it public**: GitHub → your profile → Packages → this package → Package settings →
  Change visibility. No RunPod credentials are needed then.

## Deploying a pod

Same as the original template: a **CUDA 13.0+** host with **32 GB+ VRAM** (H3 needs it), on NVMe.
Open **Connect → 8189** for the dashboard. It shows the boot and the model downloads. **Shopee**
is the third tab and **Story** the fourth. When you are done, download your clips, then **Stop** and
**Terminate**.

## Story tab: write on your PC, run on the pod

A story is kept in the browser of the address it was made on, so the PC and the pod do not share
it. To prepare everything before the pod is up:

1. On your PC, serve `dashboard/web/` and open `index.html?demo#story`:
   `python -m http.server 8765` in that folder, then http://127.0.0.1:8765/index.html?demo#story.
   Demo mode runs no models, but every field, photo and blocking video works.
2. Write the story: characters, scenes, shots, dialogue, blocking videos, takes, 720p/Fast.
3. **Export story** saves one `<title>.story.zip`:

   | In the zip | What it is |
   |---|---|
   | `story.json` | all the text and settings; photos and videos are named by their path |
   | `photos/` | each character's photo and the place, full size when picked in that session |
   | `videos/` | each blocking video added in that browser session |
   | `prompts/` | the prompt H3 gets for each scene, to read (import ignores it) |

   You can unzip it, swap a photo or video for another with the same name, and zip it again.
4. On the pod, open the Story tab and **Import story** (or drop the zip on the form). The photos
   and videos upload, and it asks to queue every scene. An older `.story.json` imports too.
5. If the pod is still booting or downloading models, the tab waits and queues the scenes by itself
   as soon as the pod accepts them (it retries every 20 s). Keep the tab open; **Stop waiting**
   cancels.

Scenes run in the Queue one after another, each with its takes.

## Story tab: start and end frames

Each scene can be given the picture it **opens on** and the picture it **ends on**. They go to
the pod as pinned frames (frame 0 and the last frame), the same mechanism as the Create tab's
pinned frames, so H3 starts and finishes the clip on exactly those pictures. Either one, both or
neither: an empty slot leaves that end of the shot to H3. A picture of another shape is cut to the
clip's shape around its centre, as the slot shows. "Use scene N's last frame" starts a scene
exactly where the previous one ends, for continuity across clips. Frames travel in the
`.story.zip` (`photos/scene-N-start-frame…`).

## Story tab: blocking videos from Blender

1. Block the scene with simple shapes or mannequins, give each character its own colour, and
   animate the camera.
2. Render at **24 fps**, at the scene's shape (576×1024, 1024×576 or 768×768) and length, as an
   H.264 MP4. The tab's "How to render it in Blender" box has a script that sets all of this up.
3. Add the MP4 to the scene (or drop it on the form) and pick what H3 follows: **Camera only**,
   **Camera + blocking**, or **Loose timing**. "Fit shots to the video" makes the shots add up to
   the video's length.

The video is cut to the scene's length and cropped to its shape on the pod. It is a reference,
not a control signal: H3 follows it the way its prompt guide describes reference videos, so
expect the camera and the timing to carry over, not every pose. The story is kept in the browser.
A blocking video is not, so on a new pod add it again.

## Updating to a newer AI Angel image

`BASE_IMAGE` is pinned on purpose: the tabs replace `app.js` and `index.html`, and `backend/`
replaces two server files, so a newer upstream image could change things under them. To move
up, put the new digest in `BASE_IMAGE`, merge the upstream changes into `dashboard/web/`, re-apply
the `backend/` patch to the new files (and copy them to `backend/original/`), test, and push.
