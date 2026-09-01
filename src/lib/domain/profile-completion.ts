// Pure functions only — no Supabase, no Next.js, no I/O. See
// src/lib/domain/eligibility.ts for why this matters.

export interface ProfileCompletionInput {
  hasPhoto: boolean;
  bio: string | null;
  hasLocation: boolean;
  hasFaithProfile: boolean;
  hasEducation: boolean;
  hasOccupation: boolean;
  interestCount: number;
  skills: string[];
  familyValues: string | null;
  hasMarriageIntention: boolean;
  hasPartnerPreference: boolean;
  lifeGoals: string | null;
  financialGoals: string | null;
  healthyMarriageBeliefs: string | null;
  lookingForInSpouse: string | null;
}

interface CompletionField {
  key: string;
  label: string;
  isComplete: (input: ProfileCompletionInput) => boolean;
}

// The canonical list of what "complete" means, in one place. Each field is
// weighted equally on purpose — a weighted scheme would need product input
// on relative importance that hasn't been specified, and equal weighting is
// the honest default until that decision is made.
const COMPLETION_FIELDS: CompletionField[] = [
  { key: "photo", label: "Profile photo", isComplete: (p) => p.hasPhoto },
  { key: "bio", label: "About me", isComplete: (p) => Boolean(p.bio && p.bio.trim().length > 0) },
  { key: "location", label: "Location", isComplete: (p) => p.hasLocation },
  { key: "faith", label: "Faith/values", isComplete: (p) => p.hasFaithProfile },
  { key: "education", label: "Education", isComplete: (p) => p.hasEducation },
  { key: "occupation", label: "Occupation", isComplete: (p) => p.hasOccupation },
  { key: "interests", label: "Interests", isComplete: (p) => p.interestCount > 0 },
  { key: "skills", label: "Skills", isComplete: (p) => p.skills.length > 0 },
  {
    key: "familyValues",
    label: "Family values",
    isComplete: (p) => Boolean(p.familyValues && p.familyValues.trim().length > 0),
  },
  {
    key: "marriageIntention",
    label: "Marriage intentions",
    isComplete: (p) => p.hasMarriageIntention,
  },
  {
    key: "partnerPreference",
    label: "Partner preferences",
    isComplete: (p) => p.hasPartnerPreference,
  },
  {
    key: "lifeGoals",
    label: "Life goals",
    isComplete: (p) => Boolean(p.lifeGoals && p.lifeGoals.trim().length > 0),
  },
  {
    key: "financialGoals",
    label: "Financial/business goals",
    isComplete: (p) => Boolean(p.financialGoals && p.financialGoals.trim().length > 0),
  },
  {
    key: "healthyMarriageBeliefs",
    label: "What makes a healthy marriage",
    isComplete: (p) => Boolean(p.healthyMarriageBeliefs && p.healthyMarriageBeliefs.trim().length > 0),
  },
  {
    key: "lookingForInSpouse",
    label: "What you're looking for in a spouse",
    isComplete: (p) => Boolean(p.lookingForInSpouse && p.lookingForInSpouse.trim().length > 0),
  },
];

export interface ProfileCompletionResult {
  percent: number; // 0-100, rounded
  completedCount: number;
  totalCount: number;
  missingFields: string[]; // labels, for a "finish your profile" prompt
}

export function calculateProfileCompletion(input: ProfileCompletionInput): ProfileCompletionResult {
  const missingFields: string[] = [];
  let completedCount = 0;

  for (const field of COMPLETION_FIELDS) {
    if (field.isComplete(input)) {
      completedCount++;
    } else {
      missingFields.push(field.label);
    }
  }

  const totalCount = COMPLETION_FIELDS.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  return { percent, completedCount, totalCount, missingFields };
}
