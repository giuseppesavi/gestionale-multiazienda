'use strict';
// Classi di licenza (per numero di dipendenti censiti attivi) e pacchetti attivabili.

const CLASSI = [
  { id: 1, min: 0, max: 9 },
  { id: 2, min: 10, max: 50 },
  { id: 3, min: 51, max: 100 },
  { id: 4, min: 101, max: 250 },
  { id: 5, min: 251, max: 1000 },
].map(c => ({ ...c, etichetta: c.min + '–' + c.max + ' dipendenti' }));

const PACCHETTI = [
  { id: 'base', nome: 'Base', sempre: true },
  { id: 'dpi', nome: 'DPI' },
  { id: 'formazione', nome: 'Formazione' },
  { id: 'competenze', nome: 'Competenze' },
  { id: 'sanitaria', nome: 'Sorveglianza sanitaria' },
  { id: 'nc', nome: 'Non conformità e azioni' },
  { id: 'attrezzature', nome: 'Attrezzature e manutenzioni' },
  { id: 'fornitori', nome: 'Qualifica fornitori' },
  { id: 'strumenti', nome: 'Strumenti di misura' },
  { id: 'documenti', nome: 'Documentazione' },
];

function classe(id) { return CLASSI.find(c => c.id === Number(id)) || null; }
function pacchettoValido(id) { return PACCHETTI.some(p => p.id === id && !p.sempre); }

function cessato(dip, oggi) { return !!dip.dataLicenziamento && dip.dataLicenziamento < oggi; }

function contaAttivi(st, oggi) {
  let n = 0;
  for (const d of st.tabella('Dipendenti').values()) if (!cessato(d, oggi)) n++;
  return n;
}

function statoLicenza(st, azienda, oggi) {
  const c = classe(azienda.classe);
  const attivi = contaAttivi(st, oggi);
  return {
    classe: c.id, etichetta: c.etichetta, max: c.max, attivi,
    avviso: attivi >= Math.ceil(c.max * 0.9),
    pieno: attivi >= c.max,
  };
}

function messaggioLimite(c) {
  return 'Hai raggiunto il numero massimo di addetti previsto dalla licenza (classe ' + c.etichetta +
    ': massimo ' + c.max + ' addetti attivi). Per inserire nuovi addetti è necessario estendere la licenza: ' +
    'contatta il fornitore del servizio. La richiesta è stata segnalata automaticamente.';
}

module.exports = { CLASSI, PACCHETTI, classe, pacchettoValido, cessato, contaAttivi, statoLicenza, messaggioLimite };
