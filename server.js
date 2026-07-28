// EA Summit check-in backend
// Holds the Swapcard API key server-side and exposes one endpoint the
// scanner page calls after reading a QR code. Never expose SWAPCARD_API_KEY
// to the browser.

const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SWAPCARD_ENDPOINT = 'https://developer.swapcard.com/event-admin/graphql';
const API_KEY = process.env.SWAPCARD_API_KEY;
const EVENT_ID = process.env.SWAPCARD_EVENT_ID;

if (!API_KEY || !EVENT_ID) {
  console.warn(
    '[warning] SWAPCARD_API_KEY and/or SWAPCARD_EVENT_ID are not set. ' +
    'Copy .env.example to .env and fill them in before checking anyone in.'
  );
}

async function swapcardRequest(query, variables) {
  const res = await fetch(SWAPCARD_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors && json.errors.length) {
    const message = json.errors.map(e => e.message).join('; ');
    throw new Error(message);
  }
  return json.data;
}

// 1. Look up the registration behind a scanned code (badge/confirmation code).
const FIND_PERSON_QUERY = `
  query FindPerson($eventId: ID!, $code: String!) {
    eventPeople(eventId: $eventId, filters: { confirmationCode: [$code] }) {
      nodes {
        id
        firstName
        lastName
        registration {
          id
          status
          checkIn
        }
      }
    }
  }
`;

// 2. Mark that registration as checked in right now.
// NOTE: Confirmed against Swapcard's live schema (via GraphQL introspection):
// - There is no standalone `updateRegistration` mutation.
// - `updateEventPerson` takes `UpdateEventPersonV2Input`, which has NO
//   `registration` field at all — it only covers profile fields
//   (name, email, job title, etc).
// - The only mutation that can touch registration/check-in data is
//   `importEventPeople`, whose `data` argument is a list of
//   `ImportEventPersonInput`. Each item has an `update` field typed as
//   `UpdateEventPersonInput` (note: NOT the V2 one used by updateEventPerson)
//   which does carry a `registration` node.
// See Swapcard changelog: "When creating or updating a person using the
// importEventPeople mutation the registration status and ticket may be set."
const CHECK_IN_MUTATION = `
  mutation CheckIn($eventId: ID!, $data: [ImportEventPersonInput!]!) {
    importEventPeople(eventId: $eventId, data: $data) {
      eventPeopleUpdated
      errors {
        errorCode
        message
      }
    }
  }
`;

app.post('/api/checkin', async (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ ok: false, message: 'No code scanned.' });
  }

  if (!API_KEY || !EVENT_ID) {
    return res.status(500).json({
      ok: false,
      message: 'Server is missing SWAPCARD_API_KEY / SWAPCARD_EVENT_ID. See .env.example.',
    });
  }

  try {
    const findData = await swapcardRequest(FIND_PERSON_QUERY, {
      eventId: EVENT_ID,
      code: code.trim(),
    });

    const person = findData?.eventPeople?.nodes?.[0];
    if (!person) {
      return res.json({ ok: false, message: `No registration found for code "${code}".` });
    }

    if (person.registration?.checkIn) {
      return res.json({
        ok: true,
        alreadyCheckedIn: true,
        name: `${person.firstName} ${person.lastName}`,
        message: `${person.firstName} ${person.lastName} was already checked in.`,
      });
    }

    const importResult = await swapcardRequest(CHECK_IN_MUTATION, {
      eventId: EVENT_ID,
      data: [
        {
          id: person.id,
          update: {
            registration: {
              id: person.registration.id,
              checkIn: new Date().toISOString(),
              checkInSource: 'API',
            },
          },
        },
      ],
    });

    const importErrors = importResult?.importEventPeople?.errors;
    if (importErrors && importErrors.length) {
      const message = importErrors.map(e => e.message || e.errorCode).join('; ');
      throw new Error(`Swapcard rejected the check-in: ${message}`);
    }

    return res.json({
      ok: true,
      alreadyCheckedIn: false,
      name: `${person.firstName} ${person.lastName}`,
      message: `${person.firstName} ${person.lastName} checked in.`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: err.message || 'Unexpected error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EA Summit check-in server running on http://localhost:${PORT}`);
});
