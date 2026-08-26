// Run with:  jsc parser.test.js   (JavaScriptCore) — no Node required.
load("parser.js");

var CATS = [
  { name: "Rent", keywords: ["rent","real estate"] },
  { name: "Groceries", keywords: ["woolworths","woolies","aldi","costco","groceries"] },
  { name: "Dining", keywords: ["coffee","matcha","lunch","kebab","cafe"] },
  { name: "Transport", keywords: ["didi","uber","flight","opal","max cap"] },
  { name: "Workout", keywords: ["climbing","gym","one playground"] },
  { name: "Health", keywords: ["chemist","meds","protein"] },
  { name: "Other", keywords: ["amazon","temu"] },
];
var TODAY = "2026-08-26"; // a Wednesday

var pass = 0, fail = 0;
function eq(got, want, label) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; print("FAIL: " + label + "\n   got  " + g + "\n   want " + w); }
}

var r;
r = parseSentence("5 aud coffee today", CATS, TODAY);
eq([r.amount, r.currency, r.date, r.categoryName, r.notes], [5, "AUD", "2026-08-26", "Dining", "coffee"], "5 aud coffee today");

r = parseSentence("120 thb woolies yesterday", CATS, TODAY);
eq([r.amount, r.currency, r.date, r.categoryName], [120, "THB", "2026-08-25", "Groceries"], "thb + yesterday + groceries");

r = parseSentence("didi to airport", CATS, TODAY);
eq([r.amount, r.categoryName, r.matchedCategory], [null, "Transport", true], "no amount, category matched");

r = parseSentence("$12.50 kebab", CATS, TODAY);
eq([r.amount, r.currency, r.categoryName], [12.5, "AUD", "Dining"], "symbol dollar decimal");

r = parseSentence("aud 30 climbing monday", CATS, TODAY);
eq([r.amount, r.date, r.categoryName], [30, "2026-08-24", "Workout"], "currency-first + weekday");

r = parseSentence("45 amazon aug 20", CATS, TODAY);
eq([r.amount, r.date, r.categoryName], [45, "2026-08-20", "Other"], "explicit month-day date");

r = parseSentence("18 lunch 20/8", CATS, TODAY);
eq([r.date, r.categoryName], ["2026-08-20", "Dining"], "numeric slash date");

r = parseSentence("9 random thing", CATS, TODAY);
eq([r.amount, r.categoryName, r.matchedCategory], [9, "Other", false], "unmatched -> Other flagged");

r = parseSentence("7", CATS, TODAY);
eq([r.amount, r.currency, r.date], [7, "AUD", "2026-08-26"], "bare number defaults");

r = parseSentence("15 one playground climbing session", CATS, TODAY);
eq([r.categoryName], ["Workout"], "multi-word keyword 'one playground'");

r = parseSentence("22 max cap opal", CATS, TODAY);
eq([r.categoryName], ["Transport"], "multi-word keyword 'max cap'");

r = parseSentence("6.5 matcha with sid", CATS, TODAY);
eq([r.amount, r.categoryName, r.notes], [6.5, "Dining", "matcha with sid"], "notes keep remaining words");

// --- splitExpenses ---
eq(splitExpenses("5 coffee and 10 lunch"), ["5 coffee", "10 lunch"], "and splits two amounts");
eq(splitExpenses("5 coffee and cake"), ["5 coffee cake"], "and keeps one when no 2nd amount");
eq(splitExpenses("woolies 20, didi 15, coffee 5"), ["woolies 20", "didi 15", "coffee 5"], "commas split three");
eq(splitExpenses("5 coffee\n10 lunch"), ["5 coffee", "10 lunch"], "newline splits");
eq(splitExpenses("coffee and lunch 20"), ["coffee lunch 20"], "leading no-amount merges forward");
eq(splitExpenses("15 climbing and 8 matcha and snack"), ["15 climbing", "8 matcha snack"], "mixed and-chain");
eq(splitExpenses("   "), [], "blank -> none");

print("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) throw new Error("tests failed");
