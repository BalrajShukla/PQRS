import { parseMaybeJson, normalizeSpaces, chunkText } from './utils.js';
import { CONFIG } from './config.js';

async function callGeminiJson({ apiKey, model, prompt }) {
  const res = await fetch(CONFIG.endpoints.gemini(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: 'Return only valid JSON. No markdown. No prose.' }]
      },
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  const json = parseMaybeJson(text);
  if (!json) throw new Error('Gemini response was not valid JSON');
  return json;
}

function buildCorePrompt({ doi, doiMeta, text, url }) {
  const limitedText = chunkText(text, 30000).slice(0, 2).join('\n\n---CHUNK---\n\n');
  return `You are extracting manuscript metadata from a scholarly PDF.

Return a JSON object with exactly these keys:
- article_title
- authors (array of objects with name, dept, college, university, city, country, orcid)
- special_issue (Yes/No/Unclear)
- study_design
- reporting_guidelines_claimed (array of strings)
- reporting_guidelines_followed (Yes/Partially/No)
- reporting_guidelines_missing_items (array of strings)
- ethics_sentences (array of objects with sentence, approval_name, approval_number)
- trial_registration_status (Not applicable/Reported/Not reported)
- trial_registration_number
- trial_registration_registry
- protocol_registration_status (Reported/Not reported)
- protocol_registration_name
- protocol_registration_link_or_number
- funding (Yes/No/Not reported)
- funding_text
- scientific_syntax_rating (Poor/Average/Acceptable)
- scientific_syntax_error_count
- hallucinated_references (array of strings)
- tortured_phrases (array of strings)
- notes

Rules:
1) Use the manuscript text as the primary source.
2) Remove superscripts and abnormal spacing from names.
3) Keep authors in exact authorship order.
4) If ORCID is absent, write "Not reported".
5) For ethics, extract every sentence that mentions IEC/IRB/ethical approval.
6) For trial registration, judge whether the design involves human intervention; if not, "Not applicable".
7) For reporting guidelines, distinguish mere claims from actual compliance and list missing items.
8) For scientific syntax, count clear spelling/grammar/tense issues only.
9) For hallucinated references/tortured phrases, flag suspicious items from the manuscript text.

Context from DOI metadata (may be partial or imperfect):
${JSON.stringify(doiMeta, null, 2)}

Optional URL fallback: ${url || 'Not provided'}

Manuscript text:\n${limitedText}`;
}

function buildEditorialPrompt({ journalName, title, text }) {
  const limitedText = chunkText(text, 30000).slice(0, 2).join('\n\n---CHUNK---\n\n');
  return `Analyze the manuscript and return JSON with these keys:
- self_citation_percentage (number between 0 and 100 or null)
- self_citation_basis (string)
- special_issue_evidence (string)
- study_design_evidence (string)
- reporting_guidelines_evidence (string)
- ethics_evidence (array of strings)
- trial_registration_evidence (string)
- protocol_registration_evidence (string)
- funding_evidence (string)
- publication_type_notes (string)
- suspicious_reference_notes (array of strings)

Current journal: ${journalName || 'Not known'}
Article title: ${title || 'Not known'}

Manuscript text:\n${limitedText}`;
}

export async function extractCoreFromGemini({ apiKey, model, doi, doiMeta, text, url }) {
  const prompt = buildCorePrompt({ doi, doiMeta, text, url });
  return callGeminiJson({ apiKey, model, prompt });
}

export async function extractEditorialFromGemini({ apiKey, model, journalName, title, text }) {
  const prompt = buildEditorialPrompt({ journalName, title, text });
  return callGeminiJson({ apiKey, model, prompt });
}
