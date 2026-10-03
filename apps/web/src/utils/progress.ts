/**
 * 顶部加载进度条（无依赖），用于路由切换（含懒加载页面 chunk）。
 * - start 幂等：守卫内重定向会多次触发 beforeEach，只算一次
 * - 200ms 内完成的切换不显示，避免闪烁
 */
let el: HTMLDivElement | null = null;
let active = false;
let value = 0;
let trickle: number | undefined;
let showDelay: number | undefined;

function render() {
  if (!el) {
    el = document.createElement("div");
    el.className = "sb-progress";
    document.body.appendChild(el);
  }
  el.style.transform = `scaleX(${value})`;
  el.style.opacity = value > 0 && value < 1 ? "1" : "0";
}

export function startProgress() {
  if (active) return;
  active = true;
  showDelay = window.setTimeout(() => {
    value = 0.08;
    render();
    // 渐进逼近 90%，等待 done
    trickle = window.setInterval(() => {
      value = Math.min(0.9, value + (0.9 - value) * 0.1);
      render();
    }, 200);
  }, 200);
}

export function doneProgress() {
  if (!active) return;
  active = false;
  window.clearTimeout(showDelay);
  window.clearInterval(trickle);
  if (value === 0) return; // 未到显示阈值即完成
  value = 1;
  render();
  window.setTimeout(() => {
    if (active) return; // 期间又开始了新的切换
    value = 0;
    render();
  }, 250);
}
