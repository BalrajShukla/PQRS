import { CONFIG } from './config.js';
import { extractCoreFromGemini, extractEditorialFromGemini } from './gemini.js';
import { scoreSyntax, normalizeSpaces, semicolonListFromArray, simpleJournalVariants, orcidFromText } from './utils.js';

function mergeArrayText(list) {
  return (list || []).filter(Boolean).join('; ');
}

function enrichAuthors(authors, orcids) {
  const out = [];
  const len = Math.max(authors?.length || 0, orcids?.length || 0);
  for (let i = 0; i < len; i++) {
    const a = authors?.[i] || {};
    const o = orcids?.[i] || a.orcid || 'Not reported';
    out.push({
      name: normalizeSpaces(a.name || a || ''),
      dept: normalizeSpaces(a.dept || a.department || ''),
      college: normalizeSpaces(a.college || ''),
      university: normalizeSpaces(a.university || ''),
      city: normalizeSpaces(a.city || ''),
      country: normalizeSpaces(a.country || ''),
      orcid: normalizeSpaces(o || 'Not reported') || 'Not reported',
    });
  }
  return out;
}

export async function analyzeManuscript({ apiKey, model, doi, doiMeta, text, url }) {
  const core = await extractCoreFromGemini({ apiKey, model, doi, doiMeta, text, url });
  const editorial = await extractEditorialFromGemini({ apiKey, model, journalName: doiMeta.journalName, title: core.article_title || doiMeta.articleTitle, text });
  const syntax = scoreSyntax(text);

  const authors = enrichAuthors(core.authors || [], doiMeta.orcids || []);
  const authorsText = authors.map((a, idx) => `${idx + 1}. ${a.name || 'Not reported'}`).join('; ');
  const depts = authors.map(a => a.dept || 'Not reported').join('; ');
  const colleges = authors.map(a => a.college || 'Not reported').join('; ');
  const universities = authors.map(a => a.university || 'Not reported').join('; ');
  const cities = authors.map(a => a.city || 'Not reported').join('; ');
  const countries = authors.map(a => a.country || 'Not reported').join('; ');
  const orcids = authors.map(a => a.orcid || 'Not reported').join('; ');

  return {
    doi: doiMeta.doi || doi || 'Not reported',
    issn: doiMeta.issn || 'Not reported',
    journal_name: doiMeta.journalName || 'Not reported',
    article_title: core.article_title || doiMeta.articleTitle || 'Not reported',
    authors: authorsText || 'Not reported',
    affiliation_department: depts || 'Not reported',
    affiliation_college: colleges || 'Not reported',
    affiliation_university: universities || 'Not reported',
    affiliation_city: cities || 'Not reported',
    affiliation_country: countries || 'Not reported',
    orcid_ids: orcids || 'Not reported',
    publisher: doiMeta.publisher || 'Not reported',
    publisher_country: doiMeta.publisherCountry || 'Not reported',
    special_issue: core.special_issue || 'Unclear',
    study_design: core.study_design || 'Not reported',
    reporting_guidelines_claimed: semicolonListFromArray(core.reporting_guidelines_claimed || []),
    reporting_guidelines_followed: core.reporting_guidelines_followed || 'Not reported',
    reporting_guidelines_missing_items: semicolonListFromArray(core.reporting_guidelines_missing_items || []),
    ethics_committee_approval: semicolonListFromArray((core.ethics_sentences || []).map(x => `${x.sentence || ''}${x.approval_number ? ` | ${x.approval_number}` : ''}`)) || 'Not reported',
    trial_registration: [core.trial_registration_status || 'Not reported', core.trial_registration_registry || '', core.trial_registration_number || ''].filter(Boolean).join(' | '),
    protocol_registration: [core.protocol_registration_status || 'Not reported', core.protocol_registration_name || '', core.protocol_registration_link_or_number || ''].filter(Boolean).join(' | '),
    received_to_accepted_days: doiMeta.received && doiMeta.accepted ? Math.max(0, Math.round((new Date(doiMeta.accepted) - new Date(doiMeta.received)) / 86400000)) : 'Not Reported',
    accepted_to_published_days: doiMeta.accepted && doiMeta.published ? Math.max(0, Math.round((new Date(doiMeta.published) - new Date(doiMeta.accepted)) / 86400000)) : 'Not Reported',
    funding: core.funding || 'Not reported',
    journal_self_citation_percentage: editorial.self_citation_percentage ?? 'Not reported',
    scientific_syntax: `${core.scientific_syntax_rating || syntax.rating} (${core.scientific_syntax_error_count ?? syntax.errors} errors)`,
    pubmed_indexed_at_publication: 'Not reported',
    pmc_indexed_at_publication: 'Not reported',
    medline_indexed_at_publication: 'Not reported',
    scopus_indexed_at_publication: 'Not reported',
    embase_indexed_at_publication: 'Not reported',
    doaj_indexed_at_publication: 'Not reported',
    special_issue_evidence: editorial.special_issue_evidence || 'Not reported',
    study_design_evidence: editorial.study_design_evidence || 'Not reported',
    reporting_guidelines_evidence: editorial.reporting_guidelines_evidence || 'Not reported',
    ethics_evidence: semicolonListFromArray(editorial.ethics_evidence || []),
    trial_registration_evidence: editorial.trial_registration_evidence || 'Not reported',
    protocol_registration_evidence: editorial.protocol_registration_evidence || 'Not reported',
    funding_evidence: editorial.funding_evidence || 'Not reported',
    suspicious_reference_notes: semicolonListFromArray(editorial.suspicious_reference_notes || []),
    hallucinated_references: semicolonListFromArray(core.hallucinated_references || []),
    tortured_phrases: semicolonListFromArray(core.tortured_phrases || []),
    notes: core.notes || editorial.publication_type_notes || 'Not reported',
    source_used: doiMeta.source || 'Not reported',
  };
}
