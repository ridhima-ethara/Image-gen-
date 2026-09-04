/* ============================================================
   Browser-side ECharts builder. Runs inside the render page so
   it shares the page's fonts and CSS custom properties -- which
   is exactly why we don't use ECharts' Node SSR path: SSR has no
   canvas, so it *estimates* text widths and label collisions
   only show up after the fact.

   Every spec here is the dataviz house style, not ECharts'
   defaults. Plain script, no modules -- injected via addScriptTag.
   ============================================================ */
(function () {
  'use strict';

  function tok(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function u() { return parseFloat(tok('--u')) || 1; }
  function px(n) { return n * u(); }

  function palette() {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(i => tok('--series-' + i));
  }

  /* rgba() from a hex + alpha -- for the 10% area wash. */
  function washOf(hex, alpha) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function fmt(v, unit, decimals) {
    let s;
    if (decimals !== null && decimals !== undefined) s = Number(v).toFixed(decimals);
    else s = Math.abs(v) >= 10000 ? v.toLocaleString('en-US') : String(v);
    return unit ? s + unit : s;
  }

  function baseText(size, color, weight) {
    return {
      fontFamily: 'Inter, sans-serif',
      fontSize: px(size),
      fontWeight: weight || 500,
      color: color,
    };
  }

  /* ---- which points get a direct label ----------------------
     Never a number on every point. Rules:
       - one series, <= 6 categories  -> label every bar tip
         (this is also the "relief" the light palette's sub-3:1
          contrast WARN requires)
       - one series, more categories  -> label the max and min only
       - many series                  -> label only the focus series
     ---------------------------------------------------------- */
  function labelPolicy(spec) {
    const multi = spec.series.length > 1;
    if (!multi) {
      /* "Never a number on every point" is about dense marks -- a line
         with 8 points labelled is chaos. A bar chart is different: the
         value belongs at the tip, and up to 8 bars stay readable. It is
         also the relief the light palette's sub-3:1 contrast requires. */
      const isBar = spec.type === 'bar' || spec.type === 'hbar';
      return spec.categories.length <= (isBar ? 8 : 6) ? 'all' : 'extremes';
    }
    return spec.focusSeries === null ? 'none' : 'focus';
  }

  function extremeIdx(data) {
    let hi = 0, lo = 0;
    data.forEach((v, i) => { if (v > data[hi]) hi = i; if (v < data[lo]) lo = i; });
    return new Set([hi, lo]);
  }

  function valueLabel(spec, seriesIdx, policy, position) {
    const color = tok('--text-primary');
    const off = policy === 'none' ? null : true;
    if (!off) return { show: false };
    const show =
      policy === 'all' ? true :
      policy === 'focus' ? seriesIdx === spec.focusSeries :
      false;
    if (!show && policy !== 'extremes') return { show: false };

    const base = {
      show: true,
      position: position,
      distance: px(8),
      ...baseText(22, color, 620),
      formatter: p => fmt(p.value, spec.unit, spec.decimals),
    };
    if (policy === 'extremes') {
      const keep = extremeIdx(spec.series[seriesIdx].data);
      base.formatter = p => (keep.has(p.dataIndex) ? fmt(p.value, spec.unit, spec.decimals) : '');
    }
    return base;
  }

  function axisCommon(isValue) {
    return {
      axisLine: { show: !isValue, lineStyle: { color: tok('--hairline'), width: 1 } },
      axisTick: { show: false },
      axisLabel: {
        ...baseText(22, tok('--text-muted'), 500),
        margin: px(14),
        /* Tabular figures so ticks form a clean column. */
        fontFeatureSettings: '"tnum"',
      },
      /* Solid hairline grid, one step off the surface. Never dashed. */
      splitLine: {
        show: isValue,
        lineStyle: { color: tok('--grid'), width: 1, type: 'solid' },
      },
    };
  }

  function legendFor(spec) {
    /* One series needs no legend -- the title already names it. */
    if (spec.series.length < 2) return { show: false };
    return {
      show: true,
      top: 0,
      right: 0,
      itemGap: px(28),
      icon: 'circle',
      itemWidth: px(12),
      itemHeight: px(12),
      textStyle: { ...baseText(22, tok('--text-secondary'), 500), padding: [0, 0, 0, px(6)] },
    };
  }

  /* The house spec caps bars at 24px -- written for a dashboard-sized
     chart. On a 1744px-wide slide plot that reads as matchsticks: the
     INTENT is "never fill the band, leave the leftover as air", so we
     scale the cap to the band and keep a generous air ratio. */
  function barCap(spec, plotW) {
    const lanes = spec.categories.length * (spec.type === 'stacked-bar' ? 1 : spec.series.length);
    const band = (plotW || 900) / Math.max(1, lanes);
    return Math.max(px(20), Math.min(px(80), band * 0.28));
  }

  function build(spec, ctx) {
    const plotW = (ctx && ctx.width) || 900;
    const colors = palette();
    const policy = labelPolicy(spec);
    const surface = tok('--surface-1');
    const horizontal = spec.type === 'hbar';
    const stacked = spec.type === 'stacked-bar';

    if (spec.type === 'donut') return buildDonut(spec, colors);

    const series = spec.series.map((s, i) => {
      const color = colors[i % 8];
      const isBar = spec.type === 'bar' || horizontal || stacked;

      if (isBar) {
        /* 4px rounded data-end, square at the baseline. */
        const r = px(4);
        const radius = horizontal ? [0, r, r, 0] : [r, r, 0, 0];
        return {
          name: s.name,
          type: 'bar',
          data: s.data,
          stack: stacked ? 'total' : undefined,
          barMaxWidth: barCap(spec, plotW),   /* never fill the band */
          barGap: '18%',                /* the gap between adjacent bars */
          barCategoryGap: '42%',
          itemStyle: {
            color,
            borderRadius: stacked ? 0 : radius,
            /* Stacked segments are separated by surface, not a stroke:
               each segment contributes 1px of surface, giving the 2px gap. */
            borderColor: stacked ? surface : 'transparent',
            borderWidth: stacked ? px(1) : 0,
          },
          label: valueLabel(spec, i, stacked ? 'none' : policy,
            horizontal ? 'right' : 'top'),
          labelLayout: { hideOverlap: true },
        };
      }

      /* line / area */
      return {
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: false,
        symbol: 'circle',
        symbolSize: px(9),
        showSymbol: spec.categories.length <= 14,
        lineStyle: { width: px(2), color, cap: 'round', join: 'round' },
        /* 2px surface ring keeps markers legible where lines cross. */
        itemStyle: { color, borderColor: surface, borderWidth: px(2) },
        areaStyle: spec.type === 'area'
          ? { color: washOf(color, parseFloat(tok('--area-wash')) || 0.10) }
          : undefined,
        /* Lines get an end-label rather than a number on every point. */
        endLabel: (policy === 'focus' && i !== spec.focusSeries) ? { show: false } : {
          show: true,
          ...baseText(22, tok('--text-primary'), 620),
          distance: px(10),
          formatter: p => fmt(p.value, spec.unit, spec.decimals),
        },
        label: { show: false },
        emphasis: { disabled: true },
      };
    });

    const cat = { type: 'category', data: spec.categories, boundaryGap: true, ...axisCommon(false) };
    const val = {
      type: 'value',
      max: spec.max,
      ...axisCommon(true),
      axisLabel: { ...axisCommon(true).axisLabel, formatter: v => fmt(v, spec.unit) },
    };

    /* A single series gets no legend -- correctly, one colour needs no key.
       But that also drops the only place the MEASURE was named ("Sales, $bn"),
       so the reader is left with bare numbers. Caption the value axis instead:
       it names what is plotted without adding a legend box. */
    if (spec.series.length === 1 && spec.series[0].name) {
      val.name = spec.series[0].name;
      val.nameLocation = 'end';
      val.nameGap = px(18);
      val.nameTextStyle = { ...baseText(21, tok('--text-muted'), 500), align: horizontal ? 'right' : 'left' };
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      color: colors,
      textStyle: { fontFamily: 'Inter, sans-serif' },
      grid: {
        left: px(16), right: px(56), bottom: px(6),
        /* Reserve headroom for whichever chrome sits above the plot --
           a legend, or the value-axis caption. containLabel covers the
           axis BAND but not either of these, so they clip without it. */
        top: px(spec.series.length > 1 ? 62 : (val.name ? 52 : 24)),
        containLabel: true,
      },
      legend: legendFor(spec),
      /* One axis. Always. Two measures of different scale get two charts. */
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? { ...cat, inverse: true } : val,
      series,
    };
  }

  function buildDonut(spec, colors) {
    const data = spec.categories.map((c, i) => ({ name: c, value: spec.series[0].data[i] }));
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'Inter, sans-serif' },
      series: [{
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '54%'],
        data,
        /* 2px of surface between slices -- the same spacer as everywhere. */
        itemStyle: { color: p => colors[p.dataIndex % 8], borderColor: tok('--surface-1'), borderWidth: px(2) },
        label: {
          ...baseText(24, tok('--text-secondary'), 500),
          formatter: p => `{n|${p.name}}\n{v|${fmt(p.value, spec.unit)}}`,
          rich: {
            n: baseText(22, tok('--text-secondary'), 500),
            v: baseText(28, tok('--text-primary'), 650),
          },
        },
        labelLine: { length: px(16), length2: px(20), lineStyle: { color: tok('--hairline'), width: 1 } },
        labelLayout: { hideOverlap: true },
        emphasis: { disabled: true },
      }],
    };
  }

  /* Mount every [data-chart] node. Returns a promise that settles
     only once ECharts reports the render finished -- screenshotting
     before this is how you get a half-drawn chart. */
  function mountAll() {
    const nodes = Array.from(document.querySelectorAll('[data-chart]'));
    return Promise.all(nodes.map(node => new Promise(resolve => {
      const spec = JSON.parse(node.getAttribute('data-chart'));
      const inst = echarts.init(node, null, {
        renderer: 'canvas',
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      /* A horizontal bar's band runs down the height, not across. */
      const ctx = {
        width: spec.type === 'hbar' ? node.clientHeight : node.clientWidth,
        height: node.clientHeight,
      };
      inst.on('finished', () => resolve());
      inst.setOption(build(spec, ctx));
      /* 'finished' can fire before the listener attaches on a
         trivially small chart; belt and braces. */
      setTimeout(resolve, 1500);
    })));
  }

  window.SMAChart = { build, mountAll, tok, px };
})();
