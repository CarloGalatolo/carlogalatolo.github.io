'use strict';
// Il giocatore "avido" usato dagli strumenti di prova: è il livello "normale" dell'IA del gioco (../ai.js), che sceglie la mossa che massimizza subito
// la differenza di mostri controllati (nella preparazione, le scelte dopo un 6 sono casuali).
// `r` è un generatore di numeri casuali in [0,1) (vedi seeded), usato per i pareggi tra mosse uguali.
const {aiMargin, aiChoose} = require('../ai.js');

function seeded(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const margin = aiMargin;
const choose = (st, r) => aiChoose(st, 'normale', r);

module.exports = {seeded, margin, choose};
