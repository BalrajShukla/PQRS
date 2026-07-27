# PQRS: Probing the Quality of Research in Stomatology

A 100% client-side, GitHub Pages–friendly web app for manuscript metadata, bibliometric, editorial, indexing, and research-integrity extraction.

## What this version does
- Single manuscript or batch processing
- DOI cleaning with a strict DOI regex
- CrossRef and OpenAlex metadata retrieval
- PDF text extraction with browser-side PDF.js
- OCR fallback with Tesseract.js when text extraction is weak
- Gemini-based extraction from manuscript text
- Date-aware indexing checks with NCBI E-utilities best-effort checks
- CSV and Excel export
- Light theme: orange + white
- Dark theme: black + teal
- Optional modules for hallucinated references and tortured phrases
- 25 PDF maximum per batch
- Browser-local API key storage only

## Important note on Gemini
This app is client-side, so each user must paste their own Gemini API key into the settings panel.

### How to get a key
1. Open Google AI Studio.
2. Sign in with your Google account.
3. Create a Gemini API key.
4. Copy the key into PQRS settings.
5. Save settings.

The key remains in the user's browser storage and is not uploaded to GitHub Pages.

## File structure
- `index.html` – app shell
- `styles.css` – responsive styling
- `js/` – application modules
- `data/scopus_issn.json` – user-provided Scopus ISSN list
- `data/embase_issn.json` – user-provided Embase ISSN list

## Batch CSV format
Expected columns:
- `doi`
- `file` or `filename`
- `url` (optional)

## Notes on indexing
PubMed, PMC, and MEDLINE checks are implemented as best-effort live queries via NCBI E-utilities.
If you need stricter historical validation, the app can later be extended with archived journal-index snapshots.

## Hallucinated references and tortured phrases
These are included as Gemini-backed analysis modules in the codebase. They can be made stricter later by adding:
- a reference parser
- a journal-title matcher
- a phrase dictionary
- a suspicious-synonym lexicon
- a scorer that combines rules plus Gemini reasoning

## Suggested future improvement
Add a local reference parser that extracts the bibliography section, then runs DOI and title checks against CrossRef/OpenAlex. That will make hallucinated-reference detection much stronger.
