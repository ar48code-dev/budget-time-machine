import { GoogleGenAI } from "@google/genai";

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION;
const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

if (!project || !location || !credentialsJson) {
  throw new Error(
    "GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, and GOOGLE_APPLICATION_CREDENTIALS_JSON must be configured for Vertex AI.",
  );
}

let credentials: Record<string, unknown>;
try {
  credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
} catch {
  throw new Error(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON must contain valid service-account JSON.",
  );
}

export const ai = new GoogleGenAI({
  vertexai: true,
  project,
  location,
  googleAuthOptions: { credentials },
});
