// The parts of the invented files that only match the office's layout: form timestamps, the teachers' written answers,
// and each course's arrival country, arrival city and vendor link. The page reads none of it. Everything here is made up.
// Used by make_school.mjs and make_past.mjs. Each takes its own random source, so the choices those scripts draw do not move.

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Timestamps -----------------------------------------------------------------------------------------------------

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
// dd/mm/yyyy h:mm:ss, the hour without a leading zero. Worked in UTC so the machine's time zone never shows.
export const stamp = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${d.getUTCHours()}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

// When each form was open, as [first day, number of days]. Round 2 and the Singapore form open a week after Round 1
// closes, so anyone on both is one to two weeks later on Round 2. Last year's forms are 52 weeks earlier, same weekdays.
const OPEN = {
  round1: [Date.UTC(2027, 8, 6), 5], // Mon 6 to Fri 10 September 2027
  round2: [Date.UTC(2027, 8, 17), 7], // Fri 17 to Thu 23 September 2027
  singapore: [Date.UTC(2027, 8, 17), 7],
};
const YEAR_BEFORE = 364 * DAY;

// n times inside a form's window, in the order they were sent: busiest on the first day and the last.
export function stamps(say, form, n, { past = false } = {}) {
  const [first, days] = OPEN[form];
  const start = first - (past ? YEAR_BEFORE : 0);
  const times = Array.from({ length: n }, () => {
    const r = say();
    const day = r < 0.4 ? 0 : r < 0.6 ? days - 1 : Math.floor(say() * days);
    // Mostly in working hours and the evening, a few late at night. The form opens at 8 on its first morning.
    const hour = day === 0 ? 8 + say() * 15.9 : say() < 0.9 ? 7 + say() * 16.9 : say() * 7;
    return start + day * DAY + Math.floor(hour * 3600) * 1000;
  });
  return times.sort((a, b) => a - b).map((t) => stamp(Math.floor(t / 1000) * 1000));
}

// ---- Courses ----------------------------------------------------------------------------------------------------------

// Each invented country has a gateway city and a coast city.
const CITIES = {
  Talloway: ["Brennick", "Port Talloway"],
  Eskmere: ["Eskhaven", "Saltmere"],
  Ombrine: ["Saint Orvel", "Ombrine Quay"],
  Kelvane: ["Kelvane City", "Coralmouth"],
  Sundaril: ["Amberfall", "Sundaril Bay"],
  Verrano: ["Castellune", "Verrano Sands"],
  Quillon: ["Quillmouth", "Wrenhaven"],
  Marrowdale: ["Dalecross", "Marrow Point"],
  Hesperin: ["Vesperton", "Hesper Cove"],
};
const BY_THE_SEA = ["Coast Kayaking", "Reef Science", "Reef Diving"];

// [Arrival Country, Arrival City, Vendor Link] for a course row.
export function travel(course) {
  if (course.type === "Singapore") return ["Singapore", "Singapore", vendor(course)];
  const country = Object.keys(CITIES).find((c) => course.name.startsWith(`${c} `));
  if (!country) return ["", "", vendor(course)]; // a renamed course: the owner fills these in by hand
  const coast = BY_THE_SEA.some((a) => course.name.endsWith(a));
  return [country, CITIES[country][coast ? 1 : 0], vendor(course)];
}
const vendor = (course) => `https://example.com/vendors/${course.code.toLowerCase()}`;

// ---- Written answers ----------------------------------------------------------------------------------------------------

const pick = (say, list) => list[Math.floor(say() * list.length)];

