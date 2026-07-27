'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Cloud-Functions-Einstieg: duenner onCall-Mantel um den Action-Clock-
// Arbiter (clock-core.js). Hier passiert AUSSCHLIESSLICH:
//   1. Auth-Pflicht (Anonymous Auth genuegt — req.auth.uid ist die Identitaet,
//      Seat-Ownership prueft der Kern gegen players/<seat>/uid),
//   2. Durchreichen der Argumente,
//   3. Mapping der Arbiter-Fehler auf HttpsError-Codes.
// Region europe-west1 — identisch zur RTDB-Instanz.
// Deploy erst nach separater Freigabe (Blaze + Anonymous Auth in der Console).
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { createArbiter, ArbiterError } = require('./clock-core');

setGlobalOptions({ region: 'europe-west1' });
admin.initializeApp();
const arbiter = createArbiter({ db: admin.database() });

const ERR_MAP = {
  invalid: 'invalid-argument',
  permission: 'permission-denied',
  'not-found': 'not-found',
  'too-early': 'failed-precondition',
  failed: 'failed-precondition',
};

const wrap = (fn) => onCall(async (req) => {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');
  const data = req.data || {};
  try {
    return await fn({
      room: data.room, phaseId: data.phaseId, hash: data.hash, next: data.next,
      uid: req.auth.uid,
    });
  } catch (e) {
    if (e instanceof ArbiterError) throw new HttpsError(ERR_MAP[e.code] || 'failed-precondition', e.message);
    console.error('[clock] interner Fehler:', e);
    throw new HttpsError('internal', 'Interner Fehler.');
  }
});

exports.clockStart = wrap(arbiter.clockStart);
exports.clockClose = wrap(arbiter.clockClose);
exports.clockSettle = wrap(arbiter.clockSettle);
