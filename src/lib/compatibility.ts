/**
 * Compatibility scoring for CovenantOne discovery.
 *
 * IMPORTANT: this produces a *guidance* score, not a prediction or
 * guarantee. Nothing here should ever be presented as "destined,"
 * "meant to be," or similarly deterministic — see FACTOR_LABELS and
 * the explanation copy below, which frame every result as one input
 * among many for the member to weigh themselves.
 */

export type Gender = "MALE" | "FEMALE";
export type FaithImportance = "CENTRAL" | "VERY_IMPORTANT" | "IMPORTANT" | "EXPLORING";
export type EducationLevel =
  | "HIGH_SCHOOL"
  | "SOME_COLLEGE"
  | "ASSOCIATE"
  | "BACHELORS"
  | "MASTERS"
  | "DOCTORATE"
  | "TRADE_VOCATIONAL"
  | "OTHER";
export type MarriageTimeframe =
  | "WITHIN_A_YEAR"
  | "ONE_TO_TWO_YEARS"
  | "TWO_PLUS_YEARS"
  | "WHEN_RIGHT_PERSON_FOUND";

export interface CompatibilityCandidate {
  userId: string;
  age: number;
  gender: Gender;
  country: string;
  region: string | null;
  city: string | null;
  willingToRelocate: boolean;
  faithImportance: FaithImportance;
  denomination: string | null;
  educationLevel: EducationLevel | null;
  seriouslySeekingMarriage: boolean;
  marriageTimeframe: MarriageTimeframe;
  wantsChildren: boolean | null;
  hasChildrenAlready: boolean;
  interestIds: string[];
  ownsBusiness: boolean;
  lifeGoals: string | null;
  familyValues: string | null;
}

export interface PartnerPreferenceFilter {
  preferredGender: Gender;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number | null;
  requireSameFaith: boolean;
  minFaithImportance: FaithImportance | null;
  minEducationLevel: EducationLevel | null;
  openToChildrenAlready: boolean;
  openToRelocation: boolean;
}

const EDUCATION_RANK: Record<EducationLevel, number> = {
  HIGH_SCHOOL: 1,
  TRADE_VOCATIONAL: 2,
  SOME_COLLEGE: 2,
  ASSOCIATE: 3,
  BACHELORS: 4,
  MASTERS: 5,
  DOCTORATE: 6,
  OTHER: 0,
};

const FAITH_RANK: Record<FaithImportance, number> = {
  EXPLORING: 1,
  IMPORTANT: 2,
  VERY_IMPORTANT: 3,
  CENTRAL: 4,
};

// Human-readable labels used in the "why this score" breakdown shown
// to members. Keep this language about alignment/overlap, never
// about destiny, fate, or certainty.
export const FACTOR_LABELS: Record<string, string> = {
  faith: "Faith & values alignment",
  marriageIntentions: "Marriage readiness & timeframe",
  children: "Children preferences",
  education: "Education level",
  location: "Location & relocation openness",
  interests: "Shared interests",
  lifestyle: "Lifestyle & family values overlap",
  business: "Business/entrepreneurial alignment",
};

const WEIGHTS = {
  faith: 22,
  marriageIntentions: 18,
  children: 15,
  education: 10,
  location: 12,
  interests: 12,
  lifestyle: 6,
  business: 5,
};

export interface CompatibilityBreakdown {
  factor: string;
  label: string;
  weight: number;
  contribution: number; // 0..weight
  note: string;
}

export interface CompatibilityResult {
  score: number; // 0..100, rounded
  breakdown: CompatibilityBreakdown[];
  hardFilterPassed: boolean;
}

/** Hard eligibility gate — run before scoring. A candidate failing
 * this should not appear in results at all, regardless of score. */
