// Invented raw files laid out like the office's, for the converter tests. The old domain is invented too.
export const NEW = new Date("2031-03-02T09:00:00Z");
export const OLD = new Date("2031-03-01T09:00:00Z");
export const blanks = (n) => Array(n).fill("");

export function rawSchool() {
  return {
    "courses.xlsx": [
      ["Course Name", "Vendor", "Arrival City", "Country"],
      ["Great Ocean Road", "v1", "Portside", "Australia"],
      ["River Walk", "v2", "Tash", "Tasland"],
      ["Glacier Camp", "v3", "Morv", "Moravia"],
      ["Garden Trails", "v4", "Singapore", "Singapore"],
    ],
    "allocation.xlsx": [
      ["Trip Code", "Course Name", "Sponsor 1", "Sponsor 2", "Sponsor 3"],
      ["AUST-1", "AUST-1 Great Ocean Road", "Wen Oxley", "Ana De Souza", "Ben Ode"],
      ["TASL-2", "TASL-2 River Walk", "Cara Lim", "", ""],
      ["SING-1", "SING-1 Garden Trails", "Dev Rao", "", ""],
    ],
    "returning.xlsx": [
      ["Email Address", "Next year I will...", "Prior Course"],
      ["woxley@oldschool.example", "Repeat", "AUST-1"],
      ["drao@oldschool.example", "Repeat", "SING-9"],
    ],
    "round1.xlsx": [
      ["Timestamp", "Email Address", "First Preference ", "How would you enhance learning or safety?",
        "Any notable priorities?", "Any final questions?", "Second Preference ", "Third Preference ",
        "Fourth Preference ", "Fifth Preference ", "Sixth Preference ", "Seventh Preference"],
      [NEW, "woxley@oldschool.example", "Australia — Great Ocean Road", "ans1", "pri1", "fin1", "Tasland – River Walk", ...blanks(5)],
      [OLD, "WOxley@OldSchool.example", "Moravia - Glacier Camp", "", "", "", ...blanks(6)],
      [OLD, "clim@oldschool.example", "Atlantis — Sunken City", "", "", "", ...blanks(6)],
    ],
    "singapore.xlsx": [
      ["Timestamp", "Email Address", "First Preference", "Second Preference", "Third Preference", "Fourth Preference",
        "Fifth Preference", "How would you enhance learning or safety?", "Anything additional for the office?"],
      [NEW, "drao@oldschool.example", "garden  trails", "", "", "", "", "sg ans", "sg more"],
    ],
  };
}

