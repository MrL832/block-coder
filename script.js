/* Block Coder (highly simplified Scratch-style toy) */

const BLOCKS = {
  MOVE_FORWARD: { label: "Move Forward", css: "block-move" },
  TURN_RIGHT: { label: "Turn Right", css: "block-turn" },
  CHANGE_COLOR: { label: "Change Color", css: "block-color" },
  REPEAT: { label: "Repeat", css: "block-repeat" },
};

const palette = document.getElementById("palette");
const workspaceDropZone = document.getElementById("workspaceDropZone");
const workspaceList = document.getElementById("workspaceList");
const emptyWorkspace = document.getElementById("emptyWorkspace");

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const goBtn = document.getElementById("goBtn");
const stopBtn = document.getElementById("stopBtn");

// Repeat modal elements
const repeatModal = document.getElementById("repeatModal");
const repeatCountEl = document.getElementById("repeatCount");
const repeatDec = document.getElementById("repeatDec");
const repeatInc = document.getElementById("repeatInc");
const repeatCancel = document.getElementById("repeatCancel");
const repeatOk = document.getElementById("repeatOk");

let runId = 0;
let running = false;

// ---------- Drag + Drop ----------
const paletteBlocks = [...palette.querySelectorAll(".blockCard")];
const dropIndicator = document.createElement("li");
dropIndicator.className = "dropIndicator";
dropIndicator.id = "dropIndicator";
dropIndicator.textContent = "Drop here";

function showEmptyHintIfNeeded() {
  const hasAny = [...workspaceList.children].some(
    (n) => n instanceof HTMLElement && n.classList.contains("wsBlock")
  );
  emptyWorkspace.style.display = hasAny ? "none" : "block";
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function makeWorkspaceBlock(type) {
  const meta = BLOCKS[type];
  const li = document.createElement("li");
  li.className = `wsBlock ${meta.css}`;
  li.dataset.type = type;
  li.dataset.id = makeId();
  li.draggable = true;
  li.setAttribute("aria-label", `${meta.label} in workspace`);

  const row = document.createElement("div");
  row.className = "wsRow";

  const left = document.createElement("div");
  left.className = "wsMeta";
  const grip = document.createElement("div");
  grip.className = "wsGrip";
  grip.setAttribute("aria-hidden", "true");
  grip.textContent = "≡";
  const text = document.createElement("div");
  text.textContent = meta.label;
  left.appendChild(grip);
  left.appendChild(text);

  const remove = document.createElement("button");
  remove.className = "wsRemove";
  remove.type = "button";
  remove.textContent = "X";
  remove.setAttribute("aria-label", `Remove ${meta.label}`);
  remove.addEventListener("click", () => {
    if (running) return;
    li.remove();
    showEmptyHintIfNeeded();
  });

  row.appendChild(left);
  row.appendChild(remove);
  li.appendChild(row);

  // Repeat gets an inner "drop inside" area
  if (type === "REPEAT") {
    li.dataset.repeatCount = li.dataset.repeatCount || "3";

    const inner = document.createElement("div");
    inner.className = "repeatInner";

    const hint = document.createElement("div");
    hint.className = "repeatHint";
    hint.textContent = "Drop blocks inside!";

    const innerList = document.createElement("ul");
    innerList.className = "wsList repeatList";
    innerList.dataset.parentRepeatId = li.dataset.id;
    innerList.setAttribute("aria-label", "Repeat blocks");

    inner.appendChild(hint);
    inner.appendChild(innerList);
    li.appendChild(inner);

    const updateHint = () => {
      const hasKids = [...innerList.children].some(
        (n) => n instanceof HTMLElement && n.classList.contains("wsBlock")
      );
      hint.style.display = hasKids ? "none" : "block";
    };
    // keep hint updated
    const mo = new MutationObserver(updateHint);
    mo.observe(innerList, { childList: true });
    updateHint();

    // Optional: click the Repeat block to set its count (still asks each run, but remembers last)
    li.addEventListener("dblclick", async (e) => {
      if (running) return;
      if (!(e.target instanceof HTMLElement)) return;
      // don't trigger when double-clicking a nested block/remove button
      if (e.target.closest("button")) return;
      const current = Number(li.dataset.repeatCount || "3");
      const picked = await openRepeatModal(current);
      if (picked != null) li.dataset.repeatCount = String(picked);
    });
  }

  li.addEventListener("dragstart", (e) => {
    if (running) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ source: "workspace", id: li.dataset.id })
    );
    setTimeout(() => li.classList.add("opacity-50"), 0);
  });

  li.addEventListener("dragend", () => {
    li.classList.remove("opacity-50");
    removeDropIndicator();
  });

  return li;
}

function removeDropIndicator() {
  if (dropIndicator.parentElement) dropIndicator.remove();
}

