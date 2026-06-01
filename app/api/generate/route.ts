// app/api/generate-questions/route.ts
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

// Initialize OpenAI (Vercel reads OPENAI_API_KEY from env)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- helpers: post-validate (de-dup + POS check + length check) ----------

function normalizeSentence(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).length;
}

/**
 * Rough POS check (not perfect, but catches big mistakes).
 * We only check common POS: noun/verb/adjective/adverb.
 * For other POS, we pass through.
 */
function roughPosCheck(designatedPos: string, sentenceWithBlank: string) {
  const s = sentenceWithBlank;

  switch (designatedPos.toLowerCase()) {
    case "noun":
      // common noun cues: determiners before blank / blank as subject with be-verb
      return /(\b(a|an|the|this|that|my|your|his|her|our|their|one|two|three)\s+______)|(___+\s+(is|was|are|were))/.test(
        s
      );

    case "verb":
      // common verb cues: subject + blank / proper name + blank / blank + preposition/inf marker
      return /(\b(i|you|we|they|he|she|it)\s+______)|([A-Z][a-z]+\s+______)|(___+\s+(to|for|with|about|into|over|under|away|up|down))/.test(
        s
      );

    case "adjective":
      // adjective cues: be-verb + blank / blank + noun-ish head (very rough)
      return /(is|was|are|were)\s+______|(______\s+\b(noun|thing|person|idea|place|time|way|day|problem|story|plan|car|book|job)\b)/.test(
        s
      );

    case "adverb":
      // adverb cues: blank at sentence start with comma / blank near verb-ish head (rough)
      return /(\b______,\s+)|______\s+\b(verb|do|did|does|say|said|go|went|work|worked|run|ran|speak|spoke)\b/.test(
        s
      );

    default:
      return true; // skip checking other POS types
  }
}

function postValidateQuestions(questions: any[], words: any[]) {
  const seen = new Set<string>();
  const wordMeta = new Map(words.map((w) => [w.word, w.pos]));

  const filtered: any[] = [];
  for (const q of questions) {
    if (!q?.word || !q?.sentence) continue;

    const key = normalizeSentence(q.sentence);

    // 1) remove exact-duplicate sentences
    if (seen.has(key)) continue;

    // 2) rough POS check
    const pos = wordMeta.get(q.word);
    if (pos && !roughPosCheck(pos, q.sentence)) continue;

    // 3) sentence length check (GSAT range: 12–22 words)
    const wc = wordCount(q.sentence);
    if (wc < 12 || wc > 22) continue;

    seen.add(key);
    filtered.push(q);
  }
  return filtered;
}

// ---------- route ----------

export async function POST(req: Request) {
  try {
    const { words } = await req.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "No words provided" }, { status: 400 });
    }

    const prompt = `
You are an English teacher generating a fill-in-the-blank (cloze) vocabulary quiz for Taiwanese high school students preparing for the GSAT (大學學測).

STRICT RULES — follow every one without exception:

1. PART OF SPEECH (POS) — MOST IMPORTANT RULE:
   - Each word has a DESIGNATED POS. You MUST use it ONLY as that POS.
   - Noun → the blank must be a noun slot (subject, object, or after a determiner).
   - Verb → the blank must be a finite verb or infinitive slot (after a subject, or after "to").
   - Adjective → the blank must modify a noun or follow a linking verb (be, seem, feel, look, etc.).
   - Adverb → the blank must modify a verb, adjective, or whole clause.
   - If the word is multi-POS (e.g. "light" can be noun/verb/adjective), choose a sentence where ONLY the designated POS fits grammatically.

2. SENTENCE LENGTH & COMPLEXITY — match GSAT 學測詞彙題 style:
   - Length: 12–22 words per sentence (count every word carefully, including "a", "the", "to").
   - Structure: one main clause; a subordinate clause (e.g. "when…", "because…", "that…") is allowed but not required.
   - Vocabulary: CEFR A2–B2 for all non-target words. Do NOT use rare, literary, or advanced words in the surrounding sentence.
   - Grammar: use simple past, simple present, present perfect, or modal verbs. Avoid subjunctive, complex inversion, or advanced structures.
   - Register: neutral or slightly formal, similar to a textbook reading passage.

3. CONTEXT CLUES: The sentence must contain enough context so a student can infer the meaning of the blank from surrounding words.

4. NO REPETITION: Vary sentence topics, subjects, and grammatical structures across the full set.

5. The target word appears exactly once, replaced by "______".

6. Output STRICT JSON only — no markdown, no extra text.

Words (target word | meaning | designated POS):
${words
  .map(
    (w: any) =>
      `- ${w.word} | meaning: ${w.meaning} | POS: ${w.pos}`
  )
  .join("\n")}

Return exactly:
{
  "questions": [
    { "word": "<target word>", "sentence": "<sentence with ______>" }
  ]
}

Self-check before outputting — for EACH sentence verify:
□ Is the blank in the correct POS slot for the designated POS?
□ Is the sentence 12–22 words (count them)?
□ Are all non-target words CEFR A2–B2?
□ Does the sentence provide clear context clues for the blank?
□ Are sentences varied in topic and structure across the set?
Rewrite any sentence that fails any check.
`;

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
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No content generated");

    const result = JSON.parse(content);

    // Post-validate (de-dup + rough POS check + word count check)
    let questions: any[] = postValidateQuestions(result.questions || [], words);

    // If some items got filtered out, retry for missing words once
    if (questions.length < words.length) {
      const missingWords = words
        .map((w: any) => w.word)
        .filter((word: string) => !questions.some((q) => q.word === word));

      const retryPrompt = `
You previously generated some questions but some were invalid.
Regenerate ONLY for the missing words below, following the SAME rules.

Missing words (use their designated POS exactly as originally specified):
${missingWords.map((w: string) => `- ${w}`).join("\n")}

Return STRICT JSON:
{ "questions": [ ... ] }
`;

      const retryCompletion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that outputs strict JSON.",
          },
          { role: "user", content: prompt + "\n\n" + retryPrompt },
        ],
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
      });

      const retryContent = retryCompletion.choices[0].message.content;
      if (retryContent) {
        const retryResult = JSON.parse(retryContent);
        const retryQuestions = postValidateQuestions(
          retryResult.questions || [],
          words
        );

        // Merge to fill gaps
        for (const rq of retryQuestions) {
          if (!questions.some((q) => q.word === rq.word)) {
            questions.push(rq);
          }
        }
      }
    }

    // Final: keep only one per target word (avoid duplicates per-word)
    // and preserve original words order if possible
    const byWord = new Map<string, any>();
    for (const q of questions) {
      if (!byWord.has(q.word)) byWord.set(q.word, q);
    }
    const orderedQuestions = words
      .map((w: any) => byWord.get(w.word))
      .filter(Boolean);

    return NextResponse.json({ questions: orderedQuestions });
  } catch (error) {
    console.error("OpenAI API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate questions. Please try again." },
      { status: 500 }
    );
  }
}
