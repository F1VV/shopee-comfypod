"""AI Angel Dashboard — standalone status/control server for the pod, port 8189.

Run with `python3.12 /opt/aiangel/dashboard/server.py`. Started by docker/start.sh BEFORE
ComfyUI, so it answers while ComfyUI is booting, crashed or restarting. HTTP contract:
docs/dashboard-api.md.

Reuses fetch.py / outputs.py from the ComfyUI-AiAngel node (loaded from AIANGEL_NODE_DIR)
instead of duplicating the download resolver, the output lister and the ZIP streamer. Those
two modules have no ComfyUI imports, so they load standalone here and in the tests.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import random
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from queue import Queue

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

SITES = ("civitai", "huggingface")
ENV_TOKEN_NAMES = {"civitai": "CIVITAI_TOKEN", "huggingface": "HF_TOKEN"}
ELASTIC_DISK_BYTES = 1 << 50  # 1 PiB: what an elastic (Global) volume reports as its size


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _node_dir() -> Path:
    default = "/opt/comfyui/custom_nodes.baked/ComfyUI-AiAngel"
    return Path(os.environ.get("AIANGEL_NODE_DIR", default))


_NODE = _node_dir()
fetch = _load_module("aiangel_dashboard_fetch", _NODE / "fetch.py")
outputs = _load_module("aiangel_dashboard_outputs", _NODE / "outputs.py")
prompt_build = _load_module("aiangel_dashboard_prompt_build", _NODE / "prompt_build.py")
h3_workflows = _load_module("aiangel_dashboard_h3_workflows", _NODE / "h3_workflows.py")
image_workflows = _load_module("aiangel_dashboard_image_workflows", _NODE / "image_workflows.py")
recipe = _load_module("aiangel_dashboard_recipe", _NODE / "recipe.py")

# ComfyUI sends a prompt's live progress only to the websocket of the client id it was queued
# with, so every job this dashboard queues carries this one id and the listener connects as it.
DASHBOARD_CLIENT_ID = f"aiangel-dashboard-{uuid.uuid4().hex}"


# ---------------------------------------------------------------------------
# small helpers shared by several routes
# ---------------------------------------------------------------------------


def _written_bytes(path: Path) -> int:
    """Bytes actually on disk, not the file's apparent length while a multi-connection
    downloader has pre-allocated the tail.

    Allocated blocks alone are NOT enough. aria2c (16 connections) pre-allocates with fallocate,
    which fills in the block count too, so a file one second into its download measures complete —
    on a pod 2026-09-20 the Create form unlocked while the text encoder was still arriving and
    ComfyUI read a half-written file (`JSONDecodeError` out of its quantization metadata).

    aria2 keeps a `<file>.aria2` control file beside the download and deletes it only when the
    file is finished, so that is the question to ask: while it exists, nothing is complete,
    whatever the size says."""
    if not path.exists():
        return 0
    for marker in (".aria2", ".aria2__temp"):
        if path.with_name(path.name + marker).exists():
            return 0
    st = path.stat()
    blocks = getattr(st, "st_blocks", None)
    return min(st.st_size, blocks * 512) if blocks else st.st_size


def _mask(value: str | None) -> str | None:
    return None if not value else f"{value[:4]}…{value[-4:]}"


def _read_secret(path: Path) -> str | None:
    if path.is_file():
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    return None


class SizeTracker:
    """Tells a file that is actively growing apart from a stalled partial one, without waiting
    30 real seconds inside a request: it remembers, per file, the last observed byte count and
    the instant it last grew, so 'downloading' can be read from two polls instead of a sleep."""

    def __init__(self) -> None:
        self._seen: dict[str, tuple[int, float]] = {}

    def note(self, path: Path, size: int, now: float) -> float:
        key = str(path)
        last_size, last_growth = self._seen.get(key, (size, now))
        if size > last_size:
            last_growth = now
        self._seen[key] = (size, last_growth)
        return last_growth


class Cached:
    """Wraps a slow probe (nvidia-smi) so repeated /api/state polls do not each pay its cost."""

    def __init__(self, fn: Callable[[], dict], ttl: float = 2.0) -> None:
        self._fn = fn
        self._ttl = ttl
        self._at = 0.0
        self._val: dict = {}

    def __call__(self) -> dict:
        now = time.time()
        if now - self._at > self._ttl:
            self._val = self._fn()
            self._at = now
        return self._val


# ---------------------------------------------------------------------------
# process / hardware probes (each overridable in tests so nothing real is touched there)
# ---------------------------------------------------------------------------


def _nvidia_smi_stats() -> dict:
    try:
        p = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.used,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if p.returncode != 0 or not p.stdout.strip():
            return {}
        name, used, total, util = (part.strip() for part in p.stdout.splitlines()[0].split(","))
        return {"name": name, "used_mb": int(used), "total_mb": int(total), "util": int(util)}
    except Exception:
        return {}


def _find_comfy_pids(proc_root: Path = Path("/proc")) -> list[int]:
    pids = []
    if not proc_root.is_dir():
        return pids
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry / "cmdline").read_bytes()
        except OSError:
            continue
        parts = [p.decode(errors="replace") for p in raw.split(b"\x00") if p]
        if any("main.py" in p for p in parts) and any("8188" in p for p in parts):
            pids.append(int(entry.name))
    return pids


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _comfy_state() -> str:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=0.5) as r:
            if r.status == 200:
                return "ready"
    except Exception:
        pass
    return "starting" if _find_comfy_pids() else "down"


def _comfy_submit(graph: dict) -> tuple[str | None, str | None]:
    """POST one API-format graph to ComfyUI's queue. Same endpoint and body shape as
    docker/handler.py's `_post("/prompt", ...)`, returning (prompt_id, error) instead of raising
    so a route can turn a rejection into a readable message rather than a 500."""
    req = urllib.request.Request(
        "http://127.0.0.1:8188/prompt",
        data=json.dumps({"prompt": graph, "client_id": DASHBOARD_CLIENT_ID}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:2000]
        message = None
        try:
            err = json.loads(body).get("error")
            message = err.get("message") if isinstance(err, dict) else (str(err) if err else None)
        except Exception:
            pass
        return None, message or f"ComfyUI rejected the prompt: {body[:300]}"
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return None, f"ComfyUI is not reachable: {e}"
    prompt_id = data.get("prompt_id")
    return (prompt_id, None) if prompt_id else (None, "ComfyUI did not return a prompt id")


def _comfy_cancel(prompt_ids: list[str], *, running: bool) -> str | None:
    """Take jobs out of ComfyUI's queue, and interrupt the one it is rendering.

    Two different things, which is why the caller says which it wants: `POST /queue {"delete": …}`
    drops jobs that have not started, and `POST /interrupt` stops the one in the sampler — a job
    already running is not in the pending list and cannot be deleted, it can only be interrupted.
    Returns an error message, or None when everything asked for went through."""
    try:
        if prompt_ids:
            req = urllib.request.Request(
                "http://127.0.0.1:8188/queue",
                data=json.dumps({"delete": prompt_ids}).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10).close()
        if running:
            req = urllib.request.Request(
                "http://127.0.0.1:8188/interrupt",
                data=json.dumps({"client_id": DASHBOARD_CLIENT_ID}).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10).close()
    except urllib.error.HTTPError as e:
        return f"ComfyUI refused the cancel: HTTP {e.code}"
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return f"ComfyUI is not reachable: {e}"
    return None


def _comfy_history(prompt_id: str) -> dict | None:
    """This prompt's entry from ComfyUI's /history, same endpoint docker/handler.py polls; None
    while ComfyUI has not recorded it yet (still queued or running)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}", timeout=5) as r:
            data = json.load(r)
    except Exception:
        return None
    return data.get(prompt_id)


def _comfy_queue() -> set[str] | None:
    """Prompt ids ComfyUI still holds (running or pending), or None when it cannot be asked. A
    job in neither the queue nor /history was dropped, e.g. by a ComfyUI restart."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as r:
            data = json.load(r)
    except Exception:
        return None
    ids = set()
    for key in ("queue_running", "queue_pending"):
        for item in data.get(key) or []:
            if isinstance(item, list) and len(item) > 1:
                ids.add(str(item[1]))
    return ids


def _tcp_ready(port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# config: every path and every swappable probe, built fresh per app instance
# ---------------------------------------------------------------------------


@dataclass
class Config:
    data_dir: Path
    models_dir: Path
    presets_file: Path
    nsfw_file: Path
    extras_file: Path
    web_dir: Path
    comfy_dir: Path
    image_version_file: Path
    models_env: str
    start_time: float
    gpu_stats_fn: Callable[[], dict]
    comfy_state_fn: Callable[[], str]
    tcp_ready_fn: Callable[[int], bool]
    resolve_fn: Callable
    download_fn: Callable
    now_fn: Callable[[], float]
    comfy_submit_fn: Callable[[dict], tuple]
    comfy_history_fn: Callable[[str], dict | None]
    comfy_queue_fn: Callable[[], set | None] = lambda: None
    comfy_cancel_fn: Callable[..., str | None] = lambda ids, running=False: None
    progress_ws: bool = True
    jobs: list = field(default_factory=list)
    jobs_lock: threading.Lock = field(default_factory=threading.Lock)
    download_queue: Queue = field(default_factory=Queue)
    size_tracker: SizeTracker = field(default_factory=SizeTracker)
    # clips and images queued from Create, oldest first; ComfyUI runs them one at a time
    # {path: ((size, mtime_ns), family)} — reading a LoRA's header is cheap but the browser asks
    # for the list on every poll, so the answer is remembered until the file itself changes
    lora_family_cache: dict = field(default_factory=dict)
    gen_jobs: list = field(default_factory=list)
    gen_lock: threading.Lock = field(default_factory=threading.Lock)
    # prompt_id -> live progress from ComfyUI's websocket
    progress: dict = field(default_factory=dict)

    @property
    def secrets_dir(self) -> Path:
        return self.data_dir / ".secrets"

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"

    def output_dir(self) -> Path:
        return self.data_dir / "output"

    def input_dir(self) -> Path:
        return self.data_dir / "input"

    def cuda_version(self) -> str | None:
        v = os.environ.get("CUDA_VERSION")
        if v:
            return v
        try:
            import torch  # optional: not installed in the dev/test environment

            return torch.version.cuda
        except Exception:
            return None

    def image_version(self) -> str | None:
        """The template's release number (`docker/VERSION`, "1.00"), plus " dev" on a :dev build."""
        try:
            return self.image_version_file.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def image_commit(self) -> str | None:
        """The git sha the image was built from — for our pod tests; the page never shows it."""
        try:
            path = self.image_version_file.with_name("image-commit")
            return path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def disk_usage(self) -> dict:
        def one(path) -> dict:
            try:
                u = shutil.disk_usage(path)
            except OSError:
                return {"used": None, "total": None}
            # RunPod reports 0 used of 1 PiB here on a Global volume and also on a pod with no
            # volume at all (seen 2026-09-16), so "free space" would be a made-up number.
            if u.total >= ELASTIC_DISK_BYTES:
                return {"used": None, "total": None, "elastic": True}
            return {"used": u.used, "total": u.total}

        return {"workspace": one(self.data_dir), "container": one("/")}

    @classmethod
    def from_env(cls, **overrides) -> Config:
        data_dir = Path(os.environ.get("DATA_DIR", "/workspace/aiangel"))
        default_web_dir = Path(__file__).resolve().parent / "web"
        cfg = cls(
            data_dir=data_dir,
            models_dir=Path(os.environ.get("MODELS_DIR", str(data_dir / "models"))),
            presets_file=Path(os.environ.get("PRESETS_FILE", "/opt/aiangel/models.tsv")),
            nsfw_file=Path(os.environ.get("AIANGEL_NSFW_KIT", "/opt/aiangel/nsfw.txt")),
            extras_file=Path(os.environ.get("AIANGEL_EXTRAS_LIST", "/opt/aiangel/extras.txt")),
            web_dir=Path(os.environ.get("AIANGEL_DASHBOARD_WEB_DIR", str(default_web_dir))),
            comfy_dir=Path(os.environ.get("AIANGEL_COMFY_DIR", "/opt/comfyui")),
            image_version_file=Path(
                os.environ.get("AIANGEL_IMAGE_VERSION_FILE", "/opt/aiangel/image-version")
            ),
            models_env=os.environ.get("MODELS", ""),
            start_time=time.time(),
            gpu_stats_fn=Cached(_nvidia_smi_stats),
            comfy_state_fn=_comfy_state,
            tcp_ready_fn=_tcp_ready,
            resolve_fn=fetch.resolve,
            download_fn=fetch.download,
            now_fn=time.time,
            comfy_submit_fn=_comfy_submit,
            comfy_history_fn=_comfy_history,
            comfy_queue_fn=_comfy_queue,
            comfy_cancel_fn=_comfy_cancel,
        )
        for key, value in overrides.items():
            setattr(cfg, key, value)
        worker = threading.Thread(
            target=_worker, name="aiangel-dashboard-downloads", args=(cfg,), daemon=True
        )
        worker.start()
        return cfg


