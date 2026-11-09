// Words that must not appear on any screen. Whole-word and case-insensitive, over the strings visibleStrings() returns.
export const FORBIDDEN = ["Open folder", "Open your work folder", "Change folder", "Sample school", "Draft summary", "How this draft was made",
  "Worth a check", "Keep", "Kept", "Redo the rest", "Swap", "Reviewed", "mixed", "gender", "proven", "optimal", "secure"];

const PATTERNS = FORBIDDEN.map((w) => [w, new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "i")]);

export const forbiddenIn = (strings) => PATTERNS.filter(([, re]) => strings.some((s) => re.test(s))).map(([w]) => w);
