import Papa from 'papaparse';

export interface VocabWord {
  level: string;
  unit: string;
  no: string;
  word: string;
  pos: string;
  meaning: string;
  id: string;
}

export const fetchAndParseCSV = async (level: number): Promise<VocabWord[]> => {
  const url = `https://raw.githubusercontent.com/DuCJ-creator/iVocab-Self-Practice/main/level${level}.csv`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    const csvText = await response.text();

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: false, // 原始數據第一行是 header，但我們手動處理較穩
        skipEmptyLines: true,
        complete: (results) => {
          const data: VocabWord[] = [];
          // 從第 1 行開始 (跳過 index 0 的標題行)
          for (let i = 1; i < results.data.length; i++) {
            const row = results.data[i] as string[];
            if (row.length >= 6) {
              // 合併可能含有逗號的解釋欄位
              const meaning = row.slice(5).join(',').trim();
              data.push({
                level: row[0].trim(),
                unit: row[1].trim(),
                no: row[2].trim(),
                word: row[3].trim(),
                pos: row[4].trim(),
                meaning: meaning,
                id: `${row[0]}-${row[1]}-${row[2]}`
              });
            }
          }
          resolve(data);
        },
        error: (err: any) => reject(err),
      });
    });
  } catch (error) {
    console.error("CSV Load Error", error);
    return [];
  }
};
