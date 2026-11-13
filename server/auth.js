'use strict';
// Accesso senza password: codice monouso via e-mail, sessione con token casuale.
// Nel database si salva solo l'hash del token di sessione e del codice.
// Le funzioni non lanciano errori "di accesso": restituiscono { _errore } così i contatori
// dei tentativi vengono comunque salvati.

const crypto = require('crypto');
const { config, registra, oggi } = require('../app/engine');
const { cessato } = require('../app/licenza');

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const norm = e => String(e || '').trim().toLowerCase();
const limita = (v, min, max, def) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };

const RISPOSTA_CODICE = 'Se l\'indirizzo è abilitato, riceverai entro pochi istanti un codice di 6 cifre via e-mail.';
const ERR_CODICE = 'Codice non valido o scaduto. Controlla le cifre oppure richiedi un nuovo codice.';

function creaAuth({ postino }) {
  const richieste = new Map();   // "ip|email" e "email" -> elenco orari
  const erroriIp = new Map();    // ip -> { n, bloccoFino }

  function conta(chiave, finestraMs, max) {
    const ora = Date.now();
    const l = (richieste.get(chiave) || []).filter(t => ora - t < finestraMs);
    if (l.length >= max) { richieste.set(chiave, l); return false; }
    l.push(ora);
    richieste.set(chiave, l);
    return true;
  }
  function ipBloccato(ip) { const r = erroriIp.get(ip); return !!r && r.bloccoFino > Date.now(); }
  function erroreIp(ip) {
    const r = erroriIp.get(ip) || { n: 0, bloccoFino: 0 };
    if (++r.n >= 10) { r.n = 0; r.bloccoFino = Date.now() + 6 * 3600 * 1000; }
    erroriIp.set(ip, r);
  }

  function trovaUtente(st, email) {
    if (!email) return null;
    const og = oggi();
    for (const d of st.tabella('Dipendenti').values()) {
      if (norm(d.email) === email && d.utente === 'SI' && !cessato(d, og)) return d;
    }
    return null;
  }
  function profilo(d) {
    return { id: d.id, email: norm(d.email), nome: (d.cognome + ' ' + d.nome).trim(), admin: d.ruolo === 'Amministratore', ruolo: d.ruolo };
  }
  function bloccato(st, email) { const b = st.prop('blocco:' + email); return !!b && b.scad > Date.now(); }

  // Genera e salva un codice per l'utente (usato anche dal pannello di amministrazione).
  function nuovoCodice(st, email) {
    const codice = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const sale = crypto.randomBytes(8).toString('hex');
    const minuti = limita(config(st).otpMinuti, 3, 30, 10);
    st.setProp('otp:' + email, { h: sha(sale + codice), sale, scad: Date.now() + minuti * 60000, tent: 0 });
    return { codice, minuti };
  }

  function richiedi(st, azienda, emailGrezza, ip) {
    const email = norm(emailGrezza);
    const risposta = { messaggio: RISPOSTA_CODICE };
    if (!conta(ip + '|' + email, 15 * 60000, 5) || !conta(email, 24 * 3600000, 20)) return risposta;
    const d = trovaUtente(st, email);
    if (!d || bloccato(st, email)) return risposta;
    const { codice, minuti } = nuovoCodice(st, email);
    postino.invia({
      a: email, segreto: true,
      oggetto: 'Codice di accesso – ' + azienda.nome,
      testo: 'Il tuo codice di accesso è: ' + codice + '\n\nÈ valido per ' + minuti + ' minuti e si può usare una sola volta.\n' +
        'Se non hai richiesto tu il codice, ignora questo messaggio.',
    }).catch(() => {});
    return risposta;
  }

  function verifica(st, azienda, emailGrezza, codice, ip) {
    const email = norm(emailGrezza);
    const ora = Date.now();
    if (ipBloccato(ip)) return { _errore: 'Troppi tentativi errati da questa connessione. Riprova più tardi.' };
    if (bloccato(st, email)) return { _errore: 'Accesso temporaneamente bloccato per troppi tentativi errati. Rivolgiti all\'amministratore.' };
    const fallito = () => {
      erroreIp(ip);
      if (trovaUtente(st, email)) {
        const g = oggi();
        const e = st.prop('err:' + email);
        const n = (e && e.giorno === g ? e.n : 0) + 1;
        st.setProp('err:' + email, { giorno: g, n });
        if (n >= 50) {
          st.setProp('blocco:' + email, { scad: ora + 24 * 3600000 });
          registra({ st }, 'Accesso bloccato', email + ': troppi tentativi errati');
          postino.invia({ a: email, oggetto: 'Accesso bloccato – ' + azienda.nome,
            testo: 'Il tuo accesso è stato bloccato per 24 ore a causa di troppi tentativi errati. Se non sei stato tu, avvisa l\'amministratore.' }).catch(() => {});
        }
      }
      return { _errore: ERR_CODICE };
    };
    const rec = st.prop('otp:' + email);
    const d = trovaUtente(st, email);
    if (!rec || !d || rec.scad < ora || rec.tent >= 5) return fallito();
    const atteso = Buffer.from(rec.h, 'hex');
    const dato = Buffer.from(sha(rec.sale + String(codice || '').trim()), 'hex');
    if (!crypto.timingSafeEqual(atteso, dato)) {
      st.setProp('otp:' + email, { ...rec, tent: rec.tent + 1 });
      return fallito();
    }
    st.setProp('otp:' + email, null);
    st.setProp('err:' + email, null);
    // Pulizia delle sessioni scadute.
    for (const [k, v] of [...st.props]) if (k.startsWith('sess:') && v.scad < ora) st.setProp(k, null);
    const token = crypto.randomBytes(32).toString('hex');
    const ore = limita(config(st).sessioneOre, 1, 6, 6);
    st.setProp('sess:' + sha(token), { dip: d.id, scad: ora + ore * 3600000, agg: ora });
    const utente = profilo(d);
    registra({ st, utente }, 'Accesso', 'Accesso con codice');
    return { token, utente };
  }

  function utenteDaToken(st, token) {
    if (!token || typeof token !== 'string') return null;
    const k = 'sess:' + sha(token);
    const s = st.prop(k);
    const ora = Date.now();
    if (!s) return null;
    if (s.scad < ora) { st.setProp(k, null); return null; }
    const d = st.tabella('Dipendenti').get(s.dip);
    if (!d || d.utente !== 'SI' || cessato(d, oggi())) { st.setProp(k, null); return null; }
    // Scadenza a scorrimento (aggiornata al massimo ogni 5 minuti per non scrivere a ogni richiesta).
    if (ora - s.agg > 5 * 60000) {
      const ore = limita(config(st).sessioneOre, 1, 6, 6);
      st.setProp(k, { ...s, scad: ora + ore * 3600000, agg: ora });
    }
    return profilo(d);
  }

  function esci(st, token) { if (token) st.setProp('sess:' + sha(token), null); return { uscito: true }; }

  return { richiedi, verifica, utenteDaToken, esci, nuovoCodice, trovaUtente };
}

module.exports = { creaAuth };
