'use strict';
// Stampe PDF (pdfmake, font Helvetica standard). Formato comune: A4, intestazione con logo e dati
// dell'azienda, titolo in maiuscolo, tabelle, riquadro firme, piè di pagina con data di stampa e pagina.

const PdfPrinter = require('pdfmake');
const eng = require('./engine');
const { ErroreUtente } = eng;
const { SCHEMA } = require('./schema');
const regole = require('./regole');
const firme = require('./firme');
const { leggibile, schedaDipendente } = require('./esporta');
const { cessato } = require('./licenza');

const printer = new PdfPrinter({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });
const tutte = (ctx, e) => [...ctx.st.tabella(e).values()];
const lista = v => String(v || '').split(',').filter(Boolean);
const D = eng.dataIt;
// Il font standard non ha tutti i caratteri: quelli fuori dal set occidentale vengono sostituiti.
const T = v => String(v ?? '').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ€]/g, '?');

// ---------- blocchi ----------

const sezione = t => ({ text: T(t), bold: true, fontSize: 10.5, margin: [0, 12, 0, 4] });
const paragrafo = t => ({ text: T(t), margin: [0, 2, 0, 6], alignment: 'justify' });
const LAYOUT = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#999999', vLineColor: () => '#999999', paddingTop: () => 3, paddingBottom: () => 3 };

function tabella(intest, righe, larghezze) {
  if (!righe.length) return { text: 'Nessun dato.', italics: true, color: '#666666', margin: [0, 0, 0, 6] };
  return { table: { headerRows: 1, widths: larghezze || intest.map(() => '*'), body: [intest.map(h => ({ text: T(h), bold: true, fillColor: '#EEEEEE' })), ...righe.map(r => r.map(c => (c && typeof c === 'object' ? c : { text: T(c) })))] },
    layout: LAYOUT, margin: [0, 0, 0, 6] };
}
// Coppie etichetta/valore su due colonne.
function campi(coppie) {
  const c = coppie.filter(x => x && x[1] !== '' && x[1] !== undefined && x[1] !== null);
  if (!c.length) return { text: '' };
  const body = [];
  for (let i = 0; i < c.length; i += 2) {
    const a = c[i], b = c[i + 1];
    body.push([{ text: T(a[0]), bold: true, fillColor: '#F5F5F5' }, { text: T(a[1]) }, { text: b ? T(b[0]) : '', bold: true, fillColor: b ? '#F5F5F5' : null }, { text: b ? T(b[1]) : '' }]);
  }
  return { table: { widths: [95, '*', 95, '*'], body }, layout: LAYOUT, margin: [0, 0, 0, 6] };
}
function campiLarghi(coppie) {
  const c = coppie.filter(x => x && x[1] !== '' && x[1] !== undefined);
  if (!c.length) return { text: '' };
  return { table: { widths: [95, '*'], body: c.map(x => [{ text: T(x[0]), bold: true, fillColor: '#F5F5F5' }, { text: T(x[1]) }]) }, layout: LAYOUT, margin: [0, 0, 0, 6] };
}

async function immagine(ctx, valore) {
  const id = String(valore || '').split('|')[0];
  const reg = id && ctx.st.tabella('FileReg').get(id);
  if (!reg || !/^image\/(png|jpeg)$/.test(reg.mime) || !ctx.servizi || !ctx.servizi.leggiFile) return null;
  const buf = await ctx.servizi.leggiFile(id);
  return buf ? 'data:' + reg.mime + ';base64,' + buf.toString('base64') : null;
}

// Riquadro firme con immagine della firma e metodo.
async function riquadroFirme(ctx, e, id) {
  const stato = firme.stato(ctx, e, id) || [];
  if (!stato.length) return [];
  const righe = [];
  for (const s of stato) {
    const img = s.stato === 'Firmata' && /schermo/.test(s.metodo) ? await immagine(ctx, s.file) : null;
    righe.push([s.ruolo, s.nome, img ? { image: img, fit: [110, 34] } : { text: T(s.stato === 'Firmata' ? s.metodo : s.stato), italics: s.stato !== 'Firmata' },
      s.dataFirma ? D(s.dataFirma.slice(0, 10)) : '']);
  }
  return [sezione('Firme'), tabella(['Ruolo', 'Firmatario', 'Firma', 'Data'], righe, [120, '*', 130, 55])];
}

