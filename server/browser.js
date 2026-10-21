let browserPromise = null;
let launchError = null;

export const VIEWPORT = { width: 1280, height: 720 };

async function getBrowser() {
  if (launchError) throw launchError;
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then((mod) => mod.chromium.launch({ args: ['--disable-dev-shm-usage'] }))
      .catch((err) => {
        launchError = new Error(
          'Playwright is not available. Install it with `npm i -D playwright` and `npx playwright install chromium`.',
        );
        launchError.cause = err;
        browserPromise = null;
        throw launchError;
      });
  }
  return browserPromise;
}

export async function isAvailable() {
  try {
    await getBrowser();
    return true;
  } catch {
    return false;
  }
}

export async function shutdown() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
}

const FOCUS_STYLE = `<style id="__nb_focus">
.slide { display: none !important; }
.slide.nb-visible { display: flex !important; }
html, body { overflow: hidden !important; }
</style>`;

async function openPage(html, slideId) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));

  let doc = html;
  if (slideId) {
    doc = html.replace(/<\/head>/i, `${FOCUS_STYLE}</head>`);
  }
  await page.setContent(doc, { waitUntil: 'load', timeout: 15000 });

  if (slideId) {
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-slide-id="${id}"]`);
      if (el) el.classList.add('nb-visible');
    }, slideId);
    await page.waitForTimeout(250);
  } else {
    await page.waitForTimeout(400);
  }

  return { context, page, errors };
}

async function close(ctx) {
  try {
    await ctx.context.close();
  } catch {
    /* ignore */
  }
}

export async function screenshot(html, slideId) {
  const ctx = await openPage(html, slideId);
  try {
    const buf = await ctx.page.screenshot({ type: 'png' });
    return {
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      errors: ctx.errors,
    };
  } finally {
    await close(ctx);
  }
}

export async function runExpression(html, slideId, expression) {
  const ctx = await openPage(html, slideId);
  try {
    const value = await ctx.page.evaluate((src) => {
      const fn = new Function(`return (${src});`);
      const out = fn();
      return typeof out === 'undefined' ? null : out;
    }, expression);
    return { value, errors: ctx.errors };
  } finally {
    await close(ctx);
  }
}

export async function queryDom(html, slideId, selector, limit = 1) {
  const ctx = await openPage(html, slideId);
  try {
    const value = await ctx.page.evaluate(
      ({ sel, lim }) => {
        const els = Array.from(document.querySelectorAll(sel)).slice(0, lim);
        return els.map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 200),
            classes: el.className,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            style: {
              color: cs.color,
              background: cs.backgroundColor,
              display: cs.display,
              fontSize: cs.fontSize,
              position: cs.position,
            },
          };
        });
      },
      { sel: selector, lim: limit },
    );
    return { value, errors: ctx.errors };
  } finally {
    await close(ctx);
  }
}

export async function probe(html, slideId) {
  const ctx = await openPage(html, slideId);
  try {
    const value = await ctx.page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const out = { viewport: { w: vw, h: vh }, overflowing: [], clipped: [] };
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const label = `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(/\s+/).join('.') : ''}`;
        if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
          out.overflowing.push({
            el: label,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
        if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow === 'hidden') {
          out.clipped.push({ el: label, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
        }
      });
      out.overflowing = out.overflowing.slice(0, 20);
      out.clipped = out.clipped.slice(0, 10);
      return out;
    });
    return { value, errors: ctx.errors };
  } finally {
    await close(ctx);
  }
}