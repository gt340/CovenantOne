/**
 * Relationship journey stages and guidance content for CovenantOne.
 *
 * Design constraints these functions and content must uphold:
 * - Never force marriage. ENDED is always a valid, judgment-free exit from
 *   any active stage.
 * - Never force either person to declare romantic interest. Guidance
 *   prompts are framed as things to learn ABOUT each other, not scripts
 *   for declaring feelings.
 * - Stage advancement (beyond the initial FRIENDSHIP stage granted on
 *   acceptance) requires BOTH participants to agree — see the propose/
 *   confirm flow in the stage API route. Nothing here or in the API
 *   auto-advances a connection unilaterally.
 * - No content here encourages private overnight meetings or sexual
 *   activity. Safety guidance always favors public settings and telling
 *   a trusted third party.
 */

export type Stage =
  | "FRIENDSHIP"
  | "DISCERNMENT"
  | "COURTSHIP"
  | "FAMILY_MENTOR_INVOLVEMENT"
  | "MARRIAGE_PREPARATION"
  | "MARRIED";

// Forward order. A connection starts at FRIENDSHIP when an introduction is
// accepted (set directly in the introductions route). ENDED is reachable
// from any stage via a separate "end connection" action, not part of this
// forward ladder.
export const STAGE_ORDER: Stage[] = [
  "FRIENDSHIP",
  "DISCERNMENT",
  "COURTSHIP",
  "FAMILY_MENTOR_INVOLVEMENT",
  "MARRIAGE_PREPARATION",
  "MARRIED",
];

export function nextStage(current: Stage): Stage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export const STAGE_LABELS: Record<Stage, string> = {
  FRIENDSHIP: "Friendship",
  DISCERNMENT: "Discernment",
  COURTSHIP: "Courtship",
  FAMILY_MENTOR_INVOLVEMENT: "Family & Mentor Involvement",
  MARRIAGE_PREPARATION: "Marriage Preparation",
  MARRIED: "Married",
};

export interface StageGuidance {
  stage: Stage;
  summary: string;
  /** Conversation topics to explore together — framed as mutual discovery,
   * never as a checklist either person must "pass." */
  topics: { title: string; prompts: string[] }[];
  /** Optional note shown specifically when this stage becomes available to
   * propose — reinforces that advancing is a choice, not an expectation. */
  advancingNote: string;
}