// Campi e griglie di una scheda, dallo schema.
function corpoScheda(ctx, e, riga, opz = {}) {
  const E = SCHEMA[e], pub = eng.pubblica(ctx, e, riga);
  const visibili = E.fields.filter(f => !['hidden', 'fk', 'section', 'file'].includes(f.type) && pub[f.name] !== undefined && eng.visibile(f, riga) && !(opz.escludi || []).includes(f.name));
  const corti = visibili.filter(f => f.type !== 'textarea'), lunghi = visibili.filter(f => f.type === 'textarea');
  const out = [campi(corti.map(f => [f.label, leggibile(ctx, f, pub[f.name])])), campiLarghi(lunghi.map(f => [f.label, pub[f.name]]))];
  for (const c of E.children) {
    if (!eng.entitaAttiva(ctx, c.e) || (opz.senzaFigli || []).includes(c.e)) continue;
    const C = SCHEMA[c.e];
    const cf = C.fields.filter(f => !['hidden', 'fk', 'file'].includes(f.type) && eng.entitaAttiva(ctx, f.ref || c.e));
    const figli = tutte(ctx, c.e).filter(r => r[c.fk] === riga.id).sort((a, b) => (a._ord || 0) - (b._ord || 0)).map(r => eng.pubblica(ctx, c.e, r));
    out.push(sezione(c.l), tabella(cf.map(f => f.label), figli.map(r => cf.map(f => leggibile(ctx, f, r[f.name])))));
  }
  return out;
}

function riga(ctx, e, id) {
  eng.esigi(ctx, e, false);
  const r = ctx.st.tabella(e).get(id);
  if (!r || !eng.visibileRiga(ctx, e, r)) throw new ErroreUtente('La scheda non esiste più: potrebbe essere stata eliminata.');
  return r;
}
const qr = (ctx, e, id) => ({ qr: (ctx.servizi && ctx.servizi.origine || '') + '/a/' + ctx.azienda.id + '/#/' + e + '/' + id, fit: 80, alignment: 'right', margin: [0, 0, 0, 6] });
const soloAdmin = ctx => { if (!ctx.utente.admin) throw new ErroreUtente('Questa stampa è riservata agli amministratori.', 'PERMESSO'); };
const tit = (ctx, e, id) => eng.titolo(ctx, e, ctx.st.tabella(e).get(id));

// Stampa di una scheda con eventuali blocchi in più.
function scheda(e, titolo, extra) {
  return async (ctx, p) => {
    const r = riga(ctx, e, p.id);
    const x = extra ? await extra(ctx, r) : {};
    return { titolo, nome: titolo + ' ' + eng.titolo(ctx, e, r),
      content: [...(x.prima || []), ...corpoScheda(ctx, e, r, x.opz), ...(x.dopo || []), ...(await riquadroFirme(ctx, e, r.id))] };
  };
}

// ---------- le stampe ----------

