'use strict';
// Motore comune delle firme: chi deve firmare ogni scheda e con quali metodi.
// Metodi: credenziali, PIN, firma disegnata, link via e-mail, scansione cartacea, attestato (solo corsi).
// Dopo la prima firma la scheda è in sola lettura; solo l'amministratore può annullare una firma.

const crypto = require('crypto');
const zlib = require('zlib');
const { SCHEMA } = require('./schema');
const pin = require('./pin');

function eng() { return require('./engine'); }
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------- chi deve firmare ----------

function dip(ctx, ruolo, id) {
  const d = id && ctx.st.tabella('Dipendenti').get(id);
  if (!d) return null;
  return { key: ruolo + ':' + id, ruolo, tipo: 'dip', dipId: id, nome: (d.cognome + ' ' + d.nome).trim(), email: d.email || '', haPin: !!d.pinHash };
}
function esterno(ruolo, chiave, nome, email) {
  return { key: ruolo + ':ext:' + chiave, ruolo, tipo: 'ext', dipId: '', nome: nome || 'Esterno', email: email || '', haPin: false };
}
function figli(ctx, e, fk, id) {
  return [...ctx.st.tabella(e).values()].filter(r => r[fk] === id).sort((a, b) => (a._ord || 0) - (b._ord || 0));
}
const soggetto = (ctx, id) => (id && ctx.st.tabella('Soggetti').get(id)) || {};

const FIRMATARI = {
  Consegne: (ctx, r) => [dip(ctx, 'Lavoratore', r.dipendenteId), dip(ctx, 'Incaricato della consegna', r.consegnatoDa)],
  Corsi: (ctx, r) => {
    if (r.importato === 'SI') return [];
    const out = [];
    for (const d of figli(ctx, 'CorsiDocenti', 'corsoId', r.id)) {
      if (d.tipo === 'Dipendente') out.push(dip(ctx, 'Docente', d.dipendenteId));
      else out.push(esterno('Docente', d.id, d.nominativo || soggetto(ctx, d.soggettoId).ragioneSociale, d.email || soggetto(ctx, d.soggettoId).email));
    }
    for (const p of figli(ctx, 'CorsiPartecipanti', 'corsoId', r.id)) {
      const s = dip(ctx, 'Partecipante', p.dipendenteId);
      if (s) { s.attestato = !!p.attestato; out.push(s); }
    }
    return out;
  },
  NC: (ctx, r) => (r.importata === 'SI' ? [] : [dip(ctx, 'Redatto da', r.redattoDa)]),
  ValutazioniCompetenze: (ctx, r) => [dip(ctx, 'Valutatore', r.valutatoreId)],
  Manutenzioni: (ctx, r) => [
    r.esecutoreTipo === 'Esterno'
      ? ((r.esecutoreNome || r.esecutoreSoggId) ? esterno('Esecutore', 'tecnico', r.esecutoreNome || soggetto(ctx, r.esecutoreSoggId).ragioneSociale, soggetto(ctx, r.esecutoreSoggId).email) : null)
      : dip(ctx, 'Esecutore', r.esecutoreDipId),
    dip(ctx, 'Responsabile della manutenzione', r.responsabileId),
  ],
  QualificheFornitori: (ctx, r) => (r.importata === 'SI' ? [] : [dip(ctx, 'Valutatore', r.valutatoreId)]),
  Tarature: (ctx, r) => [r.tipo === 'Interna' ? dip(ctx, 'Eseguita da', r.eseguitaDaId) : null, dip(ctx, 'Verificato da', r.verificatoDaId)],
  Documenti: (ctx, r) => (r.importato === 'SI' ? [] : [dip(ctx, 'Redatto da', r.redattoDa), dip(ctx, 'Verificato da', r.verificatoDa), dip(ctx, 'Approvato da', r.approvatoDa)]),
  PreseVisione: (ctx, r) => [dip(ctx, 'Lavoratore', r.dipendenteId)],
};

