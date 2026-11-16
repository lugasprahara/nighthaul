// Keyboard and mouse state, pointer lock included. Everything reads input
// through this module; nothing else touches window events.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last consume()
  let lookDX = 0;
  let lookDY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;
  let clicked = false; // a fresh mouse press since the last consume()

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'Tab', 'KeyB'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) {
      firing = true;
      clicked = true;
    }
    if (e.button === 2) aiming = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  });

  return {
    keys,
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    lock() { canvas.requestPointerLock(); },
    unlock() { document.exitPointerLock(); },
    // Read-and-clear the accumulated look movement (call once per frame).
    takeLook() {
      const dx = lookDX;
      const dy = lookDY;
      lookDX = 0;
      lookDY = 0;
      return { dx, dy };
    },
    // Was this code pressed since the last call?
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    takeClick() {
      const c = clicked;
      clicked = false;
      return c;
    },
    down(code) { return keys.has(code); },
    // Movement axes from WASD: x = strafe right, z = forward.
    moveAxes() {
      let x = 0;
      let z = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      return { x, z };
    },
  };
}
