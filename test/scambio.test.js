'use strict';
// Test delle fasi 5 e 6: Excel/CSV, i sei import, stampe PDF, export ed esportazione dei dati aziendali.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { unzipSync, strFromU8 } = require('fflate');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');
const xlsx = require('../server/xlsx');
const { STAMPE } = require('../app/stampe');
const { oggi } = require('../app/engine');

const A = 'scambio';
let db, sis, posta, ta, tu, mario, sede, mansione;
const api = (t, azione, par) => sis.api(A, [t, azione, par || {}], '6.6.6.6');
const S = (entita, dati, figli) => api(ta, 'salva', { entita, dati, figli });
const E = async (entita, q) => (await api(ta, 'elenco', { entita, q })).righe;
const b64 = fogli => xlsx.scrivi(fogli).toString('base64');
const importa = (tipo, fogli, prova) => api(ta, 'import.esegui', { tipo, base64: Buffer.isBuffer(fogli) ? fogli.toString('base64') : b64(fogli), prova });
const rifiuta = (p, codice, testo) => assert.rejects(p, e => {
  assert.ok(e.utente, 'atteso un errore per l\'utente: ' + (e.stack || JSON.stringify(e)));
  if (codice) assert.equal(e.codice, codice);
  if (testo) assert.match(e.message, testo);
  return true;
});
async function accedi(azienda, email, ip) {
  await sis.api(azienda, [null, 'otp.richiedi', { email }], ip);
  const m = posta.inviate.filter(x => x.a === email && /Codice di accesso/.test(x.oggetto)).pop();
  return (await sis.api(azienda, [null, 'otp.verifica', { email, codice: /è: (\d{6})/.exec(m.testo)[1] }], ip)).token;
}
function png() {
  const w = 60, h = 20, raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  for (let x = 5; x < 50; x++) { const o = 10 * (w * 4 + 1) + 1 + x * 4; raw[o] = raw[o + 1] = raw[o + 2] = 0; }
  const pezzo = (tipo, dati) => { const b = Buffer.alloc(12 + dati.length); b.writeUInt32BE(dati.length, 0); b.write(tipo, 4, 'latin1'); dati.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + dati.length)), 8 + dati.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(raw)), pezzo('IEND', Buffer.alloc(0))]).toString('base64');
}
const TUTTI = ['dpi', 'formazione', 'competenze', 'sanitaria', 'nc', 'attrezzature', 'fornitori', 'strumenti', 'documenti', 'rischi'];

test.before(async () => {
  db = await apriDb({});
  posta = { inviate: [], registro: [], async invia(m) { this.inviate.push(m); return true; } };
  sis = creaSistema({ db, postino: posta, adminKey: 'k' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Scambio Srl', classe: 1, pacchetti: TUTTI, admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@scambio.it' } });
  ta = await accedi(A, 'mario@scambio.it', '1.0.0.1');
  mario = (await api(ta, 'avvio')).utente.id;
  sede = (await S('Sedi', { codice: 'S1', denominazione: 'Sede', responsabileId: mario })).riga.id;
  mansione = (await S('Mansioni', { codice: 'OP', descrizione: 'Operaio', sorveglianza: 'SI' })).riga.id;
  await S('Dipendenti', { cognome: 'Neri', nome: 'Paola', cf: 'NREPLA80A41H501X', email: 'paola@scambio.it', utente: 'SI', ruolo: 'Utente registrazioni', mansioneId: mansione });
  tu = await accedi(A, 'paola@scambio.it', '1.0.0.2');
});

test('Excel e CSV: scrittura e lettura conservano testi, accenti, numeri e fogli', () => {
  const fogli = xlsx.leggi(xlsx.scrivi([{ nome: 'Dati: prova/1', righe: [['Nome', 'Età', 'Note'], ['Città & <Più>', 42, ''], ['', 3.5, 'riga "due"']] }, { nome: 'Secondo', righe: [['x']] }]));
  assert.deepEqual(fogli.map(f => f.nome), ['Dati  prova 1', 'Secondo']);
  assert.deepEqual(fogli[0].righe, [['Nome', 'Età', 'Note'], ['Città & <Più>', 42], ['', 3.5, 'riga "due"']]);
  const csv = xlsx.leggi(Buffer.from('﻿Cognome;Nome;Note\r\nRossi;Mario;"testo con ; e ""virgolette"""\r\n'));
  assert.deepEqual(csv[0].righe, [['Cognome', 'Nome', 'Note'], ['Rossi', 'Mario', 'testo con ; e "virgolette"']]);
});

