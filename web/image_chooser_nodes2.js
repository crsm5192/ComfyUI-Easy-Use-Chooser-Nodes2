import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let active = null;

function enableImageZoom(viewport, images, signal) {
  let scale = 1;
  let x = 0;
  let y = 0;
  let pan = null;
  const badge = document.createElement("span");
  badge.className = "easyuse-chooser-zoom-level";
  badge.setAttribute("aria-hidden", "true");
  viewport.append(badge);
  viewport.title = "滚轮缩放；按住鼠标中键拖动；双击恢复适应";
  function render() {
    const { width, height } = viewport.getBoundingClientRect();
    if (width && height) {
      x = scale < 1 ? width * (1 - scale) / 2 : Math.max(width * (1 - scale), Math.min(0, x));
      y = scale < 1 ? height * (1 - scale) / 2 : Math.max(height * (1 - scale), Math.min(0, y));
    }
    for (const image of images) image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    viewport.dataset.zoom = String(scale);
    badge.textContent = `${Math.round(scale * 100)}%`;
  }
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = viewport.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
    const next = Math.max(0.25, Math.min(8, scale * Math.exp(-delta * 0.002)));
    const ratio = next / scale;
    x = event.clientX - rect.left - (event.clientX - rect.left - x) * ratio;
    y = event.clientY - rect.top - (event.clientY - rect.top - y) * ratio;
    scale = next;
    render();
  }, { passive: false, signal });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  }, { signal });
  viewport.addEventListener("pointermove", (event) => {
    if (pan?.id !== event.pointerId) return;
    x += event.clientX - pan.x;
    y += event.clientY - pan.y;
    pan.x = event.clientX;
    pan.y = event.clientY;
    render();
  }, { signal });
  viewport.addEventListener("lostpointercapture", () => {
    pan = null;
    viewport.classList.remove("is-panning");
  }, { signal });
  viewport.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  }, { signal });
  viewport.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    scale = 1;
    x = y = 0;
    render();
  }, { signal });
  const resize = new ResizeObserver(render);
  resize.observe(viewport);
  signal.addEventListener("abort", () => resize.disconnect(), { once: true });
  render();
}

function closeChooser() {
  if (!active) return;
  cancelAnimationFrame(active.frame);
  active.listeners.abort();
  active.dialog.close();
  active.dialog.remove();
  active = null;
}

