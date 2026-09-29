const PREVIEW_EDGE = 1400;
const EXPORT_EDGE = 2600;

const PRESETS = {
  reference: { size: 4.2, contrast: 1.05, gamma: 1.35, white: 0.9, ink: 1.5, angle: 0 },
  fine: { size: 2.8, contrast: 1.0, gamma: 1.15, white: 0.94, ink: 1.28, angle: 15 },
  poster: { size: 11, contrast: 1.4, gamma: 1.5, white: 0.86, ink: 1.62, angle: 45 },
};

const view = document.getElementById("view");
const original = document.getElementById("original");
const frame = document.getElementById("frame");
const stage = document.getElementById("stage");
const statusEl = document.getElementById("status");
const fileInput = document.getElementById("file");
const downloadBtn = document.getElementById("download");
const overlay = document.getElementById("overlay");
const presets = document.getElementById("presets");
const angles = document.getElementById("angles");
const papers = document.getElementById("papers");
const inks = document.getElementById("inks");
const whiteField = document.getElementById("white-field");

const fields = {
  size: document.getElementById("size"),
  contrast: document.getElementById("contrast"),
  gamma: document.getElementById("gamma"),
  white: document.getElementById("white"),
  ink: document.getElementById("ink"),
  knockout: document.getElementById("knockout"),
  transparent: document.getElementById("transparent"),
};

const labels = {
  size: document.getElementById("size-val"),
  contrast: document.getElementById("contrast-val"),
  gamma: document.getElementById("gamma-val"),
  white: document.getElementById("white-val"),
  ink: document.getElementById("ink-val"),
};

let sourceBitmap = null;
let previewCanvas = null;
let sourceName = "";
let renderToken = 0;
let dragDepth = 0;

function readSettings() {
  return {
    size: Number(fields.size.value),
    contrast: Number(fields.contrast.value),
    gamma: Number(fields.gamma.value),
    white: Number(fields.white.value),
    ink: Number(fields.ink.value),
    angle: Number(angles.querySelector(".is-on").dataset.angle),
    paper: swatchColor(papers, "paper"),
    inkColor: swatchColor(inks, "ink"),
    knockout: fields.knockout.checked,
    transparent: fields.transparent.checked,
  };
}

function syncLabels() {
  labels.size.textContent = Number(fields.size.value).toFixed(1);
  labels.contrast.textContent = Number(fields.contrast.value).toFixed(2);
  labels.gamma.textContent = Number(fields.gamma.value).toFixed(2);
  labels.white.textContent = `${Math.round(Number(fields.white.value) * 100)}%`;
  labels.ink.textContent = Number(fields.ink.value).toFixed(2);
  whiteField.classList.toggle("is-off", !fields.knockout.checked);
}

function applyTheme(settings) {
  frame.classList.toggle("is-clear", settings.transparent);
}

function swatchColor(container, key) {
  const custom = container.querySelector(".picker.is-on input");
  if (custom) return custom.value;
  return container.querySelector("button.is-on").dataset[key];
}

function selectSwatch(container, button) {
  container.querySelector(".picker").classList.remove("is-on");
  setPressed(container, button);
  const picker = container.querySelector("input[type='color']");
  picker.value = button.dataset.paper || button.dataset.ink;
}

function selectCustomColor(container) {
  container.querySelectorAll("button").forEach((item) => {
    item.classList.remove("is-on");
    item.setAttribute("aria-pressed", "false");
  });
  container.querySelector(".picker").classList.add("is-on");
  renderPreview();
}