function getClosestListItemAfterY(container, y) {
  const items = [...container.children].filter(
    (n) => n instanceof HTMLElement && n.classList.contains("wsBlock")
  );
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

paletteBlocks.forEach((el) => {
  el.addEventListener("dragstart", (e) => {
    if (running) {
      e.preventDefault();
      return;
    }
    const type = el.dataset.type;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ source: "palette", type })
    );
  });
});

// Touch / no-drag fallback: tap/click a palette block to add it.
paletteBlocks.forEach((el) => {
  el.addEventListener("click", () => {
    if (running) return;
    const type = el.dataset.type;
    if (!type || !BLOCKS[type]) return;
    const node = makeWorkspaceBlock(type);
    workspaceList.appendChild(node);
    showEmptyHintIfNeeded();
  });
});

function getTargetListFromEvent(e) {
  // Some browsers report dragover target as the draggable <li> (Repeat) rather than
  // the inner box. Use elementFromPoint to reliably detect what's under the cursor.
  const underPointer = document.elementFromPoint(e.clientX, e.clientY);
  const t = underPointer instanceof HTMLElement ? underPointer : e.target;
  if (!(t instanceof HTMLElement)) return workspaceList;

  // If directly over a list, drop into it
  const list = t.closest("ul.wsList");
  if (list instanceof HTMLUListElement) return list;

  // If over the Repeat inner area, drop into its inner list
  const repeatInner = t.closest(".repeatInner");
  if (repeatInner) {
    const maybe = repeatInner.querySelector("ul.wsList");
    if (maybe instanceof HTMLUListElement) return maybe;
  }

  // If over a Repeat block (anywhere), try to drop into its inner list first
  const repeatBlock = t.closest('.wsBlock[data-type="REPEAT"]');
  if (repeatBlock) {
    const maybe = repeatBlock.querySelector(".repeatInner ul.wsList");
    if (maybe instanceof HTMLUListElement) return maybe;
  }

  return workspaceList;
}

function isDroppingIntoOwnDescendant(node, targetList) {
  return targetList.closest(`[data-id="${node.dataset.id}"]`) != null;
}

workspaceDropZone.addEventListener("dragover", (e) => {
  if (running) return;
  e.preventDefault();
  const list = getTargetListFromEvent(e);
  const afterElement = getClosestListItemAfterY(list, e.clientY);
  if (!dropIndicator.parentElement) list.appendChild(dropIndicator);
  if (afterElement == null) {
    list.appendChild(dropIndicator);
  } else {
    list.insertBefore(dropIndicator, afterElement);
  }
});

workspaceDropZone.addEventListener("dragleave", (e) => {
  if (running) return;
  // Only remove if leaving the whole drop zone.
  const rect = workspaceDropZone.getBoundingClientRect();
  const inside =
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    e.clientY >= rect.top &&
    e.clientY <= rect.bottom;
  if (!inside) removeDropIndicator();
});

workspaceDropZone.addEventListener("drop", (e) => {
  if (running) return;
  e.preventDefault();
  let payload = null;
  try {
    payload = JSON.parse(e.dataTransfer.getData("text/plain"));
  } catch {
    payload = null;
  }
  if (!payload) return;

  const targetList = dropIndicator.parentElement instanceof HTMLUListElement
    ? dropIndicator.parentElement
    : workspaceList;
  const indicatorIndex = [...targetList.children].indexOf(dropIndicator);
  let insertIndex = indicatorIndex === -1 ? targetList.children.length : indicatorIndex;

  removeDropIndicator();

  if (payload.source === "palette" && payload.type && BLOCKS[payload.type]) {
    const node = makeWorkspaceBlock(payload.type);
    insertAt(targetList, node, insertIndex);
    showEmptyHintIfNeeded();
    return;
  }

  if (payload.source === "workspace" && payload.id) {
    const node = workspaceDropZone.querySelector(`.wsBlock[data-id="${payload.id}"]`);
    if (!node) return;
    if (!(node instanceof HTMLElement)) return;
    if (isDroppingIntoOwnDescendant(node, targetList)) return;

    // Move between lists / reorder inside list
    const fromIndexInTarget = [...targetList.children].indexOf(node);
    if (fromIndexInTarget !== -1 && fromIndexInTarget < insertIndex) insertIndex -= 1;
    node.remove();
    insertAt(targetList, node, insertIndex);
    showEmptyHintIfNeeded();
  }
});

function insertAt(list, node, index) {
  const items = [...list.children].filter((n) => n !== dropIndicator && n !== node);
  if (index <= 0) {
    list.insertBefore(node, items[0] || null);
    return;
  }
  if (index >= items.length) {
    list.appendChild(node);
    return;
  }
  list.insertBefore(node, items[index]);
}

