
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AyahData, EvaluationResult } from "./types";

const RPM_LIMIT = 12; 
const TIME_WINDOW_MS = 60000;

const getRequestTimestamps = (): number[] => {
  try {
    const stored = localStorage.getItem('gemini_request_timestamps');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveRequestTimestamp = () => {
  const timestamps = getRequestTimestamps();
  const now = Date.now();
  const validTimestamps = timestamps.filter(t => now - t < TIME_WINDOW_MS);
  validTimestamps.push(now);
  localStorage.setItem('gemini_request_timestamps', JSON.stringify(validTimestamps));
};

export const getRateLimitStatus = () => {
  const timestamps = getRequestTimestamps();
  const now = Date.now();
  const validTimestamps = timestamps.filter(t => now - t < TIME_WINDOW_MS);
  const used = validTimestamps.length;
  const remaining = Math.max(0, RPM_LIMIT - used);
  const percentage = Math.round((remaining / RPM_LIMIT) * 100);
  
  return { used, limit: RPM_LIMIT, percentage, isLimited: used >= RPM_LIMIT };
};

const checkRateLimit = () => {
  const status = getRateLimitStatus();
  if (status.isLimited) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
};

const SYSTEM_INSTRUCTION = `
أنت "مُعين"، ممتحن قرآن صارم جداً.
مهمتك: تقييم الحفظ والتجويد بدقة متناهية لسورة البقرة.

القواعد الصارمة:
1. التقييم: أي خطأ في كلمة (نقص، زيادة، تشكيل يغير المعنى) يعتبر "incorrect".
2. مقارنة الكلمات (userComparison): 
   - المطلوب هنا هو "النص الذي قرأه المستخدم".
   - أعد قائمة بالكلمات التي نطقها المستخدم فعلياً بالترتيب.
   - إذا كانت الكلمة التي نطقها صحيحة ومطابقة للآية، isCorrect: true.
   - إذا كانت الكلمة التي نطقها خاطئة (تحريف أو زيادة)، isCorrect: false.
   - لا تضف الكلمات التي نسيها المستخدم (فقط ما نطق به).
3. عرض الصفحة (pageAyahs):
   - يجب أن تعيد مصفوفة تحتوي على *جميع* آيات الصفحة المحددة كاملة (وليس فقط الآية المختبرة).
   - تأكد من دقة النص القرآني للصفحة كاملة لعرضها في المصحف.
4. التجويد: يجب تقديم ملاحظات دقيقة عن أحكام التجويد (مدود، غنن، قلقلة) في حقل "tajweedNotes".
5. النجاح: (isPass) يكون true فقط إذا كانت الدقة (accuracy) تساوي 90% أو أكثر.
`;

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "{}";
  const pattern = /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/;
  const jsonBlockMatch = text.match(pattern);
  if (jsonBlockMatch && jsonBlockMatch[1]) return jsonBlockMatch[1];
  
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return "{}";
  
  let startIndex = (firstBrace !== -1 && firstBracket !== -1) ? Math.min(firstBrace, firstBracket) : (firstBrace !== -1 ? firstBrace : firstBracket);
  const openChar = text[startIndex];
  const closeChar = openChar === '{' ? '}' : ']';
  
  let balance = 0;
  let inString = false;
  let escaped = false;
  
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    
    if (!inString) {
      if (char === openChar) balance++;
      else if (char === closeChar) {
        balance--;
        if (balance === 0) return text.substring(startIndex, i + 1);
      }
    }
  }
  
  const lastClose = text.lastIndexOf(closeChar);
  if (lastClose > startIndex) return text.substring(startIndex, lastClose + 1);
  return text.substring(startIndex);
};

const EVALUATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ["correct", "minor_mistakes", "incorrect"] },
    isPass: { type: Type.BOOLEAN, description: "True if accuracy >= 90%" },
    accuracy: { type: Type.INTEGER },
    tajweedScore: { type: Type.INTEGER },
    feedback: { type: Type.STRING },
    tajweedNotes: { type: Type.STRING, description: "Specific Tajweed errors (e.g. missed Ghunna, short Madd)." },
    memorizationTip: { type: Type.STRING },
    userRecitedText: { type: Type.STRING },
    userComparison: {
      type: Type.ARRAY,
      description: "List of words actually spoken by the user.",
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "The word spoken by the user." },
          isCorrect: { type: Type.BOOLEAN },
          correction: { type: Type.STRING, description: "Optional: The correct word if this was a mistake." }
        }
      }
    },
    pageAyahs: {
      type: Type.ARRAY,
      description: "ALL ayahs on this specific Quran page.",
      items: {
        type: Type.OBJECT,
        properties: {
          ayahNumber: { type: Type.INTEGER },
          text: { type: Type.STRING }
        }
      }
    }
  },
  required: ["status", "isPass", "accuracy", "tajweedScore", "feedback", "tajweedNotes", "memorizationTip", "userComparison", "userRecitedText", "pageAyahs"]
};

