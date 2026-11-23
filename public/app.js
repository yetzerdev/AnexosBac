'use strict';
const $ = id => document.getElementById(id);
const PIE = '"El presente formato de avalúo es propiedad exclusiva de BAC Credomatic y la misma debe ser protegida contra eventos que puedan alterar su disponibilidad, integridad y/o confidencialidad"';
const FRECUENTES = ['VISTA AÉREA COLINDANTE NORTE', 'VISTA AÉREA COLINDANTE SUR', 'VISTA AÉREA COLINDANTE ESTE', 'VISTA AÉREA COLINDANTE OESTE', 'VISTA AÉREA SUPERIOR', 'VISTA PANORÁMICA', 'VISTA AÉREA DE TERRENO', 'EMBALSE DE AGUA POTABLE', 'ACCESO A LA FINCA', 'BAÑOS Y DUCHAS'];

// Geometría de la hoja A4, en mm. La comparten vista previa, PDF y Excel.
const G = { w: 210, h: 297, x: 9, ancho: 192, tituloY: 12, tituloH: 15.5, y0: 31, col: 60, sepX: 6, foto: 41, ley: 9, pieY: 284, borde: 0.5 };
const POR_HOJA = 15;
const PT = 25.4 / 72;                 // mm por punto
const TAM_LEYENDA = 10, TAM_PIE = 6.5;
const celda = i => ({ x: G.x + (i % 3) * (G.col + G.sepX), y: G.y0 + Math.floor(i / 3) * (G.foto + G.ley) });

let docs = [], activo = null, guardarT;
const docActivo = () => docs.find(d => d.id === activo);
const nuevoId = () => Math.random().toString(36).slice(2);

function estado(txt, error) { $('estado').textContent = txt; $('estado').classList.toggle('error', !!error); }

