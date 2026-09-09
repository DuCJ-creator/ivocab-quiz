// app/api/generate/route.ts
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================================
// TYPES
// =========================================================================

type POS = "noun" | "verb" | "adjective" | "adverb" | string;

interface WordItem {
  word: string;
  meaning: string;
  pos: POS;
  level: number | string; // CSV data may deliver these as strings
  unit: number | string;
}

interface NormalizedWordItem extends Omit<WordItem, "level" | "unit"> {
  level: number;
  unit: number;
}

function normalizeWord(w: WordItem): NormalizedWordItem {
  return { ...w, level: Number(w.level), unit: Number(w.unit) };
}

interface PreparedWord extends NormalizedWordItem {
  distractors: NormalizedWordItem[];
}

interface QuestionOut {
  word: string;
  pos: POS;
  level: number;
  unit: number;
  sentence: string;
  options: string[];
  answerIndex: number;
}

interface RawQuestion {
  word: string;
  sentence: string;
}

// =========================================================================
// LEVEL-BASED DIFFICULTY CONFIG
// Higher level => longer sentence, higher CEFR band, more complex grammar.
// Tune these ranges to match your actual curriculum (e.g. 學測 7000字 bands).
// =========================================================================

const LEVEL_CONFIG: Record<
  number,
  { minWords: number; maxWords: number; cefr: string; grammar: string }
> = {
  1: {
    minWords: 8,
    maxWords: 12,
    cefr: "A1–A2",
    grammar: "simple present or simple past only, no subordinate clauses",
  },
  2: {
    minWords: 10,
    maxWords: 14,
    cefr: "A2",
    grammar:
      "simple present/past, at most one simple connector (and / but / because)",
  },
  3: {
    minWords: 12,
    maxWords: 16,
    cefr: "A2–B1",
    grammar:
      "simple past or present perfect, one subordinate clause (when/if/that) allowed",
  },
  4: {
    minWords: 14,
    maxWords: 18,
    cefr: "B1",
    grammar: "modal verbs and relative clauses allowed",
  },
  5: {
    minWords: 16,
    maxWords: 20,
    cefr: "B1–B2",
    grammar: "passive voice, conditionals, or subordinate clauses allowed",
  },
  6: {
    minWords: 18,
    maxWords: 22,
    cefr: "B2",
    grammar:
      "complex sentences with multiple clauses and varied connectors, GSAT reading-passage register",
  },
};

function getLevelConfig(level: number) {
  const clamped = Math.min(6, Math.max(1, Math.round(level || 1)));
  return LEVEL_CONFIG[clamped];
}

// =========================================================================
// GENERAL HELPERS
// =========================================================================

function normalizeSentence(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).length;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rough POS check (not perfect, but catches big mistakes).
 * Consider swapping this for a real POS tagger (e.g. the `compromise` npm
 * package) if false negatives/positives become an issue at scale.
 */
function roughPosCheck(designatedPos: string, sentenceWithBlank: string) {
  const s = sentenceWithBlank;

  switch (designatedPos.toLowerCase()) {
    case "noun":
      return /(\b(a|an|the|this|that|my|your|his|her|our|their|one|two|three)\s+______)|(___+\s+(is|was|are|were))/.test(
        s
      );

    case "verb":
      return /(\b(i|you|we|they|he|she|it)\s+______)|([A-Z][a-z]+\s+______)|(___+\s+(to|for|with|about|into|over|under|away|up|down))/.test(
        s
      );

    case "adjective":
      return /(is|was|are|were)\s+______|(______\s+\b(noun|thing|person|idea|place|time|way|day|problem|story|plan|car|book|job)\b)/.test(
        s
      );

    case "adverb":
      return /(\b______,\s+)|______\s+\b(verb|do|did|does|say|said|go|went|work|worked|run|ran|speak|spoke)\b/.test(
        s
      );

    default:
      return true;
  }
}

/** True if `word` appears as a whole word anywhere in `sentence`. */
function containsWholeWord(sentence: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
  return re.test(sentence);
}