function firmatari(ctx, e, riga) {
  const f = FIRMATARI[e];
  if (!f || !riga) return [];
  const visti = new Set();
  return f(ctx, riga).filter(s => s && !visti.has(s.key) && visti.add(s.key));
}

// ---------- stato ----------

function righe(st, e, id) { return [...st.tabella('Firme').values()].filter(f => f.rifEntity === e && f.rifId === id); }
function haFirme(st, e, id) { return righe(st, e, id).some(f => f.stato === 'Firmata'); }

function stato(ctx, e, id) {
  if (!SCHEMA[e].signers) return null;
  const riga = ctx.st.tabella(e).get(id);
  const rr = righe(ctx.st, e, id);
  const ora = new Date().toISOString();
  const gestisce = eng().puoScrivere(ctx, e);
  return firmatari(ctx, e, riga).map(s => {
    const f = rr.find(x => x.signerKey === s.key && x.stato === 'Firmata');
    const att = rr.find(x => x.signerKey === s.key && x.stato === 'In attesa' && x.tokenScad > ora);
    const out = { key: s.key, ruolo: s.ruolo, nome: s.nome, esterno: s.tipo === 'ext',
      stato: f ? 'Firmata' : s.attestato ? 'Attestato caricato' : att ? 'Link inviato' : 'Da firmare',
      metodo: f ? f.metodo : '', dataFirma: f ? f.dataFirma : '', firmaId: f ? f.id : '', file: f ? f.fileId : '', metodi: [] };
    if (!f && !s.attestato) {
      if (s.tipo === 'dip' && ctx.utente && s.dipId === ctx.utente.id) out.metodi.push('credenziali');
      if (gestisce) {
        if (s.haPin) out.metodi.push('pin');
        out.metodi.push('disegno', 'scansione');
        if (s.email && e !== 'PreseVisione') out.metodi.push('link');
      }
    }
    return out;
  });
}

// ---------- firma disegnata: controllo dell'immagine ----------

// Decodifica un PNG a 8 bit e dice se è "vuoto" (tutti i pixel uguali). Lancia un errore se non è un PNG valido.
function pngVuoto(buf) {
  const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 45 || !buf.subarray(0, 8).equals(FIRMA)) throw new Error('non è un PNG');
  let pos = 8, ihdr = null;
  const dati = [];
  while (pos + 12 <= buf.length) {
    const lung = buf.readUInt32BE(pos), tipo = buf.toString('latin1', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + lung);
    if (tipo === 'IHDR') ihdr = { w: corpo.readUInt32BE(0), h: corpo.readUInt32BE(4), bit: corpo[8], colore: corpo[9], interlacciato: corpo[12] };
    else if (tipo === 'IDAT') dati.push(corpo);
    else if (tipo === 'IEND') break;
    pos += 12 + lung;
  }
  if (!ihdr || !dati.length || !ihdr.w || !ihdr.h || ihdr.w * ihdr.h > 6e6) throw new Error('PNG non valido');
  const canali = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colore];
  if (!canali || ihdr.bit !== 8 || ihdr.interlacciato) throw new Error('formato PNG non gestito');
  const raw = zlib.inflateSync(Buffer.concat(dati), { maxOutputLength: 64 * 1024 * 1024 });
  const bpp = canali, passo = ihdr.w * bpp;
  if (raw.length < (passo + 1) * ihdr.h) throw new Error('PNG incompleto');
  let prec = Buffer.alloc(passo), primo = null;
  for (let y = 0; y < ihdr.h; y++) {
    const filtro = raw[y * (passo + 1)];
    const r = Buffer.from(raw.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1)));
    for (let i = 0; i < passo; i++) {
      const a = i >= bpp ? r[i - bpp] : 0, b = prec[i], c = i >= bpp ? prec[i - bpp] : 0;
      let v = 0;
      if (filtro === 1) v = a;
      else if (filtro === 2) v = b;
      else if (filtro === 3) v = (a + b) >> 1;
      else if (filtro === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      r[i] = (r[i] + v) & 255;
    }
    if (!primo) primo = Buffer.from(r.subarray(0, bpp));
    for (let i = 0; i < passo; i++) if (r[i] !== primo[i % bpp]) return false;
    prec = r;
  }
  return true;
}

