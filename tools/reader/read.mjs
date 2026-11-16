// Sends each written answer to the model and keeps the tags that pass the checks. ask(system, user) is the model.
import { parseReply, salvageTags, checkTags } from "./check.mjs";

// Sent after a reply that is not valid JSON, with that reply, so the second try is a different request: at temperature 0
// with a fixed seed, asking the same question again gives the same broken reply.
export const FIX_JSON = "That reply is not valid JSON, so it could not be read. Send the same tags again as valid JSON only, in the shape asked for, with nothing else.";

// school is parseFiles' School; answers are [{ email, form: "Round 1"|"Singapore", answer }].
// Gives the fit.xlsx rows, the Answers sheet rows (every answer, read or not), tags dropped, the emails not read, and each
// distinct message from a model call that failed. A reply that cannot be read is retried once, with the broken reply and
// FIX_JSON after it; a failed call is retried once as it was. If the second reply cannot be read either, the tags are
// taken out of it one by one (salvageTags), or out of the first reply when the second has none; salvaged counts those
// teachers. With no tags in either, the teacher is not read.
export async function readAll({ school, answers, ask, prompt }) {
  const course = new Map(school.courses.map((c) => [c.id, c]));
  const teacher = new Map(school.teachers.map((t) => [t.email, t]));
  const rows = [];
  const notRead = [];
  const errors = [];
  let dropped = 0;
  let salvaged = 0;
  for (const { email, form, answer } of answers) {
    const ranked = (teacher.get(email)?.prefs ?? [])
      .filter((p) => p.round === form)
      .sort((a, b) => a.rank - b.rank)
      .map((p) => ({ id: p.course, name: course.get(p.course).name }));
    const user = `Ranked courses: ${ranked.map((c) => c.name).join("; ")}\nAnswer: ${answer}`;
    const attempt = async (prior) => {
      try {
        const raw = await ask(prompt, user, prior);
        return { raw, tags: parseReply(raw) };
      } catch (e) {
        if (!errors.includes(e.message)) errors.push(e.message);
        return { raw: null, tags: null };
      }
    };
    const first = await attempt([]);
    let { tags } = first;
    if (!tags) {
      const second = await attempt(first.raw === null ? [] : [{ role: "assistant", content: first.raw }, { role: "user", content: FIX_JSON }]);
      tags = second.tags ?? salvageTags(second.raw) ?? salvageTags(first.raw);
      if (tags && !second.tags) salvaged++;
    }
    if (!tags) {
      if (!notRead.includes(email)) notRead.push(email);
      continue;
    }
    const out = checkTags(tags, { email, answer, ranked });
    rows.push(...out.rows);
    dropped += out.dropped;
  }
  return { rows, answersSheet: answers.map((a) => [a.email, a.form, a.answer]), dropped, notRead, errors, salvaged };
}