test('import dipendenti: modello, verifica senza scrittura, importa, doppioni e limite di licenza', async () => {
  const mod = await api(ta, 'import.modello', { tipo: 'dipendenti' });
  const fm = xlsx.leggi(Buffer.from(mod.base64, 'base64'));
  assert.deepEqual(fm.map(f => f.nome), ['Dipendenti', 'Elenco Mansioni', 'Elenco Sedi', 'Istruzioni']);
  assert.equal(fm[0].righe[0][2], 'Codice fiscale*');
  assert.deepEqual(fm[1].righe[1], ['OP', 'Operaio']);
  await rifiuta(api(tu, 'import.modello', { tipo: 'dipendenti' }), 'PERMESSO');

  const cf = n => 'XXXYYY80A01H50' + String(n).padStart(2, '0');
  const righe = [fm[0].righe[0], fm[0].righe[1],                                             // intestazioni + riga "(esempio)"
    ['Verdi', 'Luca', cf(1), '', 'op', 's1', 'Tempo indeterminato', 44197, ''],              // data come numero di Excel
    ['Blu', 'Sara', cf(2), 'sara@scambio.it', '', '', '', '15/03/2022', ''],
    ['Senza', 'Codice', '', '', '', '', '', '', ''],
    ['Data', 'Sbagliata', cf(3), '', '', '', '', '31/02/2022', ''],
    ['Mansione', 'Ignota', cf(4), '', 'ZZZ', '', '', '', ''],
    ['Verdi', 'Luca bis', cf(1), '', '', '', '', '', '']];
  const prima = (await E('Dipendenti')).length;
  const prova = await importa('dipendenti', [{ nome: 'Dipendenti', righe }], true);
  assert.deepEqual([prova.prova, prova.valide, prova.doppioni, prova.errori.length], [true, 2, 1, 3]);
  assert.deepEqual(prova.errori.map(e => e.riga), [5, 6, 7]);
  assert.match(prova.errori[1].messaggio, /data "31\/02\/2022" non valida/);
  assert.match(prova.errori[2].messaggio, /Codice mansione "ZZZ" non trovato/);
  assert.equal((await E('Dipendenti')).length, prima);                                       // la verifica non scrive nulla
  const vero = await importa('dipendenti', [{ nome: 'Dipendenti', righe }]);
  assert.deepEqual([vero.prova, vero.valide, vero.doppioni, vero.errori.length], [false, 2, 1, 3]);
  const luca = (await E('Dipendenti', 'Verdi'))[0];
  assert.deepEqual([luca.dataAssunzione, luca.mansioneId, luca.sedeId], ['2021-01-01', mansione, sede]);
  assert.equal((await importa('dipendenti', [{ nome: 'Dipendenti', righe }])).doppioni, 3);

  // Classe 0-9: ci sono 4 addetti, ne entrano altri 5; il sesto è bloccato dalla licenza.
  const tanti = [righe[0], ...Array.from({ length: 6 }, (_, i) => ['Addetto', 'N' + i, cf(10 + i), '', '', '', '', '', ''])];
  const lic = await importa('dipendenti', [{ nome: 'Dipendenti', righe: tanti }]);
  assert.deepEqual([lic.valide, lic.errori.length, lic.errori[0].licenza], [5, 1, true]);
  assert.match(lic.errori[0].messaggio, /estendere la licenza/);
  assert.ok((await E('Log', 'Importazione')).length >= 2);
  await sis.admin('aziende.aggiorna', { codice: A, classe: 2 });
});