export function passesHardFilters(
  candidate: CompatibilityCandidate,
  viewerGender: Gender,
  viewerAge: number,
  prefs: PartnerPreferenceFilter | null
): boolean {
  if (candidate.gender === viewerGender) return false; // platform is opposite-gender matching only
  if (!prefs) return true; // no stated preferences yet — don't over-filter

  if (candidate.age < prefs.minAge || candidate.age > prefs.maxAge) return false;
  if (prefs.requireSameFaith && candidate.faithImportance === "EXPLORING") return false;
  if (
    prefs.minFaithImportance &&
    FAITH_RANK[candidate.faithImportance] < FAITH_RANK[prefs.minFaithImportance]
  ) {
    return false;
  }
  if (
    prefs.minEducationLevel &&
    candidate.educationLevel &&
    EDUCATION_RANK[candidate.educationLevel] < EDUCATION_RANK[prefs.minEducationLevel]
  ) {
    return false;
  }
  if (!prefs.openToChildrenAlready && candidate.hasChildrenAlready) return false;
  if (!prefs.openToRelocation && !candidate.willingToRelocate && prefs.maxDistanceKm !== null) {
    // Distance itself isn't computed here (no shared geocoding step yet);
    // this only blocks candidates who won't relocate when the viewer
    // has stated a maximum distance and no relocation flexibility.
    return false;
  }

  return true;
}

