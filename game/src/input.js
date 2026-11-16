// Keyboard and mouse, gathered in one place. Every other module asks
// this one what the player is doing; nothing else listens to window
// events. Held state lives in a Set; presses are queued so a consumer can
// ask "did this go down since I last asked?" exactly once per press;
// mouse look accumulates until someone takes it.

export function createInput(canvas) {
  const held = new Set();
  const pressQueue = new Set();
  let lookX = 0;
  let lookY = 0;
  let triggerHeld = false;
  let scopeHeld = false;
  let triggerClicked = false;
  let lockedNow = false;

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    held.add(e.code);
    pressQueue.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab' || e.code === 'KeyB') e.preventDefault();
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => {
    held.clear();
    triggerHeld = false;
    scopeHeld = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!lockedNow) return;
    if (e.button === 0) {
      triggerHeld = true;
      triggerClicked = true;
    } else if (e.button === 2) {
      scopeHeld = true;
    }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) triggerHeld = false;
    if (e.button === 2) scopeHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    lockedNow = document.pointerLockElement === canvas;
    if (!lockedNow) {
      triggerHeld = false;
      scopeHeld = false;
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!lockedNow) return;
    lookX += e.movementX;
    lookY += e.movementY;
  });

  return {
    keys: held,
    get locked() { return lockedNow; },
    get firing() { return triggerHeld; },
    get aiming() { return scopeHeld; },

    lock() { canvas.requestPointerLock(); },
    unlock() { document.exitPointerLock(); },

    // Drain the accumulated mouse movement.
    takeLook() {
      const out = { dx: lookX, dy: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // True exactly once per physical press of `code`.
    wasPressed(code) {
      if (!pressQueue.has(code)) return false;
      pressQueue.delete(code);
      return true;
    },
    // True exactly once per fresh left-click.
    takeClick() {
      const c = triggerClicked;
      triggerClicked = false;
      return c;
    },
    down(code) { return held.has(code); },
    // WASD/arrows as axes: x strafes right, z pushes forward.
    moveAxes() {
      const x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0)
        - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      const z = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0)
        - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
      return { x, z };
    },
  };
}
