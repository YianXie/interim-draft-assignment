// Invented stand-in School, used until the six workbooks are read. Ten teachers, five courses, one draft.
const prefs = (...list) => list.map(([course, rank, round]) => ({ course, rank, round }));

export const stub = {
  school: "Fernhollow Academy",
  year: "Interim 2028",
  courses: [
    { id: "KAY101", name: "Kayaking Basics", kind: "International", seats: 2, running: true, needs: "First aid" },
    { id: "COD102", name: "Coding Studio", kind: "International", seats: 2, running: true, needs: null },
    { id: "BAK103", name: "Baking Lab", kind: "International", seats: 2, running: true, needs: null },
    { id: "HIK201", name: "Hill Trails", kind: "Singapore", seats: 2, running: true, needs: "First aid" },
    { id: "MUR202", name: "Mural Making", kind: "Singapore", seats: 2, running: true, needs: null },
  ],
  teachers: [
    { id: "T001", name: "Alder Quill", email: "alder.quill@example.test", returning: true, returningCourse: "KAY101", submitted: true, certificates: ["First aid"],
      prefs: prefs(["KAY101", 1, "Round 1"], ["HIK201", 2, "Round 1"]) },
    { id: "T002", name: "Briar Wren", email: "briar.wren@example.test", returning: false, returningCourse: null, submitted: true, certificates: ["First aid"],
      prefs: prefs(["KAY101", 1, "Round 1"], ["COD102", 2, "Round 1"], ["BAK103", 1, "Round 2"]) },
    { id: "T003", name: "Cedar Moss", email: "cedar.moss@example.test", returning: false, returningCourse: null, submitted: true, certificates: [],
      prefs: prefs(["COD102", 1, "Round 1"], ["BAK103", 2, "Round 1"]) },
    { id: "T004", name: "Dune Hale", email: "dune.hale@example.test", returning: true, returningCourse: "COD102", submitted: true, certificates: [],
      prefs: prefs(["COD102", 1, "Round 1"]) },
    { id: "T005", name: "Ember Lowe", email: "ember.lowe@example.test", returning: false, returningCourse: null, submitted: true, certificates: ["First aid"],
      prefs: prefs(["HIK201", 1, "Singapore"], ["MUR202", 2, "Singapore"]) },
    { id: "T006", name: "Fern Dale", email: "fern.dale@example.test", returning: false, returningCourse: null, submitted: true, certificates: [],
      prefs: prefs(["BAK103", 1, "Round 1"], ["MUR202", 2, "Round 1"], ["COD102", 3, "Round 1"]) },
    { id: "T007", name: "Gale Ford", email: "gale.ford@example.test", returning: false, returningCourse: null, submitted: true, certificates: ["First aid"],
      prefs: prefs(["HIK201", 1, "Round 2"], ["KAY101", 2, "Round 2"]) },
    { id: "T008", name: "Heath Marsh", email: "heath.marsh@example.test", returning: false, returningCourse: null, submitted: true, certificates: [],
      prefs: prefs(["MUR202", 1, "Singapore"], ["BAK103", 2, "Round 2"]) },
    { id: "T009", name: "Isle Penn", email: "isle.penn@example.test", returning: false, returningCourse: null, submitted: true, certificates: [],
      prefs: prefs(["BAK103", 1, "Round 2"], ["COD102", 2, "Round 2"]) },
    { id: "T010", name: "Jade Rook", email: "jade.rook@example.test", returning: false, returningCourse: null, submitted: false, certificates: [],
      prefs: [] },
  ],
  draft: {
    T001: "KAY101", T002: "KAY101", T003: "COD102", T004: "COD102", T005: "HIK201",
    T006: "BAK103", T007: "HIK201", T008: "MUR202", T009: "BAK103", T010: "MUR202",
  },
};
