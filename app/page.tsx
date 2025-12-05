'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, Printer, RotateCcw, Award, Sparkles, BookOpen, FileText, MonitorPlay, Edit3, ArrowLeft } from 'lucide-react';
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

// Helper: Get Letter for Index (0->A, 1->B...)
const getOptionLabel = (index: number) => String.fromCharCode(65 + index);

export default function Home() {
  // Mode: 'online' (interactive) or 'paper' (printable view)
  const [mode, setMode] = useState<'online' | 'paper'>('online');
  const [step, setStep] = useState<'setup' | 'generating' | 'quiz' | 'result'>('setup');
  
  // Data State
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [fullData, setFullData] = useState<VocabWord[]>([]);
  const [availableUnits, setAvailableUnits] = useState<number[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);
  const [questionCount, setQuestionCount] = useState(10); // Default for online
  const [isLoadingCSV, setIsLoadingCSV] = useState(false);
  
  // Quiz State
  const [quizData, setQuizData] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  
  // User Info for Online Result Print
  const [userInfo, setUserInfo] = useState({ classNo: '', seatNo: '', name: '' });
  
  // Paper specific state
  const paperRef = useRef<HTMLDivElement>(null);

  // Load Data
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

  const toggleUnit = (unit: number) => {
    setSelectedUnits(prev => prev.includes(unit) ? prev.filter(u => u !== unit) : [...prev, unit].sort((a, b) => a - b));
  };

  // Main Generator Logic
  const generateQuiz = async (targetMode: 'online' | 'paper') => {
    if (selectedUnits.length === 0) return alert("請至少選擇一個單元");
    
    // For Paper mode, force 30 questions (or max available)
    const targetCount = targetMode === 'paper' ? 30 : questionCount;

    setStep('generating');
    setMode(targetMode);

    const unitWords = fullData.filter(w => selectedUnits.includes(parseInt(w.unit)));
    
    if (unitWords.length < 5) {
      setStep('setup');
      return alert("該範圍單字不足以生成測驗，請增加範圍。");
    }

    // Prepare target words
    const targets = shuffleArray(unitWords).slice(0, targetCount);

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

        // Generate Distractors
        let pool = unitWords.filter(w => w.word !== q.word);
        // If unit pool is too small, expand to full level
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
      // Clear user info on new quiz
      setUserInfo({ classNo: '', seatNo: '', name: '' }); 
      setStep(targetMode === 'online' ? 'quiz' : 'result'); // Paper goes straight to result view

    } catch (error) {
      console.error(error);
      alert("生成題目失敗，請稍後再試。");
      setStep('setup');
    }
  };

  const handleAnswer = (answer: string) => {
    if (userAnswers[currentQIndex]) return;
    setUserAnswers(prev => ({ ...prev, [currentQIndex]: answer }));
    setTimeout(() => {
      if (currentQIndex < quizData.length - 1) setCurrentQIndex(prev => prev + 1);
      else setStep('result');
    }, 1000); 
  };

  const calculateScore = () => quizData.reduce((acc, q, idx) => acc + (userAnswers[idx] === q.word ? 1 : 0), 0);
  const getWordInfo = (word: string) => fullData.find(w => w.word === word);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 print:bg-white">
      {/* Navigation - Hidden when printing */}
      <nav className="bg-slate-900 text-white shadow-lg print:hidden">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500 rounded-lg"><BookOpen className="w-8 h-8 text-slate-900" /></div>
            <div>
              <h1 className="text-3xl font-serif font-bold tracking-wide text-teal-50">Shirley's iVocab Quiz</h1>
              <p className="text-teal-400 text-sm font-medium tracking-widest uppercase mt-1">GSAT 字彙題型 • 互動練習平台</p>
            </div>
          </div>
          {step !== 'setup' && (
             <button onClick={() => window.location.reload()} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
               <RotateCcw className="w-4 h-4" /> Reset
             </button>
          )}
        </div>
      </nav>

      <main className="max-w-4xl mx-auto p-6 md:py-12 print:p-0 print:max-w-none print:w-full">
        
        {/* SETUP SCREEN */}
        {step === 'setup' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 md:p-12">
            <h2 className="text-2xl font-serif font-bold text-slate-800 flex items-center gap-2 mb-8"><Sparkles className="w-5 h-5 text-teal-600" /> Configure Assessment</h2>
            
            {/* Level Selection */}
            <div className="mb-8">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Level</label>
              <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6].map(lvl => (<button key={lvl} onClick={() => setSelectedLevel(lvl)} className={`px-6 py-2 rounded-md font-medium border ${selectedLevel === lvl ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>Level {lvl}</button>))}</div>
            </div>

            {/* Unit Selection */}
            <div className="mb-8">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Units</label>
              {isLoadingCSV ? <div className="animate-pulse text-slate-400">Loading Dictionary...</div> : <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 max-h-56 overflow-y-auto"><div className="flex flex-wrap gap-2">{availableUnits.map(unit => (<button key={unit} onClick={() => toggleUnit(unit)} className={`w-12 h-12 rounded-md font-bold text-sm ${selectedUnits.includes(unit) ? 'bg-teal-600 text-white' : 'bg-white border text-slate-400'}`}>{unit}</button>))}</div></div>}
            </div>

            {/* Questions Count (Online Only) */}
            <div className="mb-10">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Questions (Online Mode Only)</label>
              <div className="grid grid-cols-4 gap-4">{[5, 10, 20, 30].map(count => (<button key={count} onClick={() => setQuestionCount(count)} className={`py-3 rounded-md border font-medium ${questionCount === count ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'}`}>{count}</button>))}</div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button onClick={() => generateQuiz('online')} disabled={selectedUnits.length === 0} className="w-full py-4 bg-slate-900 text-white rounded-lg font-bold text-lg hover:bg-slate-800 shadow-lg flex justify-center items-center gap-2">
                <MonitorPlay className="w-5 h-5" /> Start Online Quiz
              </button>
              <button onClick={() => generateQuiz('paper')} disabled={selectedUnits.length === 0} className="w-full py-4 bg-white border-2 border-slate-900 text-slate-900 rounded-lg font-bold text-lg hover:bg-slate-50 shadow-sm flex justify-center items-center gap-2">
                <FileText className="w-5 h-5" /> Generate Paper Quiz
              </button>
            </div>
            
            <div className="mt-8 pt-6 border-t border-slate-100 text-center px-4">
              <p className="text-xs text-slate-500 italic leading-relaxed">
                Kindly note that the reading materials are thoughtfully crafted by AI—and while every effort is made for accuracy, occasional slips may still occur.<br/>
                敬請留意：本閱讀材料由人工智慧精心生成，雖力求準確，偶有疏漏仍在所難免。
              </p>
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {step === 'generating' && (
          <div className="text-center py-20">
            <div className="w-16 h-16 border-4 border-t-teal-600 rounded-full animate-spin mx-auto mb-6"></div>
            <h3 className="text-xl font-serif font-bold">Generating {mode === 'paper' ? 'Paper Quiz' : 'Questions'}...</h3>
            <p className="text-slate-500 mt-2">Consulting the AI Engine</p>
          </div>
        )}

        {/* ONLINE QUIZ MODE */}
        {step === 'quiz' && mode === 'online' && quizData.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6 flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest"><span>Question {currentQIndex + 1}/{quizData.length}</span><span>Level {quizData[currentQIndex].level}</span></div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 md:p-12">
              <h3 className="text-xl font-serif leading-relaxed mb-10">{quizData[currentQIndex].sentence.split('______').map((part:string, i:number) => <span key={i}>{part}{i===0 && <span className="inline-block w-32 border-b-2 border-slate-800 mx-2 relative top-1"></span>}</span>)}</h3>
              <div className="mt-4 mb-10 text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded inline-block">Hint: {quizData[currentQIndex].pos}</div>
              <div className="grid gap-3">{quizData[currentQIndex].options.map((opt:string, idx:number) => {
                let style = "border-slate-200 hover:bg-slate-50 text-slate-600";
                if(userAnswers[currentQIndex]) {
                  if(userAnswers[currentQIndex] === opt && opt === quizData[currentQIndex].word) style = "border-teal-500 bg-teal-50 text-teal-800 ring-1 ring-teal-500";
                  else if(userAnswers[currentQIndex] === opt) style = "border-red-500 bg-red-50 text-red-800 ring-1 ring-red-500";
                  else if(opt === quizData[currentQIndex].word) style = "border-teal-500 bg-teal-50 text-teal-800 opacity-70";
                  else style = "opacity-50";
                }
                return <button key={idx} onClick={() => handleAnswer(opt)} disabled={!!userAnswers[currentQIndex]} className={`p-4 rounded-lg border-2 text-left flex justify-between items-center ${style}`}><span className="text-lg">{opt}</span></button>
              })}</div>
            </div>
          </div>
        )}

        {/* ONLINE RESULT MODE */}
        {step === 'result' && mode === 'online' && (
          <div className="bg-white max-w-4xl mx-auto">
            
            {/* Online Header (Hidden when printing, replaced by text) */}
            <div className="bg-slate-900 text-white p-12 text-center rounded-xl shadow-xl mb-8 print:hidden">
              <Award className="w-16 h-16 text-teal-400 mx-auto mb-4" />
              <h2 className="text-3xl font-serif font-bold">Assessment Complete</h2>
              <div className="text-6xl font-black my-6 text-teal-400">{calculateScore()} <span className="text-2xl text-slate-500 font-normal">/ {quizData.length}</span></div>
            </div>

            {/* Print Header for Online Mode */}
            <div className="hidden print:block border-b-2 border-black mb-6 pb-2">
              <h1 className="text-2xl font-bold">Shirley's iVocab Quiz Result</h1>
              <p className="text-lg mt-1">Score: <span className="font-bold text-2xl">{calculateScore()}</span> / {quizData.length}</p>
            </div>

            {/* User Input Section (Interactive) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 bg-slate-50 p-6 rounded-lg border border-slate-200 print:bg-white print:border-none print:p-0 print:mb-6">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 print:text-black">Class</label>
                    <input 
                      value={userInfo.classNo}
                      onChange={(e) => setUserInfo({...userInfo, classNo: e.target.value})}
                      className="w-full bg-transparent border-b-2 border-slate-300 py-1 font-serif text-lg focus:outline-none focus:border-teal-500 print:border-black"
                      placeholder="Input Class..."
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 print:text-black">Seat No.</label>
                    <input 
                      value={userInfo.seatNo}
                      onChange={(e) => setUserInfo({...userInfo, seatNo: e.target.value})}
                      className="w-full bg-transparent border-b-2 border-slate-300 py-1 font-serif text-lg focus:outline-none focus:border-teal-500 print:border-black"
                      placeholder="Input No..."
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 print:text-black">Name</label>
                    <input 
                      value={userInfo.name}
                      onChange={(e) => setUserInfo({...userInfo, name: e.target.value})}
                      className="w-full bg-transparent border-b-2 border-slate-300 py-1 font-serif text-lg focus:outline-none focus:border-teal-500 print:border-black"
                      placeholder="Input Name..."
                    />
                </div>
            </div>
            
            <div className="space-y-6">
              {quizData.map((q, idx) => {
                const isCorrect = userAnswers[idx] === q.word;
                return (
                  <div key={idx} className={`p-6 rounded-lg border shadow-sm break-inside-avoid ${isCorrect ? 'bg-white border-teal-100' : 'bg-red-50/10 border-red-100'}`}>
                    <div className="flex gap-4 mb-4">
                       <span className={`font-mono text-sm pt-1 ${isCorrect ? 'text-teal-600' : 'text-red-500'}`}>{String(idx+1).padStart(2,'0')}.</span>
                       <div className="flex-1">
                         <p className="text-slate-800 leading-relaxed font-serif text-lg">
                           {q.sentence.split('______').map((p:string,i:number)=><span key={i}>{p}{i===0 && <span className={`font-bold px-2 mx-1 border-b-2 ${isCorrect ? 'border-teal-500 text-teal-800' : 'border-red-500 text-red-700'}`}>{userAnswers[idx] || '(No Ans)'}</span>}</span>)}
                         </p>
                         {!isCorrect && <div className="text-sm text-red-600 font-bold mt-2">Correct Answer: {q.word}</div>}
                       </div>
                    </div>
                    {/* Detailed Review Table */}
                    <div className="ml-8 mt-4 bg-slate-50 rounded-md p-4 border border-slate-100 print:bg-white print:border-slate-200">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Vocabulary Review</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500">
                              <th className="pb-2 font-medium w-32">Word</th>
                              <th className="pb-2 font-medium w-16">POS</th>
                              <th className="pb-2 font-medium">Meaning</th>
                              <th className="pb-2 font-medium w-24">Source</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/50">
                            {q.options.map((opt: string, optIdx: number) => {
                              const info = getWordInfo(opt);
                              const isTarget = opt === q.word;
                              return (
                                <tr key={optIdx} className={isTarget ? "bg-teal-50/50 print:bg-slate-100" : ""}>
                                  <td className={`py-2 pr-2 font-medium ${isTarget ? "text-teal-700" : "text-slate-700"}`}>
                                    {opt} {isTarget && <CheckCircle className="w-3 h-3 inline ml-1 text-teal-500"/>}
                                  </td>
                                  <td className="py-2 pr-2 text-slate-500 italic">{info?.pos || '-'}</td>
                                  <td className="py-2 pr-2 text-slate-600">{info?.meaning || '-'}</td>
                                  <td className="py-2 text-slate-400 font-mono text-xs">{info ? `L${info.level}-U${info.unit}` : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Online Action Buttons (Hidden on Print) */}
            <div className="mt-12 flex justify-center gap-4 print:hidden pb-12">
              <button onClick={() => window.location.reload()} className="px-8 py-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 flex gap-2"><RotateCcw className="w-4 h-4" /> New Quiz</button>
              <button onClick={() => window.print()} className="px-8 py-3 rounded-lg bg-teal-600 text-white shadow-lg hover:bg-teal-700 flex gap-2"><Printer className="w-4 h-4" /> Print Report</button>
            </div>
          </div>
        )}

        {/* PAPER RESULT (PRINT MODE) */}
        {step === 'result' && mode === 'paper' && (
           <div className="max-w-none w-full bg-white text-black">
              {/* Controls */}
              <div className="print:hidden mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-yellow-800">
                   <Edit3 className="w-5 h-5" /> 
                   <span className="text-sm font-bold">Editable Mode: Click text to edit.</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep('setup')} className="px-4 py-2 rounded bg-white border border-slate-300 text-sm font-bold hover:bg-slate-50 flex items-center gap-2"><ArrowLeft className="w-4 h-4"/> Back</button>
                  <button onClick={() => window.print()} className="px-4 py-2 rounded bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 flex items-center gap-2"><Printer className="w-4 h-4"/> Print A4</button>
                </div>
              </div>

              {/* Editable Content */}
              <div ref={paperRef} contentEditable suppressContentEditableWarning className="outline-none" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
                
                {/* --- QUESTION SHEET --- */}
                <div className="print-section">
                  {/* Header */}
                  <div className="border-b-2 border-black pb-2 mb-6">
                    <h1 className="text-2xl font-bold text-center mb-4">iVocab Level {selectedLevel} Unit(s) {selectedUnits.join(', ')} Gap Filling Quiz</h1>
                    
                    {/* One Line Info Header - Optimized with whitespace-nowrap */}
                    <div className="flex justify-between items-end w-full text-[12pt] font-medium leading-none mb-2 whitespace-nowrap">
                        <div className="w-[18%]">Class: <span className="inline-block border-b border-black w-12"></span></div>
                        <div className="w-[18%]">Seat No.: <span className="inline-block border-b border-black w-10"></span></div>
                        <div className="w-[30%]">Name: <span className="inline-block border-b border-black w-32"></span></div>
                        <div className="w-[18%]">Date: <span className="inline-block border-b border-black w-16"></span></div>
                        <div className="w-auto text-right">Score: <span className="inline-block border-b border-black w-12"></span> <span className="text-[10pt] align-top">(3*{quizData.length}+10)</span></div>
                    </div>
                  </div>

                  {/* Questions List - 12pt Times New Roman */}
                  <div className="space-y-4 text-[12pt] leading-tight">
                    {quizData.map((q, idx) => (
                      <div key={idx} className="break-inside-avoid">
                        <div className="flex gap-2">
                          <span className="font-bold">{idx + 1}.</span>
                          <div className="w-full">
                            {/* Sentence */}
                            <p className="mb-1 text-justify">
                               {q.sentence.replace('______', '__________')}
                            </p>
                            {/* Options on same line */}
                            <div className="flex flex-wrap gap-x-8 gap-y-1">
                              {q.options.map((opt: string, oIdx: number) => (
                                <span key={oIdx}>
                                  ({getOptionLabel(oIdx)}) {opt}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* --- PAGE BREAK --- */}
                <div className="break-before-page mt-10 pt-10 border-t-2 border-dashed border-slate-300 print:border-none"></div>

                {/* --- ANSWER KEY SHEET (2 Columns, Tightened) --- */}
                <div className="print-section">
                  <div className="border-b-2 border-black pb-2 mb-2">
                     <h1 className="text-xl font-bold text-center">Answer Key & Analysis</h1>
                     <p className="text-center text-sm">Level {selectedLevel} Unit(s) {selectedUnits.join(', ')}</p>
                  </div>

                  {/* 2 Column Grid for Answer Key - Tight Spacing */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10pt]">
                    {quizData.map((q, idx) => {
                      const correctIndex = q.options.indexOf(q.word);
                      return (
                        <div key={idx} className="flex gap-2 break-inside-avoid border-b border-slate-100 pb-1">
                           <div className="font-bold w-6 text-base">{idx+1}.</div>
                           <div className="w-6 font-bold text-base">({getOptionLabel(correctIndex)})</div>
                           <div className="flex-1 min-w-0">
                              <div className="font-bold underline mb-0.5">{q.word}</div>
                              <div className="flex flex-wrap gap-2 text-slate-600 text-[9pt]">
                                 <span className="italic font-serif">{q.pos}</span>
                                 <span>{q.meaning}</span>
                                 <span className="text-slate-400 font-sans tracking-tight">L{q.level}-U{q.unit}</span>
                              </div>
                           </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
           </div>
        )}

      </main>

      {/* Global Print Styles */}
      <style jsx global>{`
        @media print {
          @page { margin: 1cm; size: A4; }
          body { background: white; color: black; }
          .break-before-page { page-break-before: always; }
          .break-inside-avoid { page-break-inside: avoid; }
          /* Enforce Times New Roman in print specifically for paper mode */
          .print-section { font-family: "Times New Roman", Times, serif; }
          ::-webkit-scrollbar { display: none; }
        }
      `}</style>
    </div>
  );
}
