// 首页 hero 下落文字
// 移植自 React Bits 的 <FallingText />（React -> 原生 JS + Astro）
// 依赖 matter-js 提供物理引擎
import Matter from 'matter-js';

const STYLE_ID = 'falling-hero-style';

// 说明：页面样式由 Astro 编译成带 [data-astro-cid-*] 的属性选择器，
// 优先级高于普通类选择器。这里统一加 .hero-section 前缀，
// 避免注入的规则被页面样式反向覆盖。
const CSS = `
.hero-section.falling-hero {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

/* 未触发前提示可点击 */
.hero-section.falling-hero:not(.is-falling) .hero-copy {
  cursor: pointer;
}

.falling-hero__text {
  position: relative;
  z-index: 1;
  display: inline-block;
  transition: opacity 0.28s ease;
}

/* 文字被物理化后，整块文案淡出，交给画布里的字块呈现 */
.hero-section.falling-hero.is-falling .falling-hero__text {
  opacity: 0;
  pointer-events: none;
}

/* 占位层：撑住原始排版高度，保证文字绝对定位后容器不塌陷 */
.falling-hero__ghost {
  visibility: hidden;
  pointer-events: none;
}

.hero-section.falling-hero .falling-hero__canvas {
  position: absolute;
  inset: auto;
  top: 0;
  left: 0;
  z-index: 3;
  pointer-events: none;
}

/* 下落开始后画布才接管指针事件，用于拖拽字块 */
.hero-section.falling-hero.is-falling .falling-hero__canvas {
  pointer-events: auto;
}

/* 字块自身不拦截事件，交给画布统一处理，避免拖拽断触 */
.hero-section.falling-hero .word {
  pointer-events: none;
}

.hero-section.falling-hero .falling-hero__canvas canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.hero-section.falling-hero .falling-hero__canvas canvas:active {
  cursor: grabbing;
}

.falling-hero .word {
  display: inline-block;
  user-select: none;
  -webkit-user-select: none;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .falling-hero__canvas { display: none; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * @param {HTMLElement} heroEl  承载文字的容器（.hero-section）
 * @param {object} options
 * @param {string[]} options.segments  需要被物理化的文字片段（按顺序）
 * @param {number} options.gravity
 * @param {number} options.stiffness
 */
export function initFallingHeroText(heroEl, options = {}) {
  if (!(heroEl instanceof HTMLElement)) return () => {};
  // 尊重系统「减少动态效果」设置
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const {
    segments = [],
    gravity = 0.56,
    stiffness = 0.9,
  } = options;

  ensureStyle();
  // 注入样式以 .hero-section.falling-hero 提高优先级，这里补上标记类
  heroEl.classList.add('falling-hero');

  const textEl = heroEl.querySelector('.hero-copy');
  if (!(textEl instanceof HTMLElement) || !segments.length) return () => {};

  let disposed = false;
  let engine = null;
  let render = null;
  let rafId = 0;
  let wordBodies = [];

  // 把 hero 内的文字按语义切成若干 span（不用 split(' ') 是因为中文没有空格）
  function buildSpans() {
    const blocks = Array.from(textEl.querySelectorAll('[data-falling-line]'));
    blocks.forEach((block) => {
      const original = block.textContent || '';
      if (!original.trim()) return;
      block.textContent = '';
      // 按 segments 顺序在原文中依次定位并切分，未匹配到的部分原样保留
      let cursor = 0;
      segments.forEach((segment) => {
        if (!segment) return;
        const index = original.indexOf(segment, cursor);
        if (index < 0) return;
        if (index > cursor) {
          block.appendChild(document.createTextNode(original.slice(cursor, index)));
        }
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = segment;
        block.appendChild(span);
        cursor = index + segment.length;
      });
      if (cursor < original.length) {
        block.appendChild(document.createTextNode(original.slice(cursor)));
      }
    });
    return Array.from(textEl.querySelectorAll('.word'));
  }

  // 文字一旦变成绝对定位就会脱离文档流，导致 .hero-copy 塌陷为 0，
  // 进而让后续所有尺寸测量失真。这里保留一份不可见的原始排版用于撑高，
  // 并让真正承载文字的那份塌陷，两者叠加后高度仍与原来一致。
  function reserveLayout() {
    if (textEl.parentNode?.querySelector('.falling-hero__ghost')) return;
    const ghost = textEl.cloneNode(true);
    ghost.classList.add('falling-hero__ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('.word').forEach((node) => {
      const span = document.createElement('span');
      span.textContent = node.textContent;
      node.replaceWith(span);
    });
    textEl.parentNode?.insertBefore(ghost, textEl.nextSibling);
    // 原始文字层脱离文档流后不应再占据高度，由 ghost 独占这部分空间
    textEl.style.height = '0';
    textEl.style.overflow = 'visible';
  }

  function releaseLayout() {
    textEl.parentNode?.querySelectorAll('.falling-hero__ghost').forEach((node) => node.remove());
    textEl.style.height = '';
    textEl.style.overflow = '';
  }

  function teardown() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (engine) {
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
    }
    render?.canvas?.parentNode?.remove();
    heroEl.querySelector('.falling-hero__canvas')?.remove();
    render = null;
    engine = null;
    wordBodies = [];
    heroEl.classList.remove('is-falling', 'falling-hero');
    releaseLayout();
  }

  function start() {
    if (disposed || engine) return;

    const words = textEl.querySelectorAll('.word');
    if (!words.length) return;

    // 先把原始排版高度撑住，再测量尺寸 —— 否则文字绝对定位后容器会塌陷为 0，
    // 导致画布高度、物理边界全部算错。
    // 物理世界只需要建立一次；重复进入会创建多余的画布与引擎
    if (heroEl.querySelector('.falling-hero__canvas')) return;

    reserveLayout();
    heroEl.classList.add('is-falling');

    // 占位层生效后再测量，避免读到塌陷前的旧高度
    void heroEl.offsetHeight;

    // 物理坐标以 hero 左上角为原点，活动区域为 [0, height]
    const heroRect = heroEl.getBoundingClientRect();
    const width = Math.round(heroRect.width);
    const height = Math.round(heroRect.height);
    if (width <= 0 || height <= 0) {
      heroEl.classList.remove('is-falling');
      releaseLayout();
      return;
    }

    // 下边界：四个图标上方的隐形容器线
    const socialEl = heroEl.querySelector('.hero-social');
    const socialTop = socialEl instanceof HTMLElement
      ? socialEl.getBoundingClientRect().top - heroRect.top
      : height;
    const floorY = Math.max(60, Math.min(socialTop - 8, height));
    const wall = 50;

    const canvasHost = document.createElement('div');
    canvasHost.className = 'falling-hero__canvas';
    heroEl.appendChild(canvasHost);
    // 画布高度只覆盖到地板，物理边界与可视区域就完全对齐了。
    // 字形本身由 DOM 渲染，这里只需要一个接收鼠标事件的画布。
    canvasHost.style.width = `${width}px`;
    canvasHost.style.height = `${Math.round(floorY)}px`;
    canvasHost.style.inset = 'auto';
    canvasHost.style.top = '0';
    canvasHost.style.left = '0';

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(floorY);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${Math.round(floorY)}px`;
    canvasHost.appendChild(canvas);
    render = { canvas };

    engine = Matter.Engine.create();
    engine.world.gravity.y = gravity;

    const boundary = { isStatic: true, render: { visible: false } };
    const floor = Matter.Bodies.rectangle(
      width / 2,
      floorY + wall / 2,
      width + wall * 2,
      wall,
      boundary,
    );
    const ceiling = Matter.Bodies.rectangle(
      width / 2,
      -wall / 2,
      width + wall * 2,
      wall,
      boundary,
    );
    const leftWall = Matter.Bodies.rectangle(-wall / 2, floorY / 2, wall, floorY * 2, boundary);
    const rightWall = Matter.Bodies.rectangle(width + wall / 2, floorY / 2, wall, floorY * 2, boundary);

    // 文字的绝对定位参考框（.hero-copy）相对 hero 顶边的偏移，
    // 物理坐标以 hero 为原点，渲染时需减去这段距离。
    const bodies = [...words].map((elem, index) => {
      const rect = elem.getBoundingClientRect();
      // 物理世界与画布都以 hero 左上角为原点；
      // 字块稍后会被挂到画布宿主内（同为 hero 坐标系），因此无需再换算偏移。
      const x = rect.left - heroRect.left + rect.width / 2;
      const y = rect.top - heroRect.top + rect.height / 2;

      // 记录原始排版样式：字块脱离原容器后会丢失继承来的字号/字重，
      // 这里把计算后的样式固化下来，保证大小与原来完全一致。
      const computed = getComputedStyle(elem);
      const styleSnapshot = {
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        fontFamily: computed.fontFamily,
        fontStyle: computed.fontStyle,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        color: computed.color,
      };

      const body = Matter.Bodies.rectangle(x, y, Math.max(8, rect.width), Math.max(8, rect.height), {
        // 弹性略高、摩擦较低，落地后靠碰撞互相推开、自然摊平而不是叠在原处
        restitution: 0.6,
        frictionAir: 0.012,
        friction: 0.12,
        frictionStatic: 0.4,
        slop: 0.5,
        render: { visible: false },
      });

      // 交替给一个较小的水平初速度，制造碰撞错位
      const spread = (index % 2 === 0 ? 1 : -1) * (1 + Math.random() * 2);
      Matter.Body.setVelocity(body, { x: spread, y: 0 });
      Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.04);

      // 把字块移入画布宿主，使其与物理坐标同处 hero 坐标系
      elem.style.position = 'absolute';
      elem.style.margin = '0';
      elem.style.whiteSpace = 'pre';
      elem.style.lineHeight = '1';
      Object.assign(elem.style, styleSnapshot);
      canvasHost.appendChild(elem);
      return { elem, body, styleSnapshot };
    });

    const mouse = Matter.Mouse.create(render.canvas);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness, render: { visible: false } },
    });
    render.mouse = mouse;

    Matter.World.add(engine.world, [
      floor, ceiling, leftWall, rightWall,
      mouseConstraint,
      ...bodies.map((entry) => entry.body),
    ]);

    // 单个渲染循环：先推进物理，再把刚体位置同步到 DOM。
    // 字块已挂在画布宿主内，与物理坐标同处 hero 坐标系，可直接使用。
    const sync = () => {
      if (disposed) return;
      Matter.Engine.update(engine, 1000 / 60);
      for (const { body, elem } of bodies) {
        elem.style.left = `${body.position.x}px`;
        elem.style.top = `${body.position.y}px`;
        elem.style.transform = `translate(-50%, -50%) rotate(${body.angle}rad)`;
      }
      rafId = requestAnimationFrame(sync);
    };
    sync();
  }

  function reset() {
    teardown();
    // 清掉内联定位，恢复原始排版
    textEl.querySelectorAll('.word').forEach((node) => {
      node.style.position = '';
      node.style.left = '';
      node.style.top = '';
      node.style.transform = '';
      node.style.margin = '';
    });
  }

  const spans = buildSpans();
  if (!spans.length) return () => {};

  // 点击 hero 区域才开始下落；未触发前保持原样排版
  const onTrigger = (event) => {
    // 空白处或文字上的点击都算触发，但点链接不拦截
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    heroEl.removeEventListener('click', onTrigger);
    heroEl.removeEventListener('touchstart', onTrigger);
    start();
  };
  heroEl.addEventListener('click', onTrigger);
  heroEl.addEventListener('touchstart', onTrigger, { passive: true });

  return () => {
    disposed = true;
    heroEl.removeEventListener('click', onTrigger);
    heroEl.removeEventListener('touchstart', onTrigger);
    reset();
  };
}
