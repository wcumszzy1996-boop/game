/**
 * input.js — 键鼠 / 触屏 / 手柄 统一输入层
 */

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mode = 'key';                 // 'key' | 'pointer'
    this.pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, active: false };
    this.move = { x: 0, y: 0 };
    this.focus = false;
    this.enabled = true;
    this._bombQueue = 0;
    this._pauseQueue = 0;
    this._confirmQueue = 0;
    this._anyKeyQueue = 0;
    this._touching = false;
    this.gamepadIndex = null;

    this._bind();
  }

  _bind() {
    const dom = this.dom;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      // 阻止空格/方向键滚动页面
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.mode = 'key';
      this._anyKeyQueue++;
      if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyK') this._bombQueue++;
      if (e.code === 'Escape' || e.code === 'KeyP') this._pauseQueue++;
      if (e.code === 'Enter' || e.code === 'Space') this._confirmQueue++;
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.pointer.down = false;
    };

    this._onPointerMove = (e) => {
      if (!this.enabled) return;
      const r = dom.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width;
      const cy = (e.clientY - r.top) / r.height;
      this.pointer.ndcX = cx * 2 - 1;
      this.pointer.ndcY = -(cy * 2 - 1);
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      if (!this._touching) this.mode = 'pointer';
    };
    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      this.pointer.down = true;
      if (e.button === 2) this._bombQueue++;
      if (e.button === 0) this._confirmQueue++;
      if (e.pointerType === 'touch') {
        this._touching = true;
        this.mode = 'pointer';
        this._onPointerMove(e);
      }
    };
    this._onPointerUp = () => {
      this.pointer.down = false;
    };
    this._onContext = (e) => e.preventDefault();

    this._onTouchStart = (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.closest && e.target.closest('#ui')) return;
      this._touching = true;
      this.mode = 'pointer';
      this.pointer.down = true;
      const t = e.touches[0];
      if (t) this._setFromClient(t.clientX, t.clientY);
    };
    this._onTouchMove = (e) => {
      if (!this.enabled) return;
      const t = e.touches[0];
      if (t) {
        e.preventDefault();
        this._setFromClient(t.clientX, t.clientY);
      }
    };
    this._onTouchEnd = () => {
      this.pointer.down = false;
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    dom.addEventListener('pointermove', this._onPointerMove);
    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('contextmenu', this._onContext);
    dom.addEventListener('touchstart', this._onTouchStart, { passive: false });
    dom.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  _setFromClient(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    const cx = (clientX - r.left) / r.width;
    const cy = (clientY - r.top) / r.height;
    this.pointer.ndcX = cx * 2 - 1;
    this.pointer.ndcY = -(cy * 2 - 1);
    this.pointer.x = clientX;
    this.pointer.y = clientY;
    this.pointer.active = true;
  }

  /** 每帧调用，产出归一化移动向量与边沿事件 */
  update() {
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;

    // 手柄
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = this.gamepadIndex != null ? pads[this.gamepadIndex] : pads && pads[0];
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.abs(ax) > 0.16 || Math.abs(ay) > 0.16) {
        mx += ax;
        my -= ay;
        if (this.mode !== 'pointer') this.mode = 'key';
      }
      const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (btn(0) && !this._gpA) this._confirmQueue++;
      if (btn(7) && !this._gpRT) this._bombQueue++;
      if (btn(9) && !this._gpStart) this._pauseQueue++;
      this._gpFocus = !!btn(6);
      this._gpA = btn(0);
      this._gpRT = btn(7);
      this._gpStart = btn(9);
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.move.x = mx;
    this.move.y = my;

    // 聚焦状态：键盘 Shift / 手柄肩键 / 触屏按钮 任一来源为真即为真
    const shiftDown = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.focus = !!(shiftDown || this._gpFocus || this._touchFocus);
    return this;
  }

  get usingKeyboard() {
    return this.mode === 'key';
  }

  consumeBomb() {
    const v = this._bombQueue > 0;
    this._bombQueue = 0;
    return v;
  }
  consumePause() {
    const v = this._pauseQueue > 0;
    this._pauseQueue = 0;
    return v;
  }
  consumeConfirm() {
    const v = this._confirmQueue > 0;
    this._confirmQueue = 0;
    return v;
  }
  consumeAny() {
    const v = this._anyKeyQueue > 0;
    this._anyKeyQueue = 0;
    return v;
  }
  clearQueues() {
    this._bombQueue = 0;
    this._pauseQueue = 0;
    this._confirmQueue = 0;
    this._anyKeyQueue = 0;
  }
}
