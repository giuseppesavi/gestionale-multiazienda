'use strict';
// Verifica di un'installazione in funzione (Docker locale o Render), su database vero:
//   node test/verifica-installazione.js [indirizzo] [e-mail amministratore] [--riavvio]
// Legge ADMIN_KEY dal file .env (o dalla variabile d'ambiente). Crea, se manca, l'azienda dimostrativa "demo".
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const email = (process.argv[3] || 'admin@demo.example').toLowerCase();
const soloDopoRiavvio = process.argv.includes('--riavvio');
let chiave = process.env.ADMIN_KEY;
if (!chiave) { const m = /^ADMIN_KEY=(.+)$/m.exec(fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')); chiave = m && m[1].trim(); }

const esiti = [];
const ok = (cosa, cond, nota) => { esiti.push([cond ? 'OK ' : 'NO ', cosa + (nota ? ' – ' + nota : '')]); if (!cond) process.exitCode = 1; };
async function admin(azione, parametri) {
  const r = await fetch(base + '/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': chiave }, body: JSON.stringify({ azione, parametri }) });
  const j = await r.json(); if (!j.ok) throw new Error(azione + ': ' + j.error); return j.data;
}
let token = '';
async function api(azione, par) {
  const r = await fetch(base + '/a/demo/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': token }, body: JSON.stringify({ fn: 'api', args: [token, azione, par || {}] }) });
  const j = await r.json(); if (!j.ok) throw new Error(azione + ': ' + j.error); return j.data;
}

(async () => {
  const salute = await fetch(base + '/health');
  ok('Il server risponde', salute.status === 200);
  const stato = await admin('stato');
  ok('Database PostgreSQL', stato.database === 'PostgreSQL', stato.database);
  let aziende = await admin('aziende.elenco');
  if (!aziende.some(a => a.codice === 'demo')) {
    const t0 = Date.now();
    await admin('aziende.demo', { codice: 'demo', nome: 'Azienda dimostrativa Srl', admin: { cognome: 'Amministratore', nome: 'Demo', email } });
    ok('Azienda dimostrativa creata', true, Math.round((Date.now() - t0) / 100) / 10 + ' s');
    aziende = await admin('aziende.elenco');
  }
  const az = aziende.find(a => a.codice === 'demo');
  ok('Azienda "demo" presente con i dati', az && az.righe > 150, az ? az.righe + ' righe, ' + az.licenza.attivi + ' addetti attivi, classe ' + az.licenza.etichetta : '');
  const c = await admin('accesso.codice', { codice: 'demo', email: az.emailAdmin });
  token = (await api('otp.verifica', { email: az.emailAdmin, codice: c.codice })).token;
  const av = await api('avvio');
  ok('Accesso con codice', av.utente.admin === true, av.utente.nome + ', ' + av.pacchetti.length + ' pacchetti');
  const vuote = [];
  for (const [e, E] of Object.entries(av.schema)) if (!E.child && !(await api('elenco', { entita: e })).righe.length) vuote.push(e);
  ok('Ogni scheda contiene dati', vuote.length === 0, vuote.join(', '));
  const sc = await api('scadenzario', { giorni: 60 });
  ok('Scadenzario', sc.sezioni.length === 10, sc.sezioni.map(s => s.id + ':' + s.righe.length).join(' '));

  if (!soloDopoRiavvio) {
    // scrittura, numerazione, allegato binario, firma, stampa, import, esportazione
    const nc = await api('salva', { entita: 'NC', dati: { descrizione: 'Verifica dell\'installazione ' + new Date().toISOString() }, figli: { NcCosti: [{ descrizione: 'Prova', quantita: 2, costo: 12.5 }] } });
    ok('Salvataggio di una scheda con righe', /^NC-\d{4}-\d{3}$/.test(nc.riga.numero) && nc.riga.costoTotale === '25,00', nc.riga.numero);
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    const file = await api('file.carica', { nome: 'prova-binaria.pdf', base64: bytes.toString('base64') });
    const giu = await fetch(base + '/a/demo/file/' + file.valore.split('|')[0], { headers: { 'X-Session': token } });
    ok('Allegato salvato e riletto identico', giu.status === 200 && Buffer.from(await giu.arrayBuffer()).equals(bytes));
    await api('firma', { entita: 'NC', id: nc.riga.id, key: nc.firme[0].key, metodo: 'credenziali' });
    ok('Firma e blocco della scheda', (await api('leggi', { entita: 'NC', id: nc.riga.id })).firmata === true);
    const pdf = await api('stampa', { nome: 'moduloNc', id: nc.riga.id });
    ok('Stampa PDF', Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString() === '%PDF-', pdf.nome);
    const mod = await api('import.modello', { tipo: 'dipendenti' });
    const ver = await api('import.esegui', { tipo: 'dipendenti', base64: mod.base64, prova: true });
    ok('Import: verifica senza scrittura', ver.prova === true && ver.errori.length === 0);
    const zip = await fetch(base + '/admin/esporta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': chiave }, body: JSON.stringify({ codice: 'demo', allegati: true }) });
    const buf = Buffer.from(await zip.arrayBuffer());
    ok('Esportazione dei dati aziendali', zip.headers.get('content-type') === 'application/zip' && buf.subarray(0, 2).toString() === 'PK', Math.round(buf.length / 1024) + ' KB');
    fs.writeFileSync(path.join(__dirname, '..', '.verifica-token'), token);
  } else {
    // dopo il riavvio del contenitore: la sessione precedente e i dati devono esserci ancora
    const vecchio = fs.readFileSync(path.join(__dirname, '..', '.verifica-token'), 'utf8');
    fs.unlinkSync(path.join(__dirname, '..', '.verifica-token'));
    token = vecchio;
    const dopo = await api('elenco', { entita: 'NC', q: 'Verifica dell\'installazione' });
    ok('Dopo il riavvio: sessione e dati conservati', dopo.righe.length >= 1, dopo.righe.length + ' NC di verifica trovate');
  }
  for (const [s, t] of esiti) console.log(s + t);
  console.log(process.exitCode ? '\nCi sono problemi.' : '\nTutto a posto.');
})().catch(e => { for (const [s, t] of esiti) console.log(s + t); console.error('ERRORE: ' + e.message); process.exit(1); });