export const STAGE_GUIDANCE: Record<Stage, StageGuidance> = {
  FRIENDSHIP: {
    stage: "FRIENDSHIP",
    summary:
      "Getting to know each other with no pressure or assumptions about where things are headed. This is a good stage to simply be curious about someone's life.",
    topics: [
      {
        title: "Life goals & future plans",
        prompts: [
          "What does a meaningful life look like to you five or ten years from now?",
          "What's something you've always wanted to try or accomplish?",
        ],
      },
      {
        title: "Character",
        prompts: [
          "What's something you're proud of handling well recently?",
          "What do close friends usually say about you?",
        ],
      },
      {
        title: "Faith",
        prompts: [
          "How would you describe your faith journey so far?",
          "What role does your faith play in an ordinary week?",
        ],
      },
      {
        title: "Communication",
        prompts: [
          "How do you prefer to work through a disagreement?",
          "What makes you feel genuinely heard in a conversation?",
        ],
      },
    ],
    advancingNote:
      "There's no timeline for moving past Friendship. Take as long as feels right for both of you.",
  },
  DISCERNMENT: {
    stage: "DISCERNMENT",
    summary:
      "Both of you have agreed to more intentionally explore whether this could become a serious, marriage-directed relationship — while still giving yourselves full permission to step back at any point.",
    topics: [
      {
        title: "Values",
        prompts: [
          "What values would you never want to compromise on in a marriage?",
          "Where have you seen your values tested, and how did you respond?",
        ],
      },
      {
        title: "Family",
        prompts: [
          "What was family life like growing up, and what do you want to carry forward or do differently?",
          "How involved do you hope extended family will be in your day-to-day life?",
        ],
      },
      {
        title: "Career",
        prompts: [
          "How do you think about balancing career ambitions with a shared life?",
          "What would you need from a partner during a demanding season of work?",
        ],
      },
      {
        title: "Financial responsibility",
        prompts: [
          "How do you approach saving, spending, and financial planning?",
          "What did you learn about money growing up that still shapes you?",
        ],
      },
    ],
    advancingNote:
      "Moving into Courtship is a meaningful step. Neither of you is expected to declare romantic feelings before you're ready — advancing the stage is enough of a signal on its own.",
  },
  COURTSHIP: {
    stage: "COURTSHIP",
    summary:
      "A more focused, marriage-directed relationship. Many couples begin involving trusted family or mentors around this point — see the guidance below.",
    topics: [
      {
        title: "Business & shared goals",
        prompts: [
          "If you started or grew a business together, what would that look like?",
          "How do you want to make major financial or life decisions together?",
        ],
      },
      {
        title: "Future plans",
        prompts: [
          "How do you picture the first year of marriage?",
          "What are your honest expectations around children, timing, and family size?",
        ],
      },
      {
        title: "Character under pressure",
        prompts: [
          "Tell me about a hard season and how you got through it.",
          "What does it look like when you're at your worst, and how do you recover?",
        ],
      },
    ],
    advancingNote:
      "This is a natural point to involve people who know you well. See the Family & Mentor Involvement guidance — inviting them in is your choice, and either of you can request it.",
  },
  FAMILY_MENTOR_INVOLVEMENT: {
    stage: "FAMILY_MENTOR_INVOLVEMENT",
    summary:
      "Bringing trusted family members or mentors into the relationship for perspective, accountability, and blessing. This stage can run alongside Courtship rather than strictly after it.",
    topics: [
      {
        title: "Involving others well",
        prompts: [
          "Who are one or two people whose judgment you trust on a decision this important?",
          "What kind of input would actually be useful to you from family or a mentor, versus input that would just add pressure?",
        ],
      },
      {
        title: "Family expectations",
        prompts: [
          "What does your family expect or hope for in how this unfolds?",
          "Where might your two families see things differently, and how do you want to handle that together?",
        ],
      },
    ],
    advancingNote:
      "Use the family/mentor invitation feature to bring someone in with a clear, limited view (stage-only, or stage plus a short summary) — never full access to private conversations.",
  },
  MARRIAGE_PREPARATION: {
    stage: "MARRIAGE_PREPARATION",
    summary:
      "Both of you have agreed you're preparing for marriage together. This stage is about practical and relational readiness, not a formality.",
    topics: [
      {
        title: "Practical readiness",
        prompts: [
          "What does a realistic household budget look like for the two of you?",
          "Where will you live, and what does that decision involve for each of you?",
        ],
      },
      {
        title: "Conflict & communication under commitment",
        prompts: [
          "What's your plan for handling serious disagreements once you're married?",
          "Would premarital counseling or mentorship be valuable to you both right now?",
        ],
      },
    ],
    advancingNote:
      "There is no requirement to set a date or move to Married by any particular time. Many couples spend a meaningful season here.",
  },
  MARRIED: {
    stage: "MARRIED",
    summary: "Congratulations. This stage marks the relationship as married within the platform.",
    topics: [],
    advancingNote: "",
  },
};

export const MEETING_SAFETY_GUIDANCE = {
  title: "Before you meet in person",
  points: [
    "Meet in a public place for at least your first several meetings — a coffee shop, restaurant, or public event works well.",
    "Tell a friend or family member where you're going, who you're meeting, and roughly when you expect to be back.",
    "Arrange your own transportation to and from the meeting so you can leave whenever you want to.",
    "Consider a video call before meeting in person, so you're not walking in as complete strangers.",
    "Keep early meetings limited in time and in public settings — this platform does not support or encourage private overnight stays.",
    "Trust your instincts. If something feels off, it's always okay to end a meeting early or decline a future one.",
  ],
};