/* ---------- Guardado automático en este navegador ---------- */
const db = new Promise((ok, mal) => {
  const r = indexedDB.open('anexos', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => mal(r.error);
});
db.catch(() => {});
function guardar() {
  clearTimeout(guardarT);
  guardarT = setTimeout(async () => {
    try {
      const datos = docs.map(d => ({ ...d, fotos: d.fotos.map(f => ({ id: f.id, texto: f.texto, blob: f.blob })) }));
      const tx = (await db).transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ docs: datos, activo }, 'estado');
      tx.onabort = () => estado('No se pudo guardar el avance en este navegador (sin espacio).', true);
    } catch (e) { console.warn('Sin guardado automático', e); }
  }, 400);
}
async function restaurar() {
  try {
    const d = await db;
    const s = await new Promise((ok, mal) => { const r = d.transaction('kv').objectStore('kv').get('estado'); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
    if (!s) return;
    for (const x of s.docs) for (const f of x.fotos) await abrir(f);
    docs = [...s.docs, ...docs];
    activo = activo || s.activo;
  } catch (e) { console.warn(e); }
}

/* ---------- Lectura de carpetas ---------- */
const esImagen = n => /\.(jpe?g|png|webp|bmp|gif|avif|jfif|heic|heif|tiff?)$/i.test(n);
const orden = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

async function leerHandle(h, ruta, out) {
  if (h.kind === 'file') { if (esImagen(h.name)) out.push({ ruta, file: await h.getFile() }); return; }
  for await (const c of h.values()) await leerHandle(c, [...ruta, h.name], out);
}
async function leerEntry(e, ruta, out) {
  if (e.isFile) { if (esImagen(e.name)) out.push({ ruta, file: await new Promise((a, b) => e.file(a, b)) }); return; }
  const lector = e.createReader();
  for (;;) { // readEntries entrega de 100 en 100
    const lote = await new Promise((a, b) => lector.readEntries(a, b));
    if (!lote.length) break;
    for (const c of lote) await leerEntry(c, [...ruta, e.name], out);
  }
}

// El texto sale del nombre de la foto, salvo nombres automáticos de cámara.
function textoDeNombre(n) {
  const t = n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(img|dji|dsc[nf]?|pxl|mvimg|vid|photo|foto|imagen|image|screenshot|captura|whatsapp)[\s\-.\d]|^(dsc[nf]?|img|image|imagen|foto)$|^[\d\s\-.()]+$|^[a-f\d]{8}-[a-f\d-]{20,}/i.test(t)) return '';
  return t.replace(/^\d+\s*[-.)]\s*|^\d+\s+/, '').replace(/\s*\(\d+\)$/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es');
}

async function abrir(f) { f.bmp = await createImageBitmap(f.blob); f.url = URL.createObjectURL(f.blob); return f; }
async function prepararFoto(file) {
  let bmp = await createImageBitmap(file); // ya aplica la rotación EXIF
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return abrir({ id: nuevoId(), texto: textoDeNombre(file.name), blob });
}

async function agregar(archivos) {
  if (!archivos.length) return estado('No encontré imágenes en lo que soltaste.', true);
  const grupos = new Map();
  for (const a of archivos) { const k = a.ruta.join('/'); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(a); }
  const nuevos = [], fallas = [];
  let n = 0;
  for (const [ruta, lista] of [...grupos].sort((a, b) => orden.compare(a[0], b[0]))) {
    lista.sort((a, b) => orden.compare(a.file.name, b.file.name));
    const fotos = [];
    for (const a of lista) {
      estado(`Cargando foto ${++n} de ${archivos.length}…`);
      try { fotos.push(await prepararFoto(a.file)); } catch { fallas.push(a.file.name); }
    }
    if (!fotos.length) continue;
    if (!ruta && docActivo()) { docActivo().fotos.push(...fotos); continue; } // fotos sueltas
    const d = { id: nuevoId(), nombre: ruta.split('/').join(' - ') || 'Anexos', pie: PIE, ajuste: 'cover', fotos };
    docs.push(d); nuevos.push(d); activo = d.id;
  }
  pintar(); guardar();
  if ($('auto').checked) for (const d of nuevos) { await bajar(d, 'pdf'); await bajar(d, 'xlsx'); }
  if (fallas.length) estado(`No se pudieron abrir: ${fallas.join(', ')}. Conviértelas a JPG o PNG.`, true);
  else estado(`${n} fotos listas.`);
}

let cola = Promise.resolve();
const encolar = fn => cola = cola.then(fn).catch(e => { console.error(e); estado('Ocurrió un error: ' + (e.message || e), true); });

const traeArchivos = e => [...e.dataTransfer.types].includes('Files');
let prof = 0;
addEventListener('dragenter', e => { if (traeArchivos(e)) { prof++; document.body.classList.add('arrastrando'); } });
addEventListener('dragleave', e => { if (traeArchivos(e) && --prof <= 0) { prof = 0; document.body.classList.remove('arrastrando'); } });
addEventListener('dragover', e => { if (traeArchivos(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!traeArchivos(e)) return;
  e.preventDefault(); prof = 0;
  if ($('auto').checked) fuentesListas = cargarFuentes(); document.body.classList.remove('arrastrando');
  // Hay que pedir todo antes del primer await: luego dataTransfer se vacía.
  const tareas = [...e.dataTransfer.items].filter(i => i.kind === 'file').map(i => {
    const entry = i.webkitGetAsEntry && i.webkitGetAsEntry();
    const file = i.getAsFile();
    const handle = i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null;
    return async out => {
      const h = await handle;
      if (h) return leerHandle(h, [], out);
      if (entry) return leerEntry(entry, [], out);
      if (file && esImagen(file.name)) out.push({ ruta: [], file });
    };
  });
  encolar(async () => { const out = []; for (const t of tareas) await t(out); await agregar(out); });
});
$('archivos').onchange = e => {
  const out = [...e.target.files].filter(f => esImagen(f.name)).map(file => ({ ruta: (file.webkitRelativePath || '').split('/').slice(0, -1), file }));
  e.target.value = '';
  encolar(() => agregar(out));
};

/* ---------- Dibujo ---------- */
function dibujar(foto, ajuste, pxmm) {
  const c = document.createElement('canvas');
  const W = c.width = Math.round(G.col * pxmm), H = c.height = Math.round(G.foto * pxmm);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const { width: w, height: h } = foto.bmp;
  if (ajuste === 'fill') x.drawImage(foto.bmp, 0, 0, W, H);
  else {
    const k = Math[ajuste === 'cover' ? 'max' : 'min'](W / w, H / h);
    x.drawImage(foto.bmp, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
  }
  const b = G.borde * pxmm;
  x.strokeStyle = '#12304a'; x.lineWidth = b; x.strokeRect(b / 2, b / 2, W - b, H - b);
  return c;
}

const regla = document.createElement('canvas').getContext('2d');
const CSS_FUENTE = { ArialNarrowI: 'italic 100px "Arial Narrow", Arial', CalibriI: 'italic 100px Calibri, Arial' };
function medir(t, fuente, pt) { regla.font = CSS_FUENTE[fuente]; return regla.measureText(t).width / 100 * pt * PT; }
function partir(t, fuente, pt, max) {
  const lineas = []; let l = '';
  for (const p of t.split(/\s+/).filter(Boolean)) {
    const s = l ? l + ' ' + p : p;
    if (l && medir(s, fuente, pt) > max) { lineas.push(l); l = p; } else l = s;
  }
  if (l) lineas.push(l);
  return lineas;
}
// 10 pt siempre; solo se reduce si el texto no cabe en dos líneas.
function leyenda(texto) {
  const t = texto.toLocaleUpperCase('es');
  let pt = TAM_LEYENDA, lineas;
  do { lineas = partir(t, 'ArialNarrowI', pt, G.col - 5); }
  while ((lineas.length > 2 || lineas.some(l => medir(l, 'ArialNarrowI', pt) > G.col - 5)) && (pt -= 0.5) >= 5);
  return { pt, lineas };
}
const pieLineas = d => partir(d.pie, 'CalibriI', TAM_PIE, G.ancho);
const numHojas = d => Math.max(1, Math.ceil(d.fotos.length / POR_HOJA));

function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function ubicar(e, x, y, w, h) { e.style.cssText += `left:calc(${x}*var(--u));top:calc(${y}*var(--u));width:calc(${w}*var(--u));` + (h ? `height:calc(${h}*var(--u));` : ''); return e; }

function pintarHojas() {
  const cont = $('hojas'), d = docActivo(), sc = cont.scrollTop;
  cont.replaceChildren();
  const vacio = { fotos: [], pie: PIE, ajuste: 'cover' }, dd = d || vacio;
  for (let p = 0; p < numHojas(dd); p++) {
    const hoja = el('div', 'hoja');
    hoja.append(ubicar(el('div', 'titulo', 'ANEXOS'), G.x, G.tituloY, G.ancho, G.tituloH));
    for (let i = 0; i < POR_HOJA; i++) {
      const k = p * POR_HOJA + i, f = dd.fotos[k], c = celda(i);
      const h = ubicar(el('div', 'hueco'), c.x, c.y, G.col, G.foto);
      hoja.append(h);
      if (!f) continue;
      h.classList.add('lleno'); h.draggable = true; h.title = 'Arrastra para cambiar el orden';
      h.append(dibujar(f, dd.ajuste, 7));
      h.ondragstart = e => e.dataTransfer.setData('text/x-foto', String(k));
      h.ondragover = e => { if ([...e.dataTransfer.types].includes('text/x-foto')) { e.preventDefault(); h.classList.add('sobre'); } };
      h.ondragleave = () => h.classList.remove('sobre');
      h.ondrop = e => {
        const o = e.dataTransfer.getData('text/x-foto'); if (o === '') return;
        e.preventDefault();
        const [m] = d.fotos.splice(+o, 1); d.fotos.splice(k, 0, m);
        pintar(); guardar();
      };
      const t = ubicar(el('div', 'leyenda'), c.x, c.y + G.foto + 0.7, G.col);
      t.dataset.foto = f.id; hoja.append(t); pintarLeyenda(t, f);
    }
    const pie = ubicar(el('div', 'pie', pieLineas(dd).join('\n')), G.x, G.pieY, G.ancho);
    pie.style.fontSize = `calc(${TAM_PIE * PT}*var(--u))`;
    hoja.append(pie); cont.append(hoja);
  }
  cont.scrollTop = sc;
}
function pintarLeyenda(t, f) {
  const l = leyenda(f.texto);
  t.textContent = l.lineas.join('\n');
  t.style.fontSize = `calc(${l.pt * PT}*var(--u))`;
}

function pintar() {
  const d = docActivo();
  $('vacio').hidden = docs.length > 0; $('panel').hidden = !d;
  $('btnPdf').disabled = $('btnExcel').disabled = !d;
  $('carpetas').replaceChildren(...docs.map(x => {
    const li = el('li', x === d ? 'activa' : '');
    const b = el('button', 'abrir', `${x.nombre} (${x.fotos.length})`);
    b.onclick = () => { activo = x.id; $('hojas').scrollTop = 0; pintar(); guardar(); };
    const q = el('button', 'quitar', '×'); q.setAttribute('aria-label', 'Quitar carpeta ' + x.nombre);
    q.onclick = () => {
      if (!confirm(`¿Quitar "${x.nombre}" y sus textos? Tus fotos originales no se tocan.`)) return;
      x.fotos.forEach(soltar); docs = docs.filter(y => y !== x);
      if (activo === x.id) activo = docs[0] ? docs[0].id : null;
      pintar(); guardar();
    };
    li.append(b, q); return li;
  }));
  if (d) {
    $('nombre').value = d.nombre; $('ajuste').value = d.ajuste; $('pie').value = d.pie;
    $('cuenta').textContent = `${d.fotos.length} fotos, ${numHojas(d)} ${numHojas(d) === 1 ? 'hoja' : 'hojas'}`;
    $('lista').replaceChildren(...d.fotos.map((f, i) => {
      const li = el('li'), img = el('img'); img.src = f.url; img.alt = '';
      const inp = el('input'); inp.type = 'text'; inp.value = f.texto; inp.placeholder = 'Escribe el texto'; inp.setAttribute('list', 'frecuentes'); inp.setAttribute('aria-label', 'Texto de la foto ' + (i + 1));
      inp.oninput = () => { f.texto = inp.value.toLocaleUpperCase('es'); const t = document.querySelector(`[data-foto="${f.id}"]`); if (t) pintarLeyenda(t, f); guardar(); };
      inp.onfocus = () => { const t = document.querySelector(`[data-foto="${f.id}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
      inp.onkeydown = e => { if (e.key === 'Enter' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.querySelector('input').focus(); } };
      const q = el('button', 'quitar', '×'); q.setAttribute('aria-label', 'Quitar foto ' + (i + 1));
      q.onclick = () => { soltar(f); d.fotos.splice(i, 1); pintar(); guardar(); };
      li.append(el('span', 'n', i + 1), img, inp, q); return li;
    }));
  }
  pintarHojas();
}
function soltar(f) { URL.revokeObjectURL(f.url); f.bmp.close(); }

$('nombre').oninput = e => { const d = docActivo(); d.nombre = e.target.value; document.querySelector('#carpetas .activa .abrir').textContent = `${d.nombre} (${d.fotos.length})`; guardar(); };
$('ajuste').onchange = e => { docActivo().ajuste = e.target.value; pintarHojas(); guardar(); };
$('pie').oninput = e => { docActivo().pie = e.target.value; pintarHojas(); guardar(); };
$('frecuentes').append(...FRECUENTES.map(t => { const o = el('option'); o.value = t; return o; }));

/* ---------- PDF ---------- */
// Arial Narrow y Calibri son fuentes con licencia: no se publican con la página,
// se leen del equipo (Chrome/Edge piden permiso una vez). Debe llamarse dentro del clic.
const FUENTES = {};
const POSTSCRIPT = { 'ArialNarrow-Italic': 'ArialNarrowI', 'Calibri-Bold': 'CalibriB', 'Calibri-Italic': 'CalibriI' };
const base64 = b => new Promise((ok, mal) => { const f = new FileReader(); f.onload = () => ok(f.result.split(',')[1]); f.onerror = mal; f.readAsDataURL(b); });
async function cargarFuentes() {
  if (FUENTES.ArialNarrowI || !window.queryLocalFonts) return;
  try {
    for (const f of await queryLocalFonts({ postscriptNames: Object.keys(POSTSCRIPT) })) FUENTES[POSTSCRIPT[f.postscriptName]] = await base64(await f.blob());
  } catch (e) { console.warn('Fuentes del equipo no disponibles', e); }
}
// Respaldo: Helvetica al 82 % de ancho, la misma proporción de Arial Narrow.
function escribir(pdf, t, cx, y, fuente, pt) {
  pdf.setFontSize(pt);
  if (FUENTES[fuente]) { pdf.setFont(fuente, 'normal'); const w = pdf.getTextWidth(t); pdf.text(t, cx - w / 2, y); return w; }
  pdf.setFont('helvetica', fuente === 'CalibriB' ? 'bold' : 'italic');
  const k = fuente === 'CalibriB' ? 1 : 0.82, w = pdf.getTextWidth(t) * k;
  pdf.text(t, cx - w / 2, y, { horizontalScale: k });
  return w;
}

function crearPdf(d) {
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  for (const n in FUENTES) { pdf.addFileToVFS(n + '.ttf', FUENTES[n]); pdf.addFont(n + '.ttf', n, 'normal'); }
  for (let p = 0; p < numHojas(d); p++) {
    if (p) pdf.addPage();
    pdf.setFillColor(49, 134, 155); pdf.rect(G.x, G.tituloY, G.ancho, G.tituloH, 'F');
    pdf.setTextColor(255);
    const ty = G.tituloY + G.tituloH / 2 + 1.6, tw = escribir(pdf, 'ANEXOS', 105, ty, 'CalibriB', 14);
    pdf.setDrawColor(255); pdf.setLineWidth(0.3); pdf.line(105 - tw / 2, ty + 0.7, 105 + tw / 2, ty + 0.7);
    pdf.setTextColor(0);
    d.fotos.slice(p * POR_HOJA, (p + 1) * POR_HOJA).forEach((f, i) => {
      const c = celda(i);
      pdf.addImage(dibujar(f, d.ajuste, 16).toDataURL('image/jpeg', 0.88), 'JPEG', c.x, c.y, G.col, G.foto, f.id, 'NONE');
      const l = leyenda(f.texto);
      l.lineas.forEach((t, j) => escribir(pdf, t, c.x + G.col / 2, c.y + G.foto + 0.7 + l.pt * PT * (0.95 + j * 1.15), 'ArialNarrowI', l.pt));
    });
    pieLineas(d).forEach((t, j) => escribir(pdf, t, 105, G.pieY + TAM_PIE * PT * (0.95 + j * 1.2), 'CalibriI', TAM_PIE));
  }
  return pdf.output('blob');
}

/* ---------- Excel ---------- */
async function crearExcel(d) {
  const wb = new ExcelJS.Workbook();
  const px = mm => Math.round(mm / 25.4 * 96), pt = mm => mm / PT;
  const fino = { vertical: 'middle', horizontal: 'center', wrapText: true };
  for (let p = 0; p < numHojas(d); p++) {
    // Una pestaña por hoja: así cada una imprime exactamente en un A4.
    const ws = wb.addWorksheet(numHojas(d) > 1 ? `Anexos ${p + 1}` : 'Anexos', {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: G.tituloY / 25.4, bottom: 0.2, header: 0, footer: 0 } },
    });
    [G.col, G.sepX, G.col, G.sepX, G.col].forEach((mm, i) => ws.getColumn(i + 1).width = (px(mm * 0.962) - 5) / 7); // Excel imprime las columnas ~4 % más anchas que en pantalla
    ws.mergeCells('A1:E1');
    ws.getRow(1).height = pt(G.tituloH); ws.getRow(2).height = pt(G.y0 - G.tituloY - G.tituloH);
    const t = ws.getCell('A1');
    t.value = 'ANEXOS'; t.alignment = { vertical: 'middle', horizontal: 'center' };
    t.font = { name: 'Calibri', size: 14, bold: true, underline: true, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF31869B' } };
    for (let r = 0; r < 5; r++) { ws.getRow(3 + r * 2).height = pt(G.foto); ws.getRow(4 + r * 2).height = pt(G.ley); }
    for (let i = 0; i < POR_HOJA; i++) {
      const f = d.fotos[p * POR_HOJA + i]; if (!f) break;
      const fila = 3 + Math.floor(i / 3) * 2, col = (i % 3) * 2;
      const id = wb.addImage({ base64: dibujar(f, d.ajuste, 16).toDataURL('image/jpeg', 0.88), extension: 'jpeg' });
      ws.addImage(id, { tl: { nativeCol: col, nativeColOff: 0, nativeRow: fila - 1, nativeRowOff: 0 }, br: { nativeCol: col + 1, nativeColOff: 0, nativeRow: fila, nativeRowOff: 0 }, editAs: 'oneCell' });
      const c = ws.getCell(fila + 1, col + 1), l = leyenda(f.texto);
      c.value = f.texto.toLocaleUpperCase('es');
      c.font = { name: 'Arial Narrow', size: l.pt, italic: true };
      c.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
    }
    ws.getRow(13).height = pt(G.pieY - G.y0 - 5 * (G.foto + G.ley));
    ws.mergeCells('A14:E14');
    const pie = ws.getCell('A14');
    pie.value = d.pie; pie.font = { name: 'Calibri', size: TAM_PIE, italic: true }; pie.alignment = fino;
    ws.getRow(14).height = Math.max(1, pieLineas(d).length + (pieLineas(d).length === 1 ? 1 : 0)) * 10;
    ws.pageSetup.printArea = 'A1:E14';
  }
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

let fuentesListas = Promise.resolve();
async function bajar(d, tipo) {
  estado(`Generando ${tipo === 'pdf' ? 'PDF' : 'Excel'} de ${d.nombre}…`);
  await new Promise(r => setTimeout(r, 30));
  if (tipo === 'pdf') await fuentesListas;
  const blob = tipo === 'pdf' ? crearPdf(d) : await crearExcel(d);
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = (d.nombre.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Anexos') + '.' + tipo;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  await new Promise(r => setTimeout(r, 300)); // separa descargas seguidas
}
const exportar = tipo => encolar(async () => {
  const lista = $('todas').checked ? docs : [docActivo()].filter(Boolean);
  for (const d of lista) await bajar(d, tipo);
  if (lista.length) estado((lista.length === 1 ? `Listo: ${lista[0].nombre}.${tipo}` : `Listo: ${lista.length} archivos.`) + (tipo === 'pdf' && !FUENTES.ArialNarrowI ? ' Se usó una fuente parecida: permite el acceso a las fuentes (Chrome o Edge) para Arial Narrow.' : ''));
});
$('btnPdf').onclick = () => { fuentesListas = cargarFuentes(); exportar('pdf'); };
$('btnExcel').onclick = () => exportar('xlsx');

encolar(async () => {
  await restaurar();
  pintar();
});
