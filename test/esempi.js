'use strict';
// Genera file di esempio (cartella esempi/) da un'azienda dimostrativa in memoria:  node test/esempi.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { apriDb } = require('../server/db');
const { creaSistema } = require('../server/sistema');

function firmaPng() {
  const w = 240, h = 70, raw = Buffer.alloc((w * 4 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  const punto = (x, y) => { for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) { const o = (y + dy) * (w * 4 + 1) + 1 + (x + dx) * 4; raw[o] = raw[o + 1] = 20; raw[o + 2] = 90; } };
  for (let x = 12; x < 225; x++) punto(x, Math.round(35 + 18 * Math.sin(x / 9) * Math.cos(x / 31)));
  const pezzo = (tipo, dati) => { const b = Buffer.alloc(12 + dati.length); b.writeUInt32BE(dati.length, 0); b.write(tipo, 4, 'latin1'); dati.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + dati.length)), 8 + dati.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(raw)), pezzo('IEND', Buffer.alloc(0))]).toString('base64');
}

(async () => {
  const posta = { inviate: [], registro: [], async invia(m) { this.inviate.push(m); return true; } };
  const sis = creaSistema({ db: await apriDb({}), postino: posta, adminKey: 'k' });
  const A = 'rossi';
  await sis.admin('aziende.crea', { codice: A, nome: 'Rossi Impianti Srl', classe: 2, pacchetti: ['dpi', 'nc', 'strumenti', 'formazione'], admin: { cognome: 'Rossi', nome: 'Mario', email: 'mario@rossi.it' } });
  await sis.api(A, [null, 'otp.richiedi', { email: 'mario@rossi.it' }], '1');
  const t = (await sis.api(A, [null, 'otp.verifica', { email: 'mario@rossi.it', codice: /è: (\d{6})/.exec(posta.inviate.pop().testo)[1] }], '1')).token;
  const api = (azione, par) => sis.api(A, [t, azione, par || {}], '1');
  const S = (entita, dati, figli) => api('salva', { entita, dati, figli });
  await sis.archivio.conAzienda(A, async st => st.setProp('config', { ragioneSociale: 'Rossi Impianti Srl', indirizzo: 'Via dell\'Industria 12', comune: '20100 Milano (MI)', piva: '01234567890', email: 'info@rossi.it', telefono: '02 1234567' }));
  const io = (await api('avvio')).utente.id;
  const mans = (await S('Mansioni', { codice: 'OP', descrizione: 'Operaio di produzione' })).riga.id;
  const luca = (await S('Dipendenti', { cognome: 'Verdi', nome: 'Luca', cf: 'VRDLCU85C10F205X', mansioneId: mans, dataAssunzione: '2019-04-01' })).riga.id;
  const dpi = [];
  for (const [codice, descrizione, normativa] of [['G-01', 'Guanti antitaglio', 'EN 388'], ['S-01', 'Scarpe antinfortunistiche S3', 'EN ISO 20345'], ['O-01', 'Occhiali di protezione', 'EN 166']]) dpi.push((await S('TipiDpi', { codice, descrizione, normativa })).riga.id);
  const c = await S('Consegne', { dipendenteId: luca, note: 'Sostituzione per usura.' }, { ConsegneRighe: [{ dpiId: dpi[0], quantita: 2, taglia: '9' }, { dpiId: dpi[1], quantita: 1, taglia: '43' }, { dpiId: dpi[2], quantita: 1 }] });
  await api('firma', { entita: 'Consegne', id: c.riga.id, key: c.firme[0].key, metodo: 'disegno', immagine: firmaPng() });
  await api('firma', { entita: 'Consegne', id: c.riga.id, key: c.firme[1].key, metodo: 'credenziali' });
  await S('NC', { descrizione: 'Lotto 2231 con quote fuori tolleranza', tipologia: 'Prodotto', reclamo: 'SI' }, { NcCosti: [{ descrizione: 'Rilavorazione', quantita: 3, costo: 45 }] });
  const camp = (await S('Strumenti', { codice: 'CAMP-01', descrizione: 'Blocchetti piano-paralleli', campione: 'SI', ema: 0.001, frequenzaMesi: 24, matricola: 'BP-7781' })).riga.id;
  const cal = (await S('Strumenti', { codice: 'CAL-01', descrizione: 'Calibro digitale 150 mm', ema: 0.03, frequenzaMesi: 12, matricola: 'A19-5520', campoMisura: '0-150 mm', assegnatarioId: luca })).riga.id;
  await S('Tarature', { strumentoId: camp, tipo: 'Esterna', esitoDichiarato: 'Conforme', numCertificato: 'LAT 051-2026/118' });
  await S('Tarature', { strumentoId: cal, campioneId: camp, eseguitaDaId: io }, { TaratureRighe: [{ punto: '10 mm', valoreCampione: 10, valoreStrumento: 10.01 }, { punto: '50 mm', valoreCampione: 50, valoreStrumento: 50.03 }, { punto: '100 mm', valoreCampione: 100, valoreStrumento: 100.02 }] });

  const dir = path.join(__dirname, '..', 'esempi');
  fs.mkdirSync(dir, { recursive: true });
  const salva = (nome, buf) => { fs.writeFileSync(path.join(dir, nome), buf); console.log(nome, buf.length, 'byte'); };
  salva('verbale-consegna-dpi.pdf', Buffer.from((await api('stampa', { nome: 'verbaleConsegna', id: c.riga.id })).base64, 'base64'));
  salva('registro-strumenti.pdf', Buffer.from((await api('stampa', { nome: 'registroStrumenti' })).base64, 'base64'));
  salva('modello-import-dipendenti.xlsx', Buffer.from((await api('import.modello', { tipo: 'dipendenti' })).base64, 'base64'));
  await api('esporta.richiedi');
  const codice = /è: (\d{6})/.exec(posta.inviate.pop().testo)[1];
  salva('esportazione-dati-rossi.zip', (await sis.esportaPerAzienda(A, t, { codice, allegati: true })).buffer);
})().catch(e => { console.error(e); process.exit(1); });