// What a teacher brings to one kind of course. Every line starts with "I" so it follows any opener.
const SKILL = {
  "Coast Kayaking": [
    "I am a qualified lifeguard and have taught swimming for years, so I am comfortable supervising students on and near the water",
    "I hold a sea kayak leader award and have run the Grade 9 paddling club for four years, including capsize and rescue drills",
    "I grew up paddling on a tidal estuary and can teach students to read wind and tide before we launch each morning",
  ],
  "Highland Trek": [
    "I have trekked in the mountains most summers for ten years and know how to manage blisters, cold nights and tired teenagers",
    "I have a remote first aid certificate and have led overnight treks with groups of twelve, so I plan pace around the slowest walker",
    "I trained as a hill walking leader and am confident with route cards, map reading and spotting early signs of altitude sickness",
  ],
  "Reef Science": [
    "I run the Marine Science elective and can help students design a small research question before we even arrive",
    "I teach senior Biology and can run simple transect and quadrat surveys so students collect real reef data, not just photos",
    "I studied marine ecology at university and can turn snorkelling time into proper fieldwork with a short report at the end",
  ],
  "Reef Diving": [
    "I learned to dive on a school trip myself and remember how much a calm, encouraging adult helped",
    "I am a rescue diver with over two hundred logged dives and can run buddy checks and surface briefings every morning",
    "I have assisted a dive instructor on school trips before and know how to pace nervous divers in their first open water sessions",
  ],
  "Wildlife Survey": [
    "I teach Geography and can show students how to use GPS and simple mapping tools to record where each sighting happens",
    "I ran the camera trap project with our Environment Club and can teach students to log, sort and identify sightings each evening",
    "I volunteer with a bird ringing group at weekends and can show students how careful, patient recording works",
  ],
  "Temple Arts": [
    "I practise calligraphy and woodblock printing and would love to help students try the crafts they see, not only watch them",
    "I teach Visual Arts and can run sketching and printmaking sessions that help students look closely at what they visit",
    "I studied art history and can give short talks on site so students understand the symbols and craft before they draw",
  ],
  "Cycling Tour": [
    "I rode a long-distance charity route last year and understand how to fuel, rest and encourage riders who start to struggle",
    "I cycle to school every day, can do roadside repairs, and have led two cycling CCA trips with full route and rest plans",
    "I hold a cycle ride leader qualification and can teach group riding signals and safe spacing on busier roads",
  ],
  "Village Service": [
    "I worked for a community development charity before teaching and know how to make service projects useful for the hosts",
    "I have coordinated our service learning programme for three years and can lead reflection circles after each build day",
    "I speak conversational Bahasa and have worked alongside host families before, so I can help students build respectful relationships",
  ],
  "Photography Walk": [
    "I have exhibited my own street photography and can teach students to ask permission and photograph people respectfully",
    "I teach Media Studies and can help students plan a photo essay with a clear story rather than a camera roll of snapshots",
    "I run the school's photography club and can teach composition and editing in short sessions at the end of each day",
  ],
  "Urban Gardens": [
    "I look after the rooftop garden at school and can teach composting, seed saving and simple soil tests",
    "I teach Environmental Systems and can link each gardening session to food security and the local climate",
  ],
  "Hawker Heritage": [
    "I speak Hokkien and Malay and can help students interview stall owners politely and translate where needed",
    "I teach History and can frame each visit around how hawker culture grew out of migration and resettlement",
  ],
  "River Clean-up": [
    "I helped run the Grade 8 water quality unit and can teach students to sample, sort and record what they collect",
    "I have led beach and river clean-ups with a local group and know the glove, sharps and hydration routines well",
  ],
  "Tech Makers": [
    "I teach Design Technology and can run the laser cutter and 3D printers safely, with a clear induction for every student",
    "I coach the robotics team and can help students take a project from sketch to working prototype in a week",
  ],
  "Community Theatre": [
    "I teach Drama and have directed four school productions, so I can run warm-ups, devising and a short final sharing",
    "I have worked with a community theatre group for years and know how to help shy students find a role they enjoy",
  ],
  "Coding for Seniors": [
    "I teach Computer Science and can help students explain technology patiently, one step at a time, without jargon",
    "I ran a phone skills workshop for my parents' residents' group and know what older learners find hard",
  ],
  "Mangrove Walks": [
    "I teach Biology and can run simple plant and crab surveys so the walks become real fieldwork",
    "I have guided school groups on boardwalk trails before and know the heat and hydration routines well",
  ],
  "Bird Watching": [
    "I am a keen birder with my own spotting scope and can teach students to identify common species by call",
    "I volunteer for the annual bird census and can show students how careful counting and recording works",
  ],
  "Zero Waste Lab": [
    "I run the school's recycling committee and can help students audit waste and design practical changes",
    "I teach Chemistry and can link each session to materials, plastics and what really happens after the bin",
  ],
  "Museum Curators": [
    "I teach History and have built two student exhibitions, so I can guide research, labels and the final display",
    "I worked in a museum education team before teaching and know how exhibitions are planned and put together",
  ],
  "Kitchen Science": [
    "I teach Chemistry and can turn cooking into simple experiments on heat, acids and emulsions that students remember",
    "I hold a food hygiene certificate and can run kitchen safety briefings and clear allergy checks before we start",
  ],
};
const ANY_COURSE = [
  "I have helped on three school trips before and know how to plan a day around the group's energy and the weather",
  "I am an experienced form tutor and good at helping students settle into a new group quickly",
];
const OPEN_FIRST = [
  (a) => `Regarding ${a}, `,
  (a) => `For ${a}, `,
  (a) => `${a} is my first choice because `,
  (a) => `If I am placed on ${a}, I can offer a lot: `,
];
const OPEN_SECOND = [
  (b) => `For ${b}, `,
  (b) => `On ${b} as well, `,
  (b) => `If ${b} suits better, `,
];
// The last sentence of the answer. Overseas courses are a week away; Singapore courses are day courses.
const SAFETY_ANY = [
  "I am first aid trained and will make headcounts and a buddy system part of every day.",
  "I am happy to be the teacher at the back of the group, watching the slower students.",
  "I will make sure every student knows the plan and the emergency contacts each morning.",
  "I hold a current first aid certificate and am calm in an emergency.",
  "I am patient with students who are new to this kind of activity and good at building their confidence.",
  "I like giving each student a small job in the group, which builds responsibility and helps with headcounts.",
];
const SAFETY = {
  International: [
    ...SAFETY_ANY,
    "I would also run short evening reflections so students connect each day to what they learned.",
    "I notice homesick or anxious students early and make time to check in with them quietly.",
    "Students on my trips write a short journal each night, which helps them notice how much they learn.",
    "I always talk students through the risks of the day at breakfast so nothing comes as a surprise.",
    "I am a trained mental health first aider, which has been useful on longer trips away from home.",
    "I will share photos and short updates with the school each evening so parents know the group is safe.",
  ],
  Singapore: [
    ...SAFETY_ANY,
    "I would end each day with a short reflection so students connect what they did to what they learned.",
    "I will brief students on heat, water and sun protection before we leave school each morning.",
    "I always talk students through the risks of the day before we set off, so nothing comes as a surprise.",
    "I would set a small task to finish at home each evening, so the learning carries over to the next day.",
  ],
};

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const activityOf = (course) => Object.keys(SKILL).find((a) => course.endsWith(a));
// A line for the course, never the one already used for the other course named in the same answer.
const skillFor = (say, course, not) => {
  const a = activityOf(course);
  return pick(say, (a ? SKILL[a] : ANY_COURSE).filter((line) => line !== not));
};

