
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
أنت "مُعين"، مساعد ذكي متخصص في مراجعة سورة البقرة.
مهمتك هي اختيار آيات للاختبار وتقييم تسميع الطلاب بدقة وموضوعية.

عند اختيار الآيات:
- اختر آيات تتناسب مع مستوى الصعوبة.
- وفر الآية السابقة دائماً لمساعدة الطالب.
- هام جداً: وفر مصفوفة 'pageAyahs' تحتوي على آيات الصفحة الحالية (بحد أقصى 5 آيات محيطة) لنعرضها كصفحة قرآنية.
- تأكد من إرجاع JSON صالح تماماً.

عند التقييم:
1. دقة الحفظ: قارن التلاوة المسموعة (أو النص) بالأصل حرفياً.
2. التجويد: استنتج أخطاء النطق والتشكيل.
3. المقارنة: وفر مصفوفة 'userComparison' توضح أخطاء المستخدم.
`;

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "{}";
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
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

    const cleaned = cleanJsonResponse(response.text);
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
قيم التسميع بدقة.`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: EVALUATION_SCHEMA
      }
    });

    const cleaned = cleanJsonResponse(response.text);
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
          text: `استمع إلى هذا التسجيل الصوتي لتلاوة الطالب.
الآية المطلوبة (النص الأصلي): "${original}"

المطلوب:
1. قم بتحويل الصوت إلى نص (Transcription) للتحقق مما قاله الطالب.
2. قارن التلاوة بالنص الأصلي بدقة متناهية (انتبه للحركات ومخارج الحروف).
3. قيم الحفظ والتجويد.
أرجع النتيجة بصيغة JSON.`
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

    const cleaned = cleanJsonResponse(response.text);
    const data = JSON.parse(cleaned);
    return {
      ...data,
      originalText: original,
      userText: data.userRecitedText || "تم تحليل الصوت مباشرة"
    };
  } catch (e) {
    return handleApiError(e);
  }
};