function setPressed(container, button) {
  container.querySelectorAll("button").forEach((item) => {
    const on = item === button;
    item.classList.toggle("is-on", on);
    item.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function clearPreset() {
  presets.querySelectorAll("button").forEach((item) => {
    item.classList.remove("is-on");
    item.setAttribute("aria-pressed", "false");
  });
}

function applyPreset(name) {
  const preset = PRESETS[name];
  fields.size.value = String(preset.size);
  fields.contrast.value = String(preset.contrast);
  fields.gamma.value = String(preset.gamma);
  fields.white.value = String(preset.white);
  fields.ink.value = String(preset.ink);
  setPressed(angles, angles.querySelector(`[data-angle="${preset.angle}"]`));
  setPressed(presets, presets.querySelector(`[data-preset="${name}"]`));
  syncLabels();
  renderPreview();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || "");
}

async function decodeFile(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

function raster(bitmap, edge) {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = edge / longest;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function lumaOf(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function satOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function readCell(data, width, height, x, y, cell) {
  const points = [[0, 0]];
  if (cell >= 4) {
    const d = cell * 0.28;
    points.push([d, 0], [-d, 0], [0, d], [0, -d]);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of points) {
    const px = Math.min(width - 1, Math.max(0, Math.round(x + dx)));
    const py = Math.min(height - 1, Math.max(0, Math.round(y + dy)));
    const index = (py * width + px) * 4;
    const alpha = data[index + 3] / 255;
    r += data[index] * alpha + 255 * (1 - alpha);
    g += data[index + 1] * alpha + 255 * (1 - alpha);
    b += data[index + 2] * alpha + 255 * (1 - alpha);
  }
  const count = points.length;
  return [r / count, g / count, b / count];
}

function darknessOf(r, g, b, settings) {
  const light = lumaOf(r, g, b);
  const sat = satOf(r, g, b);
  let tone = Math.pow(Math.min(1, Math.max(0, light)), settings.gamma);
  tone = (tone - 0.5) * settings.contrast + 0.5;
  tone = Math.min(1, Math.max(0, tone));
  let darkness = 1 - tone;
  if (settings.knockout && sat < 0.22) {
    const fadeStart = settings.white - 0.08;
    if (light >= settings.white) darkness = 0;
    else if (light > fadeStart) darkness *= 1 - (light - fadeStart) / (settings.white - fadeStart);
  }
  return darkness;
}

function paintHalftone(dest, source, settings) {
  const width = source.width;
  const height = source.height;
  const image = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  const data = image.data;
  dest.width = width;
  dest.height = height;
  const ctx = dest.getContext("2d");
  if (settings.transparent) ctx.clearRect(0, 0, width, height);
  else {
    ctx.fillStyle = settings.paper;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = settings.inkColor;

  const cell = Math.max(2, (settings.size * Math.max(width, height)) / 1000);
  const rad = (settings.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const gx = x * cos + y * sin;
    const gy = -x * sin + y * cos;
    minX = Math.min(minX, gx);
    maxX = Math.max(maxX, gx);
    minY = Math.min(minY, gy);
    maxY = Math.max(maxY, gy);
  }
  const x0 = Math.floor((minX - cell) / cell) * cell;
  const y0 = Math.floor((minY - cell) / cell) * cell;
  const x1 = maxX + cell;
  const y1 = maxY + cell;
  let batch = 0;
  ctx.beginPath();

  for (let gy = y0; gy <= y1; gy += cell) {
    for (let gx = x0; gx <= x1; gx += cell) {
      const x = gx * cos - gy * sin;
      const y = gx * sin + gy * cos;
      if (x < -cell || y < -cell || x > width + cell || y > height + cell) continue;
      const [r, g, b] = readCell(data, width, height, x, y, cell);
      const darkness = darknessOf(r, g, b, settings);
      if (darkness <= 0.012) continue;
      const radius = Math.sqrt(darkness) * cell * 0.5 * settings.ink;
      if (radius < 0.4) continue;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      batch += 1;
      if (batch >= 5000) {
        ctx.fill();
        ctx.beginPath();
        batch = 0;
      }
    }
  }
  if (batch) ctx.fill();
}

function fitView() {
  if (!view.width || !view.height) return;
  frame.style.setProperty("--ratio", String(view.width / view.height));
}

function renderPreview() {
  if (!previewCanvas) return;
  const token = ++renderToken;
  const settings = readSettings();
  applyTheme(settings);
  requestAnimationFrame(() => {
    if (token !== renderToken) return;
    paintHalftone(view, previewCanvas, settings);
    fitView();
    statusEl.textContent = `${sourceName} · ${view.width} × ${view.height}`;
  });
}

async function setBitmap(bitmap, name) {
  sourceBitmap = bitmap;
  sourceName = name;
  previewCanvas = raster(bitmap, PREVIEW_EDGE);
  original.src = previewCanvas.toDataURL("image/jpeg", 0.86);
  document.getElementById("empty").hidden = true;
  frame.hidden = false;
  downloadBtn.disabled = false;
  renderPreview();
}

async function loadFile(file) {
  if (!isImageFile(file)) {
    statusEl.textContent = "请上传 JPG、PNG 或 WebP · Use a JPG, PNG, or WebP";
    return;
  }
  statusEl.textContent = "正在读图… Reading…";
  try {
    const bitmap = await decodeFile(file);
    await setBitmap(bitmap, file.name.replace(/\.[^.]+$/, "") || "照片 Photo");
  } catch {
    statusEl.textContent = "这张图读不了，换一张 JPG 或 PNG · Couldn’t read this image. Try a JPG or PNG";
  }
}

function showOriginal(show) {
  if (!original.src) return;
  original.hidden = !show;
  view.style.visibility = show ? "hidden" : "visible";
}

function filename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `网点-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}

async function download() {
  if (!sourceBitmap || downloadBtn.disabled) return;
  downloadBtn.disabled = true;
  statusEl.textContent = "正在导出… Exporting…";
  await nextFrame();
  const big = raster(sourceBitmap, EXPORT_EDGE);
  const out = document.createElement("canvas");
  paintHalftone(out, big, readSettings());
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) {
    downloadBtn.disabled = false;
    statusEl.textContent = "导出失败，请再试一次 · Export failed. Try again";
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename();
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  downloadBtn.disabled = false;
  statusEl.textContent = `已导出 Exported ${out.width} × ${out.height}`;
}


document.getElementById("pick").addEventListener("click", () => fileInput.click());
document.getElementById("empty").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) loadFile(file);
  fileInput.value = "";
});
downloadBtn.addEventListener("click", download);

const compare = document.getElementById("compare");
compare.addEventListener("pointerdown", (event) => {
  compare.setPointerCapture(event.pointerId);
  showOriginal(true);
});
compare.addEventListener("pointerup", () => showOriginal(false));
compare.addEventListener("pointercancel", () => showOriginal(false));

["size", "contrast", "gamma", "white", "ink"].forEach((key) => {
  fields[key].addEventListener("input", () => {
    clearPreset();
    syncLabels();
    renderPreview();
  });
});

fields.knockout.addEventListener("input", () => {
  syncLabels();
  renderPreview();
});
fields.transparent.addEventListener("input", renderPreview);

presets.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  applyPreset(button.dataset.preset);
});

angles.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  setPressed(angles, button);
  clearPreset();
  renderPreview();
});

papers.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  selectSwatch(papers, button);
  renderPreview();
});

inks.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  selectSwatch(inks, button);
  renderPreview();
});

document.getElementById("paper-picker").addEventListener("input", () => selectCustomColor(papers));
document.getElementById("ink-picker").addEventListener("input", () => selectCustomColor(inks));

window.addEventListener("resize", fitView);

window.addEventListener("paste", (event) => {
  const items = event.clipboardData && event.clipboardData.files;
  if (!items) return;
  const file = [...items].find(isImageFile);
  if (file) loadFile(file);
});

window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
  dragDepth += 1;
  overlay.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadFile(file);
});

syncLabels();