// About 50 words on how the teacher would add to students' learning or safety, naming one or two of their courses.
// kind is International or Singapore.
export function enhancing(say, courses, kind) {
  for (let tries = 0; ; tries++) {
    const [a, b] = courses;
    const first = skillFor(say, a);
    let text = `${pick(say, OPEN_FIRST)(a)}${first}.`;
    if (b && say() < 0.5) text += ` ${pick(say, OPEN_SECOND)(b)}${skillFor(say, b, first)}.`;
    text += ` ${pick(say, SAFETY[kind])}`;
    if ((words(text) >= 40 && words(text) <= 65) || tries > 50) return text;
  }
}

// Nothing here says how many Interims anyone has done, so no answer can disagree with last year's files.
const WITH = [
  (c) => `I would love to co-sponsor with ${c}; we led the Grade 8 camp together and work well as a pair.`,
  (c, d) => `If possible, please pair me with ${c} or ${d}. We have planned school events together and share a similar style.`,
  (c) => `My main priority is sponsoring with ${c}, as we teach the same grade and already plan a lot of our lessons together.`,
  (c) => `I would prefer not to be on the same course as ${c}, as we usually cover each other's classes when one of us is away.`,
  (c) => `Any of my top three would make me happy. Co-sponsoring with ${c} would be a bonus, but it is not essential.`,
  (c) => `I would really like to co-sponsor with ${c} if possible, as our subjects fit well together on this kind of course.`,
  (c, d) => `${c} and I work well together and would love to sponsor as a pair. ${d} would also be a great co-sponsor for me.`,
];
const OTHER_PRIORITY = [
  "I would really value a course with a strong outdoor element this year, after two years on service trips.",
  "Ideally a course that does not need long flights, as I get badly travel sick on anything over six hours.",
  "My top priority is a course where my subject is useful, so I can bring something real to the programme.",
  "I would prefer a smaller group this year so I can get to know every student properly.",
];