const handleApiError = (e: any) => {
  if (e.message === "RATE_LIMIT_EXCEEDED") throw new Error("عفواً، لقد استهلكت رصيد الطلبات المجانية. يرجى الانتظار دقيقة واحدة.");
  if (e.toString().includes("429") || e.toString().includes("Resource has been exhausted")) {
    saveRequestTimestamp(); 
    throw new Error("ضغط عالي على الخادم المجاني. يرجى الانتظار لحظات.");
  }
  console.error(e);
  throw e;
};

export const getAyahBatch = async (targetPages: number[]): Promise<any[]> => {
  try {
    checkRateLimit();
    saveRequestTimestamp();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `المهمة: إنشاء اختبار لسورة البقرة.
      الصفحات المطلوبة: [${targetPages.join(', ')}].
      
      المطلوب:
      اختر آية واحدة *صعبة* أو متشابهة من *كل صفحة* من الصفحات المذكورة أعلاه بالترتيب.
      
      المخرجات (مصفوفة JSON):
      1. number (رقم الآية)
      2. page (رقم الصفحة - يجب أن يطابق القائمة المطلوبة)
      3. text (نص الآية)
      4. startWords (أول 4 كلمات كسؤال)
      5. previousAyahText (سياق سابق)
      `,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              number: { type: Type.INTEGER },
              page: { type: Type.INTEGER },
              text: { type: Type.STRING },
              previousAyahText: { type: Type.STRING },
              previousAyahNumber: { type: Type.INTEGER },
              previousAyahPage: { type: Type.INTEGER },
              startWords: { type: Type.STRING }
            },
            required: ["number", "page", "text", "previousAyahText", "previousAyahNumber", "previousAyahPage", "startWords"]
          }
        }
      }
    });

    const cleaned = cleanJsonResponse(response.text);
    return JSON.parse(cleaned);
  } catch (e) {
    return handleApiError(e);
  }
};

export const evaluateRecitation = async (original: string, userRecitation: string, pageNumber: number): Promise<EvaluationResult> => {
  try {
    checkRateLimit();
    saveRequestTimestamp();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
      المهمة: تقييم تسميع آية من سورة البقرة (الصفحة ${pageNumber}).
      الآية الأصلية: "${original}".
      تلاوة الطالب: "${userRecitation}".
      
      المطلوب:
      1. حلل تلاوة الطالب كلمة بكلمة في userComparison (أعد فقط ما قاله الطالب).
      2. أعد كتابة نصوص *جميع* آيات الصفحة رقم ${pageNumber} في حقل pageAyahs لعرضها.
      `,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: EVALUATION_SCHEMA
      }
    });

    const cleaned = cleanJsonResponse(response.text);
    return JSON.parse(cleaned);
  } catch (e) {
    return handleApiError(e);
  }
};

export const evaluateAudioRecitation = async (original: string, audioBase64: string, mimeType: string, pageNumber: number): Promise<EvaluationResult> => {
  try {
    checkRateLimit();
    saveRequestTimestamp();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: [
        {
          text: `
          المهمة: تقييم تسميع صوتي لآية من سورة البقرة (الصفحة ${pageNumber}).
          الآية الأصلية: "${original}".
          
          المطلوب:
          1. فرغ الصوت وقيمه بدقة في userComparison (ما قاله الطالب فقط).
          2. أعد كتابة نصوص *جميع* آيات الصفحة رقم ${pageNumber} في حقل pageAyahs.
          `
        },
        { inlineData: { mimeType: mimeType, data: audioBase64 } }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: EVALUATION_SCHEMA
      }
    });

    const cleaned = cleanJsonResponse(response.text);
    let data = JSON.parse(cleaned);
    
    if (!data.userRecitedText) data.userRecitedText = "تم تحليل الصوت";
    
    return {
      ...data,
      originalText: original,
      userText: data.userRecitedText
    };
  } catch (e) {
    return handleApiError(e);
  }
};
