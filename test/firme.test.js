'use strict';
// Test della fase 3: firme con tutti i metodi, PIN e blocchi, allegati e scarico protetto.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');

function postinoFinto() {
  const inviate = [];
  return { inviate, registro: [], configurata: true, async invia(m) { inviate.push(m); return true; } };
}
// Crea un PNG RGBA; con "tratto" disegna una linea scura, altrimenti resta tutto bianco.
function png(tratto) {
  const w = 60, h = 20, raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  if (tratto) for (let x = 5; x < 50; x++) { const o = 10 * (w * 4 + 1) + 1 + x * 4; raw[o] = raw[o + 1] = raw[o + 2] = 0; }
  const pezzo = (tipo, dati) => {
    const b = Buffer.alloc(12 + dati.length);
    b.writeUInt32BE(dati.length, 0); b.write(tipo, 4, 'latin1'); dati.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + dati.length)), 8 + dati.length);
    return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(raw)), pezzo('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + buf.toString('base64');
}

let db, posta, sis, ta, tp, mario, paola, luca, dpi;
const A = 'firme';
const api = (t, azione, par, ip) => sis.api(A, [t, azione, par || {}], ip || '9.9.9.9');
const rifiuta = (p, codice, testo) => assert.rejects(p, e => {
  assert.ok(e.utente, 'atteso un errore per l\'utente: ' + e.stack);
  if (codice) assert.equal(e.codice, codice);
  if (testo) assert.match(e.message, testo);
  return true;
});
async function accedi(email, ip) {
  await api(null, 'otp.richiedi', { email }, ip);
  const m = posta.inviate.filter(x => x.a === email && /Codice di accesso/.test(x.oggetto)).pop();
  return (await api(null, 'otp.verifica', { email, codice: /è: (\d{6})/.exec(m.testo)[1] }, ip)).token;
}
const nuovaConsegna = t => api(t, 'salva', { entita: 'Consegne', dati: { dipendenteId: luca, consegnatoDa: mario }, figli: { ConsegneRighe: [{ dpiId: dpi }] } });
const firmaDi = (scheda, ruolo) => scheda.find(f => f.ruolo === ruolo);