def _token(cfg: Config, site: str) -> str | None:
    f = cfg.secrets_dir / f"{site}_token"
    if f.is_file():
        value = f.read_text(encoding="utf-8").strip()
        if value:
            return value
    return os.environ.get(ENV_TOKEN_NAMES[site]) or None


def _worker(cfg: Config) -> None:
    while True:
        job = cfg.download_queue.get()
        try:
            if not job.get("name"):
                job["state"] = "resolving"
                tokens = {site: _token(cfg, site) for site in SITES}
                resolved = cfg.resolve_fn(
                    job.get("folder_hint"), job["url"], job.get("file_part"), tokens
                )
                job.update(resolved)
            job["state"] = "downloading"
            tokens = {site: _token(cfg, site) for site in SITES}
            ok, msg = cfg.download_fn(job, cfg.models_dir, tokens)
            job["state"] = "done" if ok else "failed"
            job["message"] = msg
        except Exception as e:  # keep the worker alive, show the reason in the panel
            job["state"] = "failed"
            job["message"] = str(e)[:300]
        finally:
            cfg.download_queue.task_done()


# ---------------------------------------------------------------------------
# preset / file-state computation (pure, so it is testable without real downloads or sleeps)
# ---------------------------------------------------------------------------


def _preset_rows(presets_file: Path) -> list[tuple[list[str], str, str, int, str]]:
    rows = []
    if not presets_file.is_file():
        return rows
    for line in presets_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        preset, sub, name, size, url = line.split("\t")
        rows.append((preset.split(","), sub, name, int(size), url))
    return rows


def _in_env(name: str, models_env: str) -> bool:
    wanted = {p for p in models_env.replace(" ", "").split(",") if p}
    return name in wanted or "all" in wanted


def compute_file_state(
    path: Path, expected_size: int, tracker: SizeTracker, now: float, job_state: str | None
) -> tuple[str, int]:
    have = _written_bytes(path)
    if have >= expected_size > 0:
        return "have", have
    if job_state == "queued":
        return "queued", have
    if job_state in ("resolving", "downloading"):
        return "downloading", have
    if have > 0:
        last_growth = tracker.note(path, have, now)
        if now - last_growth <= 30:
            return "downloading", have
        return ("failed" if job_state == "failed" else "missing"), have
    return ("failed" if job_state == "failed" else "missing"), 0


def boot_download_running(cfg: Config) -> bool:
    """Is start.sh's own model download still going?

    download_models.sh deletes both markers when it starts and touches one when it ends, so
    neither being there means it is still working — or that it was never asked to run, which is
    why MODELS being empty answers no before the markers are looked at.

    This matters because the boot script fetches files one at a time: a file still waiting its
    turn is 0 bytes and not growing, which is indistinguishable from a file nobody asked for.
    Without this, the Create tab told the owner "making an image needs krea2 · 242 MB" — the
    exact size of the one krea2 file whose turn had not come — and offered a Download button
    that would have raced the boot script for the same file (owner, 2026-09-18).
    """
    if not cfg.models_env.strip():
        return False
    return not (
        (cfg.models_dir / ".aiangel-download-done").exists()
        or (cfg.models_dir / ".aiangel-download-failed").exists()
    )


def _preset_summaries(cfg: Config, jobs: list[dict], now: float) -> list[dict]:
    order: list[str] = []
    files_by_preset: dict[str, list[tuple[str, str, int, str]]] = {}
    for presets, sub, name, size, url in _preset_rows(cfg.presets_file):
        for p in presets:
            if p not in files_by_preset:
                files_by_preset[p] = []
                order.append(p)
            files_by_preset[p].append((sub, name, size, url))
    job_state_by_target = {
        (job["folder"], job["name"]): job["state"]
        for job in jobs
        if job.get("folder") and job.get("name")
    }
    summaries = []
    booting = boot_download_running(cfg)
    for name in order:
        files = []
        in_env = _in_env(name, cfg.models_env)
        for sub, fname, size, _url in files_by_preset[name]:
            path = cfg.models_dir / sub / fname
            state, have = compute_file_state(
                path, size, cfg.size_tracker, now, job_state_by_target.get((sub, fname))
            )
            # a MODELS file the boot script has not reached yet is on its way, not absent
            if state == "missing" and in_env and booting:
                state = "queued"
            files.append(
                {"folder": sub, "name": fname, "size": size, "have_bytes": have, "state": state}
            )
        summaries.append({"name": name, "in_env": in_env, "files": files})
    return summaries


BEGINNER_REQUIRED_PRESETS = ("h3core", "aiangelh3")  # what h3_workflows.AIANGEL actually loads
FAST_PRESET = "h3fast"  # h3_workflows.FAST_LORAS
IMAGE_MODES = ("t2i", "edit")
# The file each family's preset downloads: always offered, so picking one is how a user asks for
# it. Qwen Image 2.1 leads because it is what the template now downloads (owner 2026-09-20).
STOCK_UNETS = (image_workflows.QWEN21_UNET, image_workflows.UNET)
DEFAULT_IMAGE_UNET = image_workflows.QWEN21_UNET
# what the form opens on, and so what an un-suffixed "needs" answer is about
DEFAULT_IMAGE_FAMILY = image_workflows.family_of(DEFAULT_IMAGE_UNET)
# What each image mode loads, per model family (image_workflows.FAMILY_PRESETS): Krea 2 needs its
# own identity LoRA to edit, Qwen Image 2.1 does both jobs from the one preset.
IMAGE_PRESETS = image_workflows.FAMILY_PRESETS


def _image_needs(cfg: Config) -> dict[str, list[str]]:
    """For each image mode, the presets still missing — per family, plus the old un-suffixed key.

    That key is empty as soon as EITHER family can run, and otherwise names what the form's own
    default model needs — the form opens on Krea 2, so that is the answer to "what do I download
    to make this work" for someone who has not touched the model row. The form reads the
    per-family keys to decide what a particular model choice still needs."""
    defined = _preset_names(cfg)
    out: dict[str, list[str]] = {}
    for mode in IMAGE_MODES:
        per = {}
        for family, modes in IMAGE_PRESETS.items():
            required = modes[mode]
            # A family whose preset this image does not define at all can never run here — an
            # older image has no `qwen21` rows, and with no rows there is nothing to find
            # incomplete, which would otherwise read as ready.
            unknown = [p for p in required if p not in defined]
            per[family] = unknown or _missing_presets(cfg, required)
            out[f"image_{mode}_{family}"] = per[family]
        out[f"image_{mode}"] = [] if any(not m for m in per.values()) else per[DEFAULT_IMAGE_FAMILY]
    return out


# 720p = the H3 latent upscaler at x1.25 plus a 3-step refine, run in the same job as sampling.
# With the same prompt, refs and seed it reproduces the 576p clip shot for shot at 704x1280, so
# "make this 720p" is a re-run, not a post-process (measured 2026-09-15; x1.875 runs out of memory
# on a 96 GB card for a 10 s clip).
UPSCALE_720P = 1.25
# The 720p checkbox renders natively at this size instead (owner 2026-09-17, after a side-by-side:
# native 720p looked best). 147 s vs 135 s for the upscale route on a 10 s two-person clip, but it
# is a different clip from the 576p one, so "Make it 720p" on a finished clip keeps the upscale.
NATIVE_720P = (704, 1280)
UPSCALER_NODE_DIR = "custom_nodes/comfyui-minimax-h3-latent-upscaler"  # where start.sh puts it


def _upscale_ready(cfg: Config) -> bool:
    """The upscaler needs both its model file and its node code, and start.sh fetches the node
    only when MODELS carried h3upscaler at boot — so a model added later is not enough."""
    if not (cfg.data_dir / UPSCALER_NODE_DIR).is_dir():
        return False
    rows = [r for r in _preset_rows(cfg.presets_file) if "h3upscaler" in r[0]]
    return bool(rows) and all(
        _written_bytes(cfg.models_dir / sub / name) >= size for _p, sub, name, size, _u in rows
    )


def _missing_beginner_presets(cfg: Config) -> list[str]:
    return _missing_presets(cfg, BEGINNER_REQUIRED_PRESETS)


def _missing_presets(cfg: Config, required) -> list[str]:
    """Which of the required presets still have an incomplete file, so a start request can say
    WHICH is missing instead of a bare 'models not ready'."""
    missing: list[str] = []
    for presets, sub, name, size, _url in _preset_rows(cfg.presets_file):
        wanted = [p for p in presets if p in required]
        if not wanted:
            continue
        if _written_bytes(cfg.models_dir / sub / name) < size:
            for p in wanted:
                if p not in missing:
                    missing.append(p)
    return missing


def _preset_names(cfg: Config) -> set[str]:
    """Every preset this pod's models.tsv defines."""
    return {p for presets, *_ in _preset_rows(cfg.presets_file) for p in presets}


def _outputs_summary(output_dir: Path) -> dict:
    files = outputs.list_outputs(output_dir)
    return {"count": len(files), "bytes": sum(f["size"] for f in files)}


def _job_view(job: dict, cfg: Config) -> dict:
    view = {
        "id": job["id"],
        "label": f"{job['folder']}/{job['name']}" if job.get("name") else job["url"],
        "url": job["url"],
        "state": job["state"],
        "size": job.get("size"),
        "message": job.get("message"),
        "done_bytes": 0,
    }
    if job.get("state") == "downloading" and job.get("name"):
        part = fetch.partial_path(job, cfg.models_dir)
        view["done_bytes"] = _written_bytes(part)
    elif job.get("state") == "done":
        view["done_bytes"] = job.get("size") or 0
    return view


def _service_url(request: web.Request, port: int) -> str:
    pod_id = os.environ.get("RUNPOD_POD_ID")
    if pod_id:
        return f"https://{pod_id}-{port}.proxy.runpod.net/"
    return f"http://{request.url.host}:{port}/"


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------


