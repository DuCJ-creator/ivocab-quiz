import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';

// 初始化 OpenAI (Vercel 會自動從環境變數讀取 OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { words } = await req.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: 'No words provided' }, { status: 400 });
    }

    // 建構 Prompt，要求嚴格的 JSON 格式
    const prompt = `
      You are an English teacher generating a quiz. 
      For each of the following words, create a sentence (CEFR A2-C1 level) that uses the word correctly.
      The sentence must have clear context clues.
      
      Words to use:
      ${words.map((w: any) => `- ${w.word} (Meaning: ${w.meaning}, POS: ${w.pos})`).join('\n')}

      Return a JSON object with a key "questions" containing an array. 
      Each item in the array must have:
      1. "word": The target word exactly as given.
      2. "sentence": The sentence with the target word replaced by "______".
      
      Example output format:
      {
        "questions": [
          { "word": "apple", "sentence": "I ate a delicious red ______ for lunch." }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "You are a helpful assistant that outputs strict JSON." },
        { role: "user", content: prompt }
      ],
      model: "gpt-3.5-turbo-0125", // 使用 3.5-turbo 比較省錢且速度快，效果對填空題足夠
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No content generated");

    const result = JSON.parse(content);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('OpenAI API Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate questions. Please try again.' }, 
      { status: 500 }
    );
  }
}
