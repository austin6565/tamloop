/** Conservative identity matching. A shared domain never merges two entities. */
export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function normalizeDomain(value) {
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

export function normalizeCandidate(row, source) {
  const name = String(row.name ?? '').trim();
  const region = String(row.region ?? '').trim().toUpperCase();
  const entityType = String(row.entityType ?? 'company').trim().toLowerCase();
  const domain = normalizeDomain(row.domain);
  const evidence = [...new Set((row.evidence ?? []).filter((url) => {
    try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
  }))];
  return {
    key: [normalizeName(name), region, entityType].join('|'),
    name, region, entityType, domain,
    sourceStatus: String(row.sourceStatus ?? ''),
    sources: [{ provider: source, ref: String(row.sourceRef ?? '') }],
    evidence, status: 'candidate', score: null, reason: '',
  };
}

export function hardGate(candidate, hypothesis) {
  if (!normalizeName(candidate.name)) return 'missing_company_name';
  if (hypothesis.excludedDomains?.map(normalizeDomain).includes(candidate.domain) && candidate.domain)
    return 'excluded_domain';
  if (hypothesis.excludedNames?.map(normalizeName).includes(normalizeName(candidate.name)))
    return 'excluded_name';
  if (hypothesis.allowedRegions?.length && candidate.region &&
      !hypothesis.allowedRegions.map((x) => x.toUpperCase()).includes(candidate.region))
    return 'outside_region';
  return null;
}

export function applyJudgment(candidate, judgment = {}) {
  const validStatuses = new Set(['candidate', 'needs_review', 'qualified', 'excluded']);
  const requested = validStatuses.has(judgment.status) ? judgment.status : 'candidate';
  const evidence = [...new Set([...candidate.evidence, ...(judgment.evidence ?? [])].filter((url) => {
    try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
  }))];
  const status = requested === 'qualified' && evidence.length === 0 ? 'needs_review' : requested;
  const score = status === 'qualified' && Number.isFinite(judgment.score) ? judgment.score : null;
  return { ...candidate, evidence, status, score,
    reason: status === 'needs_review' && requested === 'qualified'
      ? 'qualification_requires_evidence' : String(judgment.reason ?? '') };
}

export function mergeCandidate(prior, next) {
  if (!prior) return next;
  const evidence = [...new Set([...prior.evidence, ...next.evidence])];
  const sources = [...prior.sources];
  for (const source of next.sources) {
    if (!sources.some((x) => x.provider === source.provider && x.ref === source.ref)) sources.push(source);
  }
  const conflict = [prior.status, next.status].includes('qualified') &&
    [prior.status, next.status].includes('excluded');
  const rank = { excluded: 0, needs_review: 1, candidate: 2, qualified: 3 };
  const preferred = rank[next.status] > rank[prior.status] ? next : prior;
  return { ...preferred, evidence, sources,
    status: conflict ? 'needs_review' : preferred.status,
    score: conflict ? null : preferred.score,
    reason: conflict ? 'conflicting_source_decisions' : preferred.reason };
}
