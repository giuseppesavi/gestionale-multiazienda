# Stato del progetto

Aggiornato al 13/11/2026.

## Fatto e provato (`npm test`: 12 test superati)

- **Fase 0 – Struttura**: `app/` (schema, motore, regole, licenze), `server/` (database, archivio, accesso, posta, API), `test/`.
- **Fase 1 – Dati e motore**: schema completo (43 entità), elenco, lettura, salvataggio di scheda e righe figlie in un'unica transazione, validazioni, campi univoci, protezione dalle formule, numerazione automatica, eliminazione bloccata se la scheda è usata altrove, registro delle operazioni.
- **Multi-azienda**: dati separati per azienda, creazione, sospensione ed eliminazione dalla piattaforma.
- **Pacchetti attivabili**: Base (sempre), DPI, Formazione, Competenze, Sorveglianza sanitaria, NC e azioni, Attrezzature, Fornitori, Strumenti, Documentazione. Un pacchetto spento nasconde schede e campi collegati e blocca le chiamate; i dati restano.
- **Classi di dipendenti**: 0–9, 10–50, 51–100, 101–250, 251–1000. Al limite l'inserimento di nuovi addetti è bloccato e parte la segnalazione (a schermo, nel registro e via e-mail agli amministratori dell'azienda e al fornitore, una volta al giorno).
- **Fase 2 – Accesso e permessi**: codice monouso via e-mail, sessione con solo l'hash del token nel database, limiti sui tentativi, ruoli Amministratore / Utente registrazioni.

- **Fase 3 – Firme**: credenziali, PIN, firma su schermo, link via e-mail, scansione cartacea, attestato (corsi). Scheda in sola lettura dopo la prima firma, annullamento solo da amministratore. PIN con hash lento e blocchi. Allegati (15 MB, tipi ammessi) scaricabili solo da chi vede la scheda.

- **Fase 4 – Regole dei moduli**: interinali e storico rapporti, DPI della mansione, scadenze della formazione (aggiornamenti frazionati e decorrenze), competenze e copertura, NC/azioni e riepilogo, qualifica fornitori, tarature (punti, esito, stato strumento e campione), piani e manutenzioni (anche massiva per sede), sorveglianza sanitaria (prossima visita, registro, riservatezza), documentazione (revisioni, approvazione, distribuzione, prese visione, ritiro, collegamenti).

- **Fase 5 – Stampe PDF**: 22 stampe (A4, intestazione azienda, firme con immagine, QR, piè di pagina); invio e-mail del verbale DPI.
- **Fase 6 – Excel**: lettura/scrittura .xlsx e .csv; 6 import (modello, verifica senza scrittura, importa); export di scheda dipendente, registro strumenti, registro sanitario.
- **Esportazione dei dati aziendali**: archivio .zip con Excel leggibile, file di ripristino e allegati; per pacchetti; confermata con codice via e-mail (azienda) o con la chiave della piattaforma; ripristino in una nuova azienda.

- **Pacchetto Rischi e opportunità** (portato da `Risks.gs` del progetto SGI): registri (qualità, sicurezza, ambiente, opportunità), metodi di valutazione configurabili con quattro predefiniti, valutazione iniziale e residua con istantanea del metodo, proposte da confermare, chiusura con motivo, azioni con avviso al responsabile, completamento e verifica dell'efficacia, piano di gestione in PDF e come documento controllato.

- **Fase 7 – Scadenzario e cruscotto**: manutenzioni, formazione (anche richiesta e mai svolta), azioni, riesame dei rischi, DPI, strumenti, missioni, visite, prese visione, riesame documenti; contatori e licenza.
- **Fase 8 – Pannello della piattaforma** (`/admin`): aziende con classe, pacchetti, addetti e spazio usato; creazione, sospensione, eliminazione, esportazione, ripristino; codici di accesso e sblocco; registro e prova della posta.
- **Interfaccia nel browser**: accesso con codice, menu a gruppi con 📌, elenchi, maschere con griglie, firme (credenziali, PIN, schermo, scansione, link), pagina pubblica di firma, cruscotto, scadenzario, scheda dipendente, I miei documenti, rischi con matrice, metodi, import, configurazione, esportazione dati. Provata nel browser: nessun errore su 19 pagine, 31 elenchi, 29 schede e 27 schede nuove; nessuno scorrimento orizzontale a 390 px.
- **Limite di frequenza**: 1500 richieste ogni 5 minuti per IP (`LIMITE_RICHIESTE`), 60 per il pannello.

- **Azienda dimostrativa**: dal pannello della piattaforma, pulsante "＋ Azienda dimostrativa": crea un'azienda con tutti i pacchetti e dati inventati in ogni scheda e in ogni griglia (durante la creazione non parte nessuna e-mail). Si elimina come ogni altra azienda.
- **Prova di compilazione nel browser (14/11/2026)**: compilate e salvate tutte le 29 maschere (26 schede con le griglie, voce di rischio, metodo, configurazione), firma disegnata, 21 stampe sulle schede appena create, vista dell'utente non amministratore. Nessun errore.

I test sono ora 60 (`test/base`, `firme`, `moduli`, `documenti`, `scambio`, `rischi`, `cruscotto`, `dimostrativa`). Per provare l'interfaccia in locale: `node test/demo.js`, poi http://localhost:3210/a/rossi/ (i codici di accesso compaiono sul terminale). File di esempio: `node test/esempi.js` (cartella `esempi/`).

## Da fare

- Rimasto dalla fase 4: funzione "Collega mansioni alle valutazioni".
- Import di tutti i dati dalla versione Google Fogli (pannello piattaforma).
- Fase 9: riserva SMTP sulla seconda porta e verifica del collegamento alla posta.
- Fase 10: test automatici dell'interfaccia nel browser (oggi la prova è stata fatta a mano con uno script nel browser, non fa parte di `npm test`).
- QR code a schermo (oggi il QR è solo nelle stampe).
- README in italiano semplice.
- Pubblicazione: archivio GitHub e `render.yaml` (da creare dopo conferma dei piani e dei costi Render).

## Questioni aperte

- Archivio GitHub `sgi`: non leggibile (privato); il pacchetto Rischi è stato costruito dallo script incollato. L'elenco dei registri e i permessi (`risk.view` / `risk.manage`) dell'originale sono stati ricostruiti: amministratori gestiscono, tutti gli utenti consultano.

- Variabile `PIATTAFORMA_EMAIL`: indirizzo del fornitore che riceve le segnalazioni di licenza.
- Il conteggio della licenza considera gli addetti attivi (non cessati), interinali compresi.