test.before(async () => {
  db = await apriDb({});
  posta = postinoFinto();
  sis = creaSistema({ db, postino: posta, adminKey: 'k', emailPiattaforma: 'fornitore@esempio.it' });
  await sis.admin('aziende.crea', { codice: A, nome: 'Firme Srl', classe: 2, pacchetti: ['dpi', 'formazione', 'nc'],
    admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@firme.it' } });
  ta = await accedi('mario@firme.it', '1.0.0.1');
  mario = (await api(ta, 'avvio')).utente.id;
  paola = (await api(ta, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Neri', nome: 'Paola', email: 'paola@firme.it', utente: 'SI', ruolo: 'Utente registrazioni' } })).riga.id;
  luca = (await api(ta, 'salva', { entita: 'Dipendenti', dati: { cognome: 'Verdi', nome: 'Luca' } })).riga.id;
  dpi = (await api(ta, 'salva', { entita: 'TipiDpi', dati: { codice: 'G1', descrizione: 'Guanti' } })).riga.id;
  tp = await accedi('paola@firme.it', '1.0.0.2');
});

test('credenziali: si firma solo a proprio nome; dopo la firma la scheda è in sola lettura', async () => {
  const c = await nuovaConsegna(ta);
  assert.equal(c.firme.length, 2);
  assert.equal(c.firmata, false);
  assert.deepEqual(firmaDi(c.firme, 'Incaricato della consegna').metodi, ['credenziali', 'disegno', 'scansione', 'link']);
  assert.deepEqual(firmaDi(c.firme, 'Lavoratore').metodi, ['disegno', 'scansione']); // Luca non ha PIN né e-mail
  const kInc = firmaDi(c.firme, 'Incaricato della consegna').key;
  await rifiuta(api(tp, 'firma', { entita: 'Consegne', id: c.riga.id, key: kInc, metodo: 'credenziali' }), '', /solo a tuo nome/);
  const st = await api(ta, 'firma', { entita: 'Consegne', id: c.riga.id, key: kInc, metodo: 'credenziali' });
  assert.equal(firmaDi(st, 'Incaricato della consegna').stato, 'Firmata');
  assert.equal(firmaDi(st, 'Incaricato della consegna').metodo, 'Credenziali di accesso');
  await rifiuta(api(ta, 'firma', { entita: 'Consegne', id: c.riga.id, key: kInc, metodo: 'credenziali' }), '', /già stata registrata/);
  await rifiuta(api(ta, 'salva', { entita: 'Consegne', dati: { id: c.riga.id, note: 'modifica' } }), 'FIRMATA');
  await rifiuta(api(ta, 'elimina', { entita: 'Consegne', id: c.riga.id }), 'FIRMATA');

  // Annullamento: solo amministratore, resta nel registro, la scheda torna modificabile.
  const firmaId = firmaDi(st, 'Incaricato della consegna').firmaId;
  await rifiuta(api(tp, 'firma.annulla', { firmaId }), 'PERMESSO');
  const dopo = await api(ta, 'firma.annulla', { firmaId, motivo: 'errore di persona' });
  assert.equal(firmaDi(dopo, 'Incaricato della consegna').stato, 'Da firmare');
  const reg = await api(ta, 'elenco', { entita: 'Firme' });
  const annullata = reg.righe.find(r => r.id === firmaId);
  assert.equal(annullata.stato, 'Annullata');
  assert.match(annullata.note, /errore di persona/);
  const mod = await api(ta, 'salva', { entita: 'Consegne', dati: { id: c.riga.id, note: 'modifica' } });
  assert.equal(mod.riga.note, 'modifica');
});

test('PIN: impostazione, firma, errori e blocchi (15 minuti dopo 5 errori, giornata dopo 10)', async () => {
  await rifiuta(api(tp, 'pin.imposta', { dipId: luca, pin: '1234' }), 'PERMESSO');
  await rifiuta(api(ta, 'pin.imposta', { dipId: luca, pin: '12' }), '', /4 a 8 cifre/);
  assert.deepEqual(await api(ta, 'pin.imposta', { dipId: luca, pin: '1234' }), { impostato: true });
  const generato = await api(ta, 'pin.imposta', { dipId: paola });
  assert.match(generato.pin, /^\d{6}$/);
  const scheda = await api(ta, 'leggi', { entita: 'Dipendenti', id: luca });
  assert.equal(scheda.riga.pinImpostato, 'SI');
  assert.equal(scheda.riga.pinHash, undefined);
  const grezzo = await db.query("select data from rows where tenant = $1 and sheet = 'Dipendenti' and id = $2", [A, luca]);
  assert.ok(!JSON.stringify(grezzo.rows[0].data).includes('"1234"'));

  const c = await nuovaConsegna(tp); // anche l'utente registrazioni raccoglie le firme
  const k = firmaDi(c.firme, 'Lavoratore').key;
  assert.ok(firmaDi(c.firme, 'Lavoratore').metodi.includes('pin'));
  const firmaPin = p => api(tp, 'firma', { entita: 'Consegne', id: c.riga.id, key: k, metodo: 'pin', pin: p });
  for (let i = 0; i < 5; i++) await rifiuta(firmaPin('0000'), '', /PIN non corretto/);
  await rifiuta(firmaPin('1234'), '', /temporaneamente bloccato/);
  const vero = Date.now;
  try {
    Date.now = () => vero() + 16 * 60000;
    for (let i = 0; i < 5; i++) await rifiuta(firmaPin('0000'), '', /PIN non corretto/);
    Date.now = () => vero() + 40 * 60000;
    await rifiuta(firmaPin('1234'), '', /bloccato per oggi/);
  } finally { Date.now = vero; }
  assert.ok(posta.inviate.some(m => /PIN di firma bloccato/.test(m.oggetto) && m.a === 'mario@firme.it'));
  await api(ta, 'accesso.sblocca', { dipId: luca });
  const st = await firmaPin('1234');
  assert.equal(firmaDi(st, 'Lavoratore').metodo, 'PIN del dipendente');

  // L'utente cambia il proprio PIN conoscendo quello attuale.
  await rifiuta(api(tp, 'pin.cambia', { attuale: '999999', nuovo: '4321' }), '', /attuale non è corretto/);
  await api(tp, 'pin.cambia', { attuale: generato.pin, nuovo: '4321' });
});

test('firma disegnata: immagine vuota rifiutata, immagine valida salvata e scaricabile solo da chi vede la scheda', async () => {
  const nc = await api(tp, 'salva', { entita: 'NC', dati: { descrizione: 'Prova firma' } });
  const k = nc.firme[0].key;
  assert.equal(nc.firme[0].nome, 'Neri Paola');
  await rifiuta(api(ta, 'firma', { entita: 'NC', id: nc.riga.id, key: k, metodo: 'disegno', immagine: png(false) }), '', /vuoto/);
  await rifiuta(api(ta, 'firma', { entita: 'NC', id: nc.riga.id, key: k, metodo: 'disegno', immagine: 'data:image/png;base64,AAAA' }), '', /non è valida/);
  const st = await api(ta, 'firma', { entita: 'NC', id: nc.riga.id, key: k, metodo: 'disegno', immagine: png(true) });
  assert.equal(st[0].metodo, 'Firma su schermo');
  const idFile = st[0].file.split('|')[0];
  const f = await sis.scaricaFile(A, tp, idFile);
  assert.equal(f.mime, 'image/png');
  assert.equal(await sis.scaricaFile(A, 'token-inventato', idFile), null);
  // Con il pacchetto NC disattivato la scheda non è più visibile, quindi nemmeno il file.
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['dpi', 'formazione'] });
  assert.equal(await sis.scaricaFile(A, tp, idFile), null);
  await sis.admin('aziende.aggiorna', { codice: A, pacchetti: ['dpi', 'formazione', 'nc'] });
});

test('allegati: tipi ammessi, file non ancora salvato visibile solo a chi l\'ha caricato', async () => {
  const pdf = Buffer.from('%PDF-1.4 prova').toString('base64');
  await rifiuta(api(ta, 'file.carica', { nome: 'virus.exe', base64: pdf }), '', /non ammesso/);
  await rifiuta(api(ta, 'file.carica', { nome: 'vuoto.pdf', base64: '' }), '', /vuoto/);
  const f = await api(ta, 'file.carica', { nome: 'C:\\cartella\\attestato|x.PDF', base64: pdf });
  assert.match(f.valore, /^[a-z0-9]{12}\|attestatox\.PDF$/);
  const id = f.valore.split('|')[0];
  assert.equal((await sis.scaricaFile(A, ta, id)).mime, 'application/pdf');
  assert.equal(await sis.scaricaFile(A, tp, id), null);
  await rifiuta(api(ta, 'salva', { entita: 'Corsi', dati: { titolo: 'X' }, figli: { CorsiPartecipanti: [{ dipendenteId: luca, attestato: 'inesistente00|a.pdf' }] } }), 'VALIDAZIONE');
});

test('corso: docente esterno firma dal link e-mail (monouso), attestato al posto della firma, scansione per più firmatari', async () => {
  const tipo = (await api(ta, 'salva', { entita: 'TipiCorso', dati: { tipo: 'Antincendio', area: 'Sicurezza' } })).riga.id;
  const att = await api(ta, 'file.carica', { nome: 'attestato-luca.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') });
  const corso = await api(ta, 'salva', { entita: 'Corsi', dati: { titolo: 'Antincendio 2026', tipoCorsoId: tipo }, figli: {
    CorsiDocenti: [{ tipo: 'Esterno', nominativo: 'Ing. Bruni', email: 'bruni@studio.it' }, { tipo: 'Dipendente', dipendenteId: mario }],
    CorsiPartecipanti: [{ dipendenteId: luca, attestato: att.valore }, { dipendenteId: paola }, { dipendenteId: mario }] } });
  assert.equal(corso.firme.length, 5);
  const est = corso.firme.find(f => f.esterno);
  assert.deepEqual(est.metodi, ['disegno', 'scansione', 'link']);
  assert.equal(corso.firme.find(f => f.nome === 'Verdi Luca').stato, 'Attestato caricato');
  // L'attestato salvato nella scheda è visibile anche agli altri utenti.
  assert.ok(await sis.scaricaFile(A, tp, att.valore.split('|')[0]));

  let st = await api(ta, 'firma.link', { entita: 'Corsi', id: corso.riga.id, key: est.key });
  assert.equal(st.find(f => f.esterno).stato, 'Link inviato');
  const mail = posta.inviate.filter(m => m.a === 'bruni@studio.it').pop();
  const token = /firma=([0-9a-f]{64})/.exec(mail.testo)[1];
  const righeDb = await db.query("select data from rows where tenant = $1 and sheet = 'Firme'", [A]);
  assert.ok(!JSON.stringify(righeDb.rows).includes(token)); // nel database c'è solo l'hash
  const info = await api(null, 'firmalink.info', { token });
  assert.equal(info.firmatario, 'Ing. Bruni');
  assert.match(info.documento, /Antincendio 2026/);
  await rifiuta(api(null, 'firmalink.info', { token: 'x'.repeat(64) }), '', /non è più valido/);
  await rifiuta(api(null, 'firmalink.firma', { token, immagine: png(false) }), '', /vuoto/);
  assert.deepEqual(await api(null, 'firmalink.firma', { token, immagine: png(true) }), { firmato: true });
  await rifiuta(api(null, 'firmalink.firma', { token, immagine: png(true) }), '', /non è più valido/);

  // Scansione del registro cartaceo: vale per più firmatari insieme.
  const scan = await api(tp, 'file.carica', { nome: 'registro.jpg', base64: Buffer.from('jpeg finto').toString('base64') });
  const corsoOra = await api(tp, 'leggi', { entita: 'Corsi', id: corso.riga.id });
  const chiavi = corsoOra.firme.filter(f => f.stato === 'Da firmare').map(f => f.key);
  assert.equal(chiavi.length, 3);
  await rifiuta(api(tp, 'firma.scansione', { entita: 'Corsi', id: corso.riga.id, keys: chiavi, file: 'inesistente00|x' }), '', /Carica prima/);
  st = await api(tp, 'firma.scansione', { entita: 'Corsi', id: corso.riga.id, keys: chiavi, file: scan.valore });
  assert.ok(st.every(f => f.stato === 'Firmata' || f.stato === 'Attestato caricato'));
  assert.equal(st.filter(f => f.metodo === 'Scansione cartacea').length, 3);
  const log = await api(ta, 'elenco', { entita: 'Log', q: 'Firma' });
  assert.ok(log.righe.length >= 5);
});

test('web: allegati oltre 1 MB solo con sessione valida; scarico con intestazione di sessione', async () => {
  const server = sis.app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const grande = Buffer.alloc(1.5 * 1024 * 1024, 65).toString('base64');
  const corpo = t => JSON.stringify({ fn: 'api', args: [t, 'file.carica', { nome: 'grande.pdf', base64: grande }] });
  try {
    let r = await fetch(base + '/a/' + A + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo(ta) });
    assert.equal(r.status, 413);
    r = await fetch(base + '/a/' + A + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': ta }, body: corpo(ta) });
    const j = await r.json();
    assert.equal(j.ok, true);
    const id = j.data.valore.split('|')[0];
    r = await fetch(base + '/a/' + A + '/file/' + id);
    assert.equal(r.status, 404);
    r = await fetch(base + '/a/' + A + '/file/' + id, { headers: { 'X-Session': ta } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /attachment/);
    assert.equal((await r.arrayBuffer()).byteLength, 1.5 * 1024 * 1024);
  } finally { server.close(); }
});