// Keyboard accessibility: pressing Enter/Space on palette blocks adds them.
palette.addEventListener("keydown", (e) => {
  if (running) return;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.dataset.type) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  const type = target.dataset.type;
  const node = makeWorkspaceBlock(type);
  workspaceList.appendChild(node);
  showEmptyHintIfNeeded();
});

showEmptyHintIfNeeded();

// ---------- Stage / Sprite ----------
const sprite = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  dir: 0, // 0=right, 90=down, 180=left, 270=up
  colorIndex: 0,
};

const SPRITE_COLORS = ["#22c55e", "#60a5fa", "#facc15", "#fb7185", "#a78bfa"];

// Tail (Logo-style path trail)
const trail = [];
const MAX_TRAIL_POINTS = 260;
const CLEAR_TRAIL_ON_GO = true;

function addTrailPoint(x, y) {
  const last = trail.length ? trail[trail.length - 1] : null;
  if (last && last.x != null) {
    const dx = x - last.x;
    const dy = y - last.y;
    const d = Math.hypot(dx, dy);
    // If we wrapped around the screen, break the trail so it doesn't draw a huge line.
    if (d > 120) trail.push(null);
  }

  trail.push({ x, y, colorIndex: sprite.colorIndex });
  while (trail.length > MAX_TRAIL_POINTS) trail.shift();
}

function resetTrail() {
  trail.length = 0;
  addTrailPoint(sprite.x, sprite.y);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function openRepeatModal(defaultCount = 3) {
  // Returns Promise<number|null> (null = cancelled)
  let count = clamp(Number(defaultCount) || 3, 2, 20);
  repeatCountEl.textContent = String(count);

  repeatModal.classList.remove("hidden");
  repeatModal.classList.add("flex");

  return new Promise((resolve) => {
    const onDec = () => {
      count = clamp(count - 1, 2, 20);
      repeatCountEl.textContent = String(count);
    };
    const onInc = () => {
      count = clamp(count + 1, 2, 20);
      repeatCountEl.textContent = String(count);
    };
    const onCancel = () => cleanup(null);
    const onOk = () => cleanup(count);
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(null);
      if (e.key === "Enter") cleanup(count);
    };

    function cleanup(result) {
      repeatModal.classList.add("hidden");
      repeatModal.classList.remove("flex");
      repeatDec.removeEventListener("click", onDec);
      repeatInc.removeEventListener("click", onInc);
      repeatCancel.removeEventListener("click", onCancel);
      repeatOk.removeEventListener("click", onOk);
      window.removeEventListener("keydown", onKey);
      resolve(result);
    }

    repeatDec.addEventListener("click", onDec);
    repeatInc.addEventListener("click", onInc);
    repeatCancel.addEventListener("click", onCancel);
    repeatOk.addEventListener("click", onOk);
    window.addEventListener("keydown", onKey);

    // focus OK for quick keyboard use
    setTimeout(() => repeatOk.focus(), 0);
  });
}

