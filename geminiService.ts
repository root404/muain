
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AyahData, EvaluationResult, Difficulty } from "./types.ts";

// Free Tier Constraints (Safety margin set to 12 RPM, actual is ~15)
const RPM_LIMIT = 12; 
const TIME_WINDOW_MS = 60000; // 1 Minute

// Helper: Manage Rate Limiting locally
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
  // Filter out old timestamps (> 1 min ago) and add new one
  const validTimestamps = timestamps.filter(t => now - t < TIME_WINDOW_MS);
  validTimestamps.push(now);
  localStorage.setItem('gemini_request_timestamps', JSON.stringify(validTimestamps));
};

export const getRateLimitStatus = () => {
  const timestamps = getRequestTimestamps();
  const now = Date.now();
  const validTimestamps = timestamps.filter(t => now - t < TIME_WINDOW_MS);
  // Calculate remaining percentage
  const used = validTimestamps.length;
  const remaining = Math.max(0, RPM_LIMIT - used);
  const percentage = Math.round((remaining / RPM_LIMIT) * 100);
  
  return {
    used,
    limit: RPM_LIMIT,
    percentage,
    isLimited: used >= RPM_LIMIT
  };
};

const checkRateLimit = () => {
  const status = getRateLimitStatus();
  if (status.isLimited) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
};

const SYSTEM_INSTRUCTION = `
أنت "مُعين"، نظام backend ذكي لتقييم تلاوة القرآن.
مهمتك: إرجاع كائن JSON فقط وفقط، بدون أي نص إضافي، أو مقدمات، أو markdown خارج الـ JSON.

عند التقييم:
1. قارن النص المنطوق بالنص الأصلي حرفياً.
2. حقل 'userComparison' يجب أن يكون مصفوفة (Array) تحتوي على كلمات الآية بالترتيب مع حالة كل كلمة.
3. لا تقم أبداً بكتابة شرح نصي طويل داخل حقول الـ JSON المخصصة للمصفوفات.
`;

const extractCleanJSON = (text: string | undefined): string => {
  if (!text) return "{}";
  
  // Find the first valid JSON start (either { or [)
  const firstOpenBrace = text.indexOf('{');
  const firstOpenBracket = text.indexOf('[');
  
  let startIndex = -1;
  let openChar = '';
  let closeChar = '';

  if (firstOpenBrace !== -1 && (firstOpenBracket === -1 || firstOpenBrace < firstOpenBracket)) {
    startIndex = firstOpenBrace;
    openChar = '{';
    closeChar = '}';
  } else if (firstOpenBracket !== -1) {
    startIndex = firstOpenBracket;
    openChar = '[';
    closeChar = ']';
  } else {
    // No JSON start found, try to strip markdown codes anyway as a fallback
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
  }

  let balance = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === openChar) {
        balance++;
      } else if (char === closeChar) {
        balance--;
        if (balance === 0) {
          // Found the matching closing brace/bracket
          return text.substring(startIndex, i + 1);
        }
      }
    }
  }

  // If we reach here, brackets might be unbalanced or text is truncated
  // Fallback to substring from start
  return text.substring(startIndex);
};

const EVALUATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ["correct", "minor_mistakes", "incorrect"] },
    statusIcon: { type: Type.STRING },
    accuracy: { type: Type.INTEGER },
    tajweedScore: { type: Type.INTEGER },
    feedback: { type: Type.STRING },
    tajweedNotes: { type: Type.STRING },
    memorizationTip: { type: Type.STRING },
    userRecitedText: { type: Type.STRING, description: "النص الذي سمعه النموذج من ملف الصوت" },
    userComparison: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          isCorrect: { type: Type.BOOLEAN },
          correction: { type: Type.STRING }
        }
      }
    }
  },
  required: ["status", "statusIcon", "accuracy", "tajweedScore", "feedback", "tajweedNotes", "memorizationTip", "userComparison"]
};

// Handle generic API errors
const handleApiError = (e: any) => {
  if (e.message === "RATE_LIMIT_EXCEEDED") {
    throw new Error("عفواً، لقد استهلكت رصيد الطلبات المجانية. يرجى الانتظار دقيقة واحدة.");
  }
  // Check for Google API 429
  if (e.toString().includes("429") || e.toString().includes("Resource has been exhausted")) {
    // Force save a timestamp to block immediate retry
    saveRequestTimestamp(); 
    throw new Error("ضغط عالي على الخادم المجاني. يرجى الانتظار لحظات.");
  }
  console.error(e);
  throw e;
};

export const getAyahBatch = async (count: number, difficulty: Difficulty, excludeIds: number[]): Promise<any[]> => {
  try {
    checkRateLimit();
    saveRequestTimestamp(); // Optimistically save timestamp

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `اختر ${count} آيات عشوائية من سورة البقرة لمستوى ${difficulty}. استبعد المعرفات: [${excludeIds.join(',')}]. 
      يجب أن تكون الاستجابة بصيغة JSON حصراً وتتضمن 'pageAyahs'.`,
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
              startWords: { type: Type.STRING },
              pageAyahs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    ayahNumber: { type: Type.INTEGER },
                    text: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["number", "page", "text", "previousAyahText", "previousAyahNumber", "previousAyahPage", "startWords", "pageAyahs"]
          }
        }
      }
    });

    const cleaned = extractCleanJSON(response.text);
    return JSON.parse(cleaned);
  } catch (e) {
    return handleApiError(e);
  }
};

// دالة التقييم القديمة (احتياطية للنصوص)
export const evaluateRecitation = async (original: string, userRecitation: string): Promise<EvaluationResult> => {
  try {
    checkRateLimit();
    saveRequestTimestamp();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `الآية الأصلية: "${original}"
تسميع الطالب (نص): "${userRecitation}"
قيم التسميع بدقة وأرجع JSON فقط.`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: EVALUATION_SCHEMA
      }
    });

    const cleaned = extractCleanJSON(response.text);
    const data = JSON.parse(cleaned);
    return {
      ...data,
      originalText: original,
      userText: userRecitation
    };
  } catch (e) {
    return handleApiError(e);
  }
};

// دالة التقييم الصوتية الجديدة (الأكثر دقة)
export const evaluateAudioRecitation = async (original: string, audioBase64: string, mimeType: string): Promise<EvaluationResult> => {
  try {
    checkRateLimit();
    saveRequestTimestamp();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: [
        {
          text: `الآية الأصلية المطلوبة: "${original}"
قم بتحليل الملف الصوتي المرفق.
المطلوب: إرجاع كائن JSON يحتوي على نتيجة التقييم، Transcription للنص المقروء، ومصفوفة المقارنة (userComparison).
تنبيه: لا تضف أي نص خارج الـ JSON. لا تكتب مقدمة أو خاتمة.`
        },
        {
          inlineData: {
            mimeType: mimeType,
            data: audioBase64
          }
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: EVALUATION_SCHEMA
      }
    });

    const cleaned = extractCleanJSON(response.text);
    const data = JSON.parse(cleaned);
    
    // Safety check to ensure userComparison is an array
    if (!Array.isArray(data.userComparison)) {
      // Emergency fallback if AI fails to return an array
      data.userComparison = original.split(' ').map(w => ({ text: w, isCorrect: true }));
    }

    return {
      ...data,
      originalText: original,
      userText: data.userRecitedText || "تم تحليل الصوت مباشرة"
    };
  } catch (e) {
    return handleApiError(e);
  }
};