async def get_state(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    now = cfg.now_fn()
    with cfg.jobs_lock:
        jobs = [dict(j) for j in cfg.jobs]
    gpu = cfg.gpu_stats_fn()
    pod = {
        "id": os.environ.get("RUNPOD_POD_ID") or None,
        "gpu": gpu.get("name"),
        "vram_used_mb": gpu.get("used_mb"),
        "vram_total_mb": gpu.get("total_mb"),
        "gpu_util": gpu.get("util"),
        "cuda": cfg.cuda_version(),
        "image": cfg.image_version(),
        "commit": cfg.image_commit(),
        "uptime_s": int(now - cfg.start_time),
        "disk": cfg.disk_usage(),
    }
    services = [
        {
            "key": "comfyui",
            "name": "ComfyUI",
            "port": 8188,
            "url": _service_url(request, 8188),
            "state": cfg.comfy_state_fn(),
        },
        {
            "key": "filebrowser",
            "name": "FileBrowser",
            "port": 8080,
            "url": _service_url(request, 8080),
            "state": "ready" if cfg.tcp_ready_fn(8080) else "down",
            "user": "admin",
            "secret": _read_secret(cfg.secrets_dir / "filebrowser_password"),
        },
        {
            "key": "jupyter",
            "name": "JupyterLab",
            "port": 8888,
            "url": _service_url(request, 8888),
            "state": "ready" if cfg.tcp_ready_fn(8888) else "down",
            "secret": _read_secret(cfg.secrets_dir / "jupyter_password"),
        },
    ]
    body = {
        "pod": pod,
        "services": services,
        "models_env": cfg.models_env,
        "presets": _preset_summaries(cfg, jobs, now),
        "jobs": [_job_view(j, cfg) for j in jobs],
        "keys": {site: _mask(_token(cfg, site)) for site in SITES},
        "outputs": _outputs_summary(cfg.output_dir()),
        "upscale_ready": _upscale_ready(cfg),
        # which Create options can run now, and the presets each still needs when they cannot
        "needs": {
            "clip": _missing_beginner_presets(cfg),
            "fast": _missing_presets(cfg, (FAST_PRESET,)),
            **_image_needs(cfg),
        },
    }
    return web.json_response(body)


async def post_keys(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    body = await request.json()
    cfg.secrets_dir.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        value = str(body.get(site) or "").strip()
        f = cfg.secrets_dir / f"{site}_token"
        if value == "-":
            f.unlink(missing_ok=True)
        elif value:
            f.write_text(value, encoding="utf-8", newline="\n")
            try:
                f.chmod(0o600)
            except OSError:  # RunPod Global volumes refuse chmod; the key is saved anyway
                pass
    return web.json_response({site: _mask(_token(cfg, site)) for site in SITES})


async def post_download(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    body = await request.json()
    try:
        entries = fetch.parse_entries(str(body.get("text") or ""))
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    queued = []
    with cfg.jobs_lock:
        for folder, url, file_part in entries:
            job = {
                "id": len(cfg.jobs) + 1,
                "url": url,
                "folder_hint": folder,
                "file_part": file_part,
                "state": "queued",
                "folder": None,
                "name": None,
                "size": None,
                "message": None,
            }
            cfg.jobs.append(job)
            queued.append(job)
    for job in queued:
        cfg.download_queue.put(job)
    return web.json_response({"queued": len(queued)})


async def post_preset(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    body = await request.json()
    name = str(body.get("name") or "")
    # these two are link lists, not models.tsv presets: the browser fetches the text and posts it
    # to /api/download, because every row needs the user's own Civitai key
    if name in ("nsfw", "extras"):
        return web.json_response(
            {"error": f"{name} needs its list: GET /api/kit/{name}, then POST /api/download"},
            status=400,
        )
    rows = _preset_rows(cfg.presets_file)
    known = {p for presets, *_ in rows for p in presets}
    if name not in known:
        return web.json_response({"error": f"unknown preset: {name}"}, status=400)
    queued = []
    with cfg.jobs_lock:
        for presets, sub, fname, size, url in rows:
            if name not in presets:
                continue
            path = cfg.models_dir / sub / fname
            if _written_bytes(path) >= size:
                continue
            job = {
                "id": len(cfg.jobs) + 1,
                "url": url,
                "folder": sub,
                "name": fname,
                "size": size,
                "site": "huggingface",
                "state": "queued",
                "message": None,
            }
            cfg.jobs.append(job)
            queued.append(job)
    for job in queued:
        cfg.download_queue.put(job)
    return web.json_response({"queued": len(queued)})


async def get_nsfw_kit(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    if not cfg.nsfw_file.is_file():
        return web.json_response({"error": "no NSFW kit in this image"}, status=404)
    return web.json_response({"text": cfg.nsfw_file.read_text(encoding="utf-8")})


async def get_extras_list(request: web.Request) -> web.Response:
    """The extra Krea 2 image LoRAs. Nothing adult: these are here only because their authors
    forbid re-hosting, so they cannot ride along in the `krea2` preset the way the rest do."""
    cfg: Config = request.app["cfg"]
    if not cfg.extras_file.is_file():
        return web.json_response({"error": "no extras list in this image"}, status=404)
    return web.json_response({"text": cfg.extras_file.read_text(encoding="utf-8")})


def _in_flight_since(cfg: Config) -> float | None:
    """When the earliest job still in flight began, or None when nothing is running.

    ComfyUI writes a clip into the output folder as it saves it, so the file is there, and the
    right name, long before it holds a whole video. Anything newer than a running job belongs to
    that job and is not safe to hand out yet: a download taken then returns a few dozen bytes of
    mp4 header with no error at all, which reads as a corrupt clip rather than as too early.
    """
    with cfg.gen_lock:
        live = [j for j in cfg.gen_jobs if j["state"] in ("queued", "running")]
    if not live:
        return None
    return min(
        (cfg.progress.get(j["prompt_id"]) or {}).get("started") or j["created"] for j in live
    )


async def get_outputs(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    await asyncio.to_thread(_refresh_jobs, cfg)  # a job that just ended must not hide its own file
    files = await asyncio.to_thread(outputs.list_outputs, cfg.output_dir())
    since = _in_flight_since(cfg)
    if since is not None:
        files = [f for f in files if f["mtime"] < since]
    return web.json_response({"files": files, "output_dir": str(cfg.output_dir())})


async def get_outputs_file(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    rel = request.rel_url.query.get("path", "")
    try:
        files = outputs.safe_files(cfg.output_dir(), [rel])
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    path, arc = files[0]
    since = _in_flight_since(cfg)
    if since is not None and path.stat().st_mtime >= since:
        # a page that listed this file before the next job started would otherwise still get it
        return web.json_response({"error": "this file is still being written"}, status=409)
    headers = {}
    if request.rel_url.query.get("download") == "1":
        headers["Content-Disposition"] = f'attachment; filename="{Path(arc).name}"'
    return web.FileResponse(path, headers=headers)


async def get_outputs_recipe(request: web.Request) -> web.Response:
    """How a made file was made, to start the next clip from it. 404 when the file carries none."""
    cfg: Config = request.app["cfg"]
    rel = request.rel_url.query.get("path", "")
    try:
        files = outputs.safe_files(cfg.output_dir(), [rel])
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    path, arc = files[0]
    found = await asyncio.to_thread(recipe.load, cfg.output_dir(), arc, path, cfg.input_dir())
    if found is None:
        return web.json_response({"error": "this file has no recipe in it"}, status=404)
    return web.json_response(found)


async def get_beginner_ref(request: web.Request) -> web.Response:
    """A reference picture already on the pod, so a restored recipe can show its thumbnails."""
    cfg: Config = request.app["cfg"]
    name = request.rel_url.query.get("name", "")
    try:
        _safe_input_name(cfg, name)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=404)
    if Path(name).suffix.lower() not in ALLOWED_REF_EXT:
        return web.json_response({"error": "not a picture"}, status=404)
    return web.FileResponse(cfg.input_dir() / name)


async def post_outputs_delete(request: web.Request) -> web.Response:
    """Delete the files the Outputs tab ticked, and the recipe sidecar each one carries.

    The browser asks twice before this is called; the route still only ever deletes paths it was
    given by name, resolved through outputs.safe_files, so nothing outside the output folder and
    no whole folder can be swept by a crafted request."""
    cfg: Config = request.app["cfg"]
    body = await request.json()
    rels = body.get("files")
    if not isinstance(rels, list) or not all(isinstance(r, str) for r in rels):
        return web.json_response({"error": "files must be a list of paths"}, status=400)
    if not rels:
        return web.json_response({"error": "nothing selected"}, status=400)
    root = cfg.output_dir()
    try:
        files = outputs.safe_files(root, rels)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)

    def remove() -> tuple[int, list[str]]:
        done, failed = 0, []
        for path, arc in files:
            try:
                path.unlink()
                done += 1
            except OSError as e:
                failed.append(f"{arc}: {e.strerror or e}")
                continue
            recipe.sidecar_path(root, arc).unlink(missing_ok=True)
        return done, failed

    deleted, failed = await asyncio.to_thread(remove)
    return web.json_response({"deleted": deleted, "failed": failed})


async def post_outputs_zip(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    if request.content_type == "application/json":
        raw = (await request.json()).get("files")
    else:
        raw = (await request.post()).get("files")
    root = cfg.output_dir()
    try:
        rels = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw or [])
        if not rels:
            rels = [f["path"] for f in await asyncio.to_thread(outputs.list_outputs, root)]
        files = outputs.safe_files(root, [str(r) for r in rels])
    except ValueError as e:  # json.JSONDecodeError is a ValueError too
        return web.json_response({"error": str(e)}, status=400)
    if not files:
        return web.json_response({"error": "no output files yet"}, status=404)

    resp = web.StreamResponse(
        headers={
            "Content-Type": "application/zip",
            "Content-Disposition": f'attachment; filename="{outputs.zip_name()}"',
            "Cache-Control": "no-store",
        }
    )
    await resp.prepare(request)
    chunks = outputs.zip_chunks(files)
    while (chunk := await asyncio.to_thread(next, chunks, None)) is not None:
        if chunk:
            await resp.write(chunk)
    await resp.write_eof()
    return resp


def _restart_comfyui(cfg: Config) -> None:
    pids = _find_comfy_pids()
    marker = cfg.data_dir / ".dashboard-restarted-at"
    try:
        marker.write_text(str(int(time.time())), encoding="utf-8", newline="\n")
    except OSError:
        pass
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    deadline = time.time() + 20
    while time.time() < deadline and any(_pid_alive(p) for p in pids):
        time.sleep(0.5)
    for pid in pids:
        if _pid_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    cfg.log_dir.mkdir(parents=True, exist_ok=True)
    args = os.environ.get("COMFYUI_ARGS", "").split()
    cmd = ["python3.12", "main.py", "--listen", "0.0.0.0", "--port", "8188", *args]
    with open(cfg.log_dir / "comfyui.log", "ab") as f:
        subprocess.Popen(cmd, cwd=str(cfg.comfy_dir), stdout=f, stderr=f, start_new_session=True)


async def post_comfy_restart(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    threading.Thread(target=_restart_comfyui, args=(cfg,), daemon=True).start()
    return web.json_response({"ok": True})


def _tail(path: Path, n: int, max_bytes: int = 2 << 20) -> list[str]:
    """Last n lines, reading at most the last max_bytes (a log polled every 2 s can be large)."""
    if not path.is_file():
        return []
    with path.open("rb") as f:
        size = f.seek(0, os.SEEK_END)
        f.seek(max(0, size - max_bytes))
        text = f.read().decode("utf-8", errors="replace")
    # progress bars redraw with \r: keep only the last state of each line
    # (str.splitlines would split on \r too, so split on \n only)
    lines = [ln.rstrip("\r").rsplit("\r", 1)[-1] for ln in text.split("\n")]
    if lines and lines[-1] == "":
        lines.pop()
    return lines[-n:]


def _secret_values(secrets_dir: Path) -> list[str]:
    values = []
    if secrets_dir.is_dir():
        for f in secrets_dir.iterdir():
            if f.is_file():
                v = f.read_text(encoding="utf-8", errors="replace").strip()
                if v:
                    values.append(v)
    return values


ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def _mask_line(line: str, secrets: list[str]) -> str:
    # ComfyUI and its nodes color their log lines; a browser would show the codes as "[32m"
    line = ANSI_ESCAPE.sub("", line)
    for v in secrets:
        line = line.replace(v, "••••")
    return line


async def _comfyui_live_logs(lines: int) -> list[str] | None:
    """Best effort: ComfyUI's own /internal/logs shape is not something this repo has seen (it
    lives in the base image, not here), so this parses defensively and falls back to the log
    file on anything unexpected."""
    try:
        async with (
            ClientSession(timeout=ClientTimeout(total=1.5)) as s,
            s.get("http://127.0.0.1:8188/internal/logs") as r,
        ):
            if r.status != 200:
                return None
            data = await r.json(content_type=None)
    except Exception:
        return None
    if isinstance(data, str):  # ComfyUI's /internal/logs joins every entry into one string
        return data.splitlines()[-lines:]
    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict):
        entries = data.get("entries") or data.get("logs") or []
    else:
        return None
    out = []
    for e in entries:
        if isinstance(e, str):
            out.append(e)
        elif isinstance(e, dict):
            out.append(str(e.get("m") or e.get("message") or e))
    return out[-lines:]


async def get_logs(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    name = request.rel_url.query.get("name", "")
    try:
        n = int(request.rel_url.query.get("lines", "200"))
    except ValueError:
        n = 200
    if name == "boot":
        lines = _tail(cfg.log_dir / "boot.log", n)
    elif name == "models":
        lines = _tail(cfg.log_dir / "models.log", n)
    elif name == "comfyui":
        lines = None
        if cfg.comfy_state_fn() == "ready":
            lines = await _comfyui_live_logs(n)
        if lines is None:
            # after a dashboard restart ComfyUI writes comfyui.log; before that its output is
            # part of the boot log (start.sh tees everything it runs)
            log = cfg.log_dir / "comfyui.log"
            lines = _tail(log if log.is_file() else cfg.log_dir / "boot.log", n)
    else:
        return web.json_response({"error": f"unknown log name: {name}"}, status=400)
    secrets = _secret_values(cfg.secrets_dir)
    lines = [_mask_line(ln, secrets) for ln in lines]
    return web.json_response({"name": name, "lines": lines})


# ---------------------------------------------------------------------------
# beginner "make a clip" path: guided or free-text prompt -> one H3 clip at a time
# ---------------------------------------------------------------------------

ALLOWED_REF_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# Reference videos (<Video N>): the Story tab's Blender blocking render, which H3 follows for
# camera movement, cuts and timing. ComfyUI's LoadVideo reads these through PyAV.
ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv"}
# The clip is as long as its shots add up to (owner 2026-09-16), so this is a range rather than
# two fixed choices. The ceiling is memory: a 10 s clip at 704x1280 already fills most of a 96 GB
# card once the upscaler runs, and nothing longer than 15 s has been measured on this template.
CLIP_SECONDS_MIN, CLIP_SECONDS_MAX = 1.0, 15.0
# A reference image is usually a photo straight off a phone, which is commonly 2-5 MB and can be
# more. aiohttp's own default body cap is 1 MB, so without these the upload route would reject an
# ordinary photo with aiohttp's bare 413 before our handler ever ran. The request cap sits above
# the file cap to leave room for multipart overhead, so an oversized file gets our readable
# message rather than a dropped connection.
# The H3 Reference to Video node takes up to 9 ref_image slots (the example workflow's own note
# says 9 pictures, 3 videos, 3 audio clips). The beginner path wires images only — h3_workflows
# fills ref_image_* and nothing else — so video and audio references stay a ComfyUI-side job.
MAX_REFS = 9
# Pinned frames are a different thing from references: the picture IS that frame of the clip.
# MiniMaxH3AddGuide chains without a limit of its own, so this cap is ours — the same 9 as the
# references, which is already more pictures than a short clip has room for.
MAX_KEYFRAMES = 9
# MiniMaxH3ReferenceToVideo's own limit: 3 ref_videos slots
MAX_REF_VIDEOS = 3
MAX_REF_BYTES = 20 * 1024 * 1024
# a 15 s blocking render is a few MB at the clip's size; this leaves room for a 1080p export
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_VIDEO_BYTES + 4 * 1024 * 1024


def _safe_input_name(cfg: Config, name: str) -> str:
    """A ref filename must already be a plain file sitting in input/ — never a path the client
    can use to point anywhere else (same idea as outputs.safe_files, for the input side)."""
    if not name or "/" in name or "\\" in name:
        raise ValueError(f"invalid reference filename: {name!r}")
    input_dir = cfg.input_dir().resolve()
    path = (input_dir / name).resolve()
    if not path.is_relative_to(input_dir) or not path.is_file():
        raise ValueError(f"reference not found: {name!r}")
    return name


def _ref_videos(cfg: Config, raw) -> list[str]:
    """[filename] -> the reference videos for MiniMaxH3ReferenceToVideo's ref_videos slots."""
    if raw in (None, ""):
        return []
    if not isinstance(raw, list) or not all(isinstance(v, str) for v in raw):
        raise ValueError("ref_videos must be a list of uploaded video filenames")
    if len(raw) > MAX_REF_VIDEOS:
        raise ValueError(f"{len(raw)} reference videos; H3 takes at most {MAX_REF_VIDEOS}")
    out = []
    for name in raw:
        name = _safe_input_name(cfg, name)
        if Path(name).suffix.lower() not in ALLOWED_VIDEO_EXT:
            raise ValueError(f"{name} is not a video ({', '.join(sorted(ALLOWED_VIDEO_EXT))})")
        out.append(name)
    return out


def _keyframes(cfg: Config, raw, seconds: float) -> list[tuple[str, int]]:
    """[{file, frame}] -> [(file, frame index)], checked against the clip's real frame count.

    The user types the index themselves, so the message has to say what was wrong with it: a
    negative index counts back from the end (-1 is the last frame), and two pictures on one frame
    is rejected rather than quietly letting one of them win."""
    if raw in (None, ""):
        return []
    if not isinstance(raw, list) or not all(isinstance(k, dict) for k in raw):
        raise ValueError("keyframes must be a list of {file, frame} objects")
    if len(raw) > MAX_KEYFRAMES:
        raise ValueError(f"{len(raw)} pinned frames; at most {MAX_KEYFRAMES}")
    frames = h3_workflows.frame_count(seconds)
    out, taken = [], {}
    for item in raw:
        name = _safe_input_name(cfg, str(item.get("file") or ""))
        try:
            index = int(item.get("frame"))
        except (TypeError, ValueError):
            raise ValueError(f"frame number for {name}: type a whole number") from None
        at = index if index >= 0 else frames + index
        if not 0 <= at < frames:
            raise ValueError(
                f"frame {index} is outside this clip: it has {frames} frames, so the index is"
                f" 0 to {frames - 1} (or -1 to -{frames} counting back from the end)"
            )
        if at in taken:
            raise ValueError(f"frame {index} already has a picture pinned to it")
        taken[at] = name
        out.append((name, index))
    return out


def _failure_message(messages: list) -> str:
    """Best-effort readable line out of ComfyUI's /history error messages; falls back to the
    raw list (same fallback docker/handler.py uses) rather than ever raising on a shape we did
    not anticipate."""
    try:
        for kind, data in messages:
            if (
                kind == "execution_error"
                and isinstance(data, dict)
                and data.get("exception_message")
            ):
                return str(data["exception_message"])[:500]
    except Exception:
        pass
    return f"ComfyUI reported an error: {json.dumps(messages)[:500]}"


def _job_output_files(output_dir: Path, comfy_outputs: dict) -> list[dict]:
    """Map ComfyUI history's own outputs dict to the same {path,size,mtime,kind} shape as
    outputs.list_outputs, using the same filename/type=="output" filter as docker/handler.py's
    _output_files (that one returns absolute paths for a serverless job result; this one needs
    dashboard-relative ones instead, to match what the Outputs tab already shows)."""
    files = []
    seen = set()
    for node_out in comfy_outputs.values():
        for items in node_out.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if not (
                    isinstance(item, dict) and item.get("filename") and item.get("type") == "output"
                ):
                    continue
                rel = (Path(item.get("subfolder", "")) / item["filename"]).as_posix()
                if rel in seen:
                    continue
                seen.add(rel)
                path = output_dir / rel
                try:
                    st = path.stat()
                except OSError:
                    continue
                files.append(
                    {
                        "path": rel,
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "kind": outputs.kind(item["filename"]),
                    }
                )
    return files


# ---------------------------------------------------------------------------
# the Create queue: every clip or image this dashboard sent to ComfyUI, with live progress
# ---------------------------------------------------------------------------

MAX_TAKES = 4  # "Takes": the same form with 1-4 seeds, queued one after another
KEEP_JOBS = 40  # finished jobs beyond this drop off the list (their files stay in Outputs)


def _add_job(cfg: Config, kind: str, prompt_id: str, graph: dict, info: dict) -> dict:
    titles = {
        nid: (n.get("_meta") or {}).get("title") or n["class_type"] for nid, n in graph.items()
    }
    with cfg.gen_lock:
        job = {
            "id": (cfg.gen_jobs[-1]["id"] + 1) if cfg.gen_jobs else 1,
            "kind": kind,
            "prompt_id": prompt_id,
            "state": "queued",
            "created": cfg.now_fn(),
            "started": None,
            "finished": None,
            "error": None,
            "outputs": None,
            "titles": titles,
            **info,
        }
        cfg.gen_jobs.append(job)
        done = [j for j in cfg.gen_jobs if j["state"] in ("finished", "failed")]
        for old in done[: max(0, len(cfg.gen_jobs) - KEEP_JOBS)]:
            cfg.gen_jobs.remove(old)
    return job


def _finish_job(cfg: Config, job: dict, entry: dict) -> None:
    status = entry.get("status") or {}
    if status.get("status_str") == "error":
        job["state"] = "failed"
        job["error"] = _failure_message(status.get("messages") or [])
    else:
        job["state"] = "finished"
        job["outputs"] = _job_output_files(cfg.output_dir(), entry.get("outputs") or {})
        if job.get("recipe"):
            recipe.save(cfg.output_dir(), [f["path"] for f in job["outputs"]], job["recipe"])
    job["finished"] = cfg.now_fn()
    # keep when ComfyUI actually started on it, so a finished row can say how long the work took
    # rather than how long the button has been pressed — the two differ by the wait in the queue
    started = (cfg.progress.get(job["prompt_id"]) or {}).get("started")
    if started is not None:
        job["started"] = started
    cfg.progress.pop(job["prompt_id"], None)


def _refresh_jobs(cfg: Config) -> list[dict]:
    """Ask ComfyUI's /history about every job still in flight, and return the list, oldest
    first. A job ComfyUI no longer holds anywhere was dropped (a restart), and says so rather
    than waiting forever."""
    with cfg.gen_lock:
        pending = [j for j in cfg.gen_jobs if j["state"] in ("queued", "running")]
    queue = None
    for job in pending:
        entry = cfg.comfy_history_fn(job["prompt_id"])
        if entry is not None and (
            (entry.get("status") or {}).get("completed")
            or (entry.get("status") or {}).get("status_str") == "error"
        ):
            _finish_job(cfg, job, entry)
            continue
        if job["prompt_id"] in cfg.progress:
            job["state"] = "running"
        if queue is None:
            queue = cfg.comfy_queue_fn()
        if queue is not None and job["prompt_id"] not in queue:
            # it may have finished between the two questions
            entry = cfg.comfy_history_fn(job["prompt_id"])
            if entry is not None:
                _finish_job(cfg, job, entry)
            else:
                job["state"] = "failed"
                job["error"] = "ComfyUI no longer has this job (was it restarted?)"
                job["finished"] = cfg.now_fn()
    with cfg.gen_lock:
        return [dict(j) for j in cfg.gen_jobs]


def on_comfy_event(cfg: Config, event: dict) -> None:
    """One message from ComfyUI's websocket, folded into cfg.progress[prompt_id]."""
    kind, data = event.get("type"), event.get("data") or {}
    pid = data.get("prompt_id")
    if not pid:
        return
    now = cfg.now_fn()
    if kind == "execution_start":
        cfg.progress[pid] = {"started": now, "node": None, "value": None, "max": None, "done": []}
        return
    p = cfg.progress.setdefault(
        pid, {"started": now, "node": None, "value": None, "max": None, "done": []}
    )

    def done(node) -> None:
        if node and node not in p["done"]:
            p["done"].append(node)

    if kind == "execution_cached":
        for node in data.get("nodes") or []:
            done(node)
    elif kind == "executing":
        if p["node"] and p["node"] != data.get("node"):
            done(p["node"])
        p["node"], p["value"], p["max"] = data.get("node"), None, None
    elif kind == "executed":
        done(data.get("node"))
    elif kind == "progress":
        p["node"], p["value"], p["max"] = data.get("node"), data.get("value"), data.get("max")


async def _progress_listener(app: web.Application) -> None:
    cfg: Config = app["cfg"]
    url = f"ws://127.0.0.1:8188/ws?clientId={DASHBOARD_CLIENT_ID}"
    while True:
        try:
            async with ClientSession() as s, s.ws_connect(url, heartbeat=30) as ws:
                async for msg in ws:
                    if msg.type == WSMsgType.TEXT:
                        try:
                            on_comfy_event(cfg, json.loads(msg.data))
                        except (ValueError, AttributeError, TypeError):
                            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            pass  # ComfyUI booting or restarting: try again shortly
        await asyncio.sleep(3)


async def _start_listener(app: web.Application) -> None:
    if app["cfg"].progress_ws:
        app["progress_task"] = asyncio.create_task(_progress_listener(app))


async def _stop_listener(app: web.Application) -> None:
    task = app.get("progress_task")
    if task:
        task.cancel()


def _gen_view(job: dict, cfg: Config, ahead: int) -> dict:
    view = {
        k: job.get(k)
        for k in (
            "id",
            "kind",
            "mode",
            "state",
            "prompt_id",
            "seed",
            "seconds",
            "aspect",
            "hd",
            "fast",
            "sparse",
            "upscale",
            "prompt",
            "outputs",
            "error",
            "created",
            "started",
            "finished",
            "label",
            "batch",
        )
    }
    p = cfg.progress.get(job["prompt_id"])
    view["progress"] = None
    if p and job["state"] in ("queued", "running"):
        node = p.get("node")
        view["progress"] = {
            "started": p["started"],
            "node": job["titles"].get(node) if node else None,
            "value": p.get("value"),
            "max": p.get("max"),
            "nodes_done": len(p["done"]),
            "nodes_total": len(job["titles"]),
        }
    view["ahead"] = ahead if job["state"] == "queued" else 0
    return view


def _jobs_views(cfg: Config) -> list[dict]:
    """Newest first; `ahead` = how many of this dashboard's jobs ComfyUI runs before this one."""
    jobs = _refresh_jobs(cfg)
    views, waiting = [], 0
    for job in jobs:
        views.append(_gen_view(job, cfg, waiting))
        if job["state"] in ("queued", "running"):
            waiting += 1
    return views[::-1]


async def post_beginner_upload(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    reader = await request.multipart()
    field_ = await reader.next()
    if field_ is None or not field_.filename:
        return web.json_response({"error": "no file uploaded"}, status=400)
    ext = Path(field_.filename).suffix.lower()
    if ext in ALLOWED_VIDEO_EXT:
        return await _upload_video(cfg, field_, ext)
    if ext not in ALLOWED_REF_EXT:
        return web.json_response(
            {
                "error": f"unsupported file type {ext or '(none)'}; allowed: "
                + ", ".join(sorted(ALLOWED_REF_EXT | ALLOWED_VIDEO_EXT))
            },
            status=400,
        )
    data = await field_.read()
    if len(data) > MAX_REF_BYTES:
        return web.json_response(
            {
                "error": f"reference image is {len(data) / 1024 / 1024:.1f} MB; "
                f"the limit is {MAX_REF_BYTES // 1024 // 1024} MB"
            },
            status=400,
        )
    input_dir = cfg.input_dir()
    input_dir.mkdir(parents=True, exist_ok=True)
    # a fresh generated name: the client's filename is never trusted as a path, only its extension
    name = f"ref_{uuid.uuid4().hex}{ext}"
    (input_dir / name).write_bytes(data)
    return web.json_response({"filename": name})


async def _upload_video(cfg: Config, field_, ext: str) -> web.Response:
    """A reference video, streamed to input/ so a big render is never held in memory whole."""
    input_dir = cfg.input_dir()
    input_dir.mkdir(parents=True, exist_ok=True)
    name = f"refvid_{uuid.uuid4().hex}{ext}"
    path = input_dir / name
    size = 0
    try:
        with path.open("wb") as f:
            while chunk := await field_.read_chunk(1 << 20):
                size += len(chunk)
                if size > MAX_VIDEO_BYTES:
                    raise ValueError(
                        f"the video is over {MAX_VIDEO_BYTES // 1024 // 1024} MB; render it at"
                        " the clip's size (576x1024 is plenty for a blocking guide)"
                    )
                f.write(chunk)
    except ValueError as e:
        path.unlink(missing_ok=True)
        return web.json_response({"error": str(e)}, status=400)
    if not size:
        path.unlink(missing_ok=True)
        return web.json_response({"error": "the video file is empty"}, status=400)
    return web.json_response({"filename": name})


def _pin_places(keyframes: list[tuple[str, int]], seconds: float) -> list[dict]:
    """[(file, index)] -> what each pin means in the clip, for the prompt composer: the first
    frame, the last frame, or a moment in between (in seconds, so the text can timecode it)."""
    frames = h3_workflows.frame_count(seconds)
    out = []
    for _name, index in keyframes:
        at = index if index >= 0 else frames + index
        where = "first" if at == 0 else "last" if at == frames - 1 else "middle"
        # the last frame is timecoded as the end of the clip, not frame 123 of 124, so it reads
        # as the same moment the last shot ends
        out.append({"where": where, "at": frames / 24 if where == "last" else at / 24})
    return sorted(out, key=lambda p: p["at"])


def _guided_prompt(body: dict, ref_count: int, seconds: float, pins: list[dict] = ()) -> str:
    """Compose the guided form's H3 prompt from a request body.

    Shared by /api/beginner/start and /api/beginner/preview, so what the panel shows before the
    button is pressed is produced by the same code that will send it. Raises ValueError with a
    message meant for the user.
    """

    def _pic(value) -> int | None:
        # a picture number is a 1-based index into refs; anything outside that range means no
        # picture at all, never a silent pin to somebody else's photo
        return int(value) if value and 1 <= int(value) <= ref_count else None

    raw_subjects = body.get("subjects") or []
    if not isinstance(raw_subjects, list) or not all(isinstance(s, str) for s in raw_subjects):
        raise ValueError("subjects must be a list of descriptions, one per reference image")

    def _lines(raw, where: str) -> list[dict]:
        if not isinstance(raw, list) or not all(
            isinstance(ln, dict) and isinstance(ln.get("text", ""), str) for ln in raw
        ):
            raise ValueError(f"{where} must be a list of {{speaker, text}} objects")
        return [
            {
                "speaker": int(ln.get("speaker") or 1),
                "text": str(ln.get("text") or ""),
                "language": str(ln.get("language") or "auto"),
            }
            for ln in raw
        ]

    raw_shots = body.get("shots") or []
    if not isinstance(raw_shots, list) or not all(
        isinstance(s, dict) and isinstance(s.get("what", ""), str) for s in raw_shots
    ):
        raise ValueError("shots must be a list of {what, lines} objects")

    raw_lines = body.get("lines") or []

    raw_cast = body.get("cast") or []
    if not isinstance(raw_cast, list) or not all(
        isinstance(c, dict) and isinstance(c.get("who", ""), str) for c in raw_cast
    ):
        raise ValueError("cast must be a list of {who, picture} objects")

    raw_props = body.get("props") or []
    if not isinstance(raw_props, list) or not all(
        isinstance(p, dict) and isinstance(p.get("what", ""), str) for p in raw_props
    ):
        raise ValueError("props must be a list of {kind, picture, what} objects")

    try:
        speaker = int(body.get("speaker") or 1)
        lines = _lines(raw_lines, "lines")
        shots = [
            {
                "what": str(s.get("what") or ""),
                "seconds": float(s.get("seconds") or 0),
                "lines": _lines(s.get("lines") or [], "a shot's lines"),
            }
            for s in raw_shots
        ]
        cast = [
            {"who": str(c.get("who") or ""), "picture": _pic(c.get("picture"))} for c in raw_cast
        ]
        props = [
            {
                "kind": str(p.get("kind") or "object"),
                "picture": _pic(p.get("picture")),
                "what": str(p.get("what") or ""),
                "worn_by": int(p["worn_by"]) if p.get("worn_by") else None,
            }
            for p in raw_props
        ]
    except (TypeError, ValueError) as e:
        raise ValueError(f"a speaker, picture or worn_by is not a number: {e}") from e

    return prompt_build.guided(
        str(body.get("action") or ""),
        cast=cast,
        props=props,
        subject=str(body.get("subject") or ""),
        subjects=raw_subjects,
        dialogue=str(body.get("dialogue") or ""),
        shots=shots,
        lines=lines,
        dialogue_language=str(body.get("dialogue_language") or "auto"),
        speaker=speaker,
        refs=ref_count,
        pins=list(pins),
        seconds=seconds,
        # absent = an older client, which gets the defaults; "" = the user cleared the field
        sound=str(body.get("sound", prompt_build.DEFAULT_SOUND) or ""),
        style=str(body.get("style", prompt_build.DEFAULT_STYLE) or ""),
        aspect=str(body.get("aspect") or "9:16"),
    )


class BadRequest(Exception):
    """A request the user can fix; the message is shown to them as it is."""


def _seed(body: dict) -> int:
    try:
        if body.get("seed") not in (None, ""):
            return int(body["seed"])
    except (TypeError, ValueError):
        raise BadRequest("seed must be an integer") from None
    return random.randint(0, 2**31 - 1)


def _takes(body: dict) -> int:
    try:
        n = int(body.get("count") or 1)
    except (TypeError, ValueError):
        raise BadRequest("count must be a number") from None
    if not 1 <= n <= MAX_TAKES:
        raise BadRequest(f"make 1 to {MAX_TAKES} at a time")
    return n


def _check_runnable(cfg: Config, required, what: str) -> None:
    comfy_state = cfg.comfy_state_fn()
    if comfy_state != "ready":
        raise BadRequest(f"ComfyUI is not up yet (state: {comfy_state})")
    missing = _missing_presets(cfg, required)
    if missing:
        raise BadRequest(f"{what} models not downloaded yet: {', '.join(missing)}")


def _clip_plan(cfg: Config, body: dict, *, runnable: bool) -> dict:
    """Everything a clip request decides, checked once: the prompt, the graph for a seed, and the
    recipe. /api/beginner/start queues it; /api/workflow only saves the graph, so it skips the
    checks that are about running now (ComfyUI up, models on disk)."""
    if runnable:
        _check_runnable(cfg, BEGINNER_REQUIRED_PRESETS, "clip")

    mode = str(body.get("mode") or "")
    if mode not in ("guided", "free"):
        raise BadRequest("mode must be 'guided' or 'free'")
    try:
        seconds = float(body.get("seconds"))
    except (TypeError, ValueError):
        raise BadRequest("seconds is required") from None
    if not CLIP_SECONDS_MIN <= seconds <= CLIP_SECONDS_MAX:
        raise BadRequest(
            f"the clip is {seconds:g} s long; keep it between"
            f" {CLIP_SECONDS_MIN:g} and {CLIP_SECONDS_MAX:g} seconds"
        )

    raw_refs = body.get("refs") or []
    if not isinstance(raw_refs, list) or not all(isinstance(r, str) for r in raw_refs):
        raise BadRequest("refs must be a list of uploaded filenames")
    if len(raw_refs) > MAX_REFS:
        raise BadRequest(f"{len(raw_refs)} reference images; H3 takes at most {MAX_REFS}")
    try:
        refs = [_safe_input_name(cfg, r) for r in raw_refs]
    except ValueError as e:
        raise BadRequest(str(e)) from None
    for r in refs:
        if Path(r).suffix.lower() in ALLOWED_VIDEO_EXT:
            raise BadRequest(f"{r} is a video: send it in ref_videos, not refs")

    try:
        keyframes = _keyframes(cfg, body.get("keyframes"), seconds)
        ref_videos = _ref_videos(cfg, body.get("ref_videos"))
    except ValueError as e:
        raise BadRequest(str(e)) from None

    aspect = str(body.get("aspect") or "9:16")
    if aspect not in h3_workflows.SIZES:
        raise BadRequest(f"aspect must be one of {', '.join(h3_workflows.SIZES)}")

    if mode == "free":
        prompt_text = str(body.get("prompt") or "").strip()
        if not prompt_text:
            raise BadRequest("prompt text is required in free mode")
    else:
        try:
            prompt_text = _guided_prompt(body, len(refs), seconds, _pin_places(keyframes, seconds))
        except ValueError as e:
            raise BadRequest(str(e)) from None

    seed = _seed(body)
    count = _takes(body)

    form = body.get("form")
    if not isinstance(form, dict) or len(json.dumps(form)) > recipe.MAX_FORM_BYTES:
        form = None  # the clip still runs; it just comes back as a prompt block, not a form

    upscale = body.get("upscale") is True
    hd = body.get("hd") is True
    fast = body.get("fast") is True
    # Sparse attention is ON unless the browser says otherwise (owner 2026-09-22: default it, and
    # let a user turn it off when a clip looks wrong). Absent means on, so a caller that predates
    # the field gets the new default — except a REPLAYED recipe, which the browser sends an
    # explicit false for when its stored recipe has no `sparse`, since such a clip was made
    # before this existed and must come back the way it was made.
    sparse = body.get("sparse") is not False
    if hd and upscale:
        raise BadRequest("pick one: native 720p (hd) or the 720p upscale of a 576p clip")
    if runnable and upscale and not _upscale_ready(cfg):
        raise BadRequest(
            "720p needs the H3 latent upscaler: add h3upscaler to MODELS and restart"
            " the pod (the node is fetched at boot)"
        )
    if runnable and fast and _missing_presets(cfg, (FAST_PRESET,)):
        raise BadRequest(f"Fast needs the {FAST_PRESET} models: download them in Models")
    try:
        loras = _requested_loras(cfg, body.get("loras"))
    except ValueError as e:
        raise BadRequest(str(e)) from None

    normal, big = h3_workflows.SIZES[aspect]
    width, height = big if hd else normal
    shape = aspect.replace(":", "x")
    # 9:16 keeps the names clips always had; "-720p_" stays last, the Outputs tab looks for it
    prefix = (
        f"AiAngel/aiangelh3{'' if aspect == '9:16' else '-' + shape}"
        f"{'-720p' if upscale or hd else ''}"
    )
    settings = h3_workflows.AIANGEL_FAST if fast else h3_workflows.AIANGEL
    chain = (list(h3_workflows.FAST_LORAS) if fast else []) + loras

    def graph(seed_: int) -> dict:
        return h3_workflows.clip(
            prompt_text,
            refs,
            seed=seed_,
            seconds=seconds,
            width=width,
            height=height,
            prefix=prefix,
            upscale=upscale,
            upscale_scale=UPSCALE_720P,
            loras=chain,
            keyframes=keyframes,
            ref_videos=ref_videos,
            sparse=sparse,
            **settings,
        )

    def info(seed_: int) -> dict:
        return {
            "mode": mode,
            "seed": seed_,
            "seconds": prompt_build.clip_seconds(seconds),
            "aspect": aspect,
            "hd": hd,
            "fast": fast,
            "sparse": sparse,
            "upscale": upscale,
            # what actually went to H3 — guided mode composed it, so this is the only place the
            # user can see the structured prompt their few words turned into
            "prompt": prompt_text,
            # a free prompt's first line, unless the browser named the clip itself (the Story
            # tab's "Scene 2 · The rooftop"), since a structured prompt opens on a section header
            "label": (str(body.get("label") or "").strip() or prompt_text.splitlines()[0])[:80]
            if mode == "free"
            else None,
            # written beside each file the clip produces, so "Use this recipe" in Outputs can
            # put the whole form back. `form` is the browser's own state, stored as it came.
            "recipe": {
                "kind": "clip",
                "mode": mode,
                "form": form,
                "prompt": prompt_text,
                "refs": refs,
                "keyframes": [{"file": f, "frame": i} for f, i in keyframes],
                "ref_videos": ref_videos,
                "seed": seed_,
                "seconds": seconds,
                "upscale": upscale,
                "hd": hd,
                "fast": fast,
                "sparse": sparse,
                "aspect": aspect,
                "loras": [{"name": n, "strength": s} for n, s in loras],
            },
        }

    return {
        "kind": "clip",
        "seeds": [seed + i for i in range(count)],
        "graph": graph,
        "info": info,
        "name": f"AiAngelH3-{shape}{'-720p' if hd or upscale else ''}{'-fast' if fast else ''}",
        "reply": {
            "mode": mode,
            "seconds": prompt_build.clip_seconds(seconds),
            "prompt": prompt_text,
        },
    }


def _upscale_plan(cfg: Config, body: dict, *, runnable: bool) -> dict:
    """Make a bigger version of one picture with Qwen Image 2.1 (owner 2026-09-20).

    Two ways in, and only the defaults differ: "Upscale this" sends nothing but the picture and
    gets 4 MP at full strength — the owner's choice after seeing the three strengths side by
    side — while "Custom upscale" also sends `megapixels` and `denoise`. There is no aspect and
    no takes: the result is that picture, at that size."""
    if runnable:
        _check_runnable(cfg, IMAGE_PRESETS["qwen21"]["t2i"], "image")
    try:
        source = _safe_input_name(cfg, str(body.get("source") or ""))
    except ValueError:
        raise BadRequest("pick the picture to upscale first") from None
    try:
        # No explicit default needed: _requested_unet already falls back to DEFAULT_IMAGE_UNET,
        # which is the Qwen 2.1 stock model this route requires below.
        unet = _requested_unet(cfg, body.get("unet"))
    except ValueError as e:
        raise BadRequest(str(e)) from None
    if image_workflows.family_of(unet) != "qwen21":
        raise BadRequest("upscaling runs on Qwen Image 2.1")
    try:
        megapixels = float(body.get("megapixels") or image_workflows.UPSCALE_MEGAPIXELS)
        denoise = float(body.get("denoise") or image_workflows.UPSCALE_DENOISE)
    except (TypeError, ValueError):
        raise BadRequest("megapixels and denoise must be numbers") from None
    seed = _seed(body)

    def graph(seed_: int) -> dict:
        try:
            return image_workflows.qwen21_upscale(
                source, megapixels=megapixels, denoise=denoise, seed=seed_, unet=unet
            )
        except ValueError as e:
            raise BadRequest(str(e)) from None

    if runnable:
        graph(seed)  # the size and strength are checked before anything is queued

    def info(seed_: int) -> dict:
        return {
            "mode": "upscale",
            "seed": seed_,
            "aspect": None,
            "prompt": f"upscale to {megapixels:g} MP",
            "label": f"Upscale · {megapixels:g} MP · denoise {denoise:g}",
            "batch": 1,
            "recipe": {
                "kind": "image",
                "mode": "upscale",
                "form": None,
                "prompt": image_workflows.UPSCALE_PROMPT,
                "refs": [source],
                "seed": seed_,
                "megapixels": megapixels,
                "denoise": denoise,
                "batch": 1,
                "loras": [],
                "unet": unet,
            },
        }

    return {
        "kind": "image",
        "seeds": [seed],
        "graph": graph,
        "info": info,
        "name": f"Qwen21-Upscale-{megapixels:g}MP",
        "reply": {"mode": "upscale", "prompt": f"upscale to {megapixels:g} MP"},
    }


def _image_plan(cfg: Config, body: dict, *, runnable: bool) -> dict:
    mode = str(body.get("mode") or "")
    if mode == "upscale":
        return _upscale_plan(cfg, body, runnable=runnable)
    if mode not in IMAGE_MODES:
        raise BadRequest("mode must be 't2i', 'edit' or 'upscale'")
    try:
        loras = _requested_loras(cfg, body.get("loras"))
        unet = _requested_unet(cfg, body.get("unet"))
    except ValueError as e:
        raise BadRequest(str(e)) from None
    # The model chosen decides everything else: which graph runs, and which preset it needs.
    family = image_workflows.family_of(unet)
    required = IMAGE_PRESETS[family][mode]
    if runnable:
        undefined = [p for p in required if p not in _preset_names(cfg)]
        if undefined:
            raise BadRequest(
                f"this pod's model list has no {', '.join(undefined)} preset — "
                "it predates that model; rebuild the pod on a newer image"
            )
        _check_runnable(cfg, required, "image")
    prompt_text = str(body.get("prompt") or "").strip()
    if not prompt_text:
        raise BadRequest(
            "describe the picture" if mode == "t2i" else "say what to change in the photo"
        )
    aspect = str(body.get("aspect") or "9:16")
    if aspect not in image_workflows.SIZES:
        raise BadRequest(f"aspect must be one of {', '.join(image_workflows.SIZES)}")
    # How big the picture is, within that shape. Absent or 1 means the measured default size,
    # and an older recipe carries no field at all, so it replays at exactly the size it was made.
    raw_mp = body.get("megapixels")
    try:
        megapixels = 1.0 if raw_mp in (None, "") else float(raw_mp)
    except (TypeError, ValueError):
        raise BadRequest("megapixels must be a number") from None
    lo, hi = image_workflows.MEGAPIXEL_RANGE
    if not lo <= megapixels <= hi:
        raise BadRequest(f"megapixels must be between {lo:g} and {hi:g}")
    sources: list[str] = []
    if mode == "edit":
        # `source` is the one picture the form has always sent; Qwen 2.1 also takes `sources`,
        # a list, because its encoder reads several at once ("put the shirt from <image2> on
        # the person in <image1>"). Krea 2 has one slot, so anything past the first is refused
        # rather than silently dropped.
        raw = body.get("sources")
        wanted = raw if isinstance(raw, list) else [body.get("source")]
        for item in wanted:
            try:
                sources.append(_safe_input_name(cfg, str(item or "")))
            except ValueError:
                raise BadRequest("pick the photo to edit first") from None
        if not sources:
            raise BadRequest("pick the photo to edit first")
        limit = image_workflows.QWEN21_MAX_SOURCES if family == "qwen21" else 1
        if len(sources) > limit:
            raise BadRequest(
                f"{len(sources)} pictures; this model takes "
                + ("one" if limit == 1 else f"at most {limit}")
            )
    seed = _seed(body)
    count = _takes(body)
    shape = aspect.replace(":", "x")

    def graph(seed_: int) -> dict:
        if family == "qwen21":
            if mode == "t2i":
                return image_workflows.qwen21_text_to_image(
                    prompt_text,
                    seed=seed_,
                    aspect=aspect,
                    megapixels=megapixels,
                    loras=loras,
                    unet=unet,
                    batch=count,
                )
            # no aspect and no size: this graph samples at the first picture's own size
            return image_workflows.qwen21_edit(
                prompt_text, sources, seed=seed_, loras=loras, unet=unet, batch=count
            )
        if mode == "t2i":
            return image_workflows.text_to_image(
                prompt_text,
                seed=seed_,
                aspect=aspect,
                megapixels=megapixels,
                loras=loras,
                unet=unet,
                batch=count,
            )
        return image_workflows.edit(
            prompt_text,
            sources[0],
            seed=seed_,
            aspect=aspect,
            megapixels=megapixels,
            loras=loras,
            unet=unet,
            batch=count,
        )

    def info(seed_: int) -> dict:
        return {
            "mode": mode,
            "seed": seed_,
            "aspect": aspect,
            "prompt": prompt_text,
            "label": prompt_text[:80],
            "batch": count,
            "recipe": {
                "kind": "image",
                "mode": mode,
                "form": None,
                "prompt": prompt_text,
                # `refs` carries every picture, so a replay of a Qwen 2.1 edit gets all of them
                # back; older recipes hold the single one this field has always had.
                "refs": list(sources),
                "seed": seed_,
                "aspect": aspect,
                "megapixels": megapixels,
                "batch": count,
                "loras": [{"name": n, "strength": s} for n, s in loras],
                "unet": unet,
            },
        }

    label = "Qwen21" if family == "qwen21" else "Krea2"
    return {
        "kind": "image",
        # takes are one job with a batch of that many pictures, not that many jobs: the prompt is
        # encoded once and the sampler runs them together (owner 2026-09-18)
        "seeds": [seed],
        "graph": graph,
        "info": info,
        # a Qwen 2.1 edit has no shape of its own — it comes out at the picture's size
        "name": (
            f"{label}-Edit"
            if (family == "qwen21" and mode == "edit")
            else f"{label}-{'Edit' if mode == 'edit' else 'Image'}-{shape}"
        ),
        "reply": {"mode": mode, "prompt": prompt_text},
    }


def _queue_plan(cfg: Config, plan: dict) -> web.Response:
    queued = []
    for seed in plan["seeds"]:
        graph = plan["graph"](seed)
        prompt_id, error = cfg.comfy_submit_fn(graph)
        if error:
            # the takes already queued stay queued; say how far it got
            prefix = f"{len(queued)} of {len(plan['seeds'])} queued, then: " if queued else ""
            return web.json_response({"error": prefix + error, "jobs": queued}, status=502)
        job = _add_job(cfg, plan["kind"], prompt_id, graph, plan["info"](seed))
        queued.append({"id": job["id"], "prompt_id": prompt_id, "seed": seed})
    return web.json_response(
        {"prompt_id": queued[0]["prompt_id"], "state": "queued", "jobs": queued, **plan["reply"]}
    )


async def post_beginner_start(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    body = await request.json()
    try:
        plan = _clip_plan(cfg, body, runnable=True)
    except BadRequest as e:
        return web.json_response({"error": str(e)}, status=400)
    return _queue_plan(cfg, plan)


async def post_image_start(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    body = await request.json()
    try:
        plan = _image_plan(cfg, body, runnable=True)
    except BadRequest as e:
        return web.json_response({"error": str(e)}, status=400)
    return _queue_plan(cfg, plan)


async def post_gen_cancel(request: web.Request) -> web.Response:
    """Stop one Create job, or every job still in flight (owner 2026-09-20: a started job could
    not be stopped at all).

    Queued and running are cancelled differently by ComfyUI — a pending job is deleted from the
    queue, the one in the sampler is interrupted — so both are worked out here rather than asked
    of the browser. Cancelling something that has just finished is not an error: the answer says
    how many were actually stopped, which is what the page shows."""
    cfg: Config = request.app["cfg"]
    body = await request.json()
    wants_all = bool(body.get("all"))
    job_id = body.get("id")
    if not wants_all and job_id is None:
        return web.json_response({"error": "say which job, or all"}, status=400)
    with cfg.gen_lock:
        live = [j for j in cfg.gen_jobs if j["state"] in ("queued", "running")]
        if not wants_all:
            live = [j for j in live if j.get("id") == job_id]
        ids = [j["prompt_id"] for j in live if j.get("prompt_id")]
        running = any(j["state"] == "running" for j in live)
    if not live:
        return web.json_response({"cancelled": 0})
    error = cfg.comfy_cancel_fn(ids, running=running)
    if error:
        return web.json_response({"error": error}, status=400)
    now = cfg.now_fn()
    with cfg.gen_lock:
        for job in live:
            # a cancelled job leaves the in-flight set, so _refresh_jobs never asks ComfyUI about
            # it again and cannot relabel it as "ComfyUI no longer has this job"
            job["state"] = "cancelled"
            job["finished"] = now
            cfg.progress.pop(job.get("prompt_id"), None)
    return web.json_response({"cancelled": len(live)})


GRAPHS_SUBDIR = "aiangel-graphs"  # under input/, where ComfyUI's /view can hand a graph to the page


async def post_workflow(request: web.Request) -> web.Response:
    """The ComfyUI graph a Create form would run, without running it (owner 2026-09-17).

    Saved under input/aiangel-graphs/ so ComfyUI's own page can open it
    (`?aiangel_graph=<file>`, read by the node's aiangel.js), and returned whole so the browser
    can offer it as a file. Works while models are still downloading: ComfyUI just shows the
    missing ones when it loads."""
    cfg: Config = request.app["cfg"]
    body = await request.json()
    try:
        if body.get("kind") == "image":
            plan = _image_plan(cfg, body, runnable=False)
        else:
            plan = _clip_plan(cfg, body, runnable=False)
    except BadRequest as e:
        return web.json_response({"error": str(e)}, status=400)
    graph = plan["graph"](plan["seeds"][0])
    name = f"{plan['name']}-{uuid.uuid4().hex[:8]}.json"
    folder = cfg.input_dir() / GRAPHS_SUBDIR
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(graph, indent=1), encoding="utf-8")
    return web.json_response({"file": name, "subfolder": GRAPHS_SUBDIR, "graph": graph})


async def post_ref_from_output(request: web.Request) -> web.Response:
    """Copy a made image into input/ as a reference, so it can star in a clip or be edited."""
    cfg: Config = request.app["cfg"]
    body = await request.json()
    try:
        path, arc = outputs.safe_files(cfg.output_dir(), [str(body.get("path") or "")])[0]
    except (ValueError, IndexError) as e:
        return web.json_response({"error": str(e) or "no such output"}, status=400)
    ext = Path(arc).suffix.lower()
    if ext not in ALLOWED_REF_EXT:
        return web.json_response({"error": "only a picture can be used as a reference"}, status=400)
    input_dir = cfg.input_dir()
    input_dir.mkdir(parents=True, exist_ok=True)
    name = f"ref_{uuid.uuid4().hex}{ext}"
    await asyncio.to_thread(shutil.copyfile, path, input_dir / name)
    return web.json_response({"filename": name})


async def post_beginner_preview(request: web.Request) -> web.Response:
    """The prompt the guided fields would send, without sending it.

    Same `_guided_prompt` the start route uses, so the panel can never show one thing and queue
    another. Costs nothing: no ComfyUI, no models, no disk — so it answers while the pod is
    still downloading, which is exactly when someone is filling the form in.
    """
    body = await request.json()
    try:
        seconds = float(body.get("seconds") or 5)
    except (TypeError, ValueError):
        return web.json_response({"error": "seconds must be a number"}, status=400)
    refs = body.get("refs") or []
    raw_pins = body.get("keyframes") or []
    # the preview runs on a half-finished form, so a pin whose picture is still uploading, or
    # whose number is nonsense, just does not appear in the preview yet
    pins = _pin_places(
        [
            (str(k.get("file") or ""), int(k.get("frame")))
            for k in raw_pins
            if isinstance(k, dict) and str(k.get("frame", "")).lstrip("-").isdigit()
        ],
        seconds,
    )
    try:
        prompt_text = _guided_prompt(
            body, len(refs) if isinstance(refs, list) else 0, seconds, pins
        )
    except ValueError as e:
        # an unfinished form is the normal case here, not an error worth shouting about
        return web.json_response({"prompt": "", "pending": str(e)})
    return web.json_response({"prompt": prompt_text, "pending": None})


# LoRAs on top of the model, from the Make a clip form (owner 2026-09-16: "กด add lora ได้ 2 ตัว")
# and, since 2026-09-20, the image form too. The ceiling went from two to six when the owner asked
# for the image side: "จริงๆ lora ใส่ได้หลายตัว เอาไว้ให้เค้าเลือก" — a stack of concept LoRAs is
# how NSFW images are normally made, and each one only costs its load time. Strengths the owner's
# own recipes use are offered as the starting value when that file is picked; the user sets their
# own. The trigger word is shown, never inserted into the prompt.
MAX_LORAS = 6
LORA_STRENGTH_RANGE = (-2.0, 2.0)
LORA_HINTS = {
    "MysticXXX_MMH3-V4.safetensors": {"strength": 0.4},
    "HMCumshot_V2.safetensors": {"strength": 0.9, "trigger": "hmcumshot3"},
    # The prompt-unlock LoRAs, by the file names their authors really ship (read from Civitai's
    # API on 2026-09-20, not guessed). 1.0 is fedor_bypass's nominal. TextFusion is 1.0 too, on the
    # owner's own ruling after using it (2026-09-20: "ตัว text refusal มันต้อง 1.0 ไม่ใช่ 0.5"). It
    # first shipped at 0.5 only because the PornMaster author asks for "a low weight to avoid
    # disrupting your composition" — advice we never measured, so his number replaces it.
    "fedor_bypass.safetensors": {"strength": 1.0},
    "Krea2_TextFusion_Refusal_Reduction.safetensors": {"strength": 1.0},
    "krea2filterbypass3.safetensors": {"strength": 1.0},
    "canon_qwen21.safetensors": {"trigger": "c2n0n"},
}
# The image form starts with one of these already in its LoRA stack (owner 2026-09-20): on the
# stock Krea 2 they are what makes the model follow a prompt instead of softening it, which is what
# an intense picture needs whether or not it is nude. The user can drop the row or add more.
# Matched by name because a downloaded file keeps the author's own name; first match in this order
# wins, and none of them being on the pod simply means no default row.
# TextFusion leads (owner 2026-09-20, after seeing both on a pod). It is the one the PornMaster
# author names as the thing to reach for when a theme will not generate, and it is a trained 27 MB
# LoRA rather than fedor's 1 KB projector tweak. Both open at full strength (owner 2026-09-20).
# fedor_bypass is second; both ship with the `krea2` preset. krea2filterbypass3 is last
# and is never shipped — it is here only for a pod that already had it before its author put it
# behind Civitai Buzz.
IMAGE_DEFAULT_LORAS = (
    "Krea2_TextFusion_Refusal_Reduction.safetensors",
    "fedor_bypass.safetensors",
    "krea2filterbypass3.safetensors",
)


def _image_default_lora(names: list[str]) -> dict | None:
    """The row the image form opens with, or None when the pod has no prompt-unlock LoRA."""
    by_file = {Path(n).name: n for n in names}
    for wanted in IMAGE_DEFAULT_LORAS:
        if wanted in by_file:
            hint = LORA_HINTS.get(wanted, {})
            return {"name": by_file[wanted], "strength": hint.get("strength", 1.0)}
    return None


# Which base model a LoRA belongs to, so the clip form never offers a Krea 2 LoRA and the image
# form never offers an H3 one (owner 2026-09-20, seeing H3 LoRAs in the image picker: "lora ของ
# minmax h3 มันติดมาด้วย"). Picking the wrong one is a failed job, not a bad-looking picture.
#
# Read from the file itself, by the MODULE NAMES it patches: a LoRA has to name the modules of the
# model it was trained on, so those names are as physical as the weights. Two things that look
# like they would work do NOT: nearly every LoRA of both families uses the `diffusion_model.`
# prefix, and the layer WIDTHS are factored away by LoKr (HMCumshot stores 672x896 for H3's
# 5376x7168). Checked against the eight LoRAs the presets ship, across LoRA, LoKr and diff formats.
LORA_FAMILY_MARKERS = {
    "h3": (
        "attn_qkv_proj",
        "attn_out_proj",
        "mlp_fc1",
        "mlp_fc2",
        "audio_patch_proj",
        "adaln_proj",
    ),
    "krea2": ("txtfusion", "attn_wk", "attn_wq", "attn_wv", "attn_wo", "attn_gate"),
    # Qwen Image 2.1 fuses its image MLP into one `img_mlp.gate_up`; Qwen Image 1.x names it
    # `img_mlp.net.0.proj`, and a 1.x LoRA cannot load on 2.1, so the fused name is the marker.
    # Read off the headers of all seven Qwen 2.1 LoRAs the presets and lists carry (2026-09-26).
    "qwen21": ("img_mlp_gate_up",),
}
# A safetensors file starts with 8 bytes of little-endian header length then that much JSON. A real
# header is tens of KB; this ceiling only stops a corrupt length from asking for a huge read.
MAX_SAFETENSORS_HEADER = 32 << 20


def _safetensors_keys(path: Path) -> list[str] | None:
    """The tensor names in a safetensors file, or None if it cannot be read as one."""
    try:
        with path.open("rb") as fh:
            raw = fh.read(8)
            if len(raw) < 8:
                return None
            length = int.from_bytes(raw, "little")
            if not 0 < length <= MAX_SAFETENSORS_HEADER:
                return None
            head = json.loads(fh.read(length).decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(head, dict):
        return None
    return [k for k in head if k != "__metadata__"]


def _lora_family(path: Path) -> str | None:
    """ "h3", "krea2", "qwen21", or None when the file does not say — an unknown LoRA is offered
    in every form rather than hidden, because it may well be the user's own."""
    keys = _safetensors_keys(path)
    if not keys:
        return None
    flat = "\n".join(k.replace(".", "_").lower() for k in keys)
    hits = [
        family for family, markers in LORA_FAMILY_MARKERS.items() if any(m in flat for m in markers)
    ]
    # a file that somehow looks like both names nothing useful
    return hits[0] if len(hits) == 1 else None


def _lora_family_cached(cfg: Config, path: Path) -> str | None:
    """Same, remembered per file, because the browser re-reads the list on its poll."""
    try:
        stat = path.stat()
    except OSError:
        return None
    key = str(path)
    stamp = (stat.st_size, stat.st_mtime_ns)
    cached = cfg.lora_family_cache.get(key)
    if cached and cached[0] == stamp:
        return cached[1]
    family = _lora_family(path)
    cfg.lora_family_cache[key] = (stamp, family)
    return family


def _lora_files(cfg: Config) -> list[str]:
    """Every finished LoRA under models/loras, as ComfyUI names it (sub/folder/file). The H3
    turbo LoRA is left out: AiAngelH3 has turbo merged in, and adding it again breaks the look.
    So are the LoRAs a checkbox already loads (Fast, the image edit): picking one again would
    stack it twice."""
    root = cfg.models_dir / "loras"
    if not root.is_dir():
        return []
    built_in = {
        h3_workflows.TURBO_LORA,
        image_workflows.EDIT_LORA,
        *(name for name, _ in h3_workflows.FAST_LORAS),
    }
    names = []
    for path in root.rglob("*"):
        if path.suffix.lower() not in (".safetensors", ".ckpt", ".pt") or not path.is_file():
            continue
        if path.name in built_in or path.stat().st_size == 0:
            continue
        names.append(path.relative_to(root).as_posix())
    return sorted(names, key=str.lower)


def _requested_loras(cfg: Config, raw) -> list[tuple[str, float]]:
    """The form's LoRA rows as (file, strength), checked against what is really on disk. Raises
    ValueError with a message meant for the user."""
    if raw in (None, ""):
        return []
    if not isinstance(raw, list) or not all(isinstance(r, dict) for r in raw):
        raise ValueError("loras must be a list of {name, strength} objects")
    rows = [r for r in raw if str(r.get("name") or "").strip()]
    if len(rows) > MAX_LORAS:
        raise ValueError(f"{len(rows)} LoRAs; the form takes at most {MAX_LORAS}")
    have = set(_lora_files(cfg))
    out = []
    for r in rows:
        name = str(r["name"]).strip()
        if name not in have:
            raise ValueError(f"LoRA not found in models/loras: {name}")
        try:
            strength = float(r.get("strength", 1.0))
        except (TypeError, ValueError):
            raise ValueError(f"strength for {name} is not a number") from None
        lo, hi = LORA_STRENGTH_RANGE
        if not lo <= strength <= hi:
            raise ValueError(
                f"strength for {name} is {strength:g}; keep it between {lo:g} and {hi:g}"
            )
        out.append((name, strength))
    return out


def _image_unets(cfg: Config) -> list[str]:
    """The models on this pod that an image graph can sample, each family's stock one first.

    models/diffusion_models also holds the H3 video models, which neither image graph can run, so
    the list is the files whose NAME places them (image_workflows.family_of): Krea 2 is how the
    community names its fine-tunes, including the owner's own NSFW one (PornMaster Krea 2), and a
    Qwen Image 2.1 file carries 2.1 next to qwen. Offering the wrong file would only hand the user
    a failed job. Both stock names are always listed even before their preset has arrived, so
    picking one is how a user asks for it — the start then says which preset to download."""
    stock = list(STOCK_UNETS)
    names = []
    root = cfg.models_dir / "diffusion_models"
    if root.is_dir():
        for path in sorted(root.rglob("*"), key=lambda p: str(p).lower()):
            if path.suffix.lower() != ".safetensors" or not path.is_file():
                continue
            name = path.relative_to(root).as_posix()
            if name in stock or not path.stat().st_size:
                continue
            lowered = path.name.lower()
            if "krea" in lowered or image_workflows.family_of(name) == "qwen21":
                names.append(name)
    return [*stock, *names]


def _requested_unet(cfg: Config, raw) -> str:
    """The image form's model choice, checked against what is really on the pod."""
    name = str(raw or "").strip()
    if not name:
        # The same model /api/image/models advertises as `default`, and the one the form starts
        # on. It used to be Krea 2, on the reasoning that an older recipe carries no `unet` and
        # was made there — but the browser never reaches this fallback: it sends the picker's
        # value on every start, and a recipe with no `unet` makes the picker fall back to the
        # form default too (loadImageModels(r.unet)). So the only callers that landed on Krea 2
        # were scripts, and on a pod booted with the template's real default MODELS that is a
        # model which is not there: a bare t2i answered "image models not downloaded yet: krea2"
        # while /api/state said the image form needed nothing (measured on a pod 2026-09-21).
        return DEFAULT_IMAGE_UNET
    if name not in _image_unets(cfg):
        raise ValueError(f"model not found in models/diffusion_models: {name}")
    return name


async def get_image_models(request: web.Request) -> web.Response:
    """The models the image form can pick, read fresh so one downloaded from the Models tab (the
    NSFW kit's uncensored Krea 2, say) shows up without a restart. Each carries its family, which
    is what decides the graph, which LoRAs fit it and which preset it needs."""
    cfg: Config = request.app["cfg"]
    names = await asyncio.to_thread(_image_unets, cfg)
    return web.json_response(
        {
            "default": DEFAULT_IMAGE_UNET,
            "families": {
                f: {m: list(p) for m, p in modes.items()} for f, modes in IMAGE_PRESETS.items()
            },
            "models": [
                {"name": n, "family": image_workflows.family_of(n), "stock": n in STOCK_UNETS}
                for n in names
            ],
        }
    )


async def get_beginner_loras(request: web.Request) -> web.Response:
    """The LoRAs the form can pick, with the owner's starting strength and trigger word where
    known. Read fresh each time, so a LoRA downloaded from the Models tab shows up at once."""
    cfg: Config = request.app["cfg"]
    names = await asyncio.to_thread(_lora_files, cfg)
    root = cfg.models_dir / "loras"

    def described() -> list[dict]:
        out = []
        for n in names:
            family = _lora_family_cached(cfg, root / n)
            out.append({"name": n, **LORA_HINTS.get(Path(n).name, {}), "family": family})
        return out

    return web.json_response(
        {
            "max": MAX_LORAS,
            "loras": await asyncio.to_thread(described),
            "image_default": _image_default_lora(names),
        }
    )


async def get_beginner_example(request: web.Request) -> web.Response:
    """The example H3 prompt, so free-text mode has a starting point. It lives with the graph
    builder; the browser must not carry a second copy that drifts from it."""
    return web.json_response({"prompt": h3_workflows.EXAMPLE_PROMPT})


async def get_beginner_status(request: web.Request) -> web.Response:
    """The whole Create queue, newest first, in `jobs`; the newest job's fields also sit at the
    top level, the shape this route had when it tracked one clip."""
    cfg: Config = request.app["cfg"]
    jobs = await asyncio.to_thread(_jobs_views, cfg)
    if not jobs:
        return web.json_response({"state": "idle", "jobs": []})
    return web.json_response({**jobs[0], "jobs": jobs})


# ---------------------------------------------------------------------------
# CSRF: same rule as the patched ComfyUI server (docker/patch_comfy_origin.py)
# ---------------------------------------------------------------------------


@web.middleware
async def csrf_middleware(request: web.Request, handler):
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        is_page_open = (
            request.method == "GET"
            and request.headers.get("Sec-Fetch-Mode") == "navigate"
            and request.headers.get("Sec-Fetch-Dest") == "document"
        )
        if not is_page_open:
            return web.json_response({"error": "cross-site request refused"}, status=403)
    return await handler(request)


# ---------------------------------------------------------------------------
# static front end (owned by another lane, docker/dashboard/web/)
# ---------------------------------------------------------------------------


def _add_static_routes(app: web.Application, web_dir: Path) -> None:
    async def missing(request: web.Request) -> web.Response:
        return web.Response(text="dashboard front end missing", status=200)

    if not web_dir.is_dir():
        app.router.add_get("/", missing)
        return

    # Every pod answers on a different host name but the SAME paths, so a browser that used an
    # older pod yesterday would happily serve its cached app.js against today's image. no-cache
    # means revalidate, not re-download: unchanged files still come back as a 304.
    FRESH = {"Cache-Control": "no-cache"}

    async def index(request: web.Request) -> web.Response:
        idx = web_dir / "index.html"
        if idx.is_file():
            return web.FileResponse(idx, headers=FRESH)
        return web.Response(text="dashboard front end missing", status=200)

    async def by_name(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        path = (web_dir / name).resolve()
        try:
            path.relative_to(web_dir.resolve())
        except ValueError:
            raise web.HTTPNotFound() from None
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers=FRESH)

    app.router.add_static("/static/", web_dir, show_index=False)
    app.router.add_get("/", index)
    app.router.add_get("/{name}", by_name)


def build_app(**overrides) -> web.Application:
    cfg = Config.from_env(**overrides)
    app = web.Application(middlewares=[csrf_middleware], client_max_size=MAX_REQUEST_BYTES)
    app["cfg"] = cfg
    app.router.add_get("/api/state", get_state)
    app.router.add_post("/api/keys", post_keys)
    app.router.add_post("/api/download", post_download)
    app.router.add_post("/api/preset", post_preset)
    app.router.add_get("/api/kit/nsfw", get_nsfw_kit)
    app.router.add_get("/api/kit/extras", get_extras_list)
    app.router.add_get("/api/outputs", get_outputs)
    app.router.add_get("/api/outputs/file", get_outputs_file)
    app.router.add_get("/api/outputs/recipe", get_outputs_recipe)
    app.router.add_get("/api/beginner/ref", get_beginner_ref)
    app.router.add_get("/api/beginner/loras", get_beginner_loras)
    app.router.add_get("/api/image/models", get_image_models)
    app.router.add_post("/api/outputs/zip", post_outputs_zip)
    app.router.add_post("/api/outputs/delete", post_outputs_delete)
    app.router.add_post("/api/comfy/restart", post_comfy_restart)
    app.router.add_get("/api/logs", get_logs)
    app.router.add_post("/api/beginner/upload", post_beginner_upload)
    app.router.add_post("/api/beginner/start", post_beginner_start)
    app.router.add_post("/api/beginner/cancel", post_gen_cancel)
    app.router.add_post("/api/beginner/preview", post_beginner_preview)
    app.router.add_get("/api/beginner/example", get_beginner_example)
    app.router.add_get("/api/beginner/status", get_beginner_status)
    app.router.add_post("/api/beginner/ref-from-output", post_ref_from_output)
    app.router.add_post("/api/image/start", post_image_start)
    app.router.add_post("/api/workflow", post_workflow)
    app.on_startup.append(_start_listener)
    app.on_cleanup.append(_stop_listener)
    _add_static_routes(app, cfg.web_dir)
    return app


def main() -> None:
    port = int(os.environ.get("DASHBOARD_PORT", "8189"))
    web.run_app(build_app(), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
