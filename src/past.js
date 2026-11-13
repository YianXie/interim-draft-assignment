// Last year's result for each of this year's staff, worked out from last year's allocation and forms. Imports nothing.
export const PAST_SLOTS = ["past-allocation.xlsx", "past-round1.xlsx", "past-round2.xlsx", "past-singapore.xlsx"];
export const PAST_FORMS = { "past-round1.xlsx": "Round 1", "past-round2.xlsx": "Round 2", "past-singapore.xlsx": "Singapore" };
export const RESULT_LABEL = { top4: "Top 4", "5to7": "5 to 7", none: "None", notFound: "Not found", noForm: "No form" };
export const normName = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

const ROUNDS = Object.values(PAST_FORMS);

// allocation: [{ course, sponsors }]   course is the Course Name, sponsors are names as written
// forms: [{ email, course, rank, round }]   one entry per listed choice
// staff: [{ email, name }]   this year's staff
// sent: string[]   every email with a row on any past form, even a row with no choice filled in
// Returns { byEmail: Map<email, { result, rank, round }>, unmatched: string[] }.
// byEmail holds only staff who are on a past form or matched a sponsor entry. Emails and course names are compared as given.
// Sent a form means: in `sent`, or has a listed choice. A blank form is still a form, as it is this year.
export function lastYearResults({ allocation, forms, staff, sent = [] }) {
  const sharing = new Map();
  for (const s of staff) {
    const key = normName(s.name);
    sharing.set(key, [...(sharing.get(key) || []), s.email]);
  }

  // A sponsor entry counts only when exactly one person has that name. No guessing.
  const placedOn = new Map();
  const unmatched = [];
  for (const { course, sponsors } of allocation) {
    for (const entry of sponsors) {
      const written = entry === null || entry === undefined ? "" : String(entry).trim();
      if (!written) continue;
      const who = sharing.get(normName(written)) || [];
      if (who.length === 1) placedOn.set(who[0], course);
      else unmatched.push(written);
    }
  }

  const listings = new Map();
  for (const f of forms) listings.set(f.email, [...(listings.get(f.email) || []), f]);

  const sentForm = new Set(sent);
  const byEmail = new Map();
  for (const { email } of staff) {
    const list = listings.get(email) || [];
    const form = sentForm.has(email) || list.length > 0;
    const placed = placedOn.has(email);
    if (!form && !placed) continue;
    // The listing the page shows for a course: the earliest of Round 1, Round 2, Singapore that lists it.
    const shown = placed && list.filter((f) => f.course === placedOn.get(email))
      .sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round) || a.rank - b.rank)[0];
    if (shown) byEmail.set(email, { result: shown.rank <= 4 ? "top4" : "5to7", rank: shown.rank, round: shown.round });
    else byEmail.set(email, { result: !form ? "noForm" : !placed ? "notFound" : "none", rank: null, round: null });
  }
  return { byEmail, unmatched };
}