test('import formazione storica (da CSV): i partecipanti finiscono nello stesso corso, senza firme', async () => {
  await S('TipiCorso', { tipo: 'Antincendio', area: 'Sicurezza' });
  const csv = Buffer.from(['CF dipendente;Tipologia corso;Modalità;Data inizio;Data fine;Ore;Titolo;Ente/docente',
    'XXXYYY80A01H5001;antincendio;;;10/03/2021;4;;Ente Srl', 'Sara Blu;Antincendio;;;10/03/2021;4;;Ente Srl', 'Blu Sara;Antincendio;;;10/03/2021;4;;Ente Srl',
    'Nessuno Mai;Antincendio;;;10/03/2021;4;;', 'XXXYYY80A01H5001;Corso inesistente;;;10/03/2021;4;;'].join('\r\n'));
  const r = await importa('formazione', csv);
  assert.deepEqual([r.valide, r.doppioni, r.errori.length], [2, 1, 2]);
  const corsi = await E('Corsi');
  assert.equal(corsi.length, 1);
  const c = await api(ta, 'leggi', { entita: 'Corsi', id: corsi[0].id });
  assert.deepEqual([c.riga.importato, c.riga.titolo, c.riga.nPartecipanti, c.firme.length], ['SI', 'Antincendio 10/03/2021', '2', 0]);
  const di_nuovo = await importa('formazione', csv);
  assert.deepEqual([di_nuovo.valide, di_nuovo.doppioni], [0, 3]);
});

test('import clienti/fornitori con valutazioni, NC con azioni, attrezzature', async () => {
  let r = await importa('soggetti', [
    { nome: 'Soggetti', righe: [['Ragione sociale*', 'P.IVA', 'Fornitore (Sì/No)', 'Cliente'], ['Acciai Srl', '01234567890', 'Sì', 'No'], ['ACCIAI S.R.L.', '', 'X', ''], ['Cliente Uno Spa', 9876543210, 'no', 'sì']] },
    { nome: 'Valutazioni', righe: [['Fornitore*', 'Data*', 'Punteggio medio', 'Esito', 'Valutatore'], ['acciai srl', '15/01/2025', '7,5', 'qualificato', 'Mario Rossi'], ['Ignoto Srl', '15/01/2025', 5, '', '']] }]);
  assert.deepEqual([r.perFoglio.Soggetti.valide, r.perFoglio.Soggetti.doppioni, r.perFoglio.Valutazioni.valide, r.errori.length], [2, 1, 1, 1]);
  const acciai = (await E('Soggetti', 'Acciai'))[0];
  assert.deepEqual([acciai.qualifica, acciai.mediaQualifica, acciai.dataQualifica], ['Qualificato', '7,50', '2025-01-15']);
  assert.equal((await api(ta, 'leggi', { entita: 'QualificheFornitori', id: (await E('QualificheFornitori'))[0].id })).firme.length, 0);

  r = await importa('nc', [
    { nome: 'NC', righe: [['Numero', 'Data*', 'Stato', 'Reclamo', 'Tipologia', 'Redatto da', 'Descrizione*', 'Rilevato da', 'Rilevatore', 'Costo totale'],
      ['NC-2024-007', '12/04/2024', 'chiusa', 'Sì', 'Logistica', 'Rossi Mario', 'Consegna in ritardo', 'Fornitore', 'Acciai Srl', '120,50'], ['', '20/05/2024', '', '', '', 'Sconosciuto', 'Senza numero', 'Cliente', 'Sig. Bianchi', ''],
      ['NC-2024-008', '', '', '', '', '', 'Manca la data', '', '', '']] },
    { nome: 'Azioni', righe: [['Numero NC', 'Numero azione', 'Stato', 'Descrizione*', 'Responsabile'], ['NC-2024-007', 'AZ-2024-003', 'Chiusa', 'Cambio fornitore', 'Mario Rossi'], ['NC-9999-001', '', '', 'NC inesistente', '']] }]);
  assert.deepEqual([r.perFoglio.NC.valide, r.perFoglio.NC.errori, r.perFoglio.Azioni.valide, r.perFoglio.Azioni.errori, r.avvisi.length], [2, 1, 1, 1, 1]);
  const nc = await api(ta, 'leggi', { entita: 'NC', id: (await E('NC', 'NC-2024-007'))[0].id });
  assert.deepEqual([nc.riga.stato, nc.riga.costoTotale, nc.riga.rilevatoreSoggId, nc.riga.redattoDa, nc.riga.importata, nc.firme.length], ['Chiusa', '120,50', acciai.id, mario, 'SI', 0]);
  assert.match((await E('NC', 'Senza numero'))[0].numero, /^NC-\d{4}-001$/);
  assert.equal((await E('Elenchi', 'Logistica')).length, 1);                                // tipologia nuova aggiunta all'elenco
  assert.equal((await E('Azioni'))[0].ncId, nc.riga.id);

  await S('TipiAttrezzatura', { codice: 'CAR', descrizione: 'Carrelli' });
  r = await importa('attrezzature', [{ nome: 'Attrezzature', righe: [['Codice*', 'Descrizione*', 'Codice tipologia*', 'Codice sede*', 'P.IVA fornitore', 'Stato'],
    ['A1', 'Carrello 1', 'CAR', 'S1', '01234567890', 'fuori servizio'], ['A2', 'Carrello 2', 'CAR', 'S9', '', ''], ['A1', 'Doppio', 'CAR', 'S1', '', '']] }]);
  assert.deepEqual([r.valide, r.doppioni, r.errori.length], [1, 1, 1]);
  assert.deepEqual([(await E('Attrezzature'))[0].stato, (await E('Attrezzature'))[0].fornitoreId], ['Fuori servizio', acciai.id]);
  await rifiuta(importa('attrezzature', [{ nome: 'Attrezzature', righe: [['Codice*', 'Descrizione*']] }]), '', /mancano le colonne obbligatorie: Codice tipologia, Codice sede/);
  await rifiuta(importa('attrezzature', Buffer.from('PK\u0003\u0004 non è un file excel')), '', /Non riesco a leggere il file/);
});