// -------------------------------------------------------------------------
// GRAMMATICAL FORM SAFETY NET
// The multiple-choice options are always shown in the word's exact
// dictionary/base form (no -s, -ed, -ing, plural -s). So the sentence must
// be built so that dropping in that bare form is grammatically correct.
// e.g. "She has always ______ me to take my umbrella" is WRONG for "remind"
// — it needs "reminded" (past participle), and "remind" alone doesn't fit.
// This can't be caught by a pure POS check, since "remind" IS a verb slot;
// the problem is the required inflection, not the part of speech.
// -------------------------------------------------------------------------

const PAST_TIME_CONTEXT =
  /\b(yesterday|last (night|week|month|year|summer|winter)|\bago\b|in \d{4})\b/i;

/** Returns true if the bare/base verb form plausibly fits the blank. */
function verbFormRiskCheck(sentenceWithBlank: string): boolean {
  const s = sentenceWithBlank;

  // Hard disqualifiers: these constructions require an inflected form
  // (past participle or -ing), so the bare dictionary form cannot fit.
  if (/\b(has|have|had)\s+(\w+\s+){0,2}______\b/i.test(s)) return false; // perfect tenses
  if (/\b(is|are|was|were|been|being)\s+(\w+\s+){0,2}______\b/i.test(s)) return false; // passive/progressive

  // Constructions where the bare form is definitely correct.
  const safe =
    /\bto\s+______\b/i.test(s) || // infinitive
    /\b(can|could|will|would|shall|should|may|might|must)\s+(\w+\s+)?______\b/i.test(s) || // modal
    /^\s*______\b/.test(s) || // imperative, blank opens the sentence
    /\b(do|does|did|don'?t|doesn'?t|didn'?t|do not|does not|did not)\s+(\w+\s+)?______\b/i.test(s) || // do-support
    /\b(i|you|we|they)\s+(\w+\s+){0,1}______\b/i.test(s); // subjects that take the base form in present simple

  if (safe) return true;

  // Otherwise, flag likely trouble: a 3rd-person-singular-looking subject
  // driving the blank with no modal/do-support (would need -s), or an
  // unguarded past-time context (would need -ed).
  const thirdPersonNearBlank = /\b(he|she|it|[A-Z][a-z]+)\s+(\w+\s+){0,2}______\b/.test(s);
  const pastTimeContext = PAST_TIME_CONTEXT.test(s);
  return !(thirdPersonNearBlank || pastTimeContext);
}

/** Returns true if the bare/singular noun form plausibly fits the blank. */
function nounFormRiskCheck(sentenceWithBlank: string): boolean {
  // Quantifiers/numbers right before the blank usually demand a plural noun,
  // which the bare dictionary form (assumed singular) won't satisfy.
  const pluralTrigger =
    /\b(many|several|few|both|various|numerous|two|three|four|five|six|seven|eight|nine|ten)\s+______\b/i;
  return !pluralTrigger.test(sentenceWithBlank);
}

// =========================================================================
// DISTRACTOR SELECTION
// - Same POS as the target (required).
// - Never repeats the target word or a word already used elsewhere in this quiz.
// - Priority order: same level+unit -> same level, earlier units -> earlier
//   levels (any unit) -> [fallback] same level, later units -> later levels.
// - Special case: level 1 / unit 1 has nothing "earlier" to borrow from, so it
//   skips straight to the fallback tiers instead of returning nothing.
// =========================================================================

function pickDistractors(
  target: NormalizedWordItem,
  bank: NormalizedWordItem[],
  count: number,
  usedWords: Set<string>
): NormalizedWordItem[] {
  const targetMeaning = normalizeSentence(target.meaning);

  const pool = bank.filter((w) => {
    if (w.word.toLowerCase() === target.word.toLowerCase()) return false;
    if (w.pos.toLowerCase() !== target.pos.toLowerCase()) return false;
    if (usedWords.has(w.word.toLowerCase())) return false;
    // Avoid near-synonyms of the target meaning, which could make the
    // question technically ambiguous (more than one "correct" option).
    if (normalizeSentence(w.meaning) === targetMeaning) return false;
    return true;
  });

  const sameLevelSameUnit = pool.filter(
    (w) => w.level === target.level && w.unit === target.unit
  );
  const sameLevelEarlierUnit = pool.filter(
    (w) => w.level === target.level && w.unit < target.unit
  );
  const earlierLevel = pool.filter((w) => w.level < target.level);
  const sameLevelLaterUnit = pool.filter(
    (w) => w.level === target.level && w.unit > target.unit
  );
  const laterLevel = pool.filter((w) => w.level > target.level);

  const isRootPosition = target.level <= 1 && target.unit <= 1;

  const priorityOrder = isRootPosition
    ? [sameLevelSameUnit, sameLevelLaterUnit, laterLevel]
    : [
        sameLevelSameUnit,
        sameLevelEarlierUnit,
        earlierLevel,
        sameLevelLaterUnit,
        laterLevel,
      ];

  const picked: NormalizedWordItem[] = [];
  const seen = new Set<string>();

  for (const group of priorityOrder) {
    for (const w of shuffle(group)) {
      const key = w.word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(w);
      if (picked.length >= count) return picked;
    }
  }

  if (picked.length < count) {
    console.warn(
      `[generate-questions] Only found ${picked.length}/${count} POS-matched distractors for "${target.word}" (pos=${target.pos}). Question will ship with fewer options.`
    );
  }

  return picked;
}

// =========================================================================
// PROMPT BUILDING
// =========================================================================

function buildWordBlock(pw: PreparedWord): string {
  const cfg = getLevelConfig(pw.level);
  const distractorList =
    pw.distractors.length > 0
      ? pw.distractors.map((d) => d.word).join(", ")
      : "(none available — just write a normal clear sentence)";

  return `- Target word: "${pw.word}" | meaning: ${pw.meaning} | POS: ${pw.pos} | Level ${pw.level}
  Sentence length: ${cfg.minWords}-${cfg.maxWords} words | Vocabulary band: CEFR ${cfg.cefr} | Grammar: ${cfg.grammar}
  Distractor options that will also appear as choices (same POS, must NOT fit the blank): ${distractorList}`;
}

function buildMainPrompt(batch: PreparedWord[]): string {
  return `
You are an English teacher generating a fill-in-the-blank (cloze) vocabulary quiz for Taiwanese high school students preparing for the GSAT (大學學測).

STRICT RULES — follow every one without exception:

1. PART OF SPEECH (POS):
   - Each word has a DESIGNATED POS. Use it ONLY as that POS.
   - Noun → the blank must be a noun slot (subject, object, or after a determiner).
   - Verb → the blank must be a finite verb or infinitive slot.
   - Adjective → the blank must modify a noun or follow a linking verb (be, seem, feel, look, etc.).
   - Adverb → the blank must modify a verb, adjective, or whole clause.
   - If the word is multi-POS (e.g. "light" can be noun/verb/adjective), write the sentence so ONLY the designated POS fits grammatically.

2. GRAMMATICAL FORM — CRITICAL, THIS CAUSES REAL ERRORS:
   - The multiple-choice options will show each word in its exact BARE DICTIONARY FORM — no "-s", "-ed", "-ing", or plural "-s" added. The sentence must be written so that inserting that bare form is 100% grammatically correct.
   - For VERBS specifically, avoid any context that forces conjugation. BANNED patterns: present perfect ("has/have/had ______"), passive or progressive voice ("is/are/was/were ______"), simple past ("______ed" contexts, e.g. anything with "yesterday", "last week", "ago"), and third-person singular present simple with a bare subject and no modal (e.g. "She ______ him every day" — this needs "reminds", not "remind").
     - SAFE verb constructions: infinitive ("wants to ______", "in order to ______"), modal + verb ("should/must/can/will ______"), imperative ("Please ______ ..."), do-support ("Does she ______...?", "They don't ______..."), or a subject that takes the bare form in present simple ("I/you/we/they ______ ...").
     - WRONG example: "She has always ______ me to take my umbrella when it rains." (for "remind") — "remind" doesn't fit; it would need "reminded". Either use a modal ("She should always ______ me...") or restructure entirely.
   - For NOUNS, avoid contexts that force a plural (e.g. "many/several/two/three ______") unless the word is naturally used that way in its base form; prefer singular/countable-with-article ("a/an/the ______") or uncountable contexts.
   - For ADJECTIVES/ADVERBS, avoid comparative/superlative contexts ("more ______ than", "the ______est") since the bare form usually can't take "-er"/"-est" endings directly.

3. DIFFICULTY MUST MATCH EACH WORD'S LEVEL (see per-word spec below):
   - Sentence length, vocabulary band (CEFR), and grammar complexity are specified per word. Follow them exactly — do not default to a single generic difficulty for every item.

4. UNIQUE CORRECT ANSWER — CRITICAL:
   - Each question lists distractor words that will be shown as the other multiple-choice options.
   - The distractors share the SAME part of speech as the target, so grammar alone won't rule them out.
   - You must write the sentence so that the CONTEXT / MEANING clearly rules out every distractor — only the target word makes logical sense in the blank. Think about what each distractor would mean in that slot and make sure it is clearly wrong.
   - Do NOT use any of the distractor words anywhere else in the sentence.

5. CONTEXT CLUES: The sentence must contain enough context so a student can infer the meaning of the blank from surrounding words alone.

6. NO REPETITION: Vary sentence topics, subjects, and grammatical structures across the full set.

7. The target word appears exactly once, replaced by "______" (six underscores).

8. Output STRICT JSON only — no markdown, no extra text.

Words to write questions for:
${batch.map(buildWordBlock).join("\n\n")}

Return exactly:
{
  "questions": [
    { "word": "<target word>", "sentence": "<sentence with ______>" }
  ]
}

Self-check before outputting — for EACH sentence verify:
□ Is the blank in the correct POS slot for the designated POS?
□ Would the word's BARE DICTIONARY FORM (no -s/-ed/-ing/plural) be 100% grammatical in the blank? (Check especially: no present perfect "has/have/had ___", no passive/progressive "is/are/was/were ___", no unguarded 3rd-person-singular subject, no past-time context like "yesterday"/"ago" without a modal.)
□ Is the sentence within the specified word-count range for that word's level?
□ Are all non-target words within the specified CEFR band?
□ Would every listed distractor be clearly WRONG if substituted into the blank?
□ Does none of the distractor words appear elsewhere in the sentence?
□ Are sentences varied in topic and structure across the set?
Rewrite any sentence that fails any check.
`;
}

// =========================================================================
// VALIDATION
// =========================================================================

function postValidateQuestions(
  raw: RawQuestion[],
  prepared: Map<string, PreparedWord>
): RawQuestion[] {
  const seenSentences = new Set<string>();
  const filtered: RawQuestion[] = [];

  for (const q of raw) {
    if (!q?.word || !q?.sentence) continue;

    const pw = prepared.get(q.word);
    if (!pw) continue; // not one of the words we asked for

    const key = normalizeSentence(q.sentence);
    if (seenSentences.has(key)) continue; // exact-duplicate sentence

    // Exactly one blank
    const blankMatches = q.sentence.match(/_{3,}/g) || [];
    if (blankMatches.length !== 1) continue;

    // POS slot check
    if (!roughPosCheck(pw.pos, q.sentence)) continue;

    // Grammatical-form safety net: the options are shown in bare dictionary
    // form, so reject sentences whose grammar would require an inflected
    // form (e.g. "has always ______" needing a past participle).
    const posLower = pw.pos.toLowerCase();
    if (posLower === "verb" && !verbFormRiskCheck(q.sentence)) continue;
    if (posLower === "noun" && !nounFormRiskCheck(q.sentence)) continue;

    // Level-scaled length check
    const cfg = getLevelConfig(pw.level);
    const wc = wordCount(q.sentence);
    if (wc < cfg.minWords || wc > cfg.maxWords) continue;

    // Distractors must not leak into the sentence text itself
    const leaksDistractor = pw.distractors.some((d) =>
      containsWholeWord(q.sentence, d.word)
    );
    if (leaksDistractor) continue;

    // Target word itself shouldn't also appear spelled out (only as blank)
    if (containsWholeWord(q.sentence.replace(/_{3,}/, ""), pw.word)) continue;

    seenSentences.add(key);
    filtered.push(q);
  }

  return filtered;
}

// =========================================================================
// OPENAI CALL WRAPPER
// =========================================================================

async function callModel(prompt: string): Promise<RawQuestion[]> {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant that outputs strict JSON.",
      },
      { role: "user", content: prompt },
    ],
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) throw new Error("No content generated");

  const parsed = JSON.parse(content);
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

