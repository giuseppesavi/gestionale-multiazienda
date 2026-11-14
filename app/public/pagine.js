'use strict';
// Pulsanti delle schede e pagine speciali (cruscotto, scadenzario, rischi, import, configurazione…).
(() => {
  const G = window.G, { h, D, api, toast, prova, finestra, conferma, chiedi, scarica, salvaBlob, leggiFile, stampa, badge, tabella, vai, naviga, opzioni } = G;
  const fn = (nome, par) => api('funzione', { nome, ...par });
  const titolo = (t, ...extra) => h('div', { class: 'barra' }, h('h1', {}, t), h('span', { class: 'spazio' }), extra);
  const btnStampa = (t, nome, par) => h('button', { onclick: e => prova(() => stampa(nome, typeof par === 'function' ? par() : par), e.currentTarget) }, '🖨 ' + t);
  const btnExcel = (nome, par) => h('button', { onclick: e => prova(async () => { const f = await api('esporta', { nome, ...par }); scarica(f.nome, f.base64); }, e.currentTarget) }, '⬇ Excel');
  const colore = v => (v ? Object.assign(h('span', { class: 'badge colore' }, v.punteggio + ' – ' + v.classe), { style: null }) : '');
  const valBadge = v => { if (!v) return h('span', { class: 'tenue' }, '—'); const b = h('span', { class: 'badge colore' }, v.punteggio + ' – ' + v.classe); b.style.background = v.colore; return b; };
  void colore;

  // ---------- pulsanti delle schede ----------
  const st = (t, nome) => ({ t: '🖨 ' + t, salvata: true, fn: F => stampa(nome, { id: F.id }) });
  const proposta = (t, nome, figlio, par, mappa) => ({ t, nuova: true, fn: async F => {
    const righe = await api('azione', { entita: F.e, nome, ...par(F) });
    if (!righe.length) return toast('Nessuna riga da proporre.');
    for (const r of righe) if (r.etichetta) G.ETI[r.dpiId || r.competenzaId || r.domandaId || r.attivitaId] = r.etichetta;
    F.impostaFigli(figlio, righe.map(mappa || (r => r)));
    toast(righe.length + ' righe caricate: controlla e salva.');
  } });
  const nuovaCon = (t, entita, campo) => ({ t, salvata: true, se: () => !!G.S.schema[entita] && G.S.schema[entita].puoScrivere, fn: F => vai('#/e/' + entita + '/nuovo?' + campo + '=' + F.id) });

  G.AZIONI = {
    Consegne: [proposta('Carica DPI della mansione', 'caricaDpi', 'ConsegneRighe', F => ({ dipendenteId: F.dati.dipendenteId }), r => ({ dpiId: r.dpiId, quantita: r.quantita, taglia: '', note: '' })), st('Verbale di consegna', 'verbaleConsegna'),
      { t: '✉ Invia per e-mail', salvata: true, fn: async F => { const r = await api('consegna.email', { id: F.id }); toast('Verbale inviato il ' + r.inviata + '.', 'ok'); F.ricarica(); } }],
    Corsi: [st('Registro corso', 'registroCorso')],
    NC: [st('Modulo NC', 'moduloNc'), nuovaCon('＋ Azione di miglioramento', 'Azioni', 'ncId')],
    ValutazioniCompetenze: [proposta('Carica competenze delle mansioni', 'caricaCompetenze', 'ValutazioniRighe', F => ({ mansioni: F.dati.mansioneId }), r => ({ competenzaId: r.competenzaId, valoreAtteso: r.valoreAtteso, mansioniRif: r.mansioniRif, valoreReale: '', note: '' })), st('Valutazione', 'valutazione')],
    Manutenzioni: [proposta('Carica attività del piano', 'loadPlanRows', 'ManutenzioniRighe', F => ({ attrezzaturaId: F.dati.attrezzaturaId }), r => ({ attivitaId: r.attivitaId, eseguita: 'SI', note: '' })), st('Rapporto di manutenzione', 'rapportoManutenzione')],
    Dipendenti: [{ t: 'Scheda completa', salvata: true, fn: F => vai('#/p/scheda?id=' + F.id) },
      { t: 'Assumi direttamente', salvata: true, admin: true, se: F => F.dati.tipoRapporto === 'Interinale (somministrazione)', fn: async F => { const v = await chiedi('Assunzione diretta', [{ k: 'data', l: 'Data di assunzione', tipo: 'date', valore: G.S.oggi, req: true }], 'Assumi'); if (v) { await fn('dipendenti.assumi', { id: F.id, data: v.data }); toast('Dipendente assunto direttamente.', 'ok'); F.ricarica(); } } },
      { t: 'PIN di firma', salvata: true, admin: true, fn: async F => { const v = await chiedi('PIN di firma', [{ k: 'pin', l: 'Nuovo PIN (4-8 cifre). Lascia vuoto per generarlo.', tipo: 'password', inputmode: 'numeric' }], 'Imposta');
        if (v) { const r = await api('pin.imposta', { dipId: F.id, pin: v.pin || undefined }); if (r.pin) await finestra('PIN generato', h('div', {}, h('p', {}, 'Comunica questo PIN al dipendente. Non verrà più mostrato.'), h('p', { class: 'codice' }, r.pin)), [{ t: 'Ho preso nota', classe: 'primario', valore: true }]); else toast('PIN impostato.', 'ok'); F.ricarica(); } } },
      { t: 'Sblocca accesso', salvata: true, admin: true, fn: async F => { await api('accesso.sblocca', { dipId: F.id }); toast('Accesso e PIN sbloccati.', 'ok'); } },
      st('Storico dipendente', 'storicoDipendente')],
    Mansioni: [{ t: 'Clona', salvata: true, admin: true, fn: async F => { const v = await chiedi('Clona la mansione', [{ k: 'codice', l: 'Codice della nuova mansione', req: true }], 'Clona'); if (v) { const r = await fn('mansioni.clona', { id: F.id, codice: v.codice }); delete G.OPZ.Mansioni; vai('#/e/Mansioni/' + r.riga.id); } } }, st('Scheda mansione', 'schedaMansione')],
    TipiDpi: [st('Scheda DPI', 'schedaDpi')],
    Soggetti: [nuovaCon('＋ Nuova qualifica', 'QualificheFornitori', 'soggettoId')],
    QualificheFornitori: [proposta('Carica domande standard', 'caricaDomande', 'QualificheRighe', () => ({}), r => ({ domandaId: r.domandaId, voto: '', note: '' })), st('Modulo qualifica', 'moduloQualifica')],
    Strumenti: [nuovaCon('＋ Nuova taratura', 'Tarature', 'strumentoId'), st('Scheda strumento (QR)', 'schedaStrumento')],
    Tarature: [st('Rapporto di taratura', 'rapportoTaratura')],
    Attrezzature: [proposta('Applica piano', 'applyPlan', 'AttrezzatureAttivita', F => ({ tipoId: F.dati.tipoId, pianoId: F.dati.pianoId })), nuovaCon('＋ Nuova manutenzione', 'Manutenzioni', 'attrezzaturaId'), st('Scheda attrezzatura (QR)', 'schedaAttrezzatura'), st('Storico manutenzioni', 'storicoAttrezzatura')],
    Azioni: [{ t: '✔ Completa', salvata: true, se: F => F.dati.stato !== 'Chiusa', fn: async F => { const v = await chiedi('Completa l\'azione', [{ k: 'note', l: 'Cosa è stato fatto', tipo: 'textarea', req: true }], 'Completa'); if (v) { await fn('azioni.completa', { id: F.id, note: v.note }); toast('Azione completata.', 'ok'); F.ricarica(); } } },
      { t: 'Verifica efficacia', salvata: true, admin: true, se: F => F.dati.stato === 'Chiusa', fn: async F => { const v = await chiedi('Verifica dell\'efficacia', [{ k: 'esito', l: 'Esito', tipo: 'select', opzioni: ['Efficace', 'Non efficace'] }, { k: 'note', l: 'Evidenze della verifica', tipo: 'textarea', req: true }, { k: 'x', tipo: 'nota', l: 'Se l\'azione non è efficace viene riaperta.' }], 'Registra');
        if (v) { await fn('azioni.verifica', { id: F.id, esito: v.esito, note: v.note }); toast('Verifica registrata.', 'ok'); F.ricarica(); } } }],
    Documenti: [{ t: 'Apri documento', salvata: true, se: F => F.dati.link || F.dati.file, fn: F => (F.dati.file ? G.scaricaFile(F.dati.file) : window.open(F.dati.link, '_blank', 'noopener')) },
      { t: 'Nuova revisione', salvata: true, admin: true, se: F => F.dati.stato === 'In vigore', fn: async F => { const r = await fn('documenti.nuovaRevisione', { id: F.id }); toast('Creata la revisione ' + r.riga.revisione + ' in bozza.', 'ok'); vai('#/e/Documenti/' + r.riga.id); } },
      { t: 'Distribuisci', salvata: true, admin: true, se: F => F.dati.stato === 'In vigore', fn: async F => { const r = await fn('documenti.distribuisci', { id: F.id }); toast(r.create + ' prese visione create.', 'ok'); F.ricarica(); } },
      { t: 'Ritira', salvata: true, admin: true, se: F => F.dati.stato === 'In vigore', fn: async F => { if (await conferma('Ritirare il documento? Le prese visione non firmate verranno annullate.', 'Ritira')) { await fn('documenti.ritira', { id: F.id }); toast('Documento ritirato.'); F.ricarica(); } } },
      { ...st('Scheda documento', 'schedaDocumento'), admin: true }],
    PreseVisione: [{ t: 'Apri documento', salvata: true, fn: F => vai('#/e/Documenti/' + F.dati.documentoId) }],
  };

  // ---------- cruscotto ----------
  G.PAGINE.cruscotto = async () => {
    const c = await api('cruscotto'), S = G.S, L = c.licenza;
    const tess = (n, l, href, rosso) => h('a', { class: 'tessera', href: href || '#/' }, h('div', { class: 'n' + (rosso && n ? ' rosso' : '') }, n), h('div', { class: 'l' }, l));
    const k = c.contatori, sc = c.scadenze;
    const NOMI = { manutenzioni: 'Manutenzioni', formazione: 'Formazione', strumenti: 'Strumenti di misura', visite: 'Visite mediche', prese: 'Prese visione', riesami: 'Riesami documenti', rischi: 'Riesami rischi' };
    const rapide = [['Consegne', 'Nuova consegna DPI'], ['Corsi', 'Nuovo corso'], ['NC', 'Nuova NC'], ['Manutenzioni', 'Manutenzione'], ['Tarature', 'Nuova taratura']].filter(x => S.schema[x[0]] && S.schema[x[0]].puoScrivere);
    const barra = h('div', { class: 'barraLic' + (L.pieno ? ' pieno' : '') }, h('div', {}));
    barra.firstChild.style.width = Math.min(100, Math.round(L.attivi * 100 / L.max)) + '%';
    return h('div', {}, titolo('Cruscotto'),
      L.pieno ? h('div', { class: 'avviso rosso' }, 'Hai raggiunto il numero massimo di addetti della tua licenza (' + L.max + '). Per inserire nuovi addetti è necessario estendere la licenza: contatta il fornitore del servizio.')
        : L.avviso ? h('div', { class: 'avviso' }, 'Ti stai avvicinando al limite di addetti della tua licenza: ' + L.attivi + ' su ' + L.max + '.') : null,
      h('div', { class: 'tessere' }, tess(k.dipendentiAttivi, 'Dipendenti attivi', '#/e/Dipendenti'),
        k.consegne30 !== undefined ? tess(k.consegne30, 'Consegne DPI (30 giorni)', '#/e/Consegne') : null, k.ncAperte !== undefined ? tess(k.ncAperte, 'NC aperte', '#/e/NC') : null,
        k.azioniAperte !== undefined ? tess(k.azioniAperte, 'Azioni aperte', '#/e/Azioni') : null, k.azioniScadute !== undefined ? tess(k.azioniScadute, 'Azioni scadute', '#/p/scadenzario', true) : null,
        c.mieAzioni ? tess(c.mieAzioni, 'Azioni assegnate a me', '#/e/Azioni') : null,
        c.rischi ? tess(c.rischi.attivi, 'Rischi e opportunità attivi', '#/p/rischi') : null,
        tess(c.firmeInAttesa, 'Schede con firme in attesa'), c.documenti ? tess(c.documenti.daLeggere, 'Documenti da leggere', '#/p/miei', true) : null, c.documenti && c.documenti.daFirmare ? tess(c.documenti.daFirmare, 'Documenti da firmare', '#/p/miei', true) : null),
      h('div', { class: 'card' }, h('h2', {}, 'Scadenze a 30 giorni'), tabella([{ l: 'Area', v: r => NOMI[r[0]] }, { l: 'Scadute', classe: 'num', v: r => (r[1].scadute ? badge(r[1].scadute + ' scadute') : '0') }, { l: 'In scadenza', classe: 'num', v: r => (r[1].inScadenza ? h('span', { class: 'badge giallo' }, r[1].inScadenza) : '0') }],
        Object.entries(sc), () => vai('#/p/scadenzario'), 'Nessuna scadenza da seguire con i pacchetti attivi.')),
      rapide.length ? h('div', { class: 'card' }, h('h2', {}, 'Azioni rapide'), h('div', { class: 'barra' }, rapide.map(x => h('button', { onclick: () => vai('#/e/' + x[0] + '/nuovo') }, '＋ ' + x[1])), h('button', { onclick: () => vai('#/p/scheda') }, 'Scheda dipendente'))) : null,
      h('div', { class: 'card' }, h('h2', {}, 'Licenza'), h('p', {}, 'Classe ' + L.etichetta + ': ' + L.attivi + ' addetti attivi su ' + L.max + '.'), barra,
        h('p', { class: 'tenue' }, 'Pacchetti attivi: ' + S.pacchetti.map(p => p.nome).join(', ') + '.')));
  };

  // ---------- scadenzario ----------
  G.PAGINE.scadenzario = async par => {
    const giorni = Number(par.giorni) || 60;
    const s = await api('scadenzario', { giorni });
    const sel = h('select', { 'aria-label': 'Finestra' }, [30, 60, 90, 180, 365].map(g => h('option', { value: g, selected: g === giorni }, 'Prossimi ' + g + ' giorni')));
    sel.addEventListener('change', () => vai('#/p/scadenzario?giorni=' + sel.value));
    const apri = r => vai(r.entita === 'Rischi' ? '#/p/rischi?registro=' + r.registroId : '#/e/' + r.entita + '/' + r.id);
    return h('div', {}, titolo('Scadenzario', sel), s.sezioni.map(z => h('div', { class: 'card' }, h('h2', {}, z.titolo + ' (' + z.righe.length + ')'),
      tabella([{ l: 'Scadenza', v: r => D(r.data) || '—' }, { l: 'Stato', v: r => badge(r.stato) }, { l: 'Descrizione', v: r => r.testo }], z.righe, apri, 'Nessuna scadenza nel periodo.'))));
  };

  // ---------- scheda dipendente ----------
  G.PAGINE.scheda = async par => {
    const dip = await opzioni('Dipendenti');
    const sel = h('select', { 'aria-label': 'Dipendente' }, h('option', { value: '' }, 'Scegli un dipendente…'), dip.map(o => h('option', { value: o.id, selected: o.id === par.id }, o.titolo)));
    sel.addEventListener('change', () => vai('#/p/scheda' + (sel.value ? '?id=' + sel.value : '')));
    if (!par.id) return h('div', {}, titolo('Scheda dipendente'), h('div', { class: 'barra' }, sel));
    const s = await api('scheda.dipendente', { id: par.id }), d = s.dipendente;
    const sez = (t, nodo) => h('div', { class: 'card' }, h('h2', {}, t), nodo);
    return h('div', {}, titolo('Scheda dipendente', btnExcel('dipendente.scheda', { id: par.id }), btnStampa('Storico', 'storicoDipendente', { id: par.id })), h('div', { class: 'barra' }, sel, h('button', { onclick: () => vai('#/e/Dipendenti/' + par.id) }, 'Apri anagrafica')),
      sez(s.nome, tabella([{ l: 'Dato', v: r => r[0] }, { l: 'Valore', v: r => r[1] }], [['Stato', badge(d.stato)], ['Codice fiscale', d.cf], ['Mansioni', s.mansioni.join(', ')], ['Sede', s.sede], ['Tipo rapporto', d.tipoRapporto], ['In azienda dal', d.inAziendaDal], ['PIN di firma impostato', d.pinImpostato === 'SI' ? 'Sì' : 'No']].filter(r => r[1]))),
      s.formazione ? sez('Formazione', tabella([{ l: 'Tipologia', v: r => r.tipo }, { l: 'Richiesta', v: r => (r.richiesta ? 'Sì' : 'No') }, { l: 'Ultimo corso', v: r => D(r.ultimo) }, { l: 'Scadenza', v: r => D(r.scadenza) }, { l: 'Stato', v: r => [badge(r.stato), r.parziale ? ' ' + r.parziale : ''] }], s.formazione)) : null,
      s.dpi ? sez('DPI consegnati', tabella([{ l: 'Data', v: r => D(r.data) }, { l: 'DPI', v: r => r.dpi }, { l: 'Q.tà', v: r => r.quantita }, { l: 'Taglia', v: r => r.taglia }], s.dpi, r => vai('#/e/Consegne/' + r.consegnaId))) : null,
      s.valutazioni ? sez('Valutazioni delle competenze', tabella([{ l: 'Data', v: r => D(r.data) }, { l: 'Mansioni', v: r => r.mansioni }, { l: 'Copertura', v: r => r.copertura }, { l: 'Valutatore', v: r => r.valutatore }], s.valutazioni, r => vai('#/e/ValutazioniCompetenze/' + r.id))) : null,
      s.documenti ? sez('Documenti', tabella([{ l: 'Codice', v: r => r.codice }, { l: 'Titolo', v: r => r.titolo }, { l: 'Rev.', v: r => r.revisione }, { l: 'Stato', v: r => badge(r.stato) }, { l: 'Firmata il', v: r => D(r.dataLettura) }], s.documenti, r => vai('#/e/PreseVisione/' + r.id))) : null,
      s.sanitaria ? sez('Sorveglianza sanitaria', tabella([{ l: 'Stato', v: r => badge(r.stato) }, { l: 'Ultima visita', v: r => D(r.dataVisita) }, { l: 'Giudizio', v: r => badge(r.giudizio) }, { l: 'Prossima visita', v: r => D(r.prossimaVisita) }], [s.sanitaria])) : null);
  };

  // ---------- documenti ----------
  G.PAGINE.miei = async () => {
    const m = await fn('documenti.miei');
    const apri = d => (d.file ? prova(() => G.scaricaFile(d.file)) : d.link ? window.open(d.link, '_blank', 'noopener') : toast('Per questo documento non è stato caricato un file né un link.'));
    return h('div', {}, titolo('I miei documenti'),
      m.daFirmare.length ? h('div', { class: 'card' }, h('h2', {}, 'Da firmare'), tabella([{ l: 'Documento', v: r => r.codice + ' ' + r.titolo }, { l: 'Rev.', v: r => r.revisione }, { l: 'Ruolo', v: r => r.ruolo }, { l: '', v: r => (r.pronto ? badge('Da firmare') : h('span', { class: 'tenue' }, 'In attesa delle altre firme')) }], m.daFirmare, r => vai('#/e/Documenti/' + r.id))) : null,
      h('div', { class: 'card' }, h('h2', {}, 'In vigore per me'), tabella([{ l: 'Documento', v: r => r.codice + ' ' + r.titolo }, { l: 'Rev.', v: r => r.revisione }, { l: 'Presa visione', v: r => (r.presa ? [badge(r.presa.stato), r.presa.stato === 'Firmata' ? ' ' + D(r.presa.dataLettura) : ' entro il ' + D(r.presa.entroIl)] : h('span', { class: 'tenue' }, 'Non richiesta')) },
        { l: '', v: r => h('div', { class: 'barra' }, h('button', { class: 'piccolo', onclick: e => { e.stopPropagation(); apri(r); } }, 'Apri'),
          r.presa && r.presa.stato !== 'Firmata' ? h('button', { class: 'piccolo primario', onclick: async e => { e.stopPropagation(); const b = e.currentTarget; if (await conferma('Confermi di aver letto il documento ' + r.codice + '?', 'Ho letto')) { const x = await prova(() => api('firma', { entita: 'PreseVisione', id: r.presa.id, key: r.presa.key, metodo: 'credenziali' }), b); if (x) { toast('Presa visione registrata.', 'ok'); naviga(); } } } }, 'Ho letto') : null) }], m.inVigore, null, 'Nessun documento in vigore per te.')));
  };

  // ---------- registri e riepiloghi ----------
  G.PAGINE.riepilogoNc = async par => {
    const r = await fn('nc.riepilogo', par), t = r.totali;
    const campo = (k, l, tipo, op) => { const i = tipo === 'select' ? h('select', { 'aria-label': l }, h('option', { value: '' }, l + ': tutti'), op.map(o => h('option', { value: o, selected: par[k] === o }, o))) : h('input', { type: 'date', value: par[k] || '', 'aria-label': l, title: l }); i.dataset.k = k; return i; };
    const filtri = [campo('dal', 'Dal'), campo('al', 'Al'), campo('stato', 'Stato', 'select', ['Aperta', 'In gestione', 'Chiusa']), campo('tipologia', 'Tipologia', 'select', G.S.elenchi['Tipologia NC'] || []), campo('reclamo', 'Reclamo', 'select', ['SI', 'NO'])];
    const applica = () => vai('#/p/riepilogoNc?' + new URLSearchParams(Object.fromEntries(filtri.filter(i => i.value).map(i => [i.dataset.k, i.value]))));
    const conta = o => Object.entries(o).map(([k, v]) => k + ': ' + v).join(' · ') || '—';
    return h('div', {}, titolo('Riepilogo NC e azioni', btnStampa('Riepilogo', 'riepilogoNc', par)), h('div', { class: 'barra' }, filtri, h('button', { class: 'primario', onclick: applica }, 'Applica')),
      h('div', { class: 'tessere' }, [[t.nc, 'Non conformità'], [t.reclami, 'Reclami'], [t.costo.toFixed(2).replace('.', ',') + ' €', 'Costo totale'], [t.azioniAperte, 'Azioni aperte'], [t.azioniScadute, 'Azioni scadute']].map(x => h('div', { class: 'tessera' }, h('div', { class: 'n' }, x[0]), h('div', { class: 'l' }, x[1])))),
      h('p', { class: 'tenue' }, 'Per stato: ' + conta(t.perStato) + '. Per tipologia: ' + conta(t.perTipologia) + '.'),
      h('div', { class: 'card' }, h('h2', {}, 'Non conformità'), tabella([{ l: 'Numero', v: x => x.numero }, { l: 'Data', v: x => D(x.data) }, { l: 'Tipologia', v: x => x.tipologia }, { l: 'Descrizione', v: x => x.descrizione }, { l: 'Stato', v: x => badge(x.stato) }, { l: 'Costo €', classe: 'num', v: x => x.costoTotale }], r.nc, x => vai('#/e/NC/' + x.id))),
      h('div', { class: 'card' }, h('h2', {}, 'Azioni di miglioramento'), tabella([{ l: 'Numero', v: x => x.numero }, { l: 'Descrizione', v: x => x.descrizione }, { l: 'Stato', v: x => badge(x.stato) }, { l: 'Prevista', v: x => D(x.dataPrevChiusura) }, { l: 'Chiusura', v: x => D(x.dataChiusura) }], r.azioni, x => vai('#/e/Azioni/' + x.id))));
  };
  G.PAGINE.qualificati = async () => {
    const r = await fn('fornitori.qualificati');
    return h('div', {}, titolo('Elenco fornitori qualificati', btnStampa('Elenco', 'fornitoriQualificati')), tabella([{ l: 'Fornitore', v: x => x.ragioneSociale }, { l: 'Fornitura', v: x => x.descrizioneFornitura }, { l: 'Esito', v: x => badge(x.esito) }, { l: 'Media', classe: 'num', v: x => x.media }, { l: 'Ultima valutazione', v: x => D(x.data) }], r, x => vai('#/e/Soggetti/' + x.id)));
  };
  G.PAGINE.registroStrumenti = async () => {
    const r = await fn('strumenti.registro');
    return h('div', {}, titolo('Registro strumenti', btnExcel('strumenti.registro'), btnStampa('Registro', 'registroStrumenti')), tabella([{ l: 'Codice', v: x => x.codice }, { l: 'Descrizione', v: x => x.descrizione }, { l: 'Matricola', v: x => x.matricola }, { l: 'Ultima taratura', v: x => D(x.ultimaTaratura) }, { l: 'Esito', v: x => badge(x.esitoTaratura) }, { l: 'Scadenza', v: x => D(x.scadenza) }, { l: 'Stato', v: x => badge(x.statoTaratura) }], r, x => vai('#/e/Strumenti/' + x.id)));
  };
  G.PAGINE.sanitario = async () => {
    const r = await fn('sanitaria.registro');
    return h('div', {}, titolo('Registro sorveglianza sanitaria', btnExcel('sanitaria.registro'), btnStampa('Registro', 'registroSanitario')), h('p', { class: 'tenue' }, 'Dati riservati: visibili solo a chi è autorizzato.'),
      tabella([{ l: 'Lavoratore', v: x => x.nome }, { l: 'Mansioni', v: x => x.mansioni }, { l: 'Ultima visita', v: x => D(x.dataVisita) }, { l: 'Giudizio', v: x => badge(x.giudizio) }, { l: 'Prossima visita', v: x => D(x.prossimaVisita) }, { l: 'Stato', v: x => badge(x.stato) },
        { l: '', v: x => h('button', { class: 'piccolo', onclick: async e => { e.stopPropagation(); const p = await prova(() => api('azione', { entita: 'SorveglianzaSanitaria', nome: 'nuovaVisita', dipendenteId: x.dipendenteId })); if (p) vai('#/e/SorveglianzaSanitaria/nuovo?' + new URLSearchParams({ dipendenteId: x.dipendenteId, ...p })); } }, '＋ Visita') }],
      r, x => (x.visitaId ? vai('#/e/SorveglianzaSanitaria/' + x.visitaId) : null), 'Nessun lavoratore soggetto a sorveglianza sanitaria.'));
  };

  // ---------- manutenzione massiva per sede ----------
  G.PAGINE.massiva = async par => {
    const sedi = await opzioni('Sedi'), dip = await opzioni('Dipendenti');
    const sel = h('select', { 'aria-label': 'Sede' }, h('option', { value: '' }, 'Tutte le sedi'), sedi.map(o => h('option', { value: o.id, selected: o.id === par.sede }, o.titolo)));
    sel.addEventListener('change', () => vai('#/p/massiva' + (sel.value ? '?sede=' + sel.value : '')));
    const righe = await fn('manutenzioni.inScadenza', { sedeId: par.sede || '', giorni: 30 });
    const caselle = [];
    const data = h('input', { type: 'date', value: G.S.oggi, 'aria-label': 'Data' }), chi = h('select', { 'aria-label': 'Esecutore' }, dip.map(o => h('option', { value: o.id, selected: o.id === G.S.utente.id }, o.titolo)));
    const corpo = righe.length ? righe.map(a => h('div', { class: 'card' }, h('h2', {}, a.codice + ' ' + a.descrizione), a.attivita.map(x => { const c = h('input', { type: 'checkbox' }); c.checked = true; caselle.push({ c, attr: a.attrezzaturaId, id: x.id });
      return h('label', { class: 'voce' }, c, ' ', x.attivita, ' ', badge(x.stato), x.prossima ? h('span', { class: 'tenue' }, ' ' + D(x.prossima)) : null, h('br')); }))) : h('p', { class: 'tenue' }, 'Nessuna attività in scadenza nei prossimi 30 giorni.');
    return h('div', {}, titolo('Manutenzione massiva per sede'), h('div', { class: 'barra' }, sel), corpo,
      righe.length ? h('div', { class: 'card' }, h('h2', {}, 'Registra le attività selezionate'), h('div', { class: 'barra' }, data, chi, h('button', { class: 'primario', onclick: e => prova(async () => {
        const per = {};
        for (const x of caselle) if (x.c.checked) (per[x.attr] = per[x.attr] || []).push(x.id);
        const r = await fn('manutenzioni.massiva', { data: data.value, esecutoreDipId: chi.value, elementi: Object.entries(per).map(([attrezzaturaId, attivita]) => ({ attrezzaturaId, attivita })) });
        toast(r.create.length + ' manutenzioni registrate.', 'ok'); naviga();
      }, e.currentTarget) }, 'Registra'))) : null);
  };

  // ---------- rischi e opportunità ----------
  function matrice(metodo, righe) {
    const f = metodo.definizione.fattori;
    if (f.length !== 2) return null;
    const classe = p => metodo.definizione.classi.find(c => p >= c.min && p <= c.max) || { colore: '#718096', nome: '' };
    const conta = (a, b) => righe.filter(r => { const v = r.valResidua || r.valIniziale; return v && r.stato === 'Attivo' && v.metodoId === metodo.id && v.valori[f[0].codice] === a && v.valori[f[1].codice] === b; }).length;
    const t = h('table', { class: 'matrice' }, h('tr', {}, h('th', {}, f[0].nome + ' ↓ / ' + f[1].nome + ' →'), f[1].livelli.map(l => h('th', {}, l[0] + ' ' + l[1]))),
      [...f[0].livelli].reverse().map(a => h('tr', {}, h('th', {}, a[0] + ' ' + a[1]), f[1].livelli.map(b => { const cl = classe(a[0] * b[0]), n = conta(a[0], b[0]); const td = h('td', { class: 'cella', title: cl.nome + ' (punteggio ' + a[0] * b[0] + ')' }, n || ''); td.style.background = cl.colore; return td; }))));
    return h('div', { class: 'card' }, h('h2', {}, 'Matrice (voci attive, valutazione residua se presente)'), h('div', { class: 'scorri' }, t),
      h('p', { class: 'tenue' }, metodo.definizione.classi.map(c => c.nome + ' ' + c.min + '–' + c.max + ': ' + (c.indicazione || '')).join(' · ')));
  }
  async function modificaRischio(reg, metodo, r) {
    const dip = await opzioni('Dipendenti'), proc = G.S.schema.Processi ? await opzioni('Processi') : [];
    const el = {}, f = metodo.definizione.fattori;
    const campo = (k, l, nodo, pieno) => { el[k] = nodo; return h('div', { class: 'campo' + (pieno ? ' pieno' : '') }, h('label', {}, l), nodo); };
    const sel = (op, v, vuoto) => h('select', {}, h('option', { value: '' }, vuoto || '—'), op.map(o => h('option', { value: o.id ?? o[0], selected: String(o.id ?? o[0]) === String(v ?? '') }, o.titolo ?? (o[0] + ' – ' + o[1]))));
    const valori = (pref, val) => f.map(x => campo(pref + x.codice, x.nome, sel(x.livelli, val ? val.valori[x.codice] : '')));
    const corpo = h('div', { class: 'griglia' }, campo('descrizione', 'Descrizione *', h('textarea', { value: r.descrizione || '' }), true), campo('causa', 'Causa', h('textarea', { value: r.causa || '' })), campo('effetto', 'Effetto', h('textarea', { value: r.effetto || '' })),
      proc.length ? campo('processoId', 'Processo', sel(proc, r.processoId)) : null, campo('fonte', 'Fonte', h('input', { value: r.fonte || '' })), campo('responsabileId', 'Responsabile', sel(dip, r.responsabileId)),
      h('div', { class: 'campo pieno' }, h('h2', {}, 'Valutazione iniziale – ' + metodo.nome)), valori('i_', r.valIniziale),
      campo('trattamento', 'Trattamento', h('textarea', { value: r.trattamento || '' }), true),
      h('div', { class: 'campo pieno' }, h('h2', {}, 'Valutazione residua (dopo il trattamento)')), valori('r_', r.valResidua),
      campo('prossimoRiesame', 'Prossimo riesame (vuoto = calcolato dalla classe)', h('input', { type: 'date', value: r.prossimoRiesame || '' })),
      campo('stato', 'Stato', sel([['Attivo', ''], ['Proposta', '']].map(x => ({ id: x[0], titolo: x[0] })), r.stato || 'Attivo')),
      campo('efficacia', 'Valutazione dell\'efficacia', h('textarea', { value: r.efficacia || '' }), true), campo('note', 'Note', h('textarea', { value: r.note || '' }), true));
    return finestra((r.id ? r.codice + ' – modifica' : 'Nuova voce') + ' · ' + reg.nome, corpo, [{ t: 'Annulla', valore: null }, { t: 'Salva', classe: 'primario', fn: async () => {
      const p = { id: r.id, registroId: reg.id };
      for (const k of ['descrizione', 'causa', 'effetto', 'fonte', 'trattamento', 'efficacia', 'note', 'responsabileId', 'processoId', 'prossimoRiesame', 'stato']) if (el[k]) p[k] = el[k].value;
      const leggi = pref => { const v = {}; for (const x of f) if (el[pref + x.codice].value) v[x.codice] = Number(el[pref + x.codice].value); return v; };
      const vi = leggi('i_'), vr = leggi('r_');
      if (Object.keys(vi).length) p.valori = vi;
      p.valoriResidui = Object.keys(vr).length ? vr : (r.valResidua ? null : undefined);
      if (!p.prossimoRiesame) delete p.prossimoRiesame;
      return fn('rischi.salva', p);
    } }], true);
  }
  G.PAGINE.rischi = async par => {
    const m = await fn('rischi.metodi'), registri = m.registri.filter(r => r.attivo);
    if (!registri.length) return h('div', {}, titolo('Rischi e opportunità'), h('p', {}, 'Nessun registro attivo.'));
    const regId = registri.some(r => r.id === par.registro) ? par.registro : registri[0].id, chiusi = par.chiusi === '1';
    const d = await fn('rischi.elenco', { registroId: regId, chiusi });
    const sel = h('select', { 'aria-label': 'Registro' }, registri.map(r => h('option', { value: r.id, selected: r.id === regId }, r.nome)));
    const cas = h('input', { type: 'checkbox' }); cas.checked = chiusi;
    const cambia = () => vai('#/p/rischi?registro=' + sel.value + (cas.checked ? '&chiusi=1' : ''));
    sel.addEventListener('change', cambia); cas.addEventListener('change', cambia);
    const W = d.puoScrivere;
    const azioni = r => h('div', { class: 'barra' },
      W ? h('button', { class: 'piccolo', onclick: async () => { if (await modificaRischio(d.registro, d.metodo, r)) { toast('Voce salvata.', 'ok'); naviga(); } } }, 'Modifica') : null,
      W && r.stato === 'Proposta' ? h('button', { class: 'piccolo primario', onclick: e => prova(async () => { await fn('rischi.conferma', { ids: [r.id] }); toast('Voce confermata.', 'ok'); naviga(); }, e.currentTarget) }, 'Conferma') : null,
      G.S.schema.Azioni && G.S.schema.Azioni.puoScrivere && r.stato !== 'Chiuso' ? h('button', { class: 'piccolo', onclick: () => vai('#/e/Azioni/nuovo?rischioId=' + r.id) }, '＋ Azione') : null,
      W && r.stato !== 'Chiuso' ? h('button', { class: 'piccolo pericolo', onclick: async e => {
        const b = e.currentTarget;
        if (r.stato === 'Proposta') { if (await conferma('Scartare la proposta ' + r.codice + '?', 'Scarta')) { await prova(() => fn('rischi.elimina', { id: r.id }), b); naviga(); } }
        else { const v = await chiedi('Chiudi la voce ' + r.codice, [{ k: 'motivo', l: 'Motivo della chiusura', tipo: 'textarea', req: true }], 'Chiudi'); if (v) { await prova(() => fn('rischi.elimina', { id: r.id, motivo: v.motivo }), b); naviga(); } }
      } }, r.stato === 'Proposta' ? 'Scarta' : 'Chiudi') : null);
    return h('div', {}, titolo('Rischi e opportunità', btnStampa('Piano di gestione', 'pianoRischi', { registroId: regId }),
      W && G.S.schema.Documenti ? h('button', { onclick: e => prova(async () => { const r = await fn('rischi.piano', { registroId: regId }); toast('Piano ' + r.codice + ' rev. ' + r.revisione + ' pronto in bozza.', 'ok'); vai('#/e/Documenti/' + r.documentoId); }, e.currentTarget) }, 'Genera documento controllato') : null),
      h('div', { class: 'barra' }, sel, h('label', {}, cas, ' Mostra anche le voci chiuse'), h('span', { class: 'spazio' }), W ? h('button', { class: 'primario', onclick: async () => { if (await modificaRischio(d.registro, d.metodo, {})) { toast('Voce salvata.', 'ok'); naviga(); } } }, '＋ Nuova voce') : null),
      h('p', { class: 'tenue' }, 'Metodo di valutazione: ' + d.metodo.nome + '. Il punteggio è il prodotto dei fattori.'),
      matrice(d.metodo, d.righe),
      tabella([{ l: 'Codice', v: r => r.codice }, { l: 'Descrizione', v: r => [r.descrizione, r.causa ? h('div', { class: 'tenue' }, 'Causa: ' + r.causa) : null, r.trattamento ? h('div', { class: 'tenue' }, 'Trattamento: ' + r.trattamento) : null] },
        { l: 'Valutazione', v: r => valBadge(r.valIniziale) }, { l: 'Residua', v: r => valBadge(r.valResidua) }, { l: 'Responsabile', v: r => r.responsabile }, { l: 'Riesame', v: r => D(r.prossimoRiesame) },
        { l: 'Azioni', v: r => r.azioni.map(a => h('div', {}, h('a', { href: '#/e/Azioni/' + a.id }, a.numero), ' ', badge(a.stato), a.esitoEfficacia ? [' ', badge(a.esitoEfficacia)] : null)) }, { l: 'Stato', v: r => badge(r.stato) }, { l: '', v: azioni }],
      d.righe, null, 'Nessuna voce in questo registro.'));
  };

  G.PAGINE.metodi = async () => {
    const m = await fn('rischi.metodi'), admin = G.S.utente.admin;
    const descrivi = d => h('div', {}, d.fattori.map(f => h('div', {}, h('strong', {}, f.codice + ' – ' + f.nome + ': '), f.livelli.map(l => l[0] + ' = ' + l[1]).join('; '))),
      h('div', {}, d.classi.map(c => { const b = h('span', { class: 'badge colore' }, c.nome + ' ' + c.min + '–' + c.max); b.style.background = c.colore; return [b, ' ']; })));
    async function modifica(met) {
      const nome = h('input', { value: met.nome || '' });
      const aTesto = d => d.fattori.map(f => f.codice + ' | ' + f.nome + ' | ' + f.livelli.map(l => l[0] + '=' + l[1]).join('; ')).join('\n');
      const cTesto = d => d.classi.map(c => [c.nome, c.min, c.max, c.colore, c.riesameMesi, c.indicazione || ''].join(' | ')).join('\n');
      const fatt = h('textarea', { value: met.definizione ? aTesto(met.definizione) : '' }), cla = h('textarea', { value: met.definizione ? cTesto(met.definizione) : '' });
      const pre = h('select', {}, h('option', { value: '' }, 'Parti da un metodo predefinito…'), Object.entries(m.preset).map(([k, p]) => h('option', { value: k }, p.nome)));
      pre.addEventListener('change', () => { const p = m.preset[pre.value]; if (p) { fatt.value = aTesto(p.definizione); cla.value = cTesto(p.definizione); if (!nome.value) nome.value = p.nome + ' (personalizzato)'; } });
      const riga = (l, n, aiuto) => h('div', { class: 'campo riga' }, h('label', {}, l), n, aiuto ? h('div', { class: 'aiuto' }, aiuto) : null);
      return finestra(met.id ? 'Modifica il metodo' : 'Nuovo metodo di valutazione', h('div', {}, riga('Nome del metodo', nome), met.id ? null : riga('Modello', pre),
        riga('Fattori (uno per riga)', fatt, 'Formato: CODICE | Nome | 1=Bassa; 2=Media; 3=Alta'), riga('Classi (una per riga)', cla, 'Formato: Nome | minimo | massimo | colore (#RRGGBB) | riesame in mesi | indicazione'),
        h('p', { class: 'tenue' }, 'Le valutazioni già fatte conservano il metodo con cui sono nate.')), [{ t: 'Annulla', valore: null }, { t: 'Salva', classe: 'primario', fn: () => {
        const righe = t => t.value.split('\n').map(x => x.trim()).filter(Boolean).map(x => x.split('|').map(y => y.trim()));
        const definizione = { fattori: righe(fatt).map(x => ({ codice: x[0], nome: x[1], livelli: String(x[2] || '').split(';').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf('='); return [Number(l.slice(0, i)), l.slice(i + 1).trim()]; }) })),
          classi: righe(cla).map(x => ({ nome: x[0], min: Number(x[1]), max: Number(x[2]), colore: x[3] || undefined, riesameMesi: Number(x[4]) || undefined, indicazione: x[5] || '' })) };
        return fn('rischi.metodoSalva', { id: met.id, nomeMetodo: nome.value.trim(), definizione });
      } }], true);
    }
    return h('div', {}, titolo('Metodi di valutazione', admin ? h('button', { class: 'primario', onclick: async () => { if (await modifica({})) { toast('Metodo salvato.', 'ok'); naviga(); } } }, '＋ Nuovo metodo') : null),
      h('p', { class: 'tenue' }, 'Il metodo usato da ogni registro si sceglie nella scheda del registro (menu "Registri dei rischi").'),
      m.metodi.map(x => h('div', { class: 'card' }, h('div', { class: 'barra' }, h('h2', {}, x.nome), h('span', { class: 'spazio' }), m.registri.filter(r => r.metodoId === x.id).map(r => h('span', { class: 'badge' }, r.nome)),
        admin ? h('button', { class: 'piccolo', onclick: async () => { if (await modifica(x)) { toast('Metodo salvato.', 'ok'); naviga(); } } }, 'Modifica') : null), descrivi(x.definizione))));
  };

  // ---------- import ----------
  G.PAGINE.import = async (par, resto) => {
    const tipo = resto[0];
    const NOMI = { attrezzature: 'attrezzature', dipendenti: 'dipendenti', formazione: 'formazione storica', soggetti: 'clienti e fornitori', nc: 'non conformità e azioni', documenti: 'elenco documenti' };
    if (!NOMI[tipo]) throw new Error('Importazione non riconosciuta.');
    if (!G.S.utente.admin) throw new Error('Le importazioni sono riservate agli amministratori.');
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' }), esito = h('div', {});
    const esegui = (prova_) => async e => prova(async () => {
      if (!file.files[0]) throw new Error('Scegli prima il file da importare.');
      const r = await api('import.esegui', { tipo, base64: await leggiFile(file.files[0]), prova: prova_ });
      esito.replaceChildren(h('div', { class: 'card' }, h('h2', {}, r.prova ? 'Verifica: nessun dato è stato modificato' : 'Importazione completata'),
        h('div', { class: 'tessere' }, [[r.valide, r.prova ? 'Righe valide' : 'Righe importate'], [r.doppioni, 'Doppioni saltati'], [r.errori.length, 'Righe con errori']].map(x => h('div', { class: 'tessera' }, h('div', { class: 'n' + (x[1].includes('errori') && x[0] ? ' rosso' : '') }, x[0]), h('div', { class: 'l' }, x[1])))),
        r.errori.length ? [h('h2', {}, 'Errori'), tabella([{ l: 'Foglio', v: x => x.foglio }, { l: 'Riga', v: x => x.riga }, { l: 'Problema', v: x => x.messaggio }], r.errori)] : null,
        r.avvisi.length ? [h('h2', {}, 'Avvisi'), tabella([{ l: 'Foglio', v: x => x.foglio }, { l: 'Riga', v: x => x.riga || '' }, { l: 'Avviso', v: x => x.messaggio }], r.avvisi)] : null));
      if (!r.prova) { G.OPZ = {}; toast('Importazione completata.', 'ok'); }
    }, e.currentTarget);
    return h('div', {}, titolo('Importa ' + NOMI[tipo]), h('div', { class: 'card' },
      h('p', {}, '1. Scarica il modello Excel e compilalo. 2. Premi "Verifica" per vedere cosa verrà importato, senza modificare nulla. 3. Premi "Importa".'),
      h('div', { class: 'barra' }, h('button', { onclick: e => prova(async () => { const f = await api('import.modello', { tipo }); scarica(f.nome, f.base64); }, e.currentTarget) }, '⬇ Scarica modello'), file,
        h('button', { onclick: esegui(true) }, 'Verifica'), h('button', { class: 'primario', onclick: esegui(false) }, 'Importa'))), esito);
  };

  // ---------- configurazione ed esportazione ----------
  G.PAGINE.config = async () => {
    const c = await api('config.leggi'), el = {};
    const campo = (k, l, tipo, op) => { let i;
      if (tipo === 'textarea') i = h('textarea', { value: c[k] ?? '' }); else if (tipo === 'select') i = h('select', {}, op.map(o => h('option', { value: o, selected: c[k] === o }, o))); else i = h('input', { type: tipo || 'text', value: c[k] ?? '' });
      el[k] = i; return h('div', { class: 'campo' + (tipo === 'textarea' ? ' pieno' : '') }, h('label', {}, l), i); };
    let logo = c.logo || '';
    const logoBox = h('div', { class: 'filecampo' });
    const disegnaLogo = () => { const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'nascosto' });
      inp.addEventListener('change', () => prova(async () => { const r = await api('file.carica', { nome: inp.files[0].name, base64: await leggiFile(inp.files[0]) }); logo = r.valore; disegnaLogo(); }));
      logoBox.replaceChildren(h('span', {}, logo ? logo.split('|')[1] : 'Nessun logo'), inp, h('button', { class: 'piccolo', onclick: () => inp.click() }, logo ? 'Sostituisci' : 'Carica logo (PNG o JPG)'), logo ? h('button', { class: 'piccolo', onclick: () => { logo = ''; disegnaLogo(); } }, 'Togli') : null); };
    disegnaLogo();
    const sez = (t, ...campi) => h('div', { class: 'card' }, h('h2', {}, t), h('div', { class: 'griglia' }, campi));
    return h('div', {}, titolo('Dati azienda e logo'),
      sez('Dati anagrafici', campo('ragioneSociale', 'Ragione sociale'), campo('indirizzo', 'Indirizzo'), campo('comune', 'Comune'), campo('piva', 'Partita IVA'), campo('cf', 'Codice fiscale'), campo('email', 'E-mail', 'email'), campo('telefono', 'Telefono'), campo('colore', 'Colore aziendale', 'color'),
        h('div', { class: 'campo' }, h('label', {}, 'Logo (usato nelle stampe)'), logoBox)),
      sez('Accesso e firme', campo('otpMinuti', 'Validità del codice di accesso (minuti, 3-30)', 'number'), campo('sessioneOre', 'Durata della sessione (ore, 1-6)', 'number'), campo('linkFirmaGiorni', 'Validità del link di firma (giorni)', 'number')),
      G.S.schema.Consegne ? sez('Consegne DPI', campo('emailDpi', 'E-mail a cui inviare i verbali', 'email'), campo('oggettoDpi', 'Oggetto dell\'e-mail ({NOME} e {DATA} vengono sostituiti)'), campo('dichiarazioneDpi', 'Dichiarazione riportata nel verbale', 'textarea')) : null,
      G.S.schema.QualificheFornitori ? sez('Fornitori', campo('sogliaQualifica', 'Soglia di qualifica (qualificato se la media è maggiore)', 'number')) : null,
      G.S.pacchetti.some(p => p.id === 'sanitaria') ? sez('Sorveglianza sanitaria', campo('accessoSanitaria', 'Chi può vedere i dati sanitari', 'select', ['Solo amministratori', 'Amministratori e utenti'])) : null,
      h('div', { class: 'barra' }, h('button', { class: 'primario', onclick: e => prova(async () => { const p = { logo }; for (const [k, i] of Object.entries(el)) p[k] = i.value; await api('config.salva', p); toast('Configurazione salvata.', 'ok'); G.S = await api('avvio'); document.documentElement.style.setProperty('--c', G.S.config.colore); naviga(); }, e.currentTarget) }, 'Salva')));
  };

  G.PAGINE.esporta = async () => {
    if (!G.S.utente.admin) throw new Error('L\'esportazione dei dati è riservata agli amministratori.');
    const pk = G.S.pacchetti.filter(p => p.id !== 'base').map(p => { const c = h('input', { type: 'checkbox', value: p.id }); c.checked = true; return h('label', {}, c, p.nome); });
    const all = h('input', { type: 'checkbox' }), codice = h('input', { class: 'codice', inputmode: 'numeric', maxlength: '6', placeholder: '······', 'aria-label': 'Codice di conferma' });
    return h('div', {}, titolo('Esporta i dati aziendali'), h('div', { class: 'card' },
      h('p', {}, 'Scarichi un archivio .zip con: un file Excel leggibile (un foglio per tabella), un file di ripristino completo e, se vuoi, gli allegati. I PIN di firma e i codici di accesso non vengono mai esportati.'),
      h('h2', {}, '1. Cosa esportare'), h('div', { class: 'multi' }, h('label', {}, h('input', { type: 'checkbox', checked: true, disabled: true }), 'Base (sempre incluso)'), pk), h('p', {}, h('label', {}, all, ' Includi anche gli allegati (documenti, attestati, firme)')),
      h('h2', {}, '2. Conferma'), h('p', { class: 'tenue' }, 'Per sicurezza ti inviamo un codice di conferma via e-mail.'),
      h('div', { class: 'barra' }, h('button', { onclick: e => prova(async () => { const r = await api('esporta.richiedi'); toast(r.messaggio); codice.focus(); }, e.currentTarget) }, 'Inviami il codice'), codice,
        h('button', { class: 'primario', onclick: e => prova(async () => {
          const r = await fetch('/a/' + encodeURIComponent(G.AZ) + '/esporta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': G.token() }, body: JSON.stringify({ codice: codice.value.trim(), allegati: all.checked, pacchetti: pk.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.value) }) });
          if ((r.headers.get('content-type') || '').includes('json')) throw new Error((await r.json()).error);
          const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '');
          salvaBlob(nome ? nome[1] : 'esportazione.zip', await r.blob()); toast('Archivio scaricato.', 'ok'); codice.value = '';
        }, e.currentTarget) }, '⬇ Scarica l\'archivio'))));
  };
})();
