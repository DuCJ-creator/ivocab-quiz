'use client';

import React, { useState, useEffect } from 'react';
import { BookOpen, CheckCircle, XCircle, Printer, RotateCcw, Award, ArrowRight, Library, Sparkles, AlertCircle } from 'lucide-react';
import { fetchAndParseCSV, VocabWord } from '@/lib/csv';

// Helper: Shuffle Array
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export default function Home() {
  // Application State
  const [step, setStep] = useState<'setup' | 'generating' | 'quiz' | 'result'>('setup');
  
  // Setup State
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [fullData, setFullData] = useState<VocabWord[]>([]);
  const [availableUnits, setAvailableUnits] = useState<number[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);
  const [questionCount, setQuestionCount] = useState(5); // Default to 5 to save API cost/time
  const [isLoadingCSV, setIsLoadingCSV] = useState(false);
  
  // Quiz State
  const [quizData, setQuizData] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState(0);
  
  // User Info for Print
  const [userInfo, setUserInfo] = useState({ classNo: '', seatNo: '', name: '' });

  // 1. Load CSV when Level changes
  useEffect(() => {
    const loadData = async () => {
      setIsLoadingCSV(true);
      const data = await fetchAndParseCSV(selectedLevel);
      setFullData(data);
      
      const units = [...new Set(data.map(item => parseInt(item.unit)))].sort((a, b) => a - b);
      setAvailableUnits(units);
      if (units.length > 0) setSelectedUnits([units[0]]);
      
      setIsLoadingCSV(false);
    };
    loadData();
  }, [selectedLevel]);

  // 2. Handle Unit Selection
  const toggleUnit = (unit: number) => {
    setSelectedUnits(prev => 
      prev.includes(unit) 
        ? prev.filter(u => u !== unit) 
        : [...prev, unit].sort((a, b) => a - b)
    );
  };

  // 3. START QUIZ: Pick words locally, then ask API for sentences
  const handleStartQuiz = async () => {
    if (selectedUnits.length === 0) return alert("請至少選擇一個單元");
    
    setStep('generating');

    // A. Filter words by selected units
    const unitWords = fullData.filter(w => selectedUnits.includes(parseInt(w.unit)));
    
    if (unitWords.length < 5) {
      setStep('setup');
      return alert("該範圍單字不足，請增加範圍");
    }

    // B. Randomly select Target Words based on Question Count
    const targets = shuffleArray(unitWords).slice(0, questionCount);

    try {
      // C. Call Backend API to get sentences
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: targets })
      });

      if (!response.ok) throw new Error("API Error");
      
      const { questions } = await response.json();

      // D. Assemble final quiz data (Merge AI sentences with Local Distractors)
      const finalQuiz = questions.map((q: any) => {
        const originalWordObj = targets.find(t => t.word === q.word);
        if (!originalWordObj) return null;

        // Generate Distractors locally (fast & free)
        // Priority: Same Unit -> Same Level -> All Data
        let pool = unitWords.filter(w => w.word !== q.word);
        if (pool.length < 3) pool = fullData.filter(w => w.word !== q.word);
        
        const distractors = shuffleArray(pool).slice(0, 3).map(w => w.word);
        const options = shuffleArray([q.word, ...distractors]);

        return {
          ...originalWordObj, // contains pos, meaning, etc.
          sentence: q.sentence,
          options
        };
      }).filter(Boolean);

      setQuizData(finalQuiz);
      setCurrentQIndex(0);
      setUserAnswers({});
      setScore(0);
      setStep('quiz');

    } catch (error) {
      console.error(error);
      alert("生成題目失敗，可能是 API 連線問題。請稍後再試。");
      setStep('setup');
    }
  };

  // 4. Quiz Logic
  const handleAnswer = (answer: string) => {
    setUserAnswers(prev => ({ ...prev, [currentQIndex]: answer }));
  };

  const handleNext = () => {
    if (currentQIndex < quizData.length - 1) {
      setCurrentQIndex(prev => prev + 1);
    } else {
      // Calculate Score
      const correctCount = quizData.reduce((acc, q, idx) => {
        return acc + (userAnswers[idx] === q.word ? 1 : 0);
      }, 0);
      setScore(correctCount);
      setStep('result');
    }
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-indigo-100 font-sans text-gray-800 print:bg-white">
      
      {/* HEADER */}
      <nav className="p-4 bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-gray-200 print:hidden">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl text-indigo-700">
            <Library className="w-6 h-6" />
            Shirley's iVocab Quiz
          </div>
          <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
             Powered by AI
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto p-4 md:py-10 print:p-0 print:max-w-none">
        
        {/* SETUP SCREEN */}
        {step === 'setup' && (
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl p-6 md:p-10 border border-white">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-yellow-500" /> 設定測驗範圍
            </h2>

            {/* Level Selector */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-500 mb-3">難度等級 (Level)</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => setSelectedLevel(lvl)}
                    className={`px-5 py-2 rounded-full font-semibold transition-all ${
                      selectedLevel === lvl 
                        ? 'bg-indigo-600 text-white shadow-lg scale-105' 
                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Level {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Unit Selector */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-500 mb-3">單元選擇 (Units)</label>
              {isLoadingCSV ? (
                <div className="flex items-center gap-2 text-gray-400 animate-pulse">讀取單字庫中...</div>
              ) : (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 max-h-48 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {availableUnits.map(unit => (
                      <button
                        key={unit}
                        onClick={() => toggleUnit(unit)}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all ${
                          selectedUnits.includes(unit)
                            ? 'bg-indigo-500 text-white shadow-md'
                            : 'bg-white border border-gray-200 text-gray-400 hover:border-indigo-300'
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">已選擇 {selectedUnits.length} 個單元</p>
            </div>

            {/* Question Count */}
            <div className="mb-10">
              <label className="block text-sm font-medium text-gray-500 mb-3">題數</label>
              <div className="grid grid-cols-4 gap-3">
                {[5, 10, 20, 30].map(count => (
                  <button
                    key={count}
                    onClick={() => setQuestionCount(count)}
                    className={`py-3 rounded-xl border transition-all font-medium ${
                      questionCount === count
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleStartQuiz}
              disabled={selectedUnits.length === 0}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold text-lg shadow-xl hover:shadow-2xl hover:scale-[1.01] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              開始生成題目 (AI) <Sparkles className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* LOADING AI SCREEN */}
        {step === 'generating' && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-200 rounded-full animate-ping"></div>
              <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
            </div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">AI 正在撰寫題目...</h3>
            <p className="text-gray-500 max-w-md">
              正在為您選定的 {selectedLevel} 級單字生成符合 A2-C1 難度的例句，請稍候。
            </p>
          </div>
        )}

        {/* QUIZ SCREEN */}
        {step === 'quiz' && quizData.length > 0 && (
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl overflow-hidden border border-white">
            {/* Progress Bar */}
            <div className="h-2 bg-gray-100">
              <div 
                className="h-full bg-indigo-500 transition-all duration-500 ease-out" 
                style={{ width: `${((currentQIndex + 1) / quizData.length) * 100}%` }}
              ></div>
            </div>

            <div className="p-6 md:p-10">
              <div className="flex justify-between items-center mb-8">
                <span className="text-sm font-mono text-gray-400">Q{currentQIndex + 1} / {quizData.length}</span>
                <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded font-bold">
                  Level {quizData[currentQIndex].level} - Unit {quizData[currentQIndex].unit}
                </span>
              </div>

              {/* Question Card */}
              <div className="mb-8">
                <h3 className="text-xl md:text-2xl font-medium leading-relaxed text-gray-800 mb-4">
                  {quizData[currentQIndex].sentence.split('______').map((part: string, i: number) => (
                    <span key={i}>
                      {part}
                      {i === 0 && (
                        <span className="inline-block w-24 border-b-2 border-indigo-400 mx-1 relative top-1"></span>
                      )}
                    </span>
                  ))}
                </h3>
                <div className="flex gap-3 text-sm text-gray-500 mt-4 bg-gray-50 p-3 rounded-lg inline-block">
                   <span className="font-bold">提示:</span> 
                   <span>{quizData[currentQIndex].meaning}</span>
                   <span className="text-gray-300">|</span>
                   <span className="italic">{quizData[currentQIndex].pos}</span>
                </div>
              </div>

              {/* Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {quizData[currentQIndex].options.map((opt: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(opt)}
                    className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-md flex items-center justify-between group ${
                      userAnswers[currentQIndex] === opt
                        ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                        : 'border-gray-100 bg-white hover:border-indigo-200'
                    }`}
                  >
                    <span className={`text-lg font-medium ${userAnswers[currentQIndex] === opt ? 'text-indigo-900' : 'text-gray-600'}`}>
                      {opt}
                    </span>
                    {userAnswers[currentQIndex] === opt && <CheckCircle className="w-5 h-5 text-indigo-600" />}
                  </button>
                ))}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={handleNext}
                  disabled={!userAnswers[currentQIndex]}
                  className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors disabled:opacity-30 flex items-center gap-2"
                >
                  {currentQIndex === quizData.length - 1 ? '提交答案' : '下一題'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESULT SCREEN */}
        {step === 'result' && (
          <div className="bg-white rounded-none md:rounded-3xl shadow-none md:shadow-2xl overflow-hidden print:shadow-none print:w-full">
            
            {/* Screen Header */}
            <div className="bg-gray-900 text-white p-10 text-center print:hidden">
              <Award className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
              <h2 className="text-3xl font-bold mb-2">測驗完成</h2>
              <div className="text-6xl font-black my-4 text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600">
                {score} <span className="text-2xl text-gray-500 font-normal">/ {quizData.length}</span>
              </div>
              <p className="text-gray-400">請填寫下方資訊並列印您的成績單</p>
            </div>

            {/* Print Header (Only visible when printing) */}
            <div className="hidden print:block text-center mb-6 pb-4 border-b-2 border-black pt-4">
              <h1 className="text-2xl font-bold">Shirley's iVocab Quiz Result</h1>
              <p className="text-sm mt-1">Date: {new Date().toLocaleDateString()}</p>
            </div>

            <div className="p-8 print:p-0">
              
              {/* User Info Inputs */}
              <div className="grid grid-cols-3 gap-6 mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200 print:bg-white print:border-none print:p-0 print:gap-4 print:text-sm">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Class</label>
                  <input 
                    type="text" 
                    placeholder="例如: 901"
                    className="w-full bg-transparent border-b border-gray-400 py-1 focus:outline-none focus:border-indigo-600 print:border-black"
                    value={userInfo.classNo}
                    onChange={e => setUserInfo({...userInfo, classNo: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Seat No.</label>
                  <input 
                    type="text" 
                    placeholder="例如: 15"
                    className="w-full bg-transparent border-b border-gray-400 py-1 focus:outline-none focus:border-indigo-600 print:border-black"
                    value={userInfo.seatNo}
                    onChange={e => setUserInfo({...userInfo, seatNo: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
                  <input 
                    type="text" 
                    placeholder="姓名"
                    className="w-full bg-transparent border-b border-gray-400 py-1 focus:outline-none focus:border-indigo-600 print:border-black"
                    value={userInfo.name}
                    onChange={e => setUserInfo({...userInfo, name: e.target.value})}
                  />
                </div>
              </div>

              {/* Score Summary Row for Print */}
              <div className="hidden print:flex justify-between items-center mb-4 border-b border-gray-300 pb-2 font-bold">
                 <span>Level: {selectedLevel} (Units: {selectedUnits.join(',')})</span>
                 <span>Score: {score} / {quizData.length}</span>
              </div>

              {/* Review List */}
              <div className="space-y-4">
                <h3 className="font-bold text-gray-700 print:hidden">答題詳情</h3>
                {quizData.map((q, idx) => {
                  const isCorrect = userAnswers[idx] === q.word;
                  return (
                    <div key={idx} className={`p-4 rounded-lg border flex gap-4 break-inside-avoid ${
                      isCorrect 
                        ? 'bg-green-50 border-green-200 print:bg-white print:border-gray-200' 
                        : 'bg-red-50 border-red-200 print:bg-white print:border-gray-200'
                    }`}>
                      <div className="font-mono text-gray-400 pt-1">{idx + 1}.</div>
                      <div className="flex-1">
                        {/* Sentence with answer filled in */}
                        <p className="text-gray-800 mb-2 leading-relaxed">
                          {q.sentence.split('______').map((part: string, i: number) => (
                            <span key={i}>
                              {part}
                              {i === 0 && (
                                <span className={`font-bold px-1 underline decoration-2 ${isCorrect ? 'decoration-green-500 text-green-700' : 'decoration-red-500 text-red-700'}`}>
                                  {userAnswers[idx] || '(Empty)'}
                                </span>
                              )}
                            </span>
                          ))}
                        </p>
                        
                        {/* Correction if wrong */}
                        {!isCorrect && (
                          <div className="text-sm text-red-600 flex items-center gap-1 mt-1">
                            <XCircle className="w-4 h-4" />
                            Correct answer: <span className="font-bold">{q.word}</span>
                          </div>
                        )}

                        <div className="mt-2 text-xs text-gray-400">
                          {q.meaning} ({q.pos})
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Actions */}
              <div className="mt-8 flex justify-center gap-4 print:hidden">
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> 重置
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-6 py-3 rounded-xl bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 font-medium flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" /> 列印結果
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