// =========================================================================
// ROUTE
// =========================================================================

const OPTIONS_COUNT = 4; // target + 3 distractors, when available
const BATCH_SIZE = 8; // keep prompts small enough for consistent quality

export async function POST(req: Request) {
  try {
    const { words, wordBank } = (await req.json()) as {
      words: WordItem[];
      wordBank?: WordItem[];
    };

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "No words provided" }, { status: 400 });
    }

    // level/unit may arrive as strings straight out of CSV-parsed data —
    // coerce rather than reject.
    for (const w of words) {
      if (
        typeof w.word !== "string" ||
        typeof w.pos !== "string" ||
        w.level === undefined ||
        w.level === null ||
        w.unit === undefined ||
        w.unit === null ||
        Number.isNaN(Number(w.level)) ||
        Number.isNaN(Number(w.unit))
      ) {
        return NextResponse.json(
          {
            error:
              "Each word must include { word, meaning, pos, level, unit } (level/unit must be numeric or numeric strings).",
          },
          { status: 400 }
        );
      }
    }

    const normalizedWords = words.map(normalizeWord);

    // Distractors are pulled from the full curriculum bank if provided,
    // otherwise fall back to the quiz words themselves (limits how well
    // rule #2 — backfilling from earlier units/levels — can work).
    const normalizedBank: NormalizedWordItem[] =
      wordBank && wordBank.length > 0
        ? wordBank.map(normalizeWord)
        : normalizedWords;

    // Track every word used as a target or a distractor so far, so the same
    // word never shows up twice across the whole quiz.
    const usedWords = new Set<string>(
      normalizedWords.map((w) => w.word.toLowerCase())
    );

    const prepared: PreparedWord[] = normalizedWords.map((w) => {
      const distractors = pickDistractors(
        w,
        normalizedBank,
        OPTIONS_COUNT - 1,
        usedWords
      );
      distractors.forEach((d) => usedWords.add(d.word.toLowerCase()));
      return { ...w, distractors };
    });

    const preparedMap = new Map(prepared.map((p) => [p.word, p]));

    // --- generate in batches, in parallel ---
    const batches = chunkArray(prepared, BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batches.map((batch) => callModel(buildMainPrompt(batch)))
    );

    let rawQuestions: RawQuestion[] = [];
    for (const r of batchResults) {
      if (r.status === "fulfilled") rawQuestions.push(...r.value);
      else console.error("[generate-questions] batch failed:", r.reason);
    }

    let validQuestions = postValidateQuestions(rawQuestions, preparedMap);

    // --- retry once for anything missing or filtered out ---
    const missing = prepared.filter(
      (pw) => !validQuestions.some((q) => q.word === pw.word)
    );

    if (missing.length > 0) {
      const retryPrompt =
        buildMainPrompt(missing) +
        `\n\nNote: these words failed validation on a previous attempt (wrong POS slot, wrong length for the level, distractor leaked into the sentence, or ambiguous context). Be extra careful with rules 1–4 this time.`;

      try {
        const retryRaw = await callModel(retryPrompt);
        const retryValid = postValidateQuestions(retryRaw, preparedMap);
        for (const rq of retryValid) {
          if (!validQuestions.some((q) => q.word === rq.word)) {
            validQuestions.push(rq);
          }
        }
      } catch (err) {
        console.error("[generate-questions] retry failed:", err);
      }
    }

    // --- assemble final output: one question per requested word, in order,
    // with shuffled multiple-choice options ---
    const byWord = new Map(validQuestions.map((q) => [q.word, q]));

    const questions: QuestionOut[] = [];
    for (const w of normalizedWords) {
      const pw = preparedMap.get(w.word)!;
      const rq = byWord.get(w.word);
      if (!rq) continue; // still couldn't produce a valid question for this word

      const optionWords = shuffle([
        pw.word,
        ...pw.distractors.map((d) => d.word),
      ]);
      const answerIndex = optionWords.indexOf(pw.word);

      questions.push({
        word: pw.word,
        pos: pw.pos,
        level: pw.level,
        unit: pw.unit,
        sentence: rq.sentence,
        options: optionWords,
        answerIndex,
      });
    }

    const failedWords = normalizedWords
      .map((w) => w.word)
      .filter((word) => !questions.some((q) => q.word === word));

    return NextResponse.json({
      questions,
      ...(failedWords.length > 0 ? { failedWords } : {}),
    });
  } catch (error) {
    console.error("OpenAI API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate questions. Please try again." },
      { status: 500 }
    );
  }
}