function showChooser({ id, urls }) {
  if (!app.ui.settings.getSettingValue("Comfy.VueNodes.Enabled")) return;
  const node = app.graph.getNodeById(id);
  if (node?.comfyClass !== "easy imageChooser" || !urls?.length) return;
  closeChooser();

  const dialog = document.createElement("dialog");
  dialog.className = "easyuse-nodes2-chooser";
  dialog.dataset.nodeId = String(id);
  const heading = document.createElement("h2");
  heading.id = "easyuse-nodes2-chooser-title";
  heading.textContent = `${node.title || "选择图片"} · 选择结果`;
  dialog.setAttribute("aria-labelledby", heading.id);
  const header = document.createElement("div");
  header.className = "easyuse-chooser-header";
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.dataset.action = "collapse";
  collapse.textContent = "收起看画布";
  collapse.setAttribute("aria-expanded", "true");
  header.append(heading, collapse);
  const content = document.createElement("div");
  content.className = "easyuse-chooser-content";
  const hint = document.createElement("p");
  hint.textContent = "点击图片选中，可多选。图片上滚轮缩放，中键拖动查看细节，双击恢复适应。拖动标题移动窗口，拖动右下角调整窗口大小，或收起后查看画布。";
  const grid = document.createElement("div");
  grid.className = "easyuse-chooser-images";
  const status = document.createElement("p");
  status.className = "easyuse-chooser-status";
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "easyuse-chooser-actions";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "停止本次运行";
  stop.dataset.action = "cancel";
  const proceed = document.createElement("button");
  proceed.type = "button";
  proceed.textContent = "继续工作流";
  proceed.dataset.action = "select";
  actions.append(stop, proceed);
  content.append(hint, grid, status, actions);
  dialog.append(header, content);
  document.body.append(dialog);

  const selected = new Set();
  const state = { dialog, busy: false, frame: 0, listeners: new AbortController() };
  active = state;
  function moveTo(left, top) {
    const rect = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(0, Math.min(left, window.innerWidth - rect.width))}px`;
    dialog.style.top = `${Math.max(0, Math.min(top, window.innerHeight - rect.height))}px`;
    dialog.style.right = "auto";
  }
  function keepOnScreen() {
    if (!dialog.open) return;
    const rect = dialog.getBoundingClientRect();
    moveTo(rect.left, rect.top);
  }
  const grip = document.createElement("div");
  grip.className = "easyuse-chooser-resize";
  grip.title = "拖动调整窗口大小，双击恢复默认";
  grip.tabIndex = 0;
  grip.setAttribute("aria-label", "调整窗口大小：方向键微调，Shift 加速，双击恢复默认");
  function resetManualSize() {
    dialog.classList.remove("is-manual");
    dialog.style.width = "";
    dialog.style.height = "";
  }
  function applyManualSize(width, height) {
    const rect = dialog.getBoundingClientRect();
    dialog.style.width = `${Math.round(Math.max(340, Math.min(width, window.innerWidth - rect.left - 12)))}px`;
    dialog.style.height = `${Math.round(Math.max(160, Math.min(height, window.innerHeight - rect.top - 12)))}px`;
    dialog.classList.add("is-manual");
    keepOnScreen();
  }
  let resize = null;
  grip.onpointerdown = (event) => {
    if (event.button !== 0 || content.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = dialog.getBoundingClientRect();
    resize = { id: event.pointerId, width: rect.width, height: rect.height, x: event.clientX, y: event.clientY };
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = (event) => {
    if (resize?.id !== event.pointerId) return;
    applyManualSize(resize.width + event.clientX - resize.x, resize.height + event.clientY - resize.y);
  };
  grip.onlostpointercapture = () => { resize = null; };
  grip.ondblclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetManualSize();
    keepOnScreen();
  };
  grip.onkeydown = (event) => {
    const step = event.shiftKey ? 80 : 20;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    applyManualSize(rect.width + move[0], rect.height + move[1]);
  };
  dialog.append(grip);
  function setCollapsed(value) {
    dialog.classList.toggle("is-collapsed", value);
    content.hidden = value;
    collapse.textContent = value ? "展开选图" : "收起看画布";
    collapse.setAttribute("aria-expanded", String(!value));
    if (value) resetManualSize();
    keepOnScreen();
    if (value) collapse.focus({ preventScroll: true });
  }
  collapse.onclick = () => setCollapsed(!content.hidden);
  let drag = null;
  header.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = dialog.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  header.onpointermove = (event) => {
    if (drag?.id === event.pointerId) moveTo(event.clientX - drag.x, event.clientY - drag.y);
  };
  header.onlostpointercapture = () => { drag = null; };
  window.addEventListener("resize", keepOnScreen, { signal: state.listeners.signal });
  function updateSelection() {
    proceed.disabled = state.busy || selected.size === 0;
    stop.disabled = state.busy;
    status.textContent = selected.size
      ? `已选 ${selected.size} / ${urls.length} 张`
      : "请选择要传给下一步的图片";
    node.selected_images = new Set(selected);
    node.update();
  }

  urls.forEach((data, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "easyuse-chooser-image";
    tile.dataset.index = String(index);
    tile.setAttribute("aria-pressed", "false");
    tile.setAttribute("aria-label", `选择图片 ${index + 1}`);
    const img = document.createElement("img");
    img.src = api.apiURL(`/view?${new URLSearchParams({
      filename: data.filename, subfolder: data.subfolder || "", type: data.type || "temp",
    })}`);
    img.alt = `图片 ${index + 1}`;
    img.draggable = false;
    const viewport = document.createElement("div");
    viewport.className = "easyuse-chooser-image-viewport";
    viewport.append(img);
    enableImageZoom(viewport, [img], state.listeners.signal);
    const label = document.createElement("span");
    label.textContent = `图片 ${index + 1}`;
    tile.append(viewport, label);
    tile.onclick = (event) => {
      if (state.busy || event.button !== 0) return;
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      tile.setAttribute("aria-pressed", String(selected.has(index)));
      updateSelection();
    };
    grid.append(tile);
  });

  if (urls.length >= 2) {
    const compareButton = document.createElement("button");
    compareButton.type = "button";
    compareButton.dataset.action = "compare";
    compareButton.textContent = "对比图片";
    compareButton.setAttribute("aria-expanded", "false");
    const compare = document.createElement("div");
    compare.className = "easyuse-chooser-compare";
    compare.hidden = true;
    const toolbar = document.createElement("div");
    toolbar.className = "easyuse-chooser-compare-toolbar";
    const stage = document.createElement("div");
    stage.className = "easyuse-chooser-compare-stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "slider");
    stage.setAttribute("aria-label", "图片对比分界线");
    stage.setAttribute("aria-valuemin", "0");
    stage.setAttribute("aria-valuemax", "100");
    const imageB = document.createElement("img");
    const imageA = document.createElement("img");
    imageA.className = "easyuse-chooser-compare-a";
    imageA.draggable = imageB.draggable = false;
    const reveal = document.createElement("div");
    reveal.className = "easyuse-chooser-compare-reveal";
    reveal.append(imageA);
    const divider = document.createElement("span");
    divider.className = "easyuse-chooser-compare-divider";
    divider.setAttribute("aria-hidden", "true");
    stage.append(imageB, reveal, divider);
    enableImageZoom(stage, [imageB, imageA], state.listeners.signal);
    for (const [side, image, initial] of [["A", imageA, 0], ["B", imageB, 1]]) {
      const label = document.createElement("label");
      label.append(`${side === "A" ? "左侧" : "右侧"} ${side}：`);
      const select = document.createElement("select");
      select.dataset.side = side;
      for (let index = 0; index < urls.length; index++) {
        select.add(new Option(`图片 ${index + 1}`, String(index)));
      }
      select.value = String(initial);
      function updateImage() {
        image.src = grid.children[Number(select.value)].querySelector("img").src;
        image.alt = `${side} · 图片 ${Number(select.value) + 1}`;
      }
      select.onchange = updateImage;
      updateImage();
      label.append(select);
      toolbar.append(label);
    }
    const enlarge = document.createElement("button");
    enlarge.type = "button";
    enlarge.dataset.action = "enlarge";
    enlarge.textContent = "放大查看";
    enlarge.onclick = () => {
      const large = dialog.classList.toggle("is-large");
      resetManualSize();
      enlarge.textContent = large ? "缩小窗口" : "放大查看";
      keepOnScreen();
    };
    toolbar.append(enlarge);
    const sliderLabel = document.createElement("label");
    sliderLabel.className = "easyuse-chooser-compare-slider";
    sliderLabel.append("左键拖动分界线；滚轮同步缩放，中键拖动查看细节，双击恢复适应。对比不会改变已选图片。 ");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    function setPosition(value) {
      const position = Math.max(0, Math.min(100, value));
      stage.style.setProperty("--chooser-compare-position", `${position}%`);
      stage.setAttribute("aria-valuenow", String(Math.round(position)));
      slider.value = String(position);
    }
    function point(event) {
      const rect = stage.getBoundingClientRect();
      if (rect.width) setPosition(100 * (event.clientX - rect.left) / rect.width);
    }
    stage.onpointerdown = (event) => {
      if (event.button !== 0) return;
      stage.setPointerCapture(event.pointerId);
      stage.focus({ preventScroll: true });
      point(event);
      event.preventDefault();
    };
    stage.onpointermove = (event) => {
      if ((event.buttons & 1) && stage.hasPointerCapture(event.pointerId)) point(event);
    };
    stage.onkeydown = (event) => {
      const current = Number(slider.value);
      const step = event.shiftKey ? 10 : 1;
      const next = { ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: 100 }[event.key];
      if (next == null) return;
      event.preventDefault();
      event.stopPropagation();
      setPosition(next);
    };
    slider.oninput = () => setPosition(Number(slider.value));
    setPosition(50);
    sliderLabel.append(slider);
    compare.append(toolbar, stage, sliderLabel);
    content.insertBefore(compareButton, grid);
    content.insertBefore(compare, grid);
    compareButton.onclick = () => {
      compare.hidden = !compare.hidden;
      grid.hidden = !compare.hidden;
      compareButton.textContent = compare.hidden ? "对比图片" : "返回选图";
      compareButton.setAttribute("aria-expanded", String(!compare.hidden));
      if (compare.hidden) {
        dialog.classList.remove("is-large");
        resetManualSize();
        enlarge.textContent = "放大查看";
      }
      keepOnScreen();
    };
  }

  async function submit(action) {
    if (state.busy || (action === "select" && !selected.size)) return;
    state.busy = true;
    updateSelection();
    status.textContent = action === "select" ? "正在继续…" : "正在停止…";
    try {
      const response = await api.fetchApi("/easyuse/image_chooser_message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: String(id), action,
          selected: action === "select" ? [...selected] : [],
        }),
      });
      const result = await response.json();
      if (!response.ok || result.code !== 1) {
        throw new Error(result.error || result.message || `HTTP ${response.status}`);
      }
      node.isWaitingSelection = false;
      node.setExecutingState(false);
      node.update();
      if (active === state) closeChooser();
    } catch (error) {
      if (active !== state) return;
      state.busy = false;
      updateSelection();
      status.textContent = `未能提交，请重试：${error.message}`;
    }
  }

  proceed.onclick = () => submit("select");
  stop.onclick = () => submit("cancel");
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    setCollapsed(true);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setCollapsed(true);
  });
  updateSelection();
  // Keep Last Selection may immediately send a second event without pausing.
  state.frame = requestAnimationFrame(() => {
    if (active === state) {
      dialog.show();
      keepOnScreen();
    }
  });
}

app.registerExtension({
  name: "Comfy.EasyUse.imageChooser.Nodes2",
  setup() {
    const style = document.createElement("style");
    style.textContent = `
      .easyuse-nodes2-chooser { box-sizing: border-box; position: fixed; inset: 80px 20px auto auto;
        z-index: 10000; margin: 0; width: min(620px, calc(100vw - 32px));
        max-height: calc(100vh - 32px); padding: 16px; border: 1px solid #626262; border-radius: 12px;
        background: #202020; color: #eee; font: 14px system-ui, sans-serif; box-shadow: 0 8px 30px #0008;
        display: flex; flex-direction: column; }
      .easyuse-nodes2-chooser [hidden] { display: none !important; }
      .easyuse-nodes2-chooser:not([open]) { display: none; }
      .easyuse-nodes2-chooser.is-large { width: min(1100px, calc(100vw - 32px)); }
      .easyuse-nodes2-chooser.is-collapsed { width: min(380px, calc(100vw - 32px)); }
      .easyuse-nodes2-chooser.is-manual { width: auto; }
      .easyuse-nodes2-chooser.is-manual .easyuse-chooser-content { display: flex; flex-direction: column; }
      .easyuse-nodes2-chooser.is-manual .easyuse-chooser-images { flex: 1 1 auto; min-height: 0;
        max-height: none; grid-auto-rows: minmax(240px, 1fr); }
      .easyuse-nodes2-chooser.is-manual .easyuse-chooser-image-viewport { flex: 1 1 auto; min-height: 0; height: auto; }
      .easyuse-nodes2-chooser.is-manual .easyuse-chooser-compare { display: flex; flex-direction: column;
        flex: 1 1 auto; min-height: 0; }
      .easyuse-nodes2-chooser.is-manual .easyuse-chooser-compare-stage { flex: 1 1 auto; min-height: 220px; height: auto; }
      .easyuse-chooser-header { display: flex; align-items: center; justify-content: space-between;
        gap: 12px; cursor: move; touch-action: none; user-select: none; }
      .easyuse-nodes2-chooser h2 { margin: 0; font-size: 18px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .easyuse-chooser-content { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 110px);
        overflow-y: auto; }
      .easyuse-chooser-resize { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px;
        cursor: nwse-resize; touch-action: none; border-bottom-right-radius: 12px; }
      .easyuse-chooser-resize::before { content: ""; position: absolute; inset: 5px 5px 4px 4px;
        background: repeating-linear-gradient(135deg, transparent 0 4px, #8a8a8a 4px 6px); }
      .easyuse-chooser-resize:hover::before, .easyuse-chooser-resize:focus-visible::before {
        background: repeating-linear-gradient(135deg, transparent 0 4px, #cfcfcf 4px 6px); }
      .easyuse-chooser-resize:focus-visible { outline: 1px solid #52d38a; outline-offset: -1px; }
      .easyuse-nodes2-chooser.is-collapsed .easyuse-chooser-resize { display: none; }
      .easyuse-nodes2-chooser p { margin: 12px 0; }
      .easyuse-chooser-images { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px; max-height: 55vh; overflow-y: auto; padding: 4px; }
      .easyuse-nodes2-chooser button { cursor: pointer; font: inherit; color: #eee; }
      .easyuse-chooser-header button, .easyuse-chooser-content > button,
      .easyuse-chooser-compare-toolbar button { padding: 6px 10px; border: 1px solid #666;
        border-radius: 6px; background: #383838; white-space: nowrap; }
      .easyuse-chooser-image { display: flex; flex-direction: column; align-items: center;
        gap: 8px; padding: 10px; border: 3px solid #555; border-radius: 8px; background: #303030; }
      .easyuse-chooser-image-viewport { position: relative; width: 100%; height: 240px;
        overflow: hidden; background: #111; touch-action: none; }
      .easyuse-chooser-image img { display: block; width: 100%; height: 100%; object-fit: contain;
        transform-origin: 0 0; pointer-events: none; }
      .easyuse-chooser-zoom-level { position: absolute; right: 6px; bottom: 6px;
        padding: 2px 5px; border-radius: 4px; background: #000a; color: #fff;
        font-size: 12px; pointer-events: none; }
      .easyuse-chooser-image-viewport.is-panning, .easyuse-chooser-compare-stage.is-panning { cursor: grabbing; }
      .easyuse-chooser-image[aria-pressed="true"] { border-color: #52d38a; background: #234536; }
      .easyuse-chooser-actions { display: flex; justify-content: flex-end; gap: 12px; }
      .easyuse-chooser-actions button { padding: 10px 20px; border: 1px solid #666;
        border-radius: 6px; background: #383838; }
      .easyuse-chooser-actions [data-action="select"] { background: #246d45; }
      .easyuse-nodes2-chooser button:disabled { opacity: .45; cursor: default; }
      .easyuse-chooser-status { min-height: 20px; }
      .easyuse-chooser-compare-toolbar { display: flex; flex-wrap: wrap; align-items: center;
        gap: 12px; margin: 12px 0; }
      .easyuse-chooser-compare-toolbar select { color: #eee; background: #383838;
        border: 1px solid #666; padding: 5px; border-radius: 4px; font: inherit; }
      .easyuse-chooser-compare-stage { position: relative; height: min(45vh, 380px);
        background: #111; overflow: hidden; cursor: ew-resize; touch-action: none; }
      .is-large .easyuse-chooser-compare-stage { height: min(65vh, 650px); }
      .easyuse-chooser-compare-stage img { position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: contain; pointer-events: none; transform-origin: 0 0; }
      .easyuse-chooser-compare-reveal { position: absolute; inset: 0; pointer-events: none;
        clip-path: inset(0 calc(100% - var(--chooser-compare-position)) 0 0); }
      .easyuse-chooser-compare-divider { position: absolute; top: 0; bottom: 0;
        left: var(--chooser-compare-position); width: 2px; background: #fff;
        box-shadow: 0 0 4px #000; pointer-events: none; }
      .easyuse-chooser-compare-slider { display: block; margin: 12px 0; }
      .easyuse-chooser-compare-slider input { display: block; width: 100%; margin: 10px 0; }
    `;
    document.head.append(style);
    api.addEventListener("easyuse-image-choose", (event) => showChooser(event.detail));
    api.addEventListener("easyuse-image-keep-selection", (event) => {
      if (active && String(event.detail.id) === active.dialog.dataset.nodeId) closeChooser();
    });
    for (const event of ["execution_start", "execution_error", "execution_interrupted"]) {
      api.addEventListener(event, closeChooser);
    }
    api.addEventListener("executing", (event) => {
      if (active && String(event.detail) !== active.dialog.dataset.nodeId) closeChooser();
    });
  },
});
