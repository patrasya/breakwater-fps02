// input.js — keyboard and mouse state, pointer lock, and the per-frame edges
// the controllers poll. Raw DOM events land here; the simulation reads plain
// fields, so input timing never leaks into the fixed-step sim. `pressed` and
// `mouseClicked` are edge-triggered for one frame; `keys`, `mouseDown` and
// `mouseRDown` are held state.

export const input = {
  keys: Object.create(null),
  pressed: Object.create(null),
  mouseDX: 0, mouseDY: 0,
  mouseDown: false, mouseRDown: false, mouseClicked: false,
  wheel: 0,
};

let canvas = null;
export function initInput(el) {
  canvas = el;
  addEventListener('keydown', (e) => {
    if (!input.keys[e.code]) input.pressed[e.code] = true;
    input.keys[e.code] = true;
    if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  addEventListener('blur', () => {
    for (const k in input.keys) input.keys[k] = false;
    input.mouseDown = input.mouseRDown = false;
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) { input.mouseDX += e.movementX; input.mouseDY += e.movementY; }
  });
  addEventListener('mousedown', (e) => {
    if (document.pointerLockElement === canvas) {
      if (e.button === 0) { input.mouseDown = true; input.mouseClicked = true; }
      if (e.button === 2) input.mouseRDown = true;
    }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
    if (e.button === 2) input.mouseRDown = false;
  });
  addEventListener('wheel', (e) => { if (document.pointerLockElement === canvas) input.wheel += Math.sign(e.deltaY); }, { passive: true });
  addEventListener('contextmenu', (e) => e.preventDefault());
}
export function lockPointer() { if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock(); }
export function clearFrameInput() {
  input.mouseClicked = false;
  input.wheel = 0;
  for (const k in input.pressed) delete input.pressed[k];
}
