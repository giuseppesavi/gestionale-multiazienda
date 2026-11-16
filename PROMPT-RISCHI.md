# PROMPT – GESTIONE DEI RISCHI E DELLE OPPORTUNITÀ

> Copia il testo qui sotto e dallo a un assistente di programmazione.
> Descrive solo i campi (per nome) e le funzionalità del modulo "Rischi e opportunità".

---

## Il tuo compito

Crea un modulo per l'analisi e la gestione dei rischi e delle opportunità di un'azienda: registri, metodi di valutazione configurabili, valutazione iniziale e residua, azioni con verifica dell'efficacia, piano di gestione. Interfaccia e messaggi in italiano, per utenti senza competenze tecniche.

---

## 1. Campi

### Processi
- Codice processo
- Processo
- Responsabile del processo

### Metodi di valutazione
- Nome del metodo
- Attivo
- Fattori; per ogni fattore:
  - Codice
  - Nome
  - Livelli (numero ed etichetta)
- Classi; per ogni classe:
  - Nome
  - Punteggio minimo
  - Punteggio massimo
  - Colore
  - Indicazione
  - Mesi di riesame

### Registri dei rischi
- Codice registro
- Nome del registro
- Prefisso dei codici
- Tipo (Rischi / Opportunità)
- Metodo di valutazione
- Attivo

### Rischi e opportunità (voci del registro)
- Codice
- Registro
- Stato (Proposta / Attivo / Chiuso)
- Processo
- Descrizione
- Causa
- Effetto
- Fonte
- Responsabile
- Valutazione iniziale
- Trattamento
- Valutazione residua
- Prossimo riesame
- Azioni
- Valutazione dell'efficacia
- Note

### Valutazione (iniziale e residua)
- Metodo usato
- Valore di ogni fattore
- Punteggio
- Classe
- Colore
- Indicazione
- Mesi di riesame
- Data della valutazione

### Azioni
- Numero
- Rischio / opportunità di riferimento
- Non conformità di riferimento
- Data
- Stato (Aperta / In corso / Chiusa)
- Descrizione
- Responsabile
- Data prevista chiusura
- Data chiusura effettiva
- Cosa è stato fatto
- Esito della verifica di efficacia (Efficace / Non efficace)
- Valutazione efficacia
- Data valutazione
- Dipendente valutatore

---

## 2. Funzionalità

### Registri
- Più registri separati, ognuno con il proprio metodo di valutazione e il proprio prefisso.
- Registri iniziali: rischi per la qualità, rischi per la salute e sicurezza, rischi ambientali, opportunità di miglioramento.
- L'amministratore può aggiungere, modificare e disattivare i registri.
- Ogni voce riceve un codice progressivo del proprio registro (prefisso più numero a tre cifre).

### Metodi di valutazione
- Metodi predefiniti pronti all'uso: Probabilità × Gravità 3×3, Probabilità × Gravità 5×5, Probabilità × Gravità × Rilevabilità, Beneficio × Fattibilità 3×3 per le opportunità.
- L'amministratore può creare metodi propri, anche partendo da uno predefinito.
- Il punteggio è il prodotto dei valori dei fattori.
- La classe è quella il cui intervallo contiene il punteggio.
- Controlli alla creazione di un metodo:
  - almeno un fattore;
  - codice del fattore di una, due o tre lettere maiuscole, non ripetuto;
  - almeno due livelli per fattore, numeri interi positivi;
  - almeno una classe;
  - ogni punteggio possibile deve ricadere in una classe, altrimenti il metodo è rifiutato indicando i punteggi scoperti.
- Un metodo usato da un registro attivo non si può disattivare né eliminare.

### Istantanea del metodo
- Ogni valutazione conserva una copia del metodo con cui è stata fatta.
- Cambiando il metodo di un registro, le valutazioni esistenti restano invariate.
- Il nuovo metodo si applica solo quando la voce viene rivalutata.

### Valutazione delle voci
- Valutazione iniziale: si sceglie un livello per ogni fattore; il sistema calcola punteggio, classe, colore e indicazione.
- Valutazione residua: stessa valutazione, dopo il trattamento.
- Un valore fuori dalla scala del metodo è rifiutato.
- La valutazione residua si può togliere.
- Se i valori non cambiano, la valutazione esistente non viene sostituita.

### Riesame
- Il prossimo riesame si calcola da oggi più i mesi previsti dalla classe.
- Fa fede la valutazione residua, se presente, altrimenti quella iniziale.
- La data si può impostare a mano e in quel caso resta.
- I riesami in scadenza compaiono nello scadenzario.

### Stati delle voci
- Proposta: voce da confermare; si conferma solo se è già stata valutata, altrimenti si scarta.
- Attivo: voce in gestione.
- Chiuso: la chiusura richiede il motivo, che viene annotato nelle note con la data; la voce resta nello storico.
- L'elenco mostra le voci chiuse solo a richiesta.

### Matrice dei rischi
- Per i metodi a due fattori, una griglia colorata per classe mostra quante voci attive ricadono in ogni casella.
- Si usa la valutazione residua, se presente.

### Azioni
- Ogni voce può avere più azioni; la stessa scheda serve anche per le azioni nate da una non conformità.
- Per un'azione collegata a un rischio sono obbligatori il responsabile e la data prevista di chiusura.
- All'assegnazione il responsabile riceve un'e-mail di avviso.
- Completamento: solo il responsabile o un amministratore, descrivendo cosa è stato fatto; l'azione passa a Chiusa con la data di chiusura.
- Verifica dell'efficacia: solo un amministratore, solo su un'azione completata, indicando le evidenze.
  - Efficace: l'azione resta chiusa.
  - Non efficace: l'azione viene riaperta.
- Ogni utente vede l'elenco delle azioni assegnate a lui.
- Le azioni scadute compaiono nello scadenzario e nel cruscotto.

### Piano di gestione
- Stampa PDF per registro con: scopo, metodo di valutazione (fattori, livelli, classi), tabella delle voci attive (codice, processo, descrizione, causa ed effetto, valutazione, trattamento e azioni, valutazione residua, responsabile, riesame), valutazione dell'efficacia.
- Documento controllato: il piano può essere generato come documento della gestione documentale, con codice legato al prefisso del registro.
  - Se non esiste, nasce in bozza.
  - Se esiste una bozza non firmata, viene aggiornata.
  - Se il piano è in approvazione, l'aggiornamento è rifiutato.
  - Se il piano è in vigore, nasce una nuova revisione in bozza.

### Permessi
- Gli amministratori creano e modificano registri, metodi e voci.
- Tutti gli utenti consultano registri, voci e matrice.
- Ogni utente può completare le azioni di cui è responsabile.
- Voci e metodi si modificano solo dalle pagine dedicate, non dalla maschera generica.

### Cruscotto e registro delle operazioni
- Il cruscotto mostra il numero di voci attive, le proposte da confermare e la distribuzione per classe.
- Ogni salvataggio, conferma, chiusura, cambio di metodo, completamento e verifica viene annotato nel registro delle operazioni.

### Esportazione
- Voci, valutazioni con la loro istantanea, metodi, registri e azioni rientrano nell'esportazione dei dati aziendali e nel ripristino.