const STAMPE = {
  verbaleConsegna: scheda('Consegne', 'Verbale di consegna DPI', async ctx => ({ opz: { escludi: ['emailInviata'] }, dopo: [sezione('Dichiarazione'), paragrafo(eng.config(ctx.st).dichiarazioneDpi)] })),
  registroCorso: scheda('Corsi', 'Registro corso di formazione'),
  moduloNc: scheda('NC', 'Non conformità / reclamo', async (ctx, r) => {
    const az = tutte(ctx, 'Azioni').filter(a => a.ncId === r.id);
    return { dopo: az.length ? [sezione('Azioni di miglioramento'), tabella(['Numero', 'Data', 'Descrizione', 'Responsabile', 'Stato', 'Chiusura'],
      az.map(a => [a.numero, D(a.data), a.descrizione, tit(ctx, 'Dipendenti', a.responsabileId), a.stato, D(a.dataChiusura)]), [60, 50, '*', 80, 45, 50])] : [] };
  }),
  valutazione: scheda('ValutazioniCompetenze', 'Valutazione delle competenze'),
  rapportoManutenzione: scheda('Manutenzioni', 'Rapporto di manutenzione'),
  schedaAttrezzatura: scheda('Attrezzature', 'Scheda attrezzatura', async (ctx, r) => ({ prima: [qr(ctx, 'Attrezzature', r.id)] })),
  schedaDpi: scheda('TipiDpi', 'Scheda DPI'),
  schedaMansione: scheda('Mansioni', 'Scheda mansione'),
  moduloQualifica: scheda('QualificheFornitori', 'Qualifica fornitore'),
  rapportoTaratura: scheda('Tarature', 'Rapporto di taratura'),
  schedaStrumento: scheda('Strumenti', 'Scheda strumento di misura', async (ctx, r) => {
    const tar = tutte(ctx, 'Tarature').filter(t => t.strumentoId === r.id).sort((a, b) => b.data.localeCompare(a.data));
    return { prima: [qr(ctx, 'Strumenti', r.id)], dopo: [sezione('Storico tarature'), tabella(['Data', 'Tipo', 'Esito', 'Scadenza', 'N. certificato'],
      tar.map(t => [D(t.data), t.tipo, regole.CALC.Tarature.esito(ctx, t), D(regole.CALC.Tarature.scadenza(ctx, t)), t.numCertificato]))] };
  }),
  schedaDocumento: async (ctx, p) => {
    soloAdmin(ctx);
    const r = riga(ctx, 'Documenti', p.id);
    const d = regole.funzione(ctx, { nome: 'documenti.dettaglio', id: r.id });
    const elenco = l => l.map(x => [x.codice, x.titolo, x.revisione, x.tipo || x.stato]);
    return { titolo: 'Scheda documento', nome: 'Scheda documento ' + r.codice + ' rev ' + r.revisione, content: [
      ...corpoScheda(ctx, 'Documenti', r, { senzaFigli: ['DocumentiCollegamenti'] }),
      sezione('Collegamenti'), tabella(['Codice', 'Titolo', 'Rev.', 'Tipo'], elenco(d.collegamenti), [70, '*', 35, 110]),
      sezione('Citato in'), tabella(['Codice', 'Titolo', 'Rev.', 'Tipo'], elenco(d.citatoIn), [70, '*', 35, 110]),
      sezione('Storico delle revisioni'), tabella(['Revisione', 'Data', 'Stato'], d.storico.map(x => [x.revisione, D(x.dataRevisione), x.stato])),
      ...(await riquadroFirme(ctx, 'Documenti', r.id)),
      sezione('Registro delle prese visione'), tabella(['Dipendente', 'Da firmare entro', 'Stato', 'Firmata il'], (d.preseVisione || []).map(x => [x.nome, D(x.entroIl), x.stato, D(x.dataLettura)])) ] };
  },

  storicoAttrezzatura: async (ctx, p) => {
    const r = riga(ctx, 'Attrezzature', p.id);
    eng.esigi(ctx, 'Manutenzioni', false);
    const man = tutte(ctx, 'Manutenzioni').filter(m => m.attrezzaturaId === r.id).sort((a, b) => b.data.localeCompare(a.data));
    return { titolo: 'Storico manutenzioni', nome: 'Storico manutenzioni ' + r.codice, content: [campi([['Attrezzatura', r.codice + ' ' + r.descrizione], ['Sede', tit(ctx, 'Sedi', r.sedeId)], ['Matricola', r.matricola], ['Stato', r.stato]]),
      tabella(['Data', 'Tipo', 'Attività', 'Esecutore', 'Esito', 'Costo €'], man.map(m => [D(m.data), m.tipo,
        tutte(ctx, 'ManutenzioniRighe').filter(x => x.manutenzioneId === m.id && x.eseguita === 'SI').map(x => tit(ctx, 'AttrezzatureAttivita', x.attivitaId)).join(', ') || m.descrizione,
        m.esecutoreTipo === 'Esterno' ? (m.esecutoreNome || tit(ctx, 'Soggetti', m.esecutoreSoggId)) : tit(ctx, 'Dipendenti', m.esecutoreDipId), m.esito, m.costo === '' ? '' : String(m.costo)]), [50, 60, '*', 90, 60, 40])] };
  },

  mansionario: async ctx => {
    eng.esigi(ctx, 'Mansioni', false);
    const mans = tutte(ctx, 'Mansioni').sort((a, b) => (Number(a.ordine) || 9999) - (Number(b.ordine) || 9999) || a.codice.localeCompare(b.codice, 'it'));
    const content = [];
    for (const m of mans) content.push({ text: T(m.codice + ' - ' + m.descrizione), bold: true, fontSize: 11, margin: [0, 10, 0, 3] }, ...corpoScheda(ctx, 'Mansioni', m, { escludi: ['codice', 'descrizione', 'ordine'] }));
    return { titolo: 'Mansionario aziendale', nome: 'Mansionario', content: content.length ? content : [paragrafo('Nessuna mansione.')] };
  },

  interinali: async ctx => {
    eng.esigi(ctx, 'Dipendenti', false);
    const og = eng.oggi();
    const dip = tutte(ctx, 'Dipendenti').filter(d => d.tipoRapporto === 'Interinale (somministrazione)' && !cessato(d, og));
    const agenzie = [...new Set(dip.map(d => d.agenziaId || ''))].sort((a, b) => tit(ctx, 'Soggetti', a).localeCompare(tit(ctx, 'Soggetti', b), 'it'));
    const content = [];
    for (const a of agenzie) content.push(sezione(a ? tit(ctx, 'Soggetti', a) : 'Agenzia non indicata'), tabella(['Lavoratore', 'Mansione', 'Inizio missione', 'Fine prevista', 'Riferimento contratto'],
      dip.filter(d => (d.agenziaId || '') === a).sort((x, y) => x.cognome.localeCompare(y.cognome, 'it')).map(d => [d.cognome + ' ' + d.nome, tit(ctx, 'Mansioni', d.mansioneId), D(d.inizioMissione), D(d.fineMissione), d.rifContratto])));
    return { titolo: 'Elenco interinali per agenzia', nome: 'Elenco interinali', content: content.length ? content : [paragrafo('Nessun lavoratore interinale attivo.')] };
  },

  storicoDipendente: async (ctx, p) => {
    const s = schedaDipendente(ctx, p.id), d = s.dipendente;
    const content = [campi([['Dipendente', s.nome], ['Codice fiscale', d.cf], ['Mansioni', s.mansioni.join(', ')], ['Sede', s.sede], ['Tipo rapporto', d.tipoRapporto], ['In azienda dal', d.inAziendaDal], ['Stato', d.stato], ['Contratto', d.contratto]])];
    if (s.dpi) content.push(sezione('DPI consegnati'), tabella(['Data', 'DPI', 'Q.tà', 'Taglia'], s.dpi.map(r => [D(r.data), r.dpi, String(r.quantita), r.taglia]), [60, '*', 40, 60]));
    if (s.formazione) content.push(sezione('Formazione'), tabella(['Tipologia', 'Richiesta', 'Ultimo corso', 'Scadenza', 'Stato'], s.formazione.map(r => [r.tipo, r.richiesta ? 'Sì' : 'No', D(r.ultimo), D(r.scadenza), r.stato + (r.parziale ? ' (' + r.parziale + ')' : '')]), ['*', 50, 60, 60, 110]));
    if (s.valutazioni) content.push(sezione('Valutazioni delle competenze'), tabella(['Data', 'Mansioni', 'Copertura', 'Valutatore'], s.valutazioni.map(r => [D(r.data), r.mansioni, r.copertura, r.valutatore])));
    if (s.documenti) content.push(sezione('Documenti'), tabella(['Codice', 'Titolo', 'Rev.', 'Stato', 'Firmata il'], s.documenti.map(r => [r.codice, r.titolo, r.revisione, r.stato, D(r.dataLettura)]), [60, '*', 30, 60, 60]));
    // La sezione sanitaria compare solo per chi è autorizzato.
    if (s.sanitaria) content.push(sezione('Sorveglianza sanitaria'), campi([['Stato', s.sanitaria.stato], ['Ultima visita', D(s.sanitaria.dataVisita)], ['Giudizio', s.sanitaria.giudizio], ['Prossima visita', D(s.sanitaria.prossimaVisita)]]));
    return { titolo: 'Storico dipendente', nome: 'Storico ' + s.nome, content };
  },

  riepilogoNc: async (ctx, p) => {
    const r = regole.funzione(ctx, { ...p, nome: 'nc.riepilogo' }), t = r.totali;
    const conta = o => Object.entries(o).map(([k, v]) => k + ': ' + v).join(', ');
    return { titolo: 'Riepilogo non conformità e azioni', nome: 'Riepilogo NC', content: [
      campi([['Periodo', (p.dal ? 'dal ' + D(p.dal) : 'dall\'inizio') + (p.al ? ' al ' + D(p.al) : '')], ['Non conformità', String(t.nc)], ['Reclami', String(t.reclami)], ['Costo totale €', t.costo.toFixed(2).replace('.', ',')],
        ['Per stato', conta(t.perStato)], ['Per tipologia', conta(t.perTipologia)], ['Azioni', t.azioni + ' (aperte ' + t.azioniAperte + ', scadute ' + t.azioniScadute + ')']]),
      sezione('Non conformità'), tabella(['Numero', 'Data', 'Tipologia', 'Descrizione', 'Stato', 'Costo €'], r.nc.map(x => [x.numero, D(x.data), x.tipologia, x.descrizione, x.stato, x.costoTotale]), [60, 50, 60, '*', 55, 45]),
      sezione('Azioni di miglioramento'), tabella(['Numero', 'Data', 'Descrizione', 'Stato', 'Prevista', 'Chiusura'], r.azioni.map(x => [x.numero, D(x.data), x.descrizione, x.stato, D(x.dataPrevChiusura), D(x.dataChiusura)]), [60, 50, '*', 50, 50, 50])] };
  },

  fornitoriQualificati: async ctx => {
    const r = regole.funzione(ctx, { nome: 'fornitori.qualificati' });
    return { titolo: 'Elenco fornitori qualificati', nome: 'Fornitori qualificati', content: [tabella(['Fornitore', 'Fornitura', 'Esito', 'Media', 'Ultima valutazione'],
      r.map(x => [x.ragioneSociale, x.descrizioneFornitura, x.esito, x.media, D(x.data)]), ['*', '*', 80, 40, 70])] };
  },

  registroStrumenti: async ctx => {
    const r = regole.funzione(ctx, { nome: 'strumenti.registro' });
    return { titolo: 'Registro strumenti di misura', nome: 'Registro strumenti', orizzontale: true, content: [tabella(['Codice', 'Descrizione', 'Matricola', 'Campo di misura', 'EMA ±', 'Freq. mesi', 'Ultima taratura', 'Esito', 'Scadenza', 'Stato'],
      r.map(x => [x.codice, x.descrizione, x.matricola, x.campoMisura, String(x.ema).replace('.', ','), String(x.frequenzaMesi), D(x.ultimaTaratura), x.esitoTaratura, D(x.scadenza), x.statoTaratura]), [55, '*', 60, 70, 40, 40, 60, 80, 60, 80])] };
  },

  registroSanitario: async ctx => {
    const r = regole.funzione(ctx, { nome: 'sanitaria.registro' });
    return { titolo: 'Registro sorveglianza sanitaria', nome: 'Registro sorveglianza sanitaria', content: [tabella(['Lavoratore', 'Mansioni', 'Ultima visita', 'Giudizio', 'Prossima visita', 'Stato'],
      r.map(x => [x.nome, x.mansioni, D(x.dataVisita), x.giudizio || '', D(x.prossimaVisita), x.stato]), ['*', '*', 55, 90, 55, 70])] };
  },

  // Piano di gestione dei rischi / delle opportunità: scopo, metodo, registro, efficacia.
  pianoRischi: async (ctx, p) => {
    eng.esigi(ctx, 'Rischi', false);
    const d = require('./rischi').datiPiano(ctx, p.registroId || p.id), def = d.metodo.definizione;
    const val = v => (v ? { text: T(v.punteggio + ' ' + v.classe), color: v.colore, bold: true } : '-');
    return { titolo: 'Piano di gestione - ' + d.registro.nome, nome: 'Piano di gestione ' + d.registro.nome, orizzontale: true, content: [
      sezione('Scopo'), paragrafo('Il presente piano documenta il registro «' + d.registro.nome + '», la valutazione delle voci con il metodo «' + d.metodo.nome + '», il trattamento pianificato e le azioni con i relativi responsabili e scadenze.'),
      sezione('Metodo di valutazione'), tabella(['Fattore', 'Livelli'], def.fattori.map(f => [f.codice + ' - ' + f.nome, f.livelli.map(l => l[0] + ' = ' + l[1]).join('; ')]), [200, '*']),
      paragrafo('Il punteggio è il prodotto dei fattori. Classi:'),
      tabella(['Classe', 'Intervallo', 'Indicazione', 'Riesame (mesi)'], def.classi.map(c => [{ text: T(c.nome), color: c.colore, bold: true }, c.min + ' - ' + c.max, c.indicazione, String(c.riesameMesi)]), [120, 70, '*', 80]),
      sezione('Registro'), tabella(['Codice', 'Processo', 'Descrizione', 'Causa / effetto', 'Valutazione', 'Trattamento e azioni', 'Residua', 'Responsabile', 'Riesame'],
        d.righe.map(r => [r.codice, r.processo || '-', r.descrizione, [r.causa, r.effetto].filter(Boolean).join(' / '), val(r.valIniziale),
          [r.trattamento, ...r.azioni.map(a => '- ' + a.descrizione + ' (' + a.responsabile + ', entro ' + D(a.scadenza) + ', ' + a.stato.toLowerCase() + ')')].filter(Boolean).join('\n'),
          val(r.valResidua), r.responsabile, D(r.prossimoRiesame)]), [42, 70, '*', '*', 55, '*', 55, 70, 50]),
      sezione('Valutazione dell\'efficacia'), paragrafo('L\'efficacia delle azioni è valutata alla loro chiusura e in sede di riesame di direzione; gli esiti sono riportati nel registro.')] };
  },

  elencoDocumenti: async ctx => {
    soloAdmin(ctx); eng.esigi(ctx, 'Documenti', false);
    const docs = tutte(ctx, 'Documenti').filter(d => d.stato === 'In vigore').sort((a, b) => a.codice.localeCompare(b.codice, 'it'));
    return { titolo: 'Elenco documenti in vigore', nome: 'Elenco documenti in vigore', content: [tabella(['Codice', 'Titolo', 'Tipologia', 'Rev.', 'Data rev.', 'Approvato da', 'Prossimo riesame'],
      docs.map(d => [d.codice, d.titolo, d.tipologia, d.revisione, D(d.dataRevisione), tit(ctx, 'Dipendenti', d.approvatoDa), D(regole.CALC.Documenti.prossimoRiesame(ctx, d))]), [55, '*', 70, 28, 50, 80, 55])] };
  },

  matriceDistribuzione: async ctx => {
    soloAdmin(ctx); eng.esigi(ctx, 'Documenti', false);
    const docs = tutte(ctx, 'Documenti').filter(d => d.stato === 'In vigore').sort((a, b) => a.codice.localeCompare(b.codice, 'it'));
    const mans = tutte(ctx, 'Mansioni').sort((a, b) => a.codice.localeCompare(b.codice, 'it'));
    return { titolo: 'Matrice di distribuzione dei documenti', nome: 'Matrice di distribuzione', orizzontale: true, content: [
      tabella(['Documento', 'Rev.', ...mans.map(m => m.codice), 'Altri'], docs.map(d => [d.codice + ' ' + d.titolo, d.revisione,
        ...mans.map(m => ({ text: d.distTutti === 'SI' || lista(d.distMansioni).includes(m.id) ? 'X' : '', alignment: 'center' })),
        [lista(d.distSedi).length ? 'sedi: ' + lista(d.distSedi).map(s => tit(ctx, 'Sedi', s)).join(', ') : '', lista(d.distDipendenti).map(x => tit(ctx, 'Dipendenti', x)).join(', ')].filter(Boolean).join('; ')]),
      ['*', 25, ...mans.map(() => 'auto'), 110]),
      { text: T('Legenda mansioni: ' + mans.map(m => m.codice + ' = ' + m.descrizione).join('; ')), fontSize: 8, color: '#555555' }] };
  },
};