export function scoreCompatibility(
  viewer: CompatibilityCandidate,
  candidate: CompatibilityCandidate
): CompatibilityResult {
  const breakdown: CompatibilityBreakdown[] = [];

  // Faith
  const faithDiff = Math.abs(FAITH_RANK[viewer.faithImportance] - FAITH_RANK[candidate.faithImportance]);
  const denominationMatch =
    viewer.denomination && candidate.denomination
      ? viewer.denomination.trim().toLowerCase() === candidate.denomination.trim().toLowerCase()
      : false;
  let faithScore = Math.max(0, 1 - faithDiff / 3) * WEIGHTS.faith;
  if (denominationMatch) faithScore = Math.min(WEIGHTS.faith, faithScore + WEIGHTS.faith * 0.15);
  breakdown.push({
    factor: "faith",
    label: FACTOR_LABELS.faith,
    weight: WEIGHTS.faith,
    contribution: Math.round(faithScore),
    note: denominationMatch
      ? "Same denomination and similar faith importance"
      : "Faith importance levels compared",
  });

  // Marriage intentions / timeframe
  const bothSerious = viewer.seriouslySeekingMarriage && candidate.seriouslySeekingMarriage;
  const timeframeOrder: MarriageTimeframe[] = [
    "WITHIN_A_YEAR",
    "ONE_TO_TWO_YEARS",
    "TWO_PLUS_YEARS",
    "WHEN_RIGHT_PERSON_FOUND",
  ];
  const tfDiff = Math.abs(
    timeframeOrder.indexOf(viewer.marriageTimeframe) - timeframeOrder.indexOf(candidate.marriageTimeframe)
  );
  let intentionScore = bothSerious ? WEIGHTS.marriageIntentions * 0.5 : 0;
  intentionScore += Math.max(0, 1 - tfDiff / 3) * WEIGHTS.marriageIntentions * 0.5;
  breakdown.push({
    factor: "marriageIntentions",
    label: FACTOR_LABELS.marriageIntentions,
    weight: WEIGHTS.marriageIntentions,
    contribution: Math.round(intentionScore),
    note: bothSerious ? "Both seriously seeking marriage" : "Marriage readiness differs",
  });

  // Children preferences
  let childrenScore = 0;
  if (viewer.wantsChildren !== null && candidate.wantsChildren !== null) {
    childrenScore = viewer.wantsChildren === candidate.wantsChildren ? WEIGHTS.children : 0;
  } else {
    childrenScore = WEIGHTS.children * 0.5; // unknown — neutral, not penalized
  }
  breakdown.push({
    factor: "children",
    label: FACTOR_LABELS.children,
    weight: WEIGHTS.children,
    contribution: Math.round(childrenScore),
    note:
      viewer.wantsChildren !== null && candidate.wantsChildren !== null
        ? viewer.wantsChildren === candidate.wantsChildren
          ? "Aligned on wanting children"
          : "Differing views on children"
        : "Not fully specified by one or both members",
  });

  // Education
  let eduScore = WEIGHTS.education * 0.5;
  if (viewer.educationLevel && candidate.educationLevel) {
    const diff = Math.abs(EDUCATION_RANK[viewer.educationLevel] - EDUCATION_RANK[candidate.educationLevel]);
    eduScore = Math.max(0, 1 - diff / 5) * WEIGHTS.education;
  }
  breakdown.push({
    factor: "education",
    label: FACTOR_LABELS.education,
    weight: WEIGHTS.education,
    contribution: Math.round(eduScore),
    note: "Education levels compared for general alignment, not ranked",
  });

  // Location / relocation
  let locationScore = 0;
  if (viewer.country === candidate.country) {
    locationScore += WEIGHTS.location * 0.5;
    if (viewer.region && candidate.region && viewer.region === candidate.region) {
      locationScore += WEIGHTS.location * 0.3;
    }
  }
  if (viewer.willingToRelocate || candidate.willingToRelocate) {
    locationScore += WEIGHTS.location * 0.2;
  }
  locationScore = Math.min(WEIGHTS.location, locationScore);
  breakdown.push({
    factor: "location",
    label: FACTOR_LABELS.location,
    weight: WEIGHTS.location,
    contribution: Math.round(locationScore),
    note:
      viewer.country === candidate.country
        ? "Same country" + (viewer.willingToRelocate || candidate.willingToRelocate ? ", relocation openness noted" : "")
        : "Different countries" + (viewer.willingToRelocate || candidate.willingToRelocate ? ", relocation openness noted" : ""),
  });

  // Shared interests
  const shared = viewer.interestIds.filter((id) => candidate.interestIds.includes(id));
  const denom = Math.max(1, Math.min(viewer.interestIds.length, candidate.interestIds.length) || 1);
  const interestScore = Math.min(1, shared.length / Math.max(3, denom)) * WEIGHTS.interests;
  breakdown.push({
    factor: "interests",
    label: FACTOR_LABELS.interests,
    weight: WEIGHTS.interests,
    contribution: Math.round(interestScore),
    note: `${shared.length} shared interest${shared.length === 1 ? "" : "s"}`,
  });

  // Lifestyle / family values — light-touch keyword overlap only; this
  // is intentionally coarse rather than pretending to parse meaning.
  const lifestyleScore = textOverlapScore(viewer.familyValues, candidate.familyValues, WEIGHTS.lifestyle);
  breakdown.push({
    factor: "lifestyle",
    label: FACTOR_LABELS.lifestyle,
    weight: WEIGHTS.lifestyle,
    contribution: Math.round(lifestyleScore),
    note: "Based on shared themes in stated family values",
  });

  // Business alignment
  const businessScore = viewer.ownsBusiness && candidate.ownsBusiness ? WEIGHTS.business : WEIGHTS.business * 0.4;
  breakdown.push({
    factor: "business",
    label: FACTOR_LABELS.business,
    weight: WEIGHTS.business,
    contribution: Math.round(businessScore),
    note: viewer.ownsBusiness && candidate.ownsBusiness ? "Both are business owners" : "Business background compared",
  });

  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const totalContribution = breakdown.reduce((a, b) => a + b.contribution, 0);
  const score = Math.round((totalContribution / totalWeight) * 100);

  return { score: Math.max(0, Math.min(100, score)), breakdown, hardFilterPassed: true };
}

function textOverlapScore(a: string | null, b: string | null, weight: number): number {
  if (!a || !b) return weight * 0.4;
  const wordsA = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wordsB = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (wordsA.size === 0 || wordsB.size === 0) return weight * 0.4;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const ratio = overlap / Math.max(3, Math.min(wordsA.size, wordsB.size));
  return Math.min(1, ratio) * weight;
}
