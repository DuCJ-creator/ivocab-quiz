'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Printer, RotateCcw, Award, Sparkles, BookOpen, AlertTriangle } from 'lucide-react';
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
  const [questionCount, setQuestionCount] = useState(10);
  const [isLoadingCSV, setIsLoadingCSV] = useState(false);
  
  // Quiz State
  const [quizData, setQuizData] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  
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

  // 3. START QUIZ
  const handleStartQuiz = async () => {
    if (selectedUnits.length === 0) return alert("請至少選擇一個單元");
    
    setStep('generating');

    const unitWords = fullData.filter(w => selectedUnits.includes(parseInt(w.unit)));
    
    if (unitWords.length < 5) {
      setStep('setup');
      return alert("該範圍單字不足，請增加範圍");
    }

    const targets = shuffleArray(unitWords).slice(0, questionCount);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: targets })
      });

      if (!response.ok) throw new Error("API Error");
      
      const { questions } = await response.json();

      const finalQuiz = questions.map((q: any) => {
        const originalWordObj = targets.find(t => t.word === q.word);
        if (!originalWordObj) return null;

        let pool = unitWords.filter(w => w.word !== q.word);
        if (pool.length < 3) pool = fullData.filter(w => w.word !== q.word);
        
        const distractors = shuffleArray(pool).slice(0, 3).map(w => w.word);
        const options = shuffleArray([q.word, ...distractors]);

        return {
          ...originalWordObj,
          sentence: q.sentence,
          options
        };
      }).filter(Boolean);

      setQuizData(finalQuiz);
      setCurrentQIndex(0);
      setUserAnswers({});
      setStep('quiz');

    } catch (error) {
      console.error(error);
      alert("生成題目失敗，請稍後再試。");
      setStep('setup');
    }
  };

  // 4. Quiz Logic (Auto Advance)
  const handleAnswer = (answer: string) => {
    if (userAnswers[currentQIndex]) return;

    setUserAnswers(prev => ({ ...prev, [currentQIndex]: answer }));

    setTimeout(() => {
      if (currentQIndex < quizData.length - 1) {
        setCurrentQIndex(prev => prev + 1);
      } else {
        setStep('result');
      }
    }, 1000); 
  };

  const calculateScore = () => {
    return quizData.reduce((acc, q, idx) => {
      return acc + (userAnswers[idx] === q.word ? 1 : 0);
    }, 0);
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 print:bg-white">
      
      {/* HEADER */}
      <nav className="bg-slate-900 text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500 rounded-lg">
              <BookOpen className="w-8 h-8 text-slate-900" />
            </div>
            <div>
              <h1 className="text-3xl font-serif font-bold tracking-wide text-teal-50">
                Shirley's iVocab Quiz
              </h1>
              <p className="text-teal-400 text-sm font-medium tracking-widest uppercase mt-1">
                GSAT 字彙題型 • 互動練習平台
              </p>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-slate-400">Powered by OpenAI & Vercel</div>
            <div className="text-xs text-slate-500 mt-1">Automatic Grading System</div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto p-6 md:py-12 print:p-0 print:max-w-none">
        
        {/* SETUP SCREEN */}
        {step === 'setup' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 md:p-12 animate-fade-in">
            <div className="border-b border-slate-100 pb-6 mb-8">
              <h2 className="text-2xl font-serif font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-600" /> 
                Configure Assessment
              </h2>
              <p className="text-slate-500 mt-2">請設定您的測驗範圍與難度</p>
            </div>

            {/* Level Selector */}
            <div className="mb-8">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Level</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => setSelectedLevel(lvl)}
                    className={`px-6 py-2 rounded-md font-medium transition-all duration-200 border ${
                      selectedLevel === lvl 
                        ? 'bg-slate-800 text-white border-slate-800 shadow-md' 
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Level {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Unit Selector */}
            <div className="mb-8">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Units (Scope)</label>
              {isLoadingCSV ? (
                <div className="flex items-center gap-2 text-slate-400 animate-pulse text-sm">Synchronizing Database...</div>
              ) : (
                <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 max-h-56 overflow-y-auto custom-scrollbar">
                  <div className="flex flex-wrap gap-2">
                    {availableUnits.map(unit => (
                      <button
                        key={unit}
                        onClick={() => toggleUnit(unit)}
                        className={`w-12 h-12 rounded-md flex items-center justify-center text-sm font-bold transition-all ${
                          selectedUnits.includes(unit)
                            ? 'bg-teal-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-400 hover:border-teal-400 hover:text-teal-600'
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-400 mt-2 text-right">Selected Units: {selectedUnits.length}</p>
            </div>

            {/* Question Count */}
            <div className="mb-10">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Questions</label>
              <div className="grid grid-cols-4 gap-4">
                {[5, 10, 20, 30].map(count => (
                  <button
                    key={count}
                    onClick={() => setQuestionCount(count)}
                    className={`py-3 rounded-md border transition-all font-medium ${
                      questionCount === count
                        ? 'border-teal-600 bg-teal-50 text-teal-800 ring-1 ring-teal-600'
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
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
              className="w-full py-4 bg-slate-900 text-white rounded-lg font-bold text-lg hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Start Quiz
            </button>

            {/* Bilingual Warning */}
            <div className="mt-8 pt-6 border-t border-slate-100 text-center">
              <div className="flex items-center justify-center gap-2 text-amber-600 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-bold uppercase">Disclaimer</span>
              </div>
              <p className="text-xs text-slate-500 italic leading-relaxed max-w-2xl mx-auto">
                Kindly note that the quiz questions are thoughtfully crafted by AI—and while every effort is made for accuracy, occasional slips may still occur.
                <br/>
                敬請留意：本測驗題目由人工智慧精心生成，雖力求準確，偶有疏漏仍在所難免。
              </p>
            </div>
          </div>
        )}

        {/* LOADING SCREEN */}
        {step === 'generating' && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4 animate-fade-in">
            <div className="w-16 h-16 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin mb-6"></div>
            <h3 className="text-xl font-serif font-bold text-slate-800 mb-2">Generating Assessment...</h3>
            <p className="text-slate-500 text-sm">Crafting GSAT-style questions based on your selection.</p>
          </div>
        )}

        {/* QUIZ SCREEN */}
        {step === 'quiz' && quizData.length > 0 && (
          <div className="max-w-3xl mx-auto">
            {/* Progress Indicator */}
            <div className="mb-6 flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>Question {currentQIndex + 1} of {quizData.length}</span>
              <span>Level {quizData[currentQIndex].level}</span>
            </div>

            <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-200">
              <div className="h-1.5 bg-slate-100">
                <div 
                  className="h-full bg-teal-500 transition-all duration-700 ease-out" 
                  style={{ width: `${((currentQIndex + 1) / quizData.length) * 100}%` }}
                ></div>
              </div>

              <div className="p-8 md:p-12">
                {/* Question Sentence */}
                <div className="mb-10">
                  <h3 className="text-xl md:text-2xl font-serif leading-relaxed text-slate-800">
                    {quizData[currentQIndex].sentence.split('______').map((part: string, i: number) => (
                      <span key={i}>
                        {part}
                        {i === 0 && (
                          <span className="inline-block w-32 border-b-2 border-slate-800 mx-2 relative top-1"></span>
                        )}
                      </span>
                    ))}
                  </h3>
                  
                  {/* Subtle POS Hint - NO CHINESE */}
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                      Hint: {quizData[currentQIndex].pos}
                    </span>
                  </div>
                </div>

                {/* Options Grid */}
                <div className="grid grid-cols-1 gap-3">
                  {quizData[currentQIndex].options.map((opt: string, idx: number) => {
                    const isSelected = userAnswers[currentQIndex] === opt;
                    const isCorrect = opt === quizData[currentQIndex].word;
                    
                    let btnStyle = "border-slate-200 hover:bg-slate-50 text-slate-600";
                    
                    if (userAnswers[currentQIndex]) {
                        if (isSelected && isCorrect) {
                            btnStyle = "border-teal-500 bg-teal-50 text-teal-800 font-bold ring-1 ring-teal-500";
                        } else if (isSelected && !isCorrect) {
                            btnStyle = "border-red-500 bg-red-50 text-red-800 ring-1 ring-red-500";
                        } else if (!isSelected && isCorrect) {
                            btnStyle = "border-teal-500 bg-teal-50 text-teal-800 ring-1 ring-teal-500 opacity-70";
                        } else {
                            btnStyle = "border-slate-100 text-slate-300 opacity-50";
                        }
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(opt)}
                        disabled={!!userAnswers[currentQIndex]}
                        className={`p-4 rounded-lg border-2 text-left transition-all duration-200 flex items-center justify-between group ${btnStyle}`}
                      >
                        <span className="text-lg">{opt}</span>
                        {userAnswers[currentQIndex] && isCorrect && <CheckCircle className="w-5 h-5 text-teal-600" />}
                        {userAnswers[currentQIndex] && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-red-500" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="text-center mt-6 text-slate-400 text-sm italic">
                Select an option to automatically proceed.
            </div>
          </div>
        )}

        {/* RESULT SCREEN */}
        {step === 'result' && (
          <div className="bg-white max-w-4xl mx-auto print:w-full">
            
            {/* Screen Header */}
            <div className="bg-slate-900 text-white p-12 text-center rounded-xl shadow-xl mb-8 print:hidden">
              <Award className="w-16 h-16 text-teal-400 mx-auto mb-4" />
              <h2 className="text-3xl font-serif font-bold mb-2">Assessment Complete</h2>
              <div className="text-6xl font-black my-6 text-teal-400">
                {calculateScore()} <span className="text-2xl text-slate-500 font-normal">/ {quizData.length}</span>
              </div>
              <p className="text-slate-400">Please fill in your details below to print the official report.</p>
            </div>

            {/* Print Header */}
            <div className="hidden print:block mb-8 pb-4 border-b-2 border-black">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-serif font-bold text-black">Shirley's iVocab Quiz (GSAT)</h1>
                  <p className="text-sm mt-1 text-gray-600">Performance Report</p>
                </div>
                <div className="text-right text-sm">
                  <p>Date: {new Date().toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            <div className="print:p-0">
              
              {/* User Info Inputs */}
              <div className="grid grid-cols-3 gap-8 mb-10 bg-slate-50 p-8 rounded-lg border border-slate-200 print:bg-white print:border-none print:p-0 print:mb-6 print:gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Class</label>
                  <input 
                    type="text" 
                    className="w-full bg-transparent border-b border-slate-300 py-1 focus:outline-none focus:border-teal-600 font-serif text-lg print:border-black"
                    value={userInfo.classNo}
                    onChange={e => setUserInfo({...userInfo, classNo: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Seat No.</label>
                  <input 
                    type="text" 
                    className="w-full bg-transparent border-b border-slate-300 py-1 focus:outline-none focus:border-teal-600 font-serif text-lg print:border-black"
                    value={userInfo.seatNo}
                    onChange={e => setUserInfo({...userInfo, seatNo: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-transparent border-b border-slate-300 py-1 focus:outline-none focus:border-teal-600 font-serif text-lg print:border-black"
                    value={userInfo.name}
                    onChange={e => setUserInfo({...userInfo, name: e.target.value})}
                  />
                </div>
              </div>

              {/* Score Summary Row for Print */}
              <div className="hidden print:flex justify-between items-center mb-6 border-b border-gray-900 pb-2 font-bold font-serif text-lg">
                 <span>Level: {selectedLevel} (Units: {selectedUnits.join(', ')})</span>
                 <span>Score: {calculateScore()} / {quizData.length}</span>
              </div>

              {/* Review List */}
              <div className="space-y-4">
                <h3 className="font-bold text-slate-700 uppercase tracking-wide text-sm mb-4 print:hidden">Detailed Review</h3>
                {quizData.map((q, idx) => {
                  const isCorrect = userAnswers[idx] === q.word;
                  return (
                    <div key={idx} className={`p-5 rounded-lg border flex gap-5 break-inside-avoid ${
                      isCorrect 
                        ? 'bg-teal-50/50 border-teal-100 print:bg-white print:border-gray-200' 
                        : 'bg-red-50/50 border-red-100 print:bg-white print:border-gray-200'
                    }`}>
                      <div className="font-mono text-slate-400 pt-1 text-sm">{String(idx + 1).padStart(2, '0')}.</div>
                      <div className="flex-1">
                        {/* Sentence */}
                        <p className="text-slate-800 mb-2 leading-relaxed font-serif text-lg">
                          {q.sentence.split('______').map((part: string, i: number) => (
                            <span key={i}>
                              {part}
                              {i === 0 && (
                                <span className={`font-bold px-2 mx-1 border-b-2 ${
                                    isCorrect 
                                    ? 'border-teal-500 text-teal-800' 
                                    : 'border-red-500 text-red-700'
                                }`}>
                                  {userAnswers[idx] || '(No Answer)'}
                                </span>
                              )}
                            </span>
                          ))}
                        </p>
                        
                        {/* Correction if wrong */}
                        {!isCorrect && (
                          <div className="text-sm text-red-600 flex items-center gap-1 mt-2 font-medium">
                            <XCircle className="w-4 h-4" />
                            Correct Answer: <span className="font-bold underline">{q.word}</span>
                          </div>
                        )}

                        {/* Metadata Footer: Source + POS + Meaning */}
                        <div className="mt-3 pt-2 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap items-center gap-3">
                          {/* Part of Speech */}
                          <span className="font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-600">
                            {q.pos}
                          </span>
                          
                          {/* NEW: Source Tag (Level-Unit-No) */}
                          <span className="font-mono font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-100">
                            {`L${q.level}-U${q.unit}-${q.no}`}
                          </span>

                          {/* Meaning */}
                          <span className="text-slate-600">{q.meaning}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Actions */}
              <div className="mt-12 flex justify-center gap-4 print:hidden pb-12">
                <button
                  onClick={() => window.location.reload()}
                  className="px-8 py-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium flex items-center gap-2 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" /> New Quiz
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-8 py-3 rounded-lg bg-teal-600 text-white shadow-lg hover:bg-teal-700 font-medium flex items-center gap-2 transition-colors hover:shadow-xl"
                >
                  <Printer className="w-4 h-4" /> Print Report
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
