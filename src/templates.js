/* ============================================================
   Layout archetypes.

   The model does NOT write CSS. It picks one of these and fills
   a JSON shape. That constraint is what makes output consistently
   on-brand instead of randomly styled -- it's the single biggest
   quality lever in the pipeline.

   Every text element carries data-contrast (so the scrim gate can
   sample the background beneath it) and headline blocks carry
   data-fit (so the fitter can shrink them rather than clip them).
   ============================================================ */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const when = (cond, html) => (cond ? html : '');

/* Set one phrase of the headline in the accent colour. Split on the exact
   substring so escaping still applies to every part. */
function headline(title, accent) {
  if (!accent || !title.includes(accent)) return esc(title);
  const i = title.indexOf(accent);
  return esc(title.slice(0, i))
    + `<span class="title__accent">${esc(accent)}</span>`
    + esc(title.slice(i + accent.length));
}

/* ---- shared chrome ---------------------------------------------------- */

function head(c, { titleClass = 'title', fit = '0.60' } = {}) {
  return `
    <header class="slide-head stack" style="gap:var(--gap-sm);align-items:flex-start">
      ${when(c.eyebrow, `<div class="eyebrow" data-contrast>${esc(c.eyebrow)}</div>`)}
      ${when(c.title, `<h1 class="${titleClass}" data-contrast data-fit="${fit}">${headline(c.title, c.titleAccent)}</h1>`)}
      ${when(c.subtitle, `<p class="subtitle" data-contrast data-fit="0.7">${esc(c.subtitle)}</p>`)}
    </header>`;
}

function foot(d) {
  const c = d.content;
  if (!c.source && !d.brand.logoText) return '';
  return `
    <footer class="slide-foot">
      <span data-contrast>${esc(c.source || '')}</span>
      ${when(d.brand.logoText, `<span class="logo" data-contrast>${esc(d.brand.logoText)}</span>`)}
    </footer>`;
}

function chartNode(chart, style = '') {
  return `<div class="chart" style="${style}" data-chart='${esc(JSON.stringify(chart))}'></div>`;
}

function insight(c) {
  if (!c.insight) return '';
  return `
    <div class="callout mt-lg">
      <span class="callout__label" data-contrast>${esc(c.insight.label)}</span>
      <span class="callout__text" data-contrast data-fit="0.72">${esc(c.insight.text)}</span>
    </div>`;
}

const ARROW = { up: '▲', down: '▼', flat: '—' };

function deltaTag(delta) {
  if (!delta) return '';
  /* Direction is carried by the glyph and the label, never by hue
     alone -- and "good" is whatever the data says it is, so a rising
     churn number reads red. */
  const good = delta.goodDirection;
  const tone = good === 'neutral' || delta.direction === 'flat' ? 'flat'
    : delta.direction === good ? 'up' : 'down';
  return `<span class="stat__delta stat__delta--${tone}" data-contrast>${ARROW[delta.direction]} ${esc(delta.value)}</span>`;
}

function statBlock(s, heroClass = '') {
  return `
    <div class="stat">
      <div class="stat__value ${heroClass}" data-contrast data-fit="0.5">${esc(s.value)}${when(s.unit, `<span class="stat__unit">${esc(s.unit)}</span>`)}</div>
      <div class="stat__label" data-contrast data-fit="0.72">${esc(s.label)}</div>
      ${deltaTag(s.delta)}
    </div>`;
}

/* ---- the archetypes ---------------------------------------------------- */

const T = {};

T['cover'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content" style="justify-content:flex-end">
      ${when(c.eyebrow, `<div class="eyebrow" data-contrast>${esc(c.eyebrow)}</div>`)}
      <h1 class="title title--display mt-md" data-contrast data-fit="0.5">${headline(c.title, c.titleAccent)}</h1>
      ${when(c.subtitle, `<p class="subtitle mt-md" style="max-width:44ch" data-contrast data-fit="0.7">${esc(c.subtitle)}</p>`)}
      <div class="mt-xl">${foot(d)}</div>
    </div>`;
};

T['chart-insight'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c)}
      <div class="slide-body mt-lg">
        ${chartNode(c.chart)}
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['chart-split'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg">
        <div class="split grow">
          <div class="stack grow">${chartNode(c.chart)}</div>
          <div class="stack" style="justify-content:center;gap:var(--gap-lg)">
            ${when(c.stats, (c.stats || []).map(s => statBlock(s)).join(''))}
            ${insight(c)}
          </div>
        </div>
      </div>
      ${foot(d)}
    </div>`;
};

