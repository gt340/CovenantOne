export const REPORT_CATEGORIES = [
  { value: "SEXUAL_SOLICITATION", label: "Sexual solicitation" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "THREAT", label: "Threat" },
  { value: "SCAM_OR_FINANCIAL", label: "Scam" },
  { value: "SCAM_OR_FINANCIAL", label: "Financial manipulation" },
  { value: "PROSTITUTION_OR_SEXUAL_SERVICES", label: "Prostitution / sexual services" },
  { value: "FAKE_PROFILE", label: "Impersonation" },
  { value: "OTHER", label: "Other safety violation" },
] as const;

export const REPORT_CATEGORY_VALUES = Array.from(new Set(REPORT_CATEGORIES.map((c) => c.value)));