test('import documenti: la revisione più alta va in vigore, collegamenti, distribuzione a richiesta', async () => {
  const r = await importa('documenti', [
    { nome: 'Documenti', righe: [['Codice*', 'Titolo*', 'Revisione*', 'Data revisione*', 'Approvato da', 'Stato', 'Codici mansioni destinatarie'],
      ['PR-01', 'Gestione ordini', '0', '10/01/2023', 'Mario Rossi', '', 'OP'], ['PR-01', 'Gestione ordini', '1', '10/01/2025', 'Chi Lo Sa', '', 'OP'],
      ['MOD-01', 'Modulo ordine', 'A', '05/05/2024', 'Mario Rossi', 'Bozza', ''], ['PR-02', 'Mansione ignota', '0', '10/01/2025', '', '', 'XYZ']] },
    { nome: 'Collegamenti', righe: [['Codice documento*', 'Tipo', 'Codice collegato*'], ['PR-01', 'modulo da usare', 'MOD-01'], ['PR-01', '', 'NON-C-E']] }]);
  assert.deepEqual([r.perFoglio.Documenti.valide, r.perFoglio.Documenti.errori, r.perFoglio.Collegamenti.valide, r.perFoglio.Collegamenti.errori], [3, 1, 1, 1]);
  assert.ok(r.avvisi.some(a => /Approvato da "Chi Lo Sa" non trovato/.test(a.messaggio)));
  const docs = await E('Documenti');
  const stato = (c, rev) => docs.find(d => d.codice === c && d.revisione === rev).stato;
  assert.deepEqual([stato('PR-01', '0'), stato('PR-01', '1'), stato('MOD-01', 'A')], ['Superato', 'In vigore', 'Bozza']);
  const pr1 = docs.find(d => d.codice === 'PR-01' && d.revisione === '1');
  const scheda = await api(ta, 'leggi', { entita: 'Documenti', id: pr1.id });
  assert.deepEqual([scheda.riga.importato, scheda.firme.length, scheda.figli.DocumentiCollegamenti.length], ['SI', 0, 1]);
  assert.equal((await E('PreseVisione')).length, 0);                                         // nessuna distribuzione automatica
  const dist = await api(ta, 'funzione', { nome: 'documenti.distribuisci', id: pr1.id });
  assert.equal(dist.create, 2);                                                              // Paola e Luca hanno la mansione OP
});

