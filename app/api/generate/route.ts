// app/api/generate-questions/route.ts
import { OpenAI } from "openai";
import { NextResponse } from "next/server";

// Initialize OpenAI (Vercel reads OPENAI_API_KEY from env)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- helpers: post-validate (de-dup + rough POS check) ----------

function normalizeSentence(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
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

    // Stronger prompt with your 2 restrictions
    const prompt = `
You are an English teacher generating a cloze quiz.

IMPORTANT RULES (must follow):
1) Each word has a DESIGNATED part of speech (POS).
   - You MUST use the word only as that designated POS in the sentence.
   - Do NOT use it as any other POS even if the word can be multiple POS.
   - Make the POS usage unambiguous by context.
2) Avoid repetition:
   - Across all sentences, avoid repeating the same sentence pattern, topic, or template.
   - Avoid reusing the same obvious collocations or clue vocabulary.
   - If words are similar, make sentences clearly different.
3) Each sentence should be CEFR A2–C1, natural, and include clear context clues.
4) Replace the target word with "______" exactly once.
5) Output STRICT JSON only, no extra text.

Words to use (target word / meaning / designated POS):
${words
  .map(
    (w: any) =>
      `- ${w.word} | meaning: ${w.meaning} | designated POS: ${w.pos} | DO NOT use as any other POS`
  )
  .join("\n")}

Return:
{
  "questions": [
    { "word": "<target word>", "sentence": "<sentence with ______>" }
  ]
}

Before finalizing, silently self-check:
- Is the word used ONLY as the designated POS?
- Does it appear exactly once before blanking?
- Are sentences non-repetitive across the set?
If any check fails, rewrite until all checks pass.
`;

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that outputs strict JSON.",
        },
        { role: "user", content: prompt },
      ],
      model: "gpt-3.5-turbo-0125",
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No content generated");

    const result = JSON.parse(content);

    // Post-validate (de-dup + rough POS check)
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
        model: "gpt-3.5-turbo-0125",
        response_format: { type: "json_object" },
      });

      const retryContent = retryCompletion.choices[0].message.content;
      if (retryContent) {
        const retryResult = JSON.parse(retryContent);
        const retryQuestions = postValidateQuestions(
          retryResult.questions || [],
          words
        );

        // Merge补齐
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
