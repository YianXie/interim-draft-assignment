// A plain re-check of every rule on a draft. Imports nothing, least of all the solver.
// pairs is a list of [tid, cid], so one teacher placed twice stays visible.
export function recheck(school, pairs) {
  const out = [];
  const teachers = new Map(school.teachers.map((t) => [t.id, t]));
  const courses = new Map(school.courses.map((c) => [c.id, c]));
  const placed = new Map(), filled = new Map();
  for (const [t, c] of pairs) {
    placed.set(t, (placed.get(t) ?? 0) + 1);
    filled.set(c, [...(filled.get(c) ?? []), t]);
  }
  for (const [t, n] of placed) if (n > 1) out.push({ code: "ONE_COURSE", id: t });
  for (const [t, c] of pairs) {
    const teacher = teachers.get(t), course = courses.get(c);
    if (!course || !course.running) { out.push({ code: "NOT_OFFERED", id: c }); continue; }
    if (!teacher) continue;
    if (teacher.prefs.length && !teacher.prefs.some((p) => p.course === c) && teacher.returningCourse !== c) out.push({ code: "NOT_RANKED", id: t });
    if (course.needs && !teacher.certificates.includes(course.needs)) out.push({ code: "CERTIFICATE", id: t });
  }
  for (const t of school.teachers) {
    if (t.returning && t.returningCourse && !(filled.get(t.returningCourse) ?? []).includes(t.id)) out.push({ code: "RETURNING_MOVED", id: t.id });
  }
  for (const course of school.courses) {
    const here = filled.get(course.id) ?? [];
    if (here.length > course.seats) out.push({ code: "OVER_SEATS", id: course.id });
    const hasReturning = school.teachers.some((t) => t.returning && t.returningCourse === course.id);
    if (here.length && here.length < course.seats && !hasReturning) out.push({ code: "UNDER_SEATS", id: course.id });
  }
  return out;
}