test('stampe: tutte le 23 stampe producono un PDF valido; permessi rispettati', async () => {
  const guanti = (await S('TipiDpi', { codice: 'G', descrizione: 'Guanti – taglia “M”' })).riga.id;
  const luca = (await E('Dipendenti', 'Verdi'))[0].id;
  const cons = await S('Consegne', { dipendenteId: luca }, { ConsegneRighe: [{ dpiId: guanti, quantita: 2 }] });
  await api(ta, 'firma', { entita: 'Consegne', id: cons.riga.id, key: cons.firme[0].key, metodo: 'disegno', immagine: png() });
  await api(ta, 'firma', { entita: 'Consegne', id: cons.riga.id, key: cons.firme[1].key, metodo: 'credenziali' });
  const comp = (await S('Competenze', { area: 'Tecniche', descrizione: 'Saldatura' })).riga.id;
  const val = (await S('ValutazioniCompetenze', { dipendenteId: luca, mansioneId: [mansione] }, { ValutazioniRighe: [{ competenzaId: comp, valoreAtteso: '3', valoreReale: '4' }] })).riga.id;
  const attr = (await E('Attrezzature'))[0].id;
  const att = (await S('Attrezzature', { id: attr }, { AttrezzatureAttivita: [{ attivita: 'Controllo', frequenza: 6, unita: 'Mesi' }] })).figli.AttrezzatureAttivita[0].id;
  const man = (await S('Manutenzioni', { attrezzaturaId: attr, esecutoreDipId: mario }, { ManutenzioniRighe: [{ attivitaId: att }] })).riga.id;
  const camp = (await S('Strumenti', { codice: 'C1', descrizione: 'Campione', campione: 'SI', ema: 0.001, frequenzaMesi: 12 })).riga.id;
  const str = (await S('Strumenti', { codice: 'S1', descrizione: 'Calibro', ema: 0.05, frequenzaMesi: 12 })).riga.id;
  const tar = (await S('Tarature', { strumentoId: str, campioneId: camp }, { TaratureRighe: [{ punto: '10', valoreCampione: 10, valoreStrumento: 10.01 }] })).riga.id;
  await S('SorveglianzaSanitaria', { dipendenteId: luca, tipologia: 'Periodica', giudizio: 'Idoneo' });
  await S('Dipendenti', { cognome: 'Gru', nome: 'Ugo', tipoRapporto: 'Interinale (somministrazione)', agenziaId: (await E('Soggetti', 'Acciai'))[0].id, inizioMissione: '2026-01-01' });
  const id = { verbaleConsegna: cons.riga.id, registroCorso: (await E('Corsi'))[0].id, moduloNc: (await E('NC', 'NC-2024-007'))[0].id, valutazione: val, rapportoManutenzione: man,
    schedaAttrezzatura: attr, storicoAttrezzatura: attr, schedaDpi: guanti, schedaMansione: mansione, moduloQualifica: (await E('QualificheFornitori'))[0].id, rapportoTaratura: tar,
    schedaStrumento: str, schedaDocumento: (await E('Documenti', 'PR-01')).find(d => d.stato === 'In vigore').id, storicoDipendente: luca };
  const registro = (await api(ta, 'funzione', { nome: 'rischi.metodi' })).registri.find(r => r.codice === 'QUALITA').id;
  await api(ta, 'funzione', { nome: 'rischi.salva', registroId: registro, descrizione: 'Ritardo del fornitore critico', valori: { P: 2, G: 3 } });
  id.pianoRischi = registro;
  assert.equal(Object.keys(STAMPE).length, 23);
  for (const nome of Object.keys(STAMPE)) {
    const f = await api(ta, 'stampa', { nome, id: id[nome] });
    const buf = Buffer.from(f.base64, 'base64');
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-', nome);
    assert.ok(buf.length > 1500 && /%%EOF\s*$/.test(buf.subarray(-10).toString()), nome + ': PDF incompleto');
    assert.match(f.nome, /\.pdf$/);
  }
  const conFirma = Buffer.from((await api(ta, 'stampa', { nome: 'verbaleConsegna', id: cons.riga.id })).base64, 'base64');
  const senza = Buffer.from((await api(ta, 'stampa', { nome: 'schedaDpi', id: guanti })).base64, 'base64');
  assert.ok(conFirma.includes('/Subtype /Image') && !senza.includes('/Subtype /Image'));     // l'immagine della firma è nel verbale
  await rifiuta(api(tu, 'stampa', { nome: 'schedaDocumento', id: id.schedaDocumento }), 'PERMESSO');
  await rifiuta(api(tu, 'stampa', { nome: 'registroSanitario' }), 'PERMESSO');
  await rifiuta(api(ta, 'stampa', { nome: 'inesistente' }), '', /non riconosciuta/);
  assert.equal((await api(tu, 'scheda.dipendente', { id: luca })).sanitaria, undefined);     // sezione sanitaria solo se autorizzati
  assert.equal((await api(ta, 'scheda.dipendente', { id: luca })).sanitaria.giudizio, 'Idoneo');

  // Verbale DPI via e-mail, con il PDF allegato e la data annotata.
  await rifiuta(api(ta, 'consegna.email', { id: cons.riga.id }), '', /manca l'indirizzo/);
  await sis.archivio.conAzienda(A, async st => st.setProp('config', { ...(st.prop('config') || {}), emailDpi: 'rspp@scambio.it' }));
  await api(ta, 'consegna.email', { id: cons.riga.id });
  const m = posta.inviate.find(x => x.a === 'rspp@scambio.it');
  assert.match(m.oggetto, /^CONSEGNA DPI Verdi Luca E \d\d\/\d\d\/\d{4}$/);
  assert.equal(m.allegati[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await api(ta, 'leggi', { entita: 'Consegne', id: cons.riga.id })).riga.emailInviata);
});

test('export Excel: scheda dipendente, registro strumenti, registro sanitario; clonazione mansione', async () => {
  const luca = (await E('Dipendenti', 'Verdi'))[0].id;
  const leggi = async par => xlsx.leggi(Buffer.from((await api(ta, 'esporta', par)).base64, 'base64'));
  const scheda = await leggi({ nome: 'dipendente.scheda', id: luca });
  assert.deepEqual(scheda.map(f => f.nome), ['Anagrafica', 'DPI consegnati', 'Formazione', 'Valutazioni', 'Documenti', 'Sorveglianza sanitaria']);
  assert.deepEqual(scheda[0].righe.find(r => r[0] === 'Mansione'), ['Mansione', 'OP Operaio']);
  assert.equal(scheda[2].righe[1][0], 'Antincendio');
  assert.deepEqual((await leggi({ nome: 'strumenti.registro' }))[0].righe.slice(1).map(r => r[0]), ['C1', 'S1']);
  const sanitario = (await leggi({ nome: 'sanitaria.registro' }))[0].righe;
  assert.deepEqual(sanitario.slice(1).map(r => [r[0], r[2]]), [['Neri Paola', 'Visita mancante'], ['Verdi Luca', 'Regolare']]);
  await rifiuta(api(tu, 'esporta', { nome: 'sanitaria.registro' }), 'PERMESSO');
  const utenteScheda = xlsx.leggi(Buffer.from((await api(tu, 'esporta', { nome: 'dipendente.scheda', id: luca })).base64, 'base64'));
  assert.ok(!utenteScheda.some(f => f.nome === 'Sorveglianza sanitaria'));

  await S('Mansioni', { id: mansione }, { MansioniDpi: [{ dpiId: (await E('TipiDpi'))[0].id, quantita: 2 }] });
  await rifiuta(api(ta, 'funzione', { nome: 'mansioni.clona', id: mansione, codice: 'OP' }), 'VALIDAZIONE');
  const clone = await api(ta, 'funzione', { nome: 'mansioni.clona', id: mansione, codice: 'OP2' });
  assert.deepEqual([clone.riga.descrizione, clone.riga.sorveglianza, clone.figli.MansioniDpi.length], ['Operaio (copia)', 'SI', 1]);
});

test('esportazione dei dati aziendali: conferma con codice, contenuto dell\'archivio, pacchetti scelti, ripristino', async () => {
  await rifiuta(sis.esportaPerAzienda(A, ta, { codice: '000000' }), '', /Codice di conferma/);
  await rifiuta(api(tu, 'esporta.richiedi'), 'PERMESSO');
  const codice = async () => { await api(ta, 'esporta.richiedi'); return /è: (\d{6})/.exec(posta.inviate.filter(m => /esportazione/.test(m.oggetto)).pop().testo)[1]; };
  await rifiuta(sis.esportaPerAzienda(A, tu, { codice: await codice() }), 'PERMESSO');
  const f = await sis.esportaPerAzienda(A, ta, { codice: await codice(), allegati: true });
  assert.equal(f.nome, A + '_' + oggi() + '.zip');
  const z = unzipSync(new Uint8Array(f.buffer));
  assert.match(strFromU8(z['LEGGIMI.txt']), /Scambio Srl/);
  const fogli = xlsx.leggi(Buffer.from(z['dati-leggibili.xlsx']));
  for (const n of ['Dipendenti', 'Non conformità e reclami', 'Documenti', 'Sorveglianza sanitaria', 'Registro firme']) assert.ok(fogli.some(x => x.nome === n), 'manca il foglio ' + n);
  const dip = fogli.find(x => x.nome === 'Dipendenti');
  assert.ok(dip.righe[0].includes('Cognome') && !dip.righe[0].some(h => /pin(Hash|Salt)/i.test(h)));
  const dati = JSON.parse(strFromU8(z['dati-ripristino.json']));
  assert.equal(dati.formato, 'gestionale-sq');
  await api(ta, 'pin.imposta', { dipId: mario, pin: '1234' });
  const f2 = await sis.esportaPerAzienda(A, ta, { codice: await codice(), pacchetti: ['nc'] });
  const z2 = unzipSync(new Uint8Array(f2.buffer));
  const d2 = JSON.parse(strFromU8(z2['dati-ripristino.json']));
  assert.ok(d2.tabelle.NC.length && d2.tabelle.Dipendenti.length && !d2.tabelle.Corsi && !d2.tabelle.SorveglianzaSanitaria);
  assert.ok(!JSON.stringify(d2).includes('pinHash'));                                         // i PIN non vengono mai esportati
  assert.ok(!Object.keys(z2).some(k => k.startsWith('allegati/')));
  const allegati = Object.keys(z).filter(k => k.startsWith('allegati/'));
  assert.equal(allegati.length, 1);                                                          // l'immagine della firma su schermo
  await rifiuta(sis.esportaPerAzienda(A, ta, { codice: '123456' }), '', /Codice di conferma/);
  assert.ok((await E('Log', 'Esportazione dati')).length >= 2);

  // Dalla piattaforma: esportazione completa e ripristino in una nuova azienda.
  const fp = await sis.esportaDaPiattaforma(A, { allegati: true });
  await rifiuta(sis.admin('aziende.ripristina', { codice: 'copia', classe: 1, archivio: fp.buffer.toString('base64') }), '', /serve una classe più alta/);
  await rifiuta(sis.admin('aziende.ripristina', { codice: 'copia', archivio: Buffer.from('non uno zip').toString('base64') }), '', /non è un'esportazione valida/);
  const rip = await sis.admin('aziende.ripristina', { codice: 'copia', archivio: fp.buffer.toString('base64') });
  assert.equal(rip.allegati, 1);
  const tc = await accedi('copia', 'mario@scambio.it', '1.0.0.9');
  const elenco = async (t, az, e) => (await sis.api(az, [t, 'elenco', { entita: e }], '6.6.6.6')).righe.length;
  for (const e of ['Dipendenti', 'NC', 'Corsi', 'Documenti', 'PreseVisione', 'Tarature', 'Firme', 'Rischi', 'MetodiRischio']) assert.equal(await elenco(tc, 'copia', e), await elenco(ta, A, e), e);
  const consegna = (await sis.api('copia', [tc, 'elenco', { entita: 'Consegne' }], '6.6.6.6')).righe[0];
  const firmata = await sis.api('copia', [tc, 'leggi', { entita: 'Consegne', id: consegna.id }], '6.6.6.6');
  assert.equal(firmata.firmata, true);
  assert.equal((await sis.scaricaFile('copia', tc, firmata.firme[0].file.split('|')[0])).mime, 'image/png');
  const az = (await sis.admin('aziende.elenco')).find(a => a.codice === 'copia');
  assert.deepEqual([az.licenza.classe, az.pacchetti.length], [2, 10]);
});

test('web: l\'archivio si scarica solo con sessione e codice, oppure con la chiave della piattaforma', async () => {
  const server = sis.app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, corpo, h) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(corpo) });
  try {
    let r = await post('/a/' + A + '/esporta', { codice: '111111' }, { 'X-Session': ta });
    assert.equal((await r.json()).ok, false);
    await api(ta, 'esporta.richiedi');
    const codice = /è: (\d{6})/.exec(posta.inviate.filter(m => /esportazione/.test(m.oggetto)).pop().testo)[1];
    r = await post('/a/' + A + '/esporta', { codice }, { 'X-Session': ta });
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.ok(unzipSync(new Uint8Array(await r.arrayBuffer()))['dati-ripristino.json']);
    r = await post('/admin/esporta', { codice: A }, { 'X-Admin-Key': 'sbagliata' });
    assert.equal(r.status, 401);
    r = await post('/admin/esporta', { codice: A }, { 'X-Admin-Key': 'k' });
    assert.equal(r.headers.get('content-type'), 'application/zip');
  } finally { server.close(); }
});
