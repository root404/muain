
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AyahData, EvaluationResult, Difficulty } from "./types.ts";

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

export const getAyahBatch = async (count: number, difficulty: Difficulty, excludeIds: number[]): Promise<any[]> => {
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

  try {
    const cleaned = cleanJsonResponse(response.text);
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse ayah batch", e, response.text);
    return [];
  }
};

// دالة التقييم القديمة (احتياطية للنصوص)
export const evaluateRecitation = async (original: string, userRecitation: string): Promise<EvaluationResult> => {
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

  try {
    const cleaned = cleanJsonResponse(response.text);
    const data = JSON.parse(cleaned);
    return {
      ...data,
      originalText: original,
      userText: userRecitation
    };
  } catch (e) {
    throw new Error("خطأ في تحليل النص");
  }
};

// دالة التقييم الصوتية الجديدة (الأكثر دقة)
export const evaluateAudioRecitation = async (original: string, audioBase64: string, mimeType: string): Promise<EvaluationResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview", // تم إرجاع النموذج إلى gemini-3-flash-preview بناءً على الطلب
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

  try {
    const cleaned = cleanJsonResponse(response.text);
    const data = JSON.parse(cleaned);
    return {
      ...data,
      originalText: original,
      userText: data.userRecitedText || "تم تحليل الصوت مباشرة"
    };
  } catch (e) {
    console.error("Audio evaluation error", e, response.text);
    throw new Error("حدث خطأ أثناء تحليل الملف الصوتي.");
  }
};