// ---------- generazione ----------

async function genera(ctx, p) {
  const f = Object.prototype.hasOwnProperty.call(STAMPE, p.nome) ? STAMPE[p.nome] : null;
  if (!f) throw new ErroreUtente('Stampa non riconosciuta.');
  const s = await f(ctx, p);
  const cfg = eng.config(ctx.st);
  const logo = await immagine(ctx, cfg.logo);
  const azienda = T(cfg.ragioneSociale || ctx.azienda.nome);
  const sotto = T([[cfg.indirizzo, cfg.comune].filter(Boolean).join(' - '), [cfg.piva && 'P.IVA ' + cfg.piva, cfg.cf && 'C.F. ' + cfg.cf].filter(Boolean).join(' - '), [cfg.email, cfg.telefono].filter(Boolean).join(' - ')].filter(Boolean).join('\n'));
  const colore = /^#[0-9a-f]{6}$/i.test(cfg.colore || '') ? cfg.colore : '#1F4E79';
  const def = {
    pageSize: 'A4', pageOrientation: s.orizzontale ? 'landscape' : 'portrait', pageMargins: [36, 86, 36, 44],
    info: { title: T(s.nome), author: azienda, creator: 'Gestionale Sicurezza & Qualità' },
    defaultStyle: { font: 'Helvetica', fontSize: 8.5, lineHeight: 1.15 },
    header: () => ({ margin: [36, 22, 36, 0], stack: [
      { columns: [logo ? { image: logo, fit: [110, 42], width: 120 } : { text: '', width: 1 }, { stack: [{ text: azienda, bold: true, fontSize: 12, color: colore }, { text: sotto, fontSize: 7.5, color: '#444444', margin: [0, 2, 0, 0] }], alignment: logo ? 'right' : 'left' }] },
      { canvas: [{ type: 'line', x1: 0, y1: 4, x2: s.orizzontale ? 770 : 523, y2: 4, lineWidth: 1, lineColor: colore }] }] }),
    footer: (pagina, pagine) => ({ margin: [36, 14, 36, 0], fontSize: 7.5, color: '#555555',
      columns: [{ text: 'Stampato il ' + D(eng.oggi()) }, { text: 'Pagina ' + pagina + ' di ' + pagine, alignment: 'right' }] }),
    content: [{ text: T(s.titolo).toUpperCase(), bold: true, fontSize: 13, alignment: 'center', color: colore, margin: [0, 0, 0, 10] }, ...s.content],
  };
  const buffer = await new Promise((ok, ko) => {
    const doc = printer.createPdfKitDocument(def), pezzi = [];
    doc.on('data', c => pezzi.push(c)); doc.on('end', () => ok(Buffer.concat(pezzi))); doc.on('error', ko);
    doc.end();
  });
  return { nome: T(s.nome).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf', buffer };
}

module.exports = { genera, STAMPE };