// About 20 to 30 words of notable priorities, mostly who they would like to sponsor with. Some leave it blank.
export function priorities(say, colleagues) {
  const r = say();
  if (r < 0.2) return "";
  if (r < 0.35) return pick(say, OTHER_PRIORITY);
  const c = pick(say, colleagues);
  const d = pick(say, colleagues.filter((x) => x !== c));
  return pick(say, WITH)(c, d);
}

// [note, activities it must not sit beside on the same form], so a note never argues with the teacher's own choices.
const PERSONAL = [
  ["I had knee surgery in March. I am fine on flat ground but would struggle with long, steep descents.", ["Highland Trek", "Cycling Tour"]],
  ["I have a mild shellfish allergy and carry an adrenaline pen, which I am happy to discuss with the trip leader.", []],
  ["My asthma is well controlled, but I would rather avoid very high altitude if there is a choice.", ["Highland Trek"]],
  ["I hurt my shoulder playing netball this term. It should be fully healed by Interim, but paddling might be a stretch.", ["Coast Kayaking"]],
  ["My daughter starts primary school that week, so a course that is back by the Friday would help us a lot.", []],
  ["I am a little nervous about the long flights, so any guidance on travelling with students would be much appreciated.", []],
  ["I am hoping to finally see in person the places I have been teaching about for years!", []],
  ["I sponsored a similar trip at my previous school and am happy to share what worked well.", []],
  ["I am happy to support a colleague who is newer to Interim if that helps with the pairings.", []],
  ["I am vegetarian, which has never been a problem before, but I mention it just in case.", []],
  ["Will there be a first aid refresher before Interim this year? I would like to renew my certificate.", []],
  ["Is it possible to bring my own equipment, or is everything provided by the vendor?", []],
  ["Could you let me know roughly when the final list will be shared? We are planning a family visit around it.", []],
];
const fits = (courses) => ([, avoid]) => !courses.some((c) => avoid.some((a) => c.endsWith(a)));
const THANKS = [
  "Thank you for organising all of this so carefully every year.",
  "Thanks so much to the Interim team for all your hard work!",
  "Thank you, and happy to help wherever I am needed.",
  "Many thanks for considering my choices.",
];

// Final questions or comments: often personal, sometimes only a thank you, sometimes blank.
export function finalWords(say, courses) {
  const r = say();
  if (r < 0.25) return "";
  if (r < 0.4) return pick(say, THANKS);
  const [note] = pick(say, PERSONAL.filter(fits(courses)));
  return say() < 0.5 ? `${note} ${pick(say, THANKS)}` : note;
}

const SINGAPORE_PERSONAL = [
  ["I can only do days that finish by five, as I do school pick-up most afternoons.", []],
  ["I have a back injury and should avoid heavy lifting, so a clean-up day might need lighter jobs for me.", []],
  ["I am happy with any of my choices and can help with logistics on the day if that is useful.", []],
  ["Is lunch provided on the Singapore courses, or should students bring their own?", []],
  ["I live in the east, so courses near there would be easiest, but I can travel anywhere.", []],
  ["I really enjoy the local courses and would be glad to show students a side of Singapore they have not seen.", []],
  ["I am pregnant and due after Interim, so a course with little walking would suit me best this year.",
    ["Mangrove Walks", "River Clean-up", "Bird Watching", "Urban Gardens"]],
  ["Could students be told about sun protection and water bottles before the first day?", []],
];

// Additional comments or questions on the Singapore form.
export function singaporeWords(say, courses) {
  const r = say();
  if (r < 0.3) return "";
  if (r < 0.45) return pick(say, THANKS);
  const [note] = pick(say, SINGAPORE_PERSONAL.filter(fits(courses)));
  return say() < 0.4 ? `${note} ${pick(say, THANKS)}` : note;
}
