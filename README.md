# Shopee ComfyPod: RunPod template

**Shopee ComfyPod** is the [AI Angel ComfyPod](https://www.thepexcel.com/aiangel-comfypod/) image with the
dashboard's **Shopee** tab added. The tab has the product, presenter, Thai script, batch and
doodle pop-up features. Everything else is the original image (`BASE_IMAGE`, pinned to
`d0aaacd`), unchanged.

- **The website** is in the image, so it is there as soon as the pod starts (port 8189).
- **The models** download when the pod starts, from the presets in `MODELS`, onto the volume.
  They are not in the image, the same as the original template.

## How the image is built

Every push to `main` runs `.github/workflows/build-image.yml`. It appends `dashboard/web/` as
one small layer on top of the base image and pushes
`ghcr.io/<your-github-user>/<this-repo>:latest`. The base is not downloaded, so a build takes
about a minute. Watch it under **Actions**.

To change the website: edit the files (or copy them over from
`../aiangel-pod/dashboard/web/` with `update-web.sh`), then commit and push. A pod picks up the
new image the next time it is created or restarted.

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
Open **Connect → 8189** for the dashboard. It shows the boot and the model downloads, and the
**Shopee** tab is the third tab. When you are done, download your clips, then **Stop** and
**Terminate**.

## Updating to a newer AI Angel image

`BASE_IMAGE` is pinned on purpose: the Shopee tab replaces `app.js` and `index.html`, so a newer
upstream image could change the server under them. To move up, put the new digest in
`BASE_IMAGE`, merge the upstream changes into `dashboard/web/`, test, and push.