function immagineFirma(dataUrl) {
  const { ErroreUtente } = eng();
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[1].length > 2.8e6) throw new ErroreUtente('La firma disegnata non è valida. Riprova.');
  const buf = Buffer.from(m[1], 'base64');
  let vuota;
  try { vuota = pngVuoto(buf); } catch (e) { throw new ErroreUtente('La firma disegnata non è valida. Riprova.'); }
  if (vuota) throw new ErroreUtente('Il riquadro della firma è vuoto: disegna la firma prima di confermare.');
  return buf;
}

// ---------- operazioni ----------

function contesto(ctx, p, perGestire) {
  const { ErroreUtente, esigi, puoScrivere } = eng();
  const E = esigi(ctx, p.entita, false);
  if (!E.signers) throw new ErroreUtente('Questa scheda non prevede firme.');
  if (perGestire && !puoScrivere(ctx, p.entita)) throw new ErroreUtente('Non hai i permessi per raccogliere questa firma.', 'PERMESSO');
  const riga = ctx.st.tabella(p.entita).get(p.id);
  if (!riga || !eng().visibileRiga(ctx, p.entita, riga)) throw new ErroreUtente('La scheda non esiste più: potrebbe essere stata eliminata.');
  return { E, riga, lista: firmatari(ctx, p.entita, riga) };
}

function trova(ctx, e, id, lista, key) {
  const { ErroreUtente } = eng();
  const s = lista.find(x => x.key === key);
  if (!s) throw new ErroreUtente('Firmatario non previsto per questa scheda.');
  if (righe(ctx.st, e, id).some(f => f.signerKey === key && f.stato === 'Firmata')) throw new ErroreUtente('Questa firma è già stata registrata.');
  return s;
}

function registraFirma(ctx, e, riga, s, metodo, fileId, note) {
  const { nuovoId, adesso, registra, titolo } = eng();
  const { HOOKS } = require('./regole');
  if (HOOKS[e] && HOOKS[e].primaDiFirmare) HOOKS[e].primaDiFirmare(ctx, { riga, firmatario: s });
  const inAttesa = righe(ctx.st, e, riga.id).find(f => f.signerKey === s.key && f.stato === 'In attesa');
  const f = {
    ...(inAttesa || { id: nuovoId(), createdAt: adesso() }),
    rifEntity: e, rifId: riga.id, ruolo: s.ruolo, signerKey: s.key, signerNome: s.nome, signerEmail: s.email,
    metodo, stato: 'Firmata', dataFirma: adesso(), fileId: fileId || '', note: note || '', token: '', tokenScad: '', updatedAt: adesso(),
  };
  ctx.st.metti('Firme', f);
  registra(ctx, 'Firma', SCHEMA[e].label + ' ' + titolo(ctx, e, riga) + ' – ' + s.ruolo + ': ' + s.nome + ' (' + metodo + ')');
  const h = HOOKS[e];
  if (h && h.dopoFirma) h.dopoFirma(ctx, { riga: ctx.st.tabella(e).get(riga.id), firmatario: s });
  return f;
}