T['stat-hero'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body" style="justify-content:center">
        ${statBlock(c.stats[0], 'stat__value--hero')}
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['kpi-grid'] = d => {
  const c = d.content;
  const wrap = c.stats.length === 4 ? ' kpis--wrap' : '';
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="kpis${wrap}">${c.stats.map(s => statBlock(s)).join('')}</div>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['comparison'] = d => {
  const c = d.content;
  const col = it => `
    <div class="stack" style="gap:var(--gap-md)">
      ${when(it.value, `<div class="card__value" data-contrast data-fit="0.5">${esc(it.value)}</div>`)}
      <div class="card__title" data-contrast data-fit="0.65">${esc(it.title)}</div>
      ${when(it.text, `<div class="card__text" data-contrast data-fit="0.72">${esc(it.text)}</div>`)}
    </div>`;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="compare">
          ${col(c.items[0])}
          <div class="compare__divider"></div>
          ${col(c.items[1])}
        </div>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['cards-3up'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="cards">
          ${c.items.map(it => `
            <div class="card">
              ${when(it.value, `<div class="card__value" data-contrast data-fit="0.5">${esc(it.value)}</div>`)}
              <div class="card__title" data-contrast data-fit="0.62">${esc(it.title)}</div>
              ${when(it.text, `<div class="card__text" data-contrast data-fit="0.7">${esc(it.text)}</div>`)}
            </div>`).join('')}
        </div>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['list-insight'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="numlist">
          ${c.items.map((it, i) => `
            <div class="numlist__item">
              <div class="numlist__n" data-contrast>${String(i + 1).padStart(2, '0')}</div>
              <div class="stack" style="gap:var(--gap-xs)">
                <div class="card__title" data-contrast data-fit="0.65">${esc(it.title)}</div>
                ${when(it.text, `<div class="card__text" data-contrast data-fit="0.72">${esc(it.text)}</div>`)}
              </div>
            </div>`).join('')}
        </div>
      </div>
      ${foot(d)}
    </div>`;
};

T['timeline'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="steps">
          ${c.steps.map((s, i) => `
            <div class="step">
              <div class="step__marker">
                <span class="step__dot"></span>
                <span data-contrast>${esc(s.label)}</span>
                ${when(i < c.steps.length - 1, '<span class="step__line"></span>')}
              </div>
              <div class="step__title mt-sm" data-contrast data-fit="0.62">${esc(s.title)}</div>
              ${when(s.text, `<div class="step__text" data-contrast data-fit="0.72">${esc(s.text)}</div>`)}
            </div>`).join('')}
        </div>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['process-flow'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:center">
        <div class="flow">
          ${c.steps.map((s, i) => `
            <div class="flow__node">
              <div class="step__marker" data-contrast>${esc(s.label)}</div>
              <div class="step__title" data-contrast data-fit="0.6">${esc(s.title)}</div>
              ${when(s.text, `<div class="step__text" data-contrast data-fit="0.72">${esc(s.text)}</div>`)}
            </div>
            ${when(i < c.steps.length - 1, '<div class="flow__arrow">→</div>')}`).join('')}
        </div>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

T['quote'] = d => {
  const c = d.content;
  return `
    <div class="canvas__content">
      ${when(c.eyebrow, `<div class="eyebrow" data-contrast>${esc(c.eyebrow)}</div>`)}
      <div class="slide-body" style="justify-content:center">
        <div class="quote__mark">&ldquo;</div>
        <div class="quote__text" style="max-width:26ch" data-contrast data-fit="0.55">${esc(c.quote.text)}</div>
        <div class="mt-lg stack" style="gap:var(--gap-xs)">
          <div class="quote__who" data-contrast>${esc(c.quote.attribution)}</div>
          ${when(c.quote.role, `<div class="quote__role" data-contrast>${esc(c.quote.role)}</div>`)}
        </div>
      </div>
      ${foot(d)}
    </div>`;
};

T['table'] = d => {
  const c = d.content;
  const num = new Set(c.table.numericColumns);
  return `
    <div class="canvas__content">
      ${head(c, { titleClass: 'title title--h2' })}
      <div class="slide-body mt-lg" style="justify-content:flex-start">
        <table class="dtable">
          <thead><tr>${c.table.columns.map((h, i) =>
            `<th class="${num.has(i) ? 'num' : ''}" data-contrast>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${c.table.rows.map(r => `<tr>${r.map((cell, i) =>
            `<td class="${num.has(i) ? 'num' : ''}" data-contrast>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        ${insight(c)}
      </div>
      ${foot(d)}
    </div>`;
};

export function renderTemplate(design) {
  const fn = T[design.template];
  if (!fn) throw new Error(`unknown template: ${design.template}`);
  return fn(design);
}

export const templateNames = Object.keys(T);
