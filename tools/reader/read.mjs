// Sends each written answer to the model and keeps the tags that pass the checks. ask(system, user) is the model.
import { parseReply, checkTags } from "./check.mjs";

// school is parseFiles' School; answers are [{ email, form: "Round 1"|"Singapore", answer }].
// Gives the fit.xlsx rows, the Answers sheet rows (every answer, read or not), tags dropped, the emails not read, and each
// distinct message from a model call that failed. A failed call counts as an unreadable reply: retried once, then not read.
export async function readAll({ school, answers, ask, prompt }) {
  const course = new Map(school.courses.map((c) => [c.id, c]));
  const teacher = new Map(school.teachers.map((t) => [t.email, t]));
  const rows = [];
  const notRead = [];
  const errors = [];
  let dropped = 0;
  for (const { email, form, answer } of answers) {
    const ranked = (teacher.get(email)?.prefs ?? [])
      .filter((p) => p.round === form)
      .sort((a, b) => a.rank - b.rank)
      .map((p) => ({ id: p.course, name: course.get(p.course).name }));
    const user = `Ranked courses: ${ranked.map((c) => c.name).join("; ")}\nAnswer: ${answer}`;
    const once = async () => {
      try {
        return parseReply(await ask(prompt, user));
      } catch (e) {
        if (!errors.includes(e.message)) errors.push(e.message);
        return null;
      }
    };
    const tags = (await once()) ?? (await once());
    if (!tags) {
      if (!notRead.includes(email)) notRead.push(email);
      continue;
    }
    const out = checkTags(tags, { email, answer, ranked });
    rows.push(...out.rows);
    dropped += out.dropped;
  }
  return { rows, answersSheet: answers.map((a) => [a.email, a.form, a.answer]), dropped, notRead, errors };
}