// Credenziali, PIN o firma disegnata.
async function firma(ctx, p) {
  const { ErroreUtente } = eng();
  const { riga, lista } = contesto(ctx, p, p.metodo !== 'credenziali');
  const s = trova(ctx, p.entita, p.id, lista, p.key);
  if (p.metodo === 'credenziali') {
    if (s.tipo !== 'dip' || s.dipId !== ctx.utente.id) throw new ErroreUtente('Con le credenziali di accesso puoi firmare solo a tuo nome.');
    registraFirma(ctx, p.entita, riga, s, 'Credenziali di accesso');
  } else if (p.metodo === 'pin') {
    if (s.tipo !== 'dip') throw new ErroreUtente('Il PIN è disponibile solo per i dipendenti.');
    const err = pin.verifica(ctx, s.dipId, p.pin);
    if (err) return { _errore: err };
    registraFirma(ctx, p.entita, riga, s, 'PIN del dipendente');
  } else if (p.metodo === 'disegno') {
    const buf = immagineFirma(p.immagine);
    const file = await ctx.servizi.salvaFile({ nome: 'firma.png', mime: 'image/png', buffer: buf, tipo: 'firma' });
    registraFirma(ctx, p.entita, riga, s, 'Firma su schermo', file);
  } else throw new ErroreUtente('Metodo di firma non riconosciuto.');
  return stato(ctx, p.entita, p.id);
}

// Scansione cartacea: un file vale per più firmatari insieme.
function scansione(ctx, p) {
  const { ErroreUtente } = eng();
  const { riga, lista } = contesto(ctx, p, true);
  const idFile = String(p.file || '').split('|')[0];
  const reg = ctx.st.tabella('FileReg').get(idFile);
  if (!reg) throw new ErroreUtente('Carica prima la scansione del documento firmato.');
  const chiavi = Array.isArray(p.keys) ? p.keys : [];
  if (!chiavi.length) throw new ErroreUtente('Scegli almeno un firmatario.');
  for (const k of chiavi) registraFirma(ctx, p.entita, riga, trova(ctx, p.entita, p.id, lista, k), 'Scansione cartacea', idFile + '|' + reg.nome);
  return stato(ctx, p.entita, p.id);
}

// Link via e-mail: token lungo, monouso, con scadenza.
function inviaLink(ctx, p) {
  const { ErroreUtente, nuovoId, adesso, config, registra, titolo } = eng();
  const { E, riga, lista } = contesto(ctx, p, true);
  if (p.entita === 'PreseVisione') throw new ErroreUtente('Le prese visione non si firmano tramite link.');
  const s = trova(ctx, p.entita, p.id, lista, p.key);
  if (!s.email) throw new ErroreUtente('Per questo firmatario non è indicato un indirizzo e-mail.');
  const giorni = Math.min(30, Math.max(1, Number(config(ctx.st).linkFirmaGiorni) || 7));
  const token = crypto.randomBytes(32).toString('hex');
  const prec = righe(ctx.st, p.entita, p.id).find(f => f.signerKey === s.key && f.stato === 'In attesa');
  ctx.st.metti('Firme', {
    ...(prec || { id: nuovoId(), createdAt: adesso() }),
    rifEntity: p.entita, rifId: p.id, ruolo: s.ruolo, signerKey: s.key, signerNome: s.nome, signerEmail: s.email,
    metodo: 'Link via e-mail', stato: 'In attesa', dataFirma: '', fileId: '', note: '',
    token: sha(token), tokenScad: new Date(Date.now() + giorni * 86400000).toISOString(), updatedAt: adesso(),
  });
  const url = ctx.servizi.origine + '/a/' + ctx.azienda.id + '/?firma=' + token;
  ctx.servizi.postino.invia({
    a: s.email, segreto: true, oggetto: 'Richiesta di firma – ' + ctx.azienda.nome,
    testo: 'Gentile ' + s.nome + ',\n\n' + ctx.azienda.nome + ' le chiede di firmare: ' + E.label + ' ' + titolo(ctx, p.entita, riga) +
      ' (' + s.ruolo + ').\n\nPer firmare apra questo collegamento:\n' + url + '\n\nIl collegamento è valido ' + giorni + ' giorni e si può usare una sola volta.',
  }).catch(() => {});
  registra(ctx, 'Link di firma', E.label + ' ' + titolo(ctx, p.entita, riga) + ' – inviato a ' + s.nome);
  return stato(ctx, p.entita, p.id);
}

