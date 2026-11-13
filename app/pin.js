'use strict';
// PIN di firma dei dipendenti: da 4 a 8 cifre, salvato come hash lento (scrypt) con salt.
// Blocco di 15 minuti dopo 5 errori; blocco per la giornata dopo 10 errori, con e-mail agli amministratori.

const crypto = require('crypto');
const { cessato } = require('./licenza');

function eng() { return require('./engine'); }
const hashPin = (pin, sale) => crypto.scryptSync(String(pin), Buffer.from(sale, 'hex'), 32).toString('hex');
const pinValido = p => typeof p === 'string' && /^\d{4,8}$/.test(p);

function emailAmministratori(st) {
  const og = eng().oggi();
  const out = new Set();
  for (const d of st.tabella('Dipendenti').values()) {
    if (d.utente === 'SI' && d.ruolo === 'Amministratore' && d.email && !cessato(d, og)) out.add(d.email);
  }
  return [...out];
}

function imposta(ctx, dipId, pin) {
  const { ErroreUtente, registra, adesso } = eng();
  const d = ctx.st.tabella('Dipendenti').get(dipId);
  if (!d) throw new ErroreUtente('Dipendente non trovato.');
  let generato = false;
  if (pin === undefined || pin === null || pin === '') { pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); generato = true; }
  if (!pinValido(pin)) throw new ErroreUtente('Il PIN deve essere composto da 4 a 8 cifre.');
  const sale = crypto.randomBytes(16).toString('hex');
  ctx.st.metti('Dipendenti', { ...d, pinSalt: sale, pinHash: hashPin(pin, sale), updatedAt: adesso() });
  ctx.st.setProp('pin:' + dipId, null);
  registra(ctx, 'PIN', 'PIN di firma impostato per ' + d.cognome + ' ' + d.nome);
  return generato ? { pin } : { impostato: true };
}

// Restituisce null se il PIN è corretto, altrimenti il messaggio d'errore (i contatori vengono aggiornati).
function verifica(ctx, dipId, pin) {
  const { oggi, registra } = eng();
  const st = ctx.st;
  const d = st.tabella('Dipendenti').get(dipId);
  if (!d || !d.pinHash) return 'Per questo dipendente non è stato impostato un PIN di firma.';
  const og = oggi(), ora = Date.now(), k = 'pin:' + dipId;
  let s = st.prop(k) || { giorno: og, n: 0, fino: 0 };
  if (s.giorno !== og) s = { giorno: og, n: 0, fino: 0 };
  if (s.n >= 10) return 'PIN bloccato per oggi per troppi tentativi errati. Rivolgiti all\'amministratore.';
  if (s.fino > ora) return 'PIN temporaneamente bloccato per troppi tentativi errati. Riprova tra qualche minuto.';
  const atteso = Buffer.from(d.pinHash, 'hex');
  const dato = Buffer.from(hashPin(String(pin ?? ''), d.pinSalt), 'hex');
  if (atteso.length === dato.length && crypto.timingSafeEqual(atteso, dato)) { st.setProp(k, null); return null; }
  s = { ...s, n: s.n + 1 };
  if (s.n >= 10) {
    registra(ctx, 'PIN bloccato', d.cognome + ' ' + d.nome + ': 10 tentativi errati');
    const postino = ctx.servizi && ctx.servizi.postino;
    if (postino) for (const a of emailAmministratori(st)) {
      postino.invia({ a, oggetto: 'PIN di firma bloccato – ' + d.cognome + ' ' + d.nome,
        testo: 'Il PIN di firma di ' + d.cognome + ' ' + d.nome + ' è stato bloccato per oggi dopo 10 tentativi errati.\nPuoi sbloccarlo dalla scheda del dipendente.' }).catch(() => {});
    }
  } else if (s.n % 5 === 0) s.fino = ora + 15 * 60000;
  st.setProp(k, s);
  return 'PIN non corretto.';
}

function sblocca(ctx, dipId) {
  const { ErroreUtente, registra } = eng();
  const d = ctx.st.tabella('Dipendenti').get(dipId);
  if (!d) throw new ErroreUtente('Dipendente non trovato.');
  ctx.st.setProp('pin:' + dipId, null);
  if (d.email) { const e = String(d.email).toLowerCase(); ctx.st.setProp('blocco:' + e, null); ctx.st.setProp('err:' + e, null); }
  registra(ctx, 'Sblocco', 'Accesso e PIN sbloccati per ' + d.cognome + ' ' + d.nome);
  return { sbloccato: true };
}

module.exports = { imposta, verifica, sblocca, pinValido, emailAmministratori };