function wrapSprite() {
  if (sprite.x < -10) sprite.x = canvas.width + 10;
  if (sprite.x > canvas.width + 10) sprite.x = -10;
  if (sprite.y < -10) sprite.y = canvas.height + 10;
  if (sprite.y > canvas.height + 10) sprite.y = -10;
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Subtle retro grid
  ctx.fillStyle = "#030712";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  const step = 24;
  for (let x = 0; x <= canvas.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSprite() {
  const scale = 4; // pixel size
  const pixels = [
    "....X....",
    "...XXX...",
    "..XXXXX..",
    ".XXXXXXX.",
    "XXX.XXX.X",
    ".XXXXXXX.",
    "..X...X..",
    ".X.....X.",
  ];

  ctx.save();
  ctx.translate(sprite.x, sprite.y);
  ctx.rotate((sprite.dir * Math.PI) / 180);

  // Glow shadow
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = SPRITE_COLORS[sprite.colorIndex];
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pixel ship
  const color = SPRITE_COLORS[sprite.colorIndex];
  for (let row = 0; row < pixels.length; row++) {
    for (let col = 0; col < pixels[row].length; col++) {
      if (pixels[row][col] !== "X") continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        (col - 4) * scale,
        (row - 4) * scale,
        scale,
        scale
      );
    }
  }

  // Tiny cockpit
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(-scale, -scale, scale, scale);

  ctx.restore();
}

function drawTail() {
  if (trail.length < 2) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const len = trail.length;
  for (let i = 0; i < len; i++) {
    const p = trail[i];
    if (!p) continue;

    const baseColor = SPRITE_COLORS[p.colorIndex ?? sprite.colorIndex];
    const t = i / len; // old -> new
    const alpha = 0.06 + t * 0.35;
    const size = Math.round(7 - t * 3); // bigger for newer points

    ctx.globalAlpha = alpha;
    ctx.fillStyle = baseColor;
    ctx.fillRect(
      Math.round(p.x - size / 2),
      Math.round(p.y - size / 2),
      size,
      size
    );
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function render() {
  drawBackground();
  drawTail();
  drawSprite();
  requestAnimationFrame(render);
}
render();

// ---------- Execution Engine ----------
function setUiRunning(isRunning) {
  goBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  // Disable dragging while running
  workspaceDropZone.querySelectorAll(".wsBlock").forEach((li) => {
    li.draggable = !isRunning;
    li.setAttribute("draggable", String(!isRunning));
    li.classList.toggle("opacity-90", isRunning);
  });
  paletteBlocks.forEach((el) => {
    el.draggable = !isRunning;
    el.setAttribute("draggable", String(!isRunning));
    el.classList.toggle("opacity-70", isRunning);
  });
}

function getProgram() {
  function parseList(listEl) {
    const steps = [];
    const kids = [...listEl.children].filter(
      (n) => n instanceof HTMLElement && n.classList.contains("wsBlock")
    );
    for (const li of kids) {
      const type = li.dataset.type;
      const step = { type, el: li };
      if (type === "REPEAT") {
        const inner = li.querySelector("ul.wsList");
        step.children = inner ? parseList(inner) : [];
      }
      steps.push(step);
    }
    return steps;
  }
  return parseList(workspaceList);
}

function sleep(ms, myRunId) {
  return new Promise((resolve) => {
    const start = performance.now();
    function tick(now) {
      if (myRunId !== runId) return resolve("stopped");
      if (now - start >= ms) return resolve("ok");
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

async function animateMove(distance, myRunId) {
  const radians = (sprite.dir * Math.PI) / 180;
  const dx = Math.cos(radians) * distance;
  const dy = Math.sin(radians) * distance;
  const x0 = sprite.x;
  const y0 = sprite.y;
  const duration = 420;
  const start = performance.now();

  return new Promise((resolve) => {
    function tick(now) {
      if (myRunId !== runId) return resolve("stopped");
      const t = Math.min(1, (now - start) / duration);
      // easeInOut
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      sprite.x = x0 + dx * ease;
      sprite.y = y0 + dy * ease;
      wrapSprite();
      addTrailPoint(sprite.x, sprite.y);
      if (t >= 1) return resolve("ok");
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

async function runBlock(type, myRunId) {
  switch (type) {
    case "MOVE_FORWARD":
      return animateMove(64, myRunId);
    case "TURN_RIGHT":
      sprite.dir = (sprite.dir + 90) % 360;
      return sleep(220, myRunId);
    case "CHANGE_COLOR":
      sprite.colorIndex = (sprite.colorIndex + 1) % SPRITE_COLORS.length;
      return sleep(180, myRunId);
    default:
      return "ok";
  }
}

function clearActiveHighlight() {
  workspaceDropZone.querySelectorAll(".wsBlock").forEach((li) => {
    li.classList.remove("wsActive");
  });
}

goBtn.addEventListener("click", async () => {
  if (running) return;
  const program = getProgram();
  if (!program.length) return;

  running = true;
  runId += 1;
  const myRunId = runId;
  setUiRunning(true);
  if (CLEAR_TRAIL_ON_GO) resetTrail();

  async function runSteps(steps) {
    for (const step of steps) {
      if (myRunId !== runId) return "stopped";
      clearActiveHighlight();
      step.el.classList.add("wsActive");

      if (step.type === "REPEAT") {
        const current = Number(step.el.dataset.repeatCount || "3");
        const picked = await openRepeatModal(current);
        if (picked == null) return "stopped"; // user cancelled
        step.el.dataset.repeatCount = String(picked);

        const children = step.children || [];
        if (!children.length) {
          const wait = await sleep(200, myRunId);
          if (wait === "stopped") return "stopped";
          continue;
        }

        for (let k = 0; k < picked; k++) {
          if (myRunId !== runId) return "stopped";
          const r = await runSteps(children);
          if (r === "stopped") return "stopped";
          const pause = await sleep(120, myRunId);
          if (pause === "stopped") return "stopped";
        }

        continue;
      }

      const result = await runBlock(step.type, myRunId);
      if (result === "stopped") return "stopped";
    }
    return "ok";
  }

  await runSteps(program);

  clearActiveHighlight();
  running = false;
  setUiRunning(false);
});

stopBtn.addEventListener("click", () => {
  if (!running) return;
  runId += 1; // invalidates any in-flight animations
  running = false;
  clearActiveHighlight();
  setUiRunning(false);
});

// Reset sprite on double-click anywhere on the stage
canvas.addEventListener("dblclick", () => {
  if (running) return;
  sprite.x = canvas.width / 2;
  sprite.y = canvas.height / 2;
  sprite.dir = 0;
  resetTrail();
});

// Start with a tiny tail dot so kids immediately see the "path"
resetTrail();
