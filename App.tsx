
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, History, BookOpen, Trophy, X, 
  ChevronLeft, Quote, Sparkles,
  MessageCircle, Lightbulb, Check,
  Play, RotateCcw, HelpCircle,
  Filter, ArrowUpDown, Calendar, Target,
  Clock, Zap, AlertTriangle, CheckCircle, AlertCircle, XCircle
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { getAyahBatch, evaluateRecitation, evaluateAudioRecitation, getRateLimitStatus } from './geminiService';
import { AppState, EvaluationResult, HistoryItem, AyahData } from './types';

// Al-Baqarah Pages Logic (Standard Madani: Pages 2 to 49 = 48 Pages)
const TOTAL_PAGES = 48;
const START_PAGE = 2;
const QUESTIONS_PER_TEST = 5;
const TOTAL_TESTS = Math.ceil(TOTAL_PAGES / QUESTIONS_PER_TEST); // 10 Tests

const HINT_PENALTY_PER_WORD = 10; // Strict penalty

// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      if (base64String) {
        const base64Data = base64String.split(',')[1];
        resolve(base64Data);
      } else {
        reject(new Error("Conversion failed"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [activeTestId, setActiveTestId] = useState<number>(0); // 1 to 10
  const [ayahQueue, setAyahQueue] = useState<AyahData[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [sessionResults, setSessionResults] = useState<EvaluationResult[]>([]);
  const [hintsRevealed, setHintsRevealed] = useState<string[]>([]);
  const [quotaPercent, setQuotaPercent] = useState<number>(100);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const timerRef = useRef<any>(null); 
  
  const [historySort, setHistorySort] = useState<'dateDesc' | 'dateAsc' | 'accDesc' | 'accAsc'>('dateDesc');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'correct' | 'mistakes'>('all');

  const recognitionRef = useRef<any>(null);
  
  const mainScrollRef = useRef<HTMLElement>(null);
  const challengeRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const resultCardRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  const executeProgrammaticScroll = (target: React.RefObject<HTMLDivElement | null>, block: 'start' | 'center' | 'end' | 'nearest' = 'center') => {
    if (target.current) {
      target.current.scrollIntoView({ behavior: 'smooth', block });
    }
  };

  useEffect(() => {
    switch (state) {
      case AppState.READY:
        executeProgrammaticScroll(challengeRef);
        break;
      case AppState.RECORDING:
      case AppState.CONFIRMING:
      case AppState.EVALUATING:
        executeProgrammaticScroll(recordingRef, 'center');
        break;
      case AppState.FINISHED:
        executeProgrammaticScroll(resultCardRef, 'start');
        break;
      case AppState.SESSION_SUMMARY:
        executeProgrammaticScroll(summaryRef);
        break;
      case AppState.IDLE:
        mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    }
  }, [state, result]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    const saved = localStorage.getItem('muein_modern_v2');
    if (saved) try { setHistory(JSON.parse(saved)); } catch(e) {}

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'ar-SA';
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setTranscript(finalTranscript + ' ' + interimTranscript);
      };
    }

    const quotaInterval = setInterval(() => {
       const status = getRateLimitStatus();
       setQuotaPercent(status.percentage);
    }, 1000);

    return () => clearInterval(quotaInterval);
  }, []);

  useEffect(() => {
    localStorage.setItem('muein_modern_v2', JSON.stringify(history));
  }, [history]);

  const stats = useMemo(() => {
    if (history.length === 0) return { avg: 0, count: 0, level: 'مبتدئ' };
    const avgScore = Math.round(history.reduce((a, b) => a + b.accuracy, 0) / history.length);
    const countTests = history.length;
    let rank = 'طالب علم';
    if (avgScore > 90 && countTests > 20) rank = 'حافظ مُتقن';
    else if (countTests > 10) rank = 'مُراجع مُواظب';
    return { avg: avgScore, count: countTests, level: rank };
  }, [history]);

  const filteredHistory = useMemo(() => {
    let list = [...history];
    if (historyFilter === 'correct') list = list.filter(h => h.status === 'correct');
    if (historyFilter === 'mistakes') list = list.filter(h => h.status !== 'correct');
    list.sort((a, b) => {
      if (historySort === 'dateDesc') return b.timestamp - a.timestamp;
      if (historySort === 'dateAsc') return a.timestamp - b.timestamp;
      if (historySort === 'accDesc') return b.accuracy - a.accuracy;
      if (historySort === 'accAsc') return a.accuracy - b.accuracy;
      return 0;
    });
    return list;
  }, [history, historySort, historyFilter]);

  const currentAyah = ayahQueue[currentQuestionIndex] || null;

  const getPagesForTest = (testId: number) => {
    const start = START_PAGE + (testId - 1) * QUESTIONS_PER_TEST;
    const pages = [];
    for (let i = 0; i < QUESTIONS_PER_TEST; i++) {
      const p = start + i;
      if (p < START_PAGE + TOTAL_PAGES) pages.push(p);
    }
    return pages;
  };

  const handleStartTest = async (testId: number) => {
    if (quotaPercent === 0) {
      setError("الرجاء الانتظار قليلاً لاستعادة رصيد الطاقة.");
      return;
    }
    setError(null);
    setActiveTestId(testId);
    setState(AppState.LOADING_AYAH);
    setSessionResults([]);
    setCurrentQuestionIndex(0);
    setTranscript('');
    setResult(null);
    setHintsRevealed([]);
    setAudioBlob(null);

    const targetPages = getPagesForTest(testId);

    try {
      const batch = await getAyahBatch(targetPages);
      if (!batch || batch.length === 0) throw new Error("تعذر تحميل الآيات");
      setAyahQueue(batch as AyahData[]);
      setState(AppState.READY);
    } catch (err: any) {
      setError(err.message || "تعذر الاتصال بالذكاء الاصطناعي");
      setState(AppState.IDLE);
    }
  };

  const handleGetHint = () => {
    if (!currentAyah) return;
    const fullTextWords = currentAyah.text.trim().split(/\s+/);
    const startWordsCount = currentAyah.startWords.trim().split(/\s+/).length;
    const availableWords = fullTextWords.slice(startWordsCount);
    if (hintsRevealed.length < availableWords.length) {
      const nextWord = availableWords[hintsRevealed.length];
      setHintsRevealed(prev => [...prev, nextWord]);
    }
  };

  const startRecording = async () => {
    setError(null);
    setTranscript('');
    setAudioBlob(null);
    setRecordingDuration(0);
    audioChunksRef.current = [];
    
    try {
      try { recognitionRef.current?.start(); } catch (e) { }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.start();
      setState(AppState.RECORDING);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (e) {
      setError("يرجى السماح بصلاحية الميكروفون");
      setState(AppState.READY);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try { recognitionRef.current?.stop(); } catch(e) {}

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        if (audioChunksRef.current.length > 0) setState(AppState.CONFIRMING);
        else { setError("لم يتم تسجيل صوت"); setState(AppState.READY); }
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorderRef.current.stop();
    } else {
       setState(AppState.READY);
    }
  };

  const handleEvaluate = async () => {
    if (quotaPercent === 0) {
      setError("نفذ رصيد الطاقة. انتظر لحظات...");
      return;
    }
    setState(AppState.EVALUATING);
    try {
      if (currentAyah) {
        let evalResult: EvaluationResult;
        if (audioBlob) {
           const base64Audio = await blobToBase64(audioBlob);
           evalResult = await evaluateAudioRecitation(currentAyah.text, base64Audio, audioBlob.type || 'audio/webm', currentAyah.page);
        } else {
           evalResult = await evaluateRecitation(currentAyah.text, transcript, currentAyah.page);
        }

        const penalty = hintsRevealed.length * HINT_PENALTY_PER_WORD;
        evalResult.accuracy = Math.max(0, evalResult.accuracy - penalty);
        evalResult.ayahNumber = currentAyah.number;
        
        if (evalResult.accuracy < 90) {
          evalResult.status = 'incorrect';
          evalResult.isPass = false;
        }

        setResult(evalResult);
        setSessionResults(prev => [...prev, evalResult]);
        
        setHistory(prev => [{
          id: Date.now().toString(),
          testId: activeTestId,
          ayahNumber: currentAyah.number,
          pageNumber: currentAyah.page,
          status: evalResult.status,
          accuracy: evalResult.accuracy,
          timestamp: Date.now(),
          textSnippet: currentAyah.text.substring(0, 40)
        }, ...prev].slice(0, 100));
        
        setState(AppState.FINISHED);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "خطأ في تحليل التسميع");
      setState(AppState.CONFIRMING); 
    }
  };

  const nextAyah = () => {
    if (currentQuestionIndex + 1 < ayahQueue.length) {
      setCurrentQuestionIndex(prev => prev + 1);
      setTranscript('');
      setAudioBlob(null);
      setResult(null);
      setHintsRevealed([]);
      setState(AppState.READY);
    } else {
      setState(AppState.SESSION_SUMMARY);
    }
  };

  const pageVariants: Variants = {
    initial: { opacity: 0, y: 30 },
    enter: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
    exit: { opacity: 0, y: -30, transition: { duration: 0.3 } }
  };

  const getQuotaColor = () => quotaPercent > 50 ? 'text-emerald-500' : quotaPercent > 20 ? 'text-amber-500' : 'text-red-500';

  const sessionScore = sessionResults.length > 0 ? Math.round(sessionResults.reduce((a,b) => a + b.accuracy, 0) / sessionResults.length) : 0;
  const sessionPassed = sessionScore >= 90;

  return (
    <div className="flex-1 flex flex-col h-screen max-w-5xl mx-auto w-full px-4 md:px-8 overflow-hidden relative">
      <motion.header 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="h-20 shrink-0 flex items-center justify-between z-50 bg-white/50 backdrop-blur-md"
      >
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setState(AppState.IDLE)}>
          <motion.div whileHover={{ scale: 1.05 }} className="w-12 h-12 bg-emerald-900 text-white rounded-2xl flex items-center justify-center shadow-md">
            <BookOpen size={24} />
          </motion.div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 quran-text leading-none">مُعين</h1>
            <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider">اختبارات سورة البقرة</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-1">
           <div className="flex flex-col items-end mr-2">
             <div className="flex items-center gap-1">
               <span className={`text-[10px] font-black uppercase ${getQuotaColor()}`}>{quotaPercent}%</span>
               <Zap size={16} className={`${getQuotaColor()} fill-current`} />
             </div>
             <div className="w-16 md:w-24 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
               <motion.div initial={{ width: '100%' }} animate={{ width: `${quotaPercent}%` }} className={`h-full ${quotaPercent > 50 ? 'bg-emerald-50' : 'bg-red-50'}`} />
             </div>
           </div>
           <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHistory(true)} className="p-3 rounded-2xl bg-white border border-slate-100 text-slate-500 hover:text-emerald-900 transition-colors shadow-sm">
             <History size={20} />
           </motion.button>
        </div>
      </motion.header>

      <main ref={mainScrollRef} className="flex-1 flex flex-col scroll-container pb-40">
        <AnimatePresence mode="wait">
          {state === AppState.IDLE && (
            <motion.div key="idle" variants={pageVariants} initial="initial" animate="enter" exit="exit" className="flex-none flex flex-col items-center justify-center py-10 min-h-full">
              <div className="text-center space-y-4 mb-8">
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 quran-text">اختبارات التثبيت</h2>
                <p className="text-slate-500 text-sm md:text-base max-w-lg mx-auto">48 صفحة &bull; 10 اختبارات &bull; تقييم صارم</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full max-w-2xl px-2">
                {Array.from({ length: TOTAL_TESTS }).map((_, idx) => {
                  const testId = idx + 1;
                  const pages = getPagesForTest(testId);
                  
                  return (
                    <motion.button 
                      key={testId}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleStartTest(testId)}
                      disabled={quotaPercent === 0}
                      className="relative bg-white p-4 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-500 transition-all flex flex-col items-center gap-2 group overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                         <Target size={60} className="text-emerald-900" />
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-700 font-black text-xl border border-slate-100 group-hover:bg-emerald-900 group-hover:text-white transition-colors z-10">
                        {testId}
                      </div>
                      <div className="text-center z-10">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">الصفحات</span>
                        <span className="text-sm font-bold text-slate-800">{pages[0]} - {pages[pages.length-1]}</span>
                      </div>
                      {idx < 2 && (
                         <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {state === AppState.LOADING_AYAH && (
            <motion.div key="loading" variants={pageVariants} initial="initial" animate="enter" exit="exit" className="flex-1 flex flex-col items-center justify-center gap-6 py-20 min-h-full">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-20 h-20 border-4 border-emerald-50 border-t-emerald-900 rounded-full" />
              <p className="text-xl font-bold text-emerald-900 quran-text">جاري إعداد الاختبار للصفحات المحددة...</p>
            </motion.div>
          )}

          {(state !== AppState.IDLE && state !== AppState.LOADING_AYAH && state !== AppState.SESSION_SUMMARY) && (
            <motion.div key="active-session" variants={pageVariants} initial="initial" animate="enter" exit="exit" className="flex-none flex flex-col min-h-0 py-4">
              <div className="flex items-center justify-between mb-6 px-2 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="h-2 w-32 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / ayahQueue.length) * 100}%` }} className="h-full bg-emerald-900" />
                  </div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">سؤال {currentQuestionIndex + 1} من {ayahQueue.length}</span>
                </div>
                <div className="bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100 text-[10px] font-bold text-emerald-800">
                  اختبار {activeTestId}
                </div>
              </div>

              {state === AppState.FINISHED && result ? (
                <div ref={resultCardRef} className="flex-none flex flex-col bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-24">
                  <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`p-6 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 ${result.isPass ? 'bg-emerald-900 text-white' : 'bg-red-900 text-white'}`}>
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/10 rounded-full backdrop-blur-sm">
                         {result.isPass ? <CheckCircle size={32} className="text-emerald-100" /> : <XCircle size={32} className="text-red-100" />}
                      </div>
                      <div>
                        <h4 className="text-xl font-bold">{result.isPass ? "إجابة موفقة" : "إجابة غير دقيقة"}</h4>
                        <p className="text-white/80 text-xs opacity-90">الدقة: {result.accuracy}% {result.isPass ? "(ممتاز)" : "(يحتاج مراجعة)"}</p>
                      </div>
                    </div>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={nextAyah} className={`px-8 py-3 rounded-xl font-bold text-sm btn-modern flex items-center gap-2 ${result.isPass ? 'bg-white text-emerald-900' : 'bg-white text-red-900'}`}>
                      {currentQuestionIndex + 1 < ayahQueue.length ? 'السؤال التالي' : 'عرض النتيجة النهائية'} <ChevronLeft size={18} />
                    </motion.button>
                  </motion.div>
                  
                  <div className="p-6 md:p-10 space-y-10">
                     <div className="bg-slate-50 p-6 md:p-10 rounded-3xl border border-slate-100">
                      <h5 className="text-[10px] font-black text-slate-400 uppercase mb-6 text-center">التحليل التفصيلي</h5>
                      {/* Detailed Recitation Feedback: User Text Only (Black/Red) */}
                      <div className="quran-text text-xl md:text-3xl text-justify leading-[3.5] dir-rtl flex flex-wrap items-end gap-1">
                        {Array.isArray(result.userComparison) ? result.userComparison.map((word, i) => (
                           <span key={i} className={`rounded-md px-1 transition-colors ${word.isCorrect 
                                ? "text-slate-900" 
                                : "text-red-600"
                              }`}>
                                {word.text}
                           </span>
                        )) : <span className="text-slate-900 italic">{result.userText}</span>}
                      </div>
                      
                      {/* Tajweed Notes Section */}
                      {result.tajweedNotes && (
                        <div className="mt-8 bg-amber-50 rounded-2xl p-6 border border-amber-100 flex gap-4 items-start">
                          <div className="p-2 bg-amber-100 rounded-lg text-amber-700 shrink-0">
                             <AlertTriangle size={20} />
                          </div>
                          <div>
                            <h5 className="font-bold text-amber-900 mb-1">ملاحظات التجويد والأداء</h5>
                            <p className="text-amber-800 text-sm leading-relaxed quran-text">{result.tajweedNotes}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="text-center space-y-6">
                      <div className="inline-flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest">الصفحة {currentAyah?.page}</div>
                      <div className="bg-[#fdfbf7] border-2 border-[#f0eadd] p-6 rounded-xl shadow-inner relative">
                        {/* Page Number decoration */}
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-300 font-sans">{currentAyah?.page}</div>
                        
                        <div className="quran-text text-xl md:text-2xl text-justify text-slate-800 leading-[2.8]" dir="rtl">
                          {result.pageAyahs?.map((ayah, i) => (
                              <React.Fragment key={i}>
                                <span className={ayah.ayahNumber === result.ayahNumber ? 'ayah-highlight text-slate-900 font-bold inline-block px-1' : ''}>{ayah.text}</span>
                                <span className="text-emerald-900 font-bold text-lg mx-2 font-sans inline-block">﴿{ayah.ayahNumber}﴾</span>
                              </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-none flex flex-col items-center justify-center space-y-8 min-h-full">
                  <div ref={contextRef} className="w-full bg-white p-6 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden shrink-0">
                    <div className="absolute top-0 left-0 bg-slate-800 text-white px-4 py-1 rounded-br-2xl text-[10px] font-bold">الصفحة {currentAyah?.page}</div>
                    <div className="absolute top-0 right-0 p-4 text-emerald-900/10"><Quote size={60} /></div>
                    <p className="quran-text text-xl md:text-2xl text-slate-600 text-center italic relative z-10 leading-relaxed px-4">"{currentAyah?.previousAyahText}"</p>
                    <div className="mt-4 flex justify-center gap-4">
                       <span className="text-[10px] font-bold bg-slate-50 px-3 py-1 rounded-full text-slate-400">آية {currentAyah?.previousAyahNumber}</span>
                    </div>
                  </div>
                  <div ref={challengeRef} className="w-full flex-none flex flex-col items-center justify-center space-y-6 py-10">
                    <div className="text-center space-y-4">
                      <p className="text-emerald-900 font-bold text-sm uppercase tracking-widest">أكمل الآية التالية (صفحة {currentAyah?.page}):</p>
                      <h3 className="quran-text text-4xl md:text-6xl text-slate-900 font-bold leading-tight flex flex-wrap justify-center items-center gap-2">
                        <span>{currentAyah?.startWords}</span>
                        <AnimatePresence>
                          {hintsRevealed.map((word, idx) => (
                            <motion.span key={idx} initial={{ opacity: 0, scale: 0.8, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="text-emerald-700 underline decoration-emerald-200 underline-offset-8">{word}</motion.span>
                          ))}
                        </AnimatePresence>
                        <span className="text-emerald-200">...</span>
                      </h3>
                    </div>
                    <div ref={recordingRef} className="w-full max-w-sm pt-4 flex flex-col items-center gap-8">
                      {(state === AppState.READY || state === AppState.RECORDING) && (
                        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleGetHint} className="flex items-center gap-2 px-6 py-2.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-xs font-bold hover:bg-amber-100 transition-colors shadow-sm">
                          <HelpCircle size={16} />تلميح (-{HINT_PENALTY_PER_WORD}%)
                        </motion.button>
                      )}
                      {state === AppState.READY && (
                        <div className="flex flex-col items-center gap-4">
                          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={startRecording} className="w-24 h-24 bg-emerald-900 text-white rounded-full flex items-center justify-center shadow-xl shadow-emerald-900/20 btn-modern"><Mic size={36} /></motion.button>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">اضغط للتسميع</p>
                        </div>
                      )}
                      {state === AppState.RECORDING && (
                        <div className="flex flex-col items-center gap-6 w-full">
                           <motion.button animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} onClick={stopRecording} className="w-24 h-24 bg-red-600 text-white rounded-full flex items-center justify-center shadow-xl shadow-red-600/20 btn-modern relative">
                              <div className="absolute inset-0 bg-red-600 rounded-full animate-ping opacity-20"></div>
                              <div className="w-6 h-6 bg-white rounded-sm"></div>
                           </motion.button>
                           <div className="bg-white px-8 py-4 rounded-2xl border-2 border-emerald-900 text-center shadow-lg w-full max-h-40 overflow-y-auto scroll-smooth">
                             <p className="text-emerald-900 font-bold italic leading-relaxed break-words">{transcript || "جاري الاستماع..."}</p>
                           </div>
                        </div>
                      )}
                      {state === AppState.CONFIRMING && (
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-6 w-full">
                          <div className="bg-white w-full p-8 rounded-3xl border-2 border-dashed border-emerald-100 text-center shadow-sm">
                            <p className="text-2xl font-black text-slate-800 italic break-words">{transcript || "تم تسجيل الصوت"}</p>
                          </div>
                          <div className="flex gap-4 w-full">
                            <button onClick={handleEvaluate} className="flex-[3] py-5 bg-emerald-900 text-white rounded-2xl font-black text-xl shadow-lg btn-modern flex items-center justify-center gap-2">تأكيد <Check size={24}/></button>
                            <button onClick={startRecording} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-bold btn-modern">إعادة</button>
                          </div>
                        </motion.div>
                      )}
                      {state === AppState.EVALUATING && (
                        <div className="flex flex-col items-center gap-4">
                          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-12 h-12 border-4 border-emerald-50 border-t-emerald-900 rounded-full" />
                          <p className="text-sm font-bold text-emerald-900 animate-pulse">جاري التحليل الصارم...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {state === AppState.SESSION_SUMMARY && (
            <motion.div key="summary" ref={summaryRef} variants={pageVariants} initial="initial" animate="enter" exit="exit" className="flex-none flex flex-col items-center justify-center text-center space-y-10 py-20 min-h-full">
              <div className="relative">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 10 }} className={`w-48 h-48 rounded-full flex items-center justify-center shadow-2xl border-8 ${sessionPassed ? 'bg-white border-emerald-50 text-emerald-900' : 'bg-white border-red-50 text-red-900'}`}>
                  {sessionPassed ? <Trophy size={100} /> : <XCircle size={100} />}
                </motion.div>
              </div>
              <div className="space-y-4">
                <h2 className={`text-6xl font-black quran-text ${sessionPassed ? 'text-emerald-900' : 'text-red-900'}`}>
                  {sessionPassed ? "ناجح" : "لم تجتز الاختبار"}
                </h2>
                <p className="text-slate-500 text-xl font-bold">
                  النتيجة النهائية: <span className={sessionPassed ? 'text-emerald-600' : 'text-red-600'}>{sessionScore}%</span>
                </p>
                <p className="text-slate-400">
                  {sessionPassed ? "مبارك! يمكنك الانتقال للاختبار التالي" : "يجب عليك مراجعة الصفحات وإعادة المحاولة"}
                </p>
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setState(AppState.IDLE)} className="px-12 py-5 bg-slate-900 text-white rounded-2xl font-black text-xl shadow-xl flex items-center gap-4 btn-modern">القائمة الرئيسية <RotateCcw size={24} /></motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="bg-white w-full max-w-2xl h-[85vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden relative">
              <div className="p-8 shrink-0 border-b border-slate-50 bg-slate-50/50">
                <div className="flex justify-between items-center mb-6"><h3 className="text-2xl font-black text-slate-900 quran-text">سجل الاختبارات</h3><button onClick={() => setShowHistory(false)} className="p-2 rounded-xl hover:bg-white transition-all text-slate-400"><X size={24}/></button></div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 history-scroll bg-slate-50/30">
                {filteredHistory.map(h => (
                  <motion.div layout key={h.id} className="p-6 bg-white rounded-2xl border border-slate-100 hover:border-emerald-200 transition-all group shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Calendar size={12} />{new Date(h.timestamp).toLocaleDateString('ar-EG')}</div>
                      <div className={`px-4 py-1.5 rounded-full text-[10px] font-black border flex items-center gap-1.5 ${h.accuracy >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                        {h.accuracy >= 90 ? "ناجح" : "إعادة"} ({h.accuracy}%)
                      </div>
                    </div>
                    <p className="quran-text text-xl text-slate-800 leading-relaxed mb-4 line-clamp-2">"{h.textSnippet}..."</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">اختبار {h.testId || "?"}</span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">صفحة {h.pageNumber}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