function daToken(ctx, token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const h = sha(token), ora = new Date().toISOString();
  const f = [...ctx.st.tabella('Firme').values()].find(x => x.token === h && x.stato === 'In attesa' && x.tokenScad > ora);
  if (!f || !SCHEMA[f.rifEntity] || !ctx.pacchetti.has(SCHEMA[f.rifEntity].pack)) return null;
  const riga = ctx.st.tabella(f.rifEntity).get(f.rifId);
  const s = riga && firmatari(ctx, f.rifEntity, riga).find(x => x.key === f.signerKey);
  return s ? { f, riga, s } : null;
}
const ERR_LINK = 'Questo collegamento non è più valido: è scaduto oppure è già stato usato.';

// Pagina pubblica: riepilogo del documento da firmare.
function linkInfo(ctx, token) {
  const t = daToken(ctx, token);
  if (!t) return { _errore: ERR_LINK };
  return { azienda: ctx.azienda.nome, documento: SCHEMA[t.f.rifEntity].label + ' ' + eng().titolo(ctx, t.f.rifEntity, t.riga),
    ruolo: t.s.ruolo, firmatario: t.s.nome, pinDisponibile: t.s.haPin };
}

async function linkFirma(ctx, p) {
  const { ErroreUtente } = eng();
  const t = daToken(ctx, p.token);
  if (!t) return { _errore: ERR_LINK };
  const c = { ...ctx, utente: { email: t.s.email, id: '' } };
  if (p.metodo === 'pin') {
    if (t.s.tipo !== 'dip') throw new ErroreUtente('Il PIN è disponibile solo per i dipendenti.');
    const err = pin.verifica(c, t.s.dipId, p.pin);
    if (err) return { _errore: err };
    registraFirma(c, t.f.rifEntity, t.riga, t.s, 'Link via e-mail (PIN)');
  } else {
    const buf = immagineFirma(p.immagine);
    const file = await ctx.servizi.salvaFile({ nome: 'firma.png', mime: 'image/png', buffer: buf, tipo: 'firma', autore: t.s.email });
    registraFirma(c, t.f.rifEntity, t.riga, t.s, 'Link via e-mail (firma su schermo)', file);
  }
  return { firmato: true };
}

// Annullamento: solo amministratore; resta nel registro firme.
function annulla(ctx, p) {
  const { ErroreUtente, adesso, registra, titolo } = eng();
  if (!ctx.utente.admin) throw new ErroreUtente('Solo gli amministratori possono annullare una firma.', 'PERMESSO');
  const f = ctx.st.tabella('Firme').get(p.firmaId);
  if (!f || f.stato !== 'Firmata') throw new ErroreUtente('Firma non trovata o già annullata.');
  const motivo = String(p.motivo || '').trim().slice(0, 300);
  ctx.st.metti('Firme', { ...f, stato: 'Annullata', updatedAt: adesso(),
    note: ('Annullata da ' + ctx.utente.nome + ' il ' + eng().dataIt(eng().oggi()) + (motivo ? ': ' + motivo : '') + (f.note ? ' – ' + f.note : '')) });
  const riga = ctx.st.tabella(f.rifEntity).get(f.rifId);
  registra(ctx, 'Firma annullata', SCHEMA[f.rifEntity].label + ' ' + titolo(ctx, f.rifEntity, riga) + ' – ' + f.ruolo + ': ' + f.signerNome);
  const { HOOKS } = require('./regole');
  const h = HOOKS[f.rifEntity];
  if (h && h.dopoAnnullamento && riga) h.dopoAnnullamento(ctx, { riga, firma: f });
  return stato(ctx, f.rifEntity, f.rifId);
}

module.exports = { firmatari, stato, haFirme, firma, scansione, inviaLink, linkInfo, linkFirma, annulla, pngVuoto };
