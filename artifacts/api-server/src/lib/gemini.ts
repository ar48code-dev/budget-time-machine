import { ai } from "@workspace/integrations-gemini-ai";

const MODEL = "gemini-2.5-flash";

function cleanJson(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export async function generateJson<T>({
  systemInstruction,
  prompt,
  inlineData,
}: {
  systemInstruction: string;
  prompt: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}) {
  const request = async (strict: boolean) => {
    const parts = inlineData
      ? [{ text: prompt }, { inlineData }]
      : [{ text: prompt }];
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2,
        ...(strict ? { maxOutputTokens: 8192 } : {}),
      },
    });
    const text = response.text ?? "";
    return JSON.parse(cleanJson(text)) as T;
  };

  try {
    return await request(false);
  } catch {
    return request(true);
  }
}

export async function generateText({
  systemInstruction,
  prompt,
}: {
  systemInstruction: string;
  prompt: string;
}) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { systemInstruction, temperature: 0.35, maxOutputTokens: 8192 },
  });
  return response.text ?? "";
}