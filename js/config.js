export const CONFIG = {
  maxBatchFiles: 25,
  defaultModel: 'gemini-2.5-pro',
  modelOptions: ['gemini-2.5-pro', 'gemini-1.5-pro'],
  storageKeys: {
    apiKey: 'pqrs_gemini_api_key',
    model: 'pqrs_gemini_model',
    theme: 'pqrs_theme',
  },
  endpoints: {
    crossref: (doi) => `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    openalex: (doi) => `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
    pubmedSearch: (term) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(term)}`,
    pubmedFetch: (pmid) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${encodeURIComponent(pmid)}`,
    pmcSearch: (term) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&retmode=json&term=${encodeURIComponent(term)}`,
    nlmCatalogSearch: (term) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog&retmode=json&term=${encodeURIComponent(term)}`,
    nlmCatalogFetch: (id) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nlmcatalog&retmode=json&id=${encodeURIComponent(id)}`,
    orcidSearch: (q) => `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}`,
    gemini: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
  },
};
