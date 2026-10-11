// Web Export – Penpot-Plugin
// Wandelt Boards in eine statische Website (HTML + CSS + Bilder) um.
// Dieser Code läuft in der Penpot-Sandbox: kein DOM, nur das globale `penpot`-Objekt.
// Die Oberfläche (ui.html) baut aus dem Ergebnis die ZIP-Datei.

const ROOT_ID = "00000000-0000-0000-0000-000000000000";
const MOBILE_BREAKPOINT = 768;

const SEMANTIC_TAGS = ["header", "nav", "main", "section", "article", "aside", "footer", "div"];
// Nur eindeutige Namen – "Label" o. ä. kommt in Komponenten oft vor und soll kein Tag werden.
const TEXT_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote"];
const INDEX_NAMES = ["index", "home", "start", "startseite"];
const TEXT_PROPS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle",
  "lineHeight", "letterSpacing", "textTransform", "textDecoration",
];
// Penpot-interne Schrift-IDs -> Name bei Google Fonts
const FONT_ALIASES = { sourcesanspro: "Source Sans Pro", worksans: "Work Sans" };

const FLEX_ALIGN = { start: "flex-start", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" };
const FLEX_JUSTIFY = {
  start: "flex-start", end: "flex-end", center: "center", stretch: "stretch",
  "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly",
};

// ---------------------------------------------------------------------------
// Verbindung zur Oberfläche

penpot.ui.open("Web Export", `ui.html?theme=${penpot.theme}`, { width: 360, height: 660 });

penpot.ui.onMessage((msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ready" || msg.type === "refresh") sendBoards();
  if (msg.type === "export") runExport(msg.options || {});
});

penpot.on("selectionchange", () => sendBoards());
penpot.on("themechange", (theme) => penpot.ui.sendMessage({ type: "theme", theme }));

function sendBoards() {
  try {
    const { boards, fromSelection } = targetBoards();
    const pages = planPages(boards);
    penpot.ui.sendMessage({
      type: "boards",
      fromSelection,
      pages: pages.map((p) => ({
        name: p.board.name,
        file: p.file,
        responsive: Boolean(p.board.flex || p.board.grid),
      })),
    });
  } catch (e) {
    penpot.ui.sendMessage({ type: "error", message: errorText(e) });
  }
}

async function runExport(options) {
  const opts = {
    googleFonts: options.googleFonts !== false,
    mobile: options.mobile !== false,
    fluidType: options.fluidType !== false,
    scale: Number(options.scale) || 2,
  };
  try {
    const { boards } = targetBoards();
    if (!boards.length) throw new Error("Auf dieser Seite gibt es keine Boards zum Exportieren.");

    const ctx = createContext(boards, opts);
    const bodies = [];
    for (const page of ctx.pages) {
      penpot.ui.sendMessage({ type: "progress", text: `Baue ${page.file} …` });
      bodies.push(await renderPage(page, ctx));
    }
    // Die Dokumente erst am Ende zusammensetzen, weil die Schriften aller Seiten bekannt sein müssen.
    ctx.pages.forEach((page, i) => {
      ctx.files.push({ path: page.file, text: htmlDocument(page, bodies[i], ctx) });
    });
    ctx.files.push({ path: "style.css", text: buildCss(ctx) });

    penpot.ui.sendMessage({ type: "result", files: ctx.files, warnings: ctx.warnings });
  } catch (e) {
    penpot.ui.sendMessage({ type: "error", message: errorText(e) });
  }
}

function errorText(e) {
  return String((e && e.message) || e || "Unbekannter Fehler");
}

// ---------------------------------------------------------------------------
// Welche Boards werden exportiert?

function isTopLevel(shape) {
  const parent = shape.parent;
  return !parent || parent.id === ROOT_ID || !parent.parent;
}

function topBoardOf(shape) {
  let cur = shape;
  while (cur && !isTopLevel(cur)) cur = cur.parent;
  return cur && cur.type === "board" ? cur : null;
}

// Ausgewählte Boards (bzw. die Boards, in denen etwas ausgewählt ist),
// sonst alle Boards der aktuellen Seite.
function targetBoards() {
  const picked = [];
  for (const shape of penpot.selection || []) {
    const board = topBoardOf(shape);
    if (board && !picked.some((b) => b.id === board.id)) picked.push(board);
  }
  if (picked.length) return { boards: picked, fromSelection: true };

  const page = penpot.currentPage;
  let all = [];
  if (page && page.root && page.root.children) all = page.root.children;
  else if (page && page.findShapes) all = page.findShapes().filter(isTopLevel);
  const boards = all
    .filter((s) => s.type === "board" && !s.hidden)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return { boards, fromSelection: false };
}

function planPages(boards) {
  const indexBoard = flowStartBoard(boards) || boards.find((b) => INDEX_NAMES.includes(slugify(b.name))) || boards[0];
  const used = new Set();
  return boards.map((board) => {
    const base = board === indexBoard ? "index" : slugify(board.name) || "seite";
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    return { board, slug, nameSlug: slugify(board.name), file: `${slug}.html`, title: board.name };
  });
}

// Das Start-Board des ersten Prototyp-Flows wird zur index.html.
function flowStartBoard(boards) {
  try {
    const flows = (penpot.currentPage && penpot.currentPage.flows) || [];
    for (const flow of flows) {
      const start = flow.startingBoard;
      const match = start && boards.find((b) => b.id === start.id);
      if (match) return match;
    }
  } catch (e) {
    // Flows nicht verfügbar – dann entscheidet der Name.
  }
  return null;
}

function createContext(boards, opts) {
  const ctx = {
    opts,
    pages: planPages(boards),
    css: [],
    files: [],
    warnings: [],
    fonts: new Map(),
    counter: 0,
    assetCount: 0,
    designWidth: 1440,
    usesMobileStack: false,
    usesMobileGrid: false,
    usesMobilePad: false,
  };
  ctx.warn = (text) => {
    if (!ctx.warnings.includes(text)) ctx.warnings.push(text);
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Ebenen-Namen auswerten

function parseName(name) {
  const raw = String(name || "").trim();
  const m = raw.match(/^([a-zA-Z][\w-]*)\s*(?::\s*(.*))?$/);
  if (!m) return { kind: null };
  const key = m[1].toLowerCase();
  const arg = (m[2] || "").trim();
  if (key === "button" || key === "btn") return { kind: "button", href: arg || "#" };
  if (key === "link") return { kind: "link", href: arg || "#" };
  if (key === "img" || key === "bild") return { kind: "img", alt: arg };
  if (key === "svg") return { kind: "svg", alt: arg };
  if (key === "skip" || key === "ignore") return { kind: "skip" };
  if (SEMANTIC_TAGS.includes(key)) return { kind: "tag", tag: key, id: arg };
  if (TEXT_TAGS.includes(key)) return { kind: "text", tag: key, id: arg };
  return { kind: null };
}

function resolveHref(target, ctx) {
  const t = String(target || "").trim();
  if (!t || t === "#") return "#";
  if (/^(https?:|mailto:|tel:|#)/i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/.*)?$/i.test(t) && !/\.html?$/i.test(t)) return `https://${t}`;
  if (/^[^/\s]+@[^/\s]+\.[a-z]{2,}$/i.test(t)) return `mailto:${t}`;

  const [rawPath, hash] = t.split("#");
  const path = rawPath.replace(/^\.?\//, "").replace(/\.html?$/i, "");
  const slug = slugify(path);
  let file = "index.html";
  if (slug) {
    const page = ctx.pages.find((p) => p.slug === slug || p.nameSlug === slug);
    if (page) file = page.file;
    else {
      file = `${slug}.html`;
      ctx.warn(`Link-Ziel „${t}“ passt zu keinem exportierten Board.`);
    }
  }
  return hash ? `${file}#${hash}` : file;
}

// ---------------------------------------------------------------------------
// Seiten rendern

async function renderPage(page, ctx) {
  const board = page.board;
  ctx.designWidth = board.width || 1440;
  const meta = parseName(board.name);
  const cls = newClass(ctx, board);
  const classes = [cls, "page"];
  const decls = [];

  boxDecls(board, decls, ctx);
  if (board.flex || board.grid) {
    decls.push("position:relative", "width:100%", "min-height:100vh");
    layoutDecls(board, decls, classes, ctx);
  } else {
    decls.push("position:relative", `width:${px(board.width)}`, `height:${px(board.height)}`, "margin:0 auto");
    if (board.clipContent) decls.push("overflow:hidden");
    ctx.warn(`„${board.name}“ hat kein Flex- oder Grid-Layout. Die Seite hat eine feste Breite und passt sich nicht an Handys an.`);
  }
  ctx.css.push(rule(`.${cls}`, decls));

  const tag = meta.kind === "tag" ? meta.tag : "main";
  let inner = "";
  for (const child of orderedChildren(board)) inner += await renderNode(child, board, ctx, 2);
  page.background = firstSolidFill(board);
  return `  <${tag} class="${classes.join(" ")}">\n${inner}  </${tag}>\n`;
}

async function renderNode(shape, parent, ctx, depth, inLink) {
  if (!shape || shape.hidden) return "";
  const meta = parseName(shape.name);
  if (meta.kind === "skip") return "";

  const pad = "  ".repeat(depth);
  const cls = newClass(ctx, shape);
  const classes = [cls];
  const decls = [];
  let attrs = "";

  // Links im Link sind in HTML nicht erlaubt – der äußere gewinnt.
  const link = linkFor(shape, meta, ctx, inLink);
  const isLink = Boolean(link);
  if (link) {
    attrs += ` href="${escAttr(link.href)}"`;
    if (/^https?:/i.test(link.href)) attrs += ` target="_blank" rel="noopener"`;
    classes.push(link.button ? "btn" : "lnk");
  }
  if (meta.id) attrs += ` id="${escAttr(slugify(meta.id))}"`;

  // Vektoren, Bilder und alles mit "img"/"svg" im Namen wird als Datei exportiert.
  const exportKind = decideExport(shape, meta);
  if (exportKind) {
    placement(shape, parent, decls, { isImage: true });
    const src = await exportAsset(shape, exportKind, ctx);
    const size = ` width="${Math.round(shape.width)}" height="${Math.round(shape.height)}"`;
    const alt = escAttr(meta.alt || "");
    ctx.css.push(rule(`.${cls}`, decls));
    if (!src) return `${pad}<div class="${classes.join(" ")}"></div>\n`;
    if (isLink) {
      return `${pad}<a class="${classes.join(" ")}"${attrs}><img src="${src}" alt="${alt}"${size} loading="lazy"></a>\n`;
    }
    return `${pad}<img class="${classes.join(" ")}"${attrs} src="${src}" alt="${alt}"${size} loading="lazy">\n`;
  }

  if (shape.type === "text") {
    placement(shape, parent, decls, { isText: true });
    const tag = isLink ? "a" : meta.kind === "text" ? meta.tag : "p";
    const content = renderTextContent(shape, decls, ctx);
    ctx.css.push(rule(`.${cls}`, decls));
    return `${pad}<${tag} class="${classes.join(" ")}"${attrs}>${content}</${tag}>\n`;
  }

  // Container und einfache Formen
  const hasLayout = Boolean(shape.flex || shape.grid);
  placement(shape, parent, decls, { hasLayout });
  if (!decls.includes("position:absolute")) decls.push("position:relative");
  boxDecls(shape, decls, ctx);
  if (shape.type === "board") {
    layoutDecls(shape, decls, classes, ctx);
    if (shape.clipContent) decls.push("overflow:hidden");
  }
  ctx.css.push(rule(`.${cls}`, decls));

  const tag = isLink ? "a" : meta.kind === "tag" ? meta.tag : "div";
  const kids = orderedChildren(shape);
  if (!kids.length) return `${pad}<${tag} class="${classes.join(" ")}"${attrs}></${tag}>\n`;
  let inner = "";
  for (const child of kids) inner += await renderNode(child, shape, ctx, depth + 1, inLink || isLink);
  return `${pad}<${tag} class="${classes.join(" ")}"${attrs}>\n${inner}${pad}</${tag}>\n`;
}

// Link aus dem Ebenen-Namen (button:/link:) oder aus dem Prototyp ("Bei Klick → …").
function linkFor(shape, meta, ctx, inLink) {
  const named = meta.kind === "button" || meta.kind === "link";
  const action = named ? null : clickAction(shape);
  if (!named && !action) return null;
  if (inLink) {
    ctx.warn(`„${shape.name}“ liegt in einem anderen Link und wird deshalb nicht selbst verlinkt.`);
    return null;
  }

  if (named) return { href: resolveHref(meta.href, ctx), button: meta.kind === "button" };

  // Prototyp-Klicks: Texte werden normale Links, alles andere bekommt den Button-Hover.
  const button = shape.type !== "text";
  if (action.type === "navigate-to") {
    const dest = action.destination;
    const page = dest && ctx.pages.find((p) => p.board.id === dest.id);
    if (page) return { href: page.file, button };
    ctx.warn(`„${shape.name}“ führt zum Board „${dest ? dest.name : "?"}“, das nicht mit exportiert wird.`);
    return { href: dest ? `${slugify(dest.name) || "seite"}.html` : "#", button };
  }
  if (action.type === "open-url") {
    const url = String(action.url || "").trim();
    return { href: !url ? "#" : /^[a-z]+:/i.test(url) ? url : resolveHref(url, ctx), button };
  }
  if (action.type === "previous-screen") return { href: "javascript:history.back()", button };

  ctx.warn(`„${shape.name}“: Overlays aus dem Prototyp werden noch nicht unterstützt.`);
  return null;
}

function clickAction(shape) {
  let interactions;
  try {
    interactions = shape.interactions;
  } catch (e) {
    return null;
  }
  const hit = asArray(interactions).find((i) => i && i.trigger === "click" && i.action);
  return hit ? hit.action : null;
}

function decideExport(shape, meta) {
  if (meta.kind === "img") return "png";
  if (meta.kind === "svg") return "svg";
  if (["path", "bool", "svg-raw"].includes(shape.type)) return "svg";
  if (shape.type === "image") return "png";
  if ((shape.type === "rectangle" || shape.type === "ellipse") && hasImageFill(shape)) return "png";
  return null;
}

async function exportAsset(shape, kind, ctx) {
  const name = slugify(shape.name).slice(0, 40) || shape.type;
  const path = `assets/${name}-${++ctx.assetCount}.${kind}`;
  try {
    const data = await shape.export({ type: kind, scale: kind === "png" ? ctx.opts.scale : 1 });
    ctx.files.push({ path, data });
    return path;
  } catch (e) {
    ctx.warn(`„${shape.name}“ konnte nicht als ${kind.toUpperCase()} exportiert werden: ${errorText(e)}`);
    return null;
  }
}

function orderedChildren(shape) {
  const kids = (shape.children || []).filter((c) => c && !c.hidden);
  if (shape.grid) {
    return kids.slice().sort((a, b) => {
      const ca = a.layoutCell || {};
      const cb = b.layoutCell || {};
      return (ca.row || 0) - (cb.row || 0) || (ca.column || 0) - (cb.column || 0);
    });
  }
  if (!shape.flex) return kids; // freie Anordnung: Stapelreihenfolge beibehalten

  // Im Flex-Layout bestimmt die sichtbare Position die Reihenfolge im HTML.
  const isAbs = (c) => c.layoutChild && c.layoutChild.absolute;
  const flow = kids.filter((c) => !isAbs(c));
  const row = isRow(shape.flex.dir);
  const wrap = shape.flex.wrap === "wrap";
  flow.sort((a, b) => {
    if (row) {
      if (wrap && Math.abs(a.y - b.y) > Math.min(a.height, b.height) / 2) return a.y - b.y;
      return a.x - b.x;
    }
    if (wrap && Math.abs(a.x - b.x) > Math.min(a.width, b.width) / 2) return a.x - b.x;
    return a.y - b.y;
  });
  return flow.concat(kids.filter(isAbs));
}

// ---------------------------------------------------------------------------
// Position und Größe

function placement(shape, parent, decls, opt) {
  const lc = shape.layoutChild;
  const inFlow = (parent.flex || parent.grid) && !(lc && lc.absolute);
  if (inFlow) flowSizing(shape, parent, decls, opt);
  else {
    decls.push("position:absolute", `left:${px(shape.x - parent.x)}`, `top:${px(shape.y - parent.y)}`);
    absSizing(shape, decls, opt);
    if (lc && lc.zIndex) decls.push(`z-index:${lc.zIndex}`);
  }
  if (shape.rotation && !opt.isImage) decls.push(`transform:rotate(${round(shape.rotation, 2)}deg)`);
}

function absSizing(shape, decls, opt) {
  if (opt.isText) {
    if (shape.growType === "auto-width") decls.push("white-space:nowrap");
    else if (shape.growType === "auto-height") decls.push(`width:${px(shape.width)}`);
    else decls.push(`width:${px(shape.width)}`, `height:${px(shape.height)}`);
    return;
  }
  decls.push(`width:${px(shape.width)}`);
  decls.push(opt.hasLayout ? `min-height:${px(shape.height)}` : `height:${px(shape.height)}`);
}

function flowSizing(shape, parent, decls, opt) {
  const lc = shape.layoutChild || {};
  const dir = parent.flex ? parent.flex.dir : null;
  const row = isRow(dir);
  const col = dir === "column" || dir === "column-reverse";
  const h = lc.horizontalSizing || "fix";
  const v = lc.verticalSizing || "fix";

  if (opt.isText && shape.growType === "auto-width") decls.push("white-space:nowrap");

  if (h === "fix") {
    decls.push(`width:${px(shape.width)}`, "max-width:100%");
    if (row) decls.push("flex-shrink:0");
  } else if (h === "fill") {
    if (row) decls.push("flex:1 1 0", "min-width:0");
    else if (col) decls.push("align-self:stretch");
    else decls.push("width:100%");
  }

  if (opt.isImage) {
    decls.push(`aspect-ratio:${round(shape.width, 2)} / ${round(shape.height, 2)}`, "height:auto");
  } else if (v === "fix") {
    if (opt.isText) {
      if (shape.growType === "fixed") decls.push(`height:${px(shape.height)}`);
    } else decls.push(opt.hasLayout ? `min-height:${px(shape.height)}` : `height:${px(shape.height)}`);
    if (col) decls.push("flex-shrink:0");
  } else if (v === "fill") {
    if (col) decls.push("flex:1 1 0", "min-height:0");
    else if (row) decls.push("align-self:stretch");
    else decls.push("height:100%");
  }

  if (lc.alignSelf && lc.alignSelf !== "auto" && FLEX_ALIGN[lc.alignSelf]) {
    decls.push(`align-self:${FLEX_ALIGN[lc.alignSelf]}`);
  }
  const margins = [lc.topMargin, lc.rightMargin, lc.bottomMargin, lc.leftMargin].map(num);
  if (margins.some((m) => m)) decls.push(`margin:${margins.map(px).join(" ")}`);
  for (const [prop, css] of [["minWidth", "min-width"], ["maxWidth", "max-width"], ["minHeight", "min-height"], ["maxHeight", "max-height"]]) {
    if (typeof lc[prop] === "number" && lc[prop] > 0) decls.push(`${css}:${px(lc[prop])}`);
  }
  if (lc.zIndex) decls.push(`z-index:${lc.zIndex}`);

  const cell = parent.grid && shape.layoutCell;
  if (cell && cell.row && cell.column) {
    decls.push(`grid-row:${cell.row} / span ${cell.rowSpan || 1}`);
    decls.push(`grid-column:${cell.column} / span ${cell.columnSpan || 1}`);
  }
}

function isRow(dir) {
  return dir === "row" || dir === "row-reverse";
}

// ---------------------------------------------------------------------------
// Layout (Flex / Grid)

function layoutDecls(shape, decls, classes, ctx) {
  const layout = shape.flex || shape.grid;
  if (!layout) return;

  if (shape.flex) {
    const f = shape.flex;
    const row = isRow(f.dir);
    // Die Reihenfolge der Kinder ist schon visuell sortiert, daher nie "-reverse".
    decls.push("display:flex", `flex-direction:${row ? "row" : "column"}`);
    if (f.wrap === "wrap") decls.push("flex-wrap:wrap");
    pushGap(f, decls);
    decls.push(`align-items:${FLEX_ALIGN[f.alignItems] || "flex-start"}`);
    if (f.justifyContent && f.justifyContent !== "start") {
      decls.push(`justify-content:${FLEX_JUSTIFY[f.justifyContent] || "flex-start"}`);
    }
    if (f.wrap === "wrap" && f.alignContent && FLEX_JUSTIFY[f.alignContent]) {
      decls.push(`align-content:${FLEX_JUSTIFY[f.alignContent]}`);
    }
    const flowKids = (shape.children || []).filter((c) => !c.hidden && !(c.layoutChild && c.layoutChild.absolute));
    if (ctx.opts.mobile && row && shape.width > MOBILE_BREAKPOINT && flowKids.length > 1) {
      classes.push("m-stack");
      ctx.usesMobileStack = true;
    }
  } else {
    const g = shape.grid;
    decls.push("display:grid");
    if (g.columns && g.columns.length) decls.push(`grid-template-columns:${g.columns.map(gridTrack).join(" ")}`);
    if (g.rows && g.rows.length) decls.push(`grid-template-rows:${g.rows.map(gridTrack).join(" ")}`);
    pushGap(g, decls);
    // Grid versteht start/end/center/stretch direkt
    if (FLEX_ALIGN[g.alignItems]) decls.push(`align-items:${g.alignItems}`);
    if (FLEX_ALIGN[g.justifyItems]) decls.push(`justify-items:${g.justifyItems}`);
    if (ctx.opts.mobile && g.columns && g.columns.length > 1 && shape.width > MOBILE_BREAKPOINT) {
      classes.push("m-grid");
      ctx.usesMobileGrid = true;
    }
  }

  const paddings = [layout.topPadding, layout.rightPadding, layout.bottomPadding, layout.leftPadding].map(num);
  if (paddings.some((p) => p)) decls.push(`padding:${paddings.map(px).join(" ")}`);
  if (ctx.opts.mobile && (paddings[1] > 32 || paddings[3] > 32)) {
    classes.push("m-pad");
    ctx.usesMobilePad = true;
  }
}

function pushGap(layout, decls) {
  const rg = num(layout.rowGap);
  const cg = num(layout.columnGap);
  if (!rg && !cg) return;
  decls.push(rg === cg ? `gap:${px(rg)}` : `gap:${px(rg)} ${px(cg)}`);
}

function gridTrack(track) {
  const v = num(track.value);
  if (track.type === "fixed") return px(v);
  if (track.type === "percent") return `${round(v, 2)}%`;
  if (track.type === "flex") return `minmax(0, ${round(v || 1, 2)}fr)`;
  return "auto";
}

// ---------------------------------------------------------------------------
// Aussehen (Füllungen, Rahmen, Ecken, Schatten)

function boxDecls(shape, decls, ctx) {
  const layers = [];
  for (const fill of asArray(shape.fills)) {
    if (fill.fillImage) {
      ctx.warn(`Das Bild in der Füllung von „${shape.name}“ wird ignoriert. Tipp: Leg das Bild als eigenes Rechteck in das Board.`);
      continue;
    }
    if (fill.fillColorGradient) layers.push(gradientCss(fill.fillColorGradient, fill.fillOpacity));
    else if (fill.fillColor) layers.push(rgba(fill.fillColor, fill.fillOpacity));
  }
  if (layers.length === 1 && !layers[0].includes("gradient")) decls.push(`background-color:${layers[0]}`);
  else if (layers.length) {
    decls.push(`background:${layers.map((l) => (l.includes("gradient") ? l : `linear-gradient(${l}, ${l})`)).join(", ")}`);
  }

  const stroke = asArray(shape.strokes).find((s) => s && s.strokeColor && num(s.strokeWidth) > 0 && s.strokeStyle !== "none");
  if (stroke) {
    const style = ["dashed", "dotted"].includes(stroke.strokeStyle) ? stroke.strokeStyle : "solid";
    const value = `${px(stroke.strokeWidth)} ${style} ${rgba(stroke.strokeColor, stroke.strokeOpacity)}`;
    if (stroke.strokeAlignment === "outer") decls.push(`outline:${value}`);
    else decls.push(`border:${value}`);
  }

  if (shape.type === "ellipse") decls.push("border-radius:50%");
  else {
    const corners = [shape.borderRadiusTopLeft, shape.borderRadiusTopRight, shape.borderRadiusBottomRight, shape.borderRadiusBottomLeft].map(num);
    if (corners.some((c) => c)) {
      decls.push(corners.every((c) => c === corners[0]) ? `border-radius:${px(corners[0])}` : `border-radius:${corners.map(px).join(" ")}`);
    } else if (num(shape.borderRadius)) decls.push(`border-radius:${px(shape.borderRadius)}`);
  }

  const shadows = shadowList(shape, false);
  if (shadows) decls.push(`box-shadow:${shadows}`);
  effectDecls(shape, decls);
}

function effectDecls(shape, decls) {
  if (typeof shape.opacity === "number" && shape.opacity < 1) decls.push(`opacity:${round(shape.opacity, 3)}`);
  if (shape.blur && !shape.blur.hidden && num(shape.blur.value)) decls.push(`filter:blur(${px(shape.blur.value)})`);
  if (shape.blendMode && shape.blendMode !== "normal" && !isMixed(shape.blendMode)) decls.push(`mix-blend-mode:${shape.blendMode}`);
}

function shadowList(shape, forText) {
  const list = asArray(shape.shadows)
    .filter((s) => s && !s.hidden && !(forText && s.style === "inner-shadow"))
    .map((s) => {
      const color = s.color ? rgba(s.color.color, s.color.opacity) : "rgba(0, 0, 0, 0.2)";
      if (forText) return `${px(s.offsetX)} ${px(s.offsetY)} ${px(s.blur)} ${color}`;
      const inset = s.style === "inner-shadow" ? "inset " : "";
      return `${inset}${px(s.offsetX)} ${px(s.offsetY)} ${px(s.blur)} ${px(s.spread)} ${color}`;
    });
  return list.join(", ");
}

function hasImageFill(shape) {
  return asArray(shape.fills).some((f) => f && f.fillImage);
}

function firstSolidFill(shape) {
  const fill = asArray(shape.fills).find((f) => f && f.fillColor && !f.fillImage && !f.fillColorGradient);
  return fill ? rgba(fill.fillColor, fill.fillOpacity) : null;
}

function gradientCss(g, opacity) {
  const op = opacity == null ? 1 : Number(opacity);
  const stops = asArray(g.stops)
    .map((s) => `${rgba(s.color, (s.opacity == null ? 1 : s.opacity) * op)} ${round(num(s.offset) * 100, 2)}%`)
    .join(", ");
  if (g.type === "radial") {
    return `radial-gradient(circle at ${round(num(g.startX) * 100, 1)}% ${round(num(g.startY) * 100, 1)}%, ${stops})`;
  }
  const angle = (Math.atan2(num(g.endX) - num(g.startX), -(num(g.endY) - num(g.startY))) * 180) / Math.PI;
  return `linear-gradient(${round(angle, 1)}deg, ${stops})`;
}

// ---------------------------------------------------------------------------
// Text

function renderTextContent(shape, decls, ctx) {
  const chars = String(shape.characters || "");
  decls.push(...textDecls(shape, ctx));

  const align = firstOk(shape.align, shape.textAlign);
  if (align && align !== "left") decls.push(`text-align:${align}`);

  const shadows = shadowList(shape, true);
  if (shadows) decls.push(`text-shadow:${shadows}`);
  effectDecls(shape, decls);

  let html = escapeText(chars);
  const mixed = TEXT_PROPS.some((p) => isMixed(shape[p])) || isMixed(shape.fills);
  if (mixed) {
    const runs = textRuns(shape, chars);
    if (runs) {
      html = runs
        .map((run) => {
          const runDecls = textDecls(run.style, ctx);
          if (!runDecls.length) return escapeText(run.text);
          const cls = `t-${++ctx.counter}`;
          ctx.css.push(rule(`.${cls}`, runDecls));
          // Zeilenumbrüche außerhalb der <span> halten
          return run.text
            .split("\n")
            .map((part) => (part ? `<span class="${cls}">${escapeText(part)}</span>` : ""))
            .join("<br>");
        })
        .join("");
    } else {
      ctx.warn(`„${shape.name}“ hat gemischte Schriftstile, die nicht ausgelesen werden konnten.`);
    }
  }

  const vAlign = shape.verticalAlign;
  if (shape.growType === "fixed" && (vAlign === "center" || vAlign === "bottom")) {
    decls.push("display:flex", "flex-direction:column", `justify-content:${vAlign === "center" ? "center" : "flex-end"}`);
    html = `<span class="txt-in">${html}</span>`;
  }
  return html;
}

// Text in Abschnitte mit gleichem Stil zerlegen (für gemischte Formatierung)
function textRuns(shape, chars) {
  if (typeof shape.getRange !== "function") return null;
  const runs = [];
  let current = null;
  try {
    for (let i = 0; i < chars.length; i++) {
      const range = shape.getRange(i, i + 1);
      const style = {};
      for (const p of TEXT_PROPS) style[p] = range[p];
      style.fills = range.fills;
      const sig = JSON.stringify(style);
      if (current && current.sig === sig) current.text += chars[i];
      else {
        current = { sig, style, text: chars[i] };
        runs.push(current);
      }
    }
  } catch (e) {
    return null;
  }
  return runs;
}

function textDecls(o, ctx) {
  const d = [];
  if (ok(o.fontFamily)) {
    d.push(`font-family:${fontStack(o.fontFamily)}`);
    addFont(ctx, o.fontFamily, ok(o.fontWeight) ? o.fontWeight : "400", ok(o.fontStyle) ? o.fontStyle : "normal");
  }
  if (ok(o.fontSize)) d.push(fontSizeDecl(Number(o.fontSize), ctx));
  if (ok(o.fontWeight)) d.push(`font-weight:${o.fontWeight}`);
  if (ok(o.fontStyle) && o.fontStyle !== "normal") d.push(`font-style:${o.fontStyle}`);
  if (ok(o.lineHeight)) d.push(`line-height:${round(Number(o.lineHeight), 3)}`);
  if (ok(o.letterSpacing) && Number(o.letterSpacing) !== 0) d.push(`letter-spacing:${px(o.letterSpacing)}`);
  if (ok(o.textTransform) && o.textTransform !== "none") d.push(`text-transform:${o.textTransform}`);
  if (ok(o.textDecoration) && o.textDecoration !== "none") d.push(`text-decoration:${o.textDecoration}`);
  const color = textColor(o.fills);
  if (color) d.push(`color:${color}`);
  return d;
}

function textColor(fills) {
  if (isMixed(fills)) return null;
  const fill = asArray(fills)[0];
  if (!fill) return null;
  if (fill.fillColor) return rgba(fill.fillColor, fill.fillOpacity);
  const stop = fill.fillColorGradient && asArray(fill.fillColorGradient.stops)[0];
  return stop ? rgba(stop.color, stop.opacity) : null;
}

function fontSizeDecl(size, ctx) {
  // Große Schriften schrumpfen auf kleinen Bildschirmen mit (bis ~60 %).
  if (ctx.opts.fluidType && size > 32) {
    const min = Math.max(28, Math.round(size * 0.6));
    const vw = round((size / ctx.designWidth) * 100, 2);
    return `font-size:clamp(${min}px, ${vw}vw, ${round(size, 2)}px)`;
  }
  return `font-size:${px(size)}`;
}

function fontName(family) {
  return FONT_ALIASES[String(family).toLowerCase()] || String(family);
}

function fontStack(family) {
  return `"${fontName(family).replace(/"/g, "")}", system-ui, sans-serif`;
}

function addFont(ctx, family, weight, style) {
  const name = fontName(family);
  if (!ctx.fonts.has(name)) ctx.fonts.set(name, new Set());
  ctx.fonts.get(name).add(`${style === "italic" ? 1 : 0},${parseInt(weight, 10) || 400}`);
}

// ---------------------------------------------------------------------------
// Dokument und Stylesheet

function htmlDocument(page, body, ctx) {
  const fonts = ctx.opts.googleFonts ? fontLinks(ctx) : "";
  const bodyStyle = page.background ? ` style="background-color:${page.background}"` : "";
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeText(page.title)}</title>
${fonts}  <link rel="stylesheet" href="style.css">
</head>
<body${bodyStyle}>
${body}</body>
</html>
`;
}

function fontLinks(ctx) {
  if (!ctx.fonts.size) return "";
  let out = '  <link rel="preconnect" href="https://fonts.googleapis.com">\n';
  out += '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n';
  // Eine Datei pro Schrift: fehlt eine bei Google, laden die anderen trotzdem.
  for (const [family, variants] of ctx.fonts) {
    const tuples = [...variants]
      .map((t) => t.split(",").map(Number))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map((t) => t.join(","))
      .join(";");
    const fam = encodeURIComponent(family).replace(/%20/g, "+");
    out += `  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam}:ital,wght@${tuples}&amp;display=swap">\n`;
  }
  return out;
}

function buildCss(ctx) {
  let css = `/* Erzeugt mit dem Penpot-Plugin „Web Export“ */

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
h1, h2, h3, h4, h5, h6, p, blockquote, label { margin: 0; font: inherit; }
img { display: block; max-width: 100%; }
a { color: inherit; }
.lnk { text-decoration: none; }
.lnk:hover { opacity: 0.8; }
.btn { text-decoration: none; cursor: pointer; transition: filter 0.15s ease, transform 0.15s ease; }
.btn:hover { filter: brightness(1.08); }
.btn:active { transform: translateY(1px); }
.btn > img, .lnk > img { width: 100%; height: 100%; }
.txt-in { display: block; }

`;
  css += ctx.css.join("\n");

  const mobile = [];
  if (ctx.usesMobileStack) {
    mobile.push(
      "  .m-stack { flex-direction: column !important; flex-wrap: nowrap !important; align-items: stretch !important; }",
      "  .m-stack > * { width: auto !important; max-width: 100% !important; flex: 0 0 auto !important; align-self: stretch !important; }",
    );
  }
  if (ctx.usesMobileGrid) {
    mobile.push(
      "  .m-grid { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: none !important; }",
      "  .m-grid > * { grid-column: 1 / -1 !important; grid-row: auto !important; }",
    );
  }
  if (ctx.usesMobilePad) mobile.push("  .m-pad { padding-left: 20px !important; padding-right: 20px !important; }");
  if (mobile.length) css += `\n\n/* Handy */\n@media (max-width: ${MOBILE_BREAKPOINT}px) {\n${mobile.join("\n")}\n}\n`;
  return css;
}

function rule(selector, decls) {
  if (!decls.length) return `${selector} {}\n`;
  return `${selector} {\n${decls.map((d) => `  ${d.replace(":", ": ")};`).join("\n")}\n}\n`;
}

function newClass(ctx, shape) {
  const base = slugify(shape.name).slice(0, 24) || shape.type || "el";
  const safe = /^[a-z]/.test(base) ? base : `e-${base}`;
  return `${safe}-${++ctx.counter}`;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rgba(hex, opacity) {
  if (!hex || typeof hex !== "string") return "transparent";
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  h = h.slice(0, 6).toLowerCase();
  const a = opacity == null ? 1 : Number(opacity);
  if (a >= 1) return `#${h}`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${round(a, 3)})`;
}

function px(value) {
  const v = round(num(value), 2);
  return v === 0 ? "0" : `${v}px`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits) {
  const f = Math.pow(10, digits || 0);
  return Math.round(Number(value) * f) / f;
}

function isMixed(value) {
  return value === "mixed" || typeof value === "symbol";
}

function ok(value) {
  return value !== undefined && value !== null && value !== "" && !isMixed(value);
}

function firstOk(...values) {
  return values.find(ok);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeText(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function escAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
