import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js";
import { isAtLeast18 } from "../domain/eligibility";

// -----------------------------------------------------------------------------
// Step: Account (sign up)
// -----------------------------------------------------------------------------
export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/[A-Z]/, "Password must include an uppercase letter.")
    .regex(/[0-9]/, "Password must include a number."),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/[A-Z]/, "Password must include an uppercase letter.")
    .regex(/[0-9]/, "Password must include a number."),
});

// -----------------------------------------------------------------------------
// Step: Phone verification
// -----------------------------------------------------------------------------
export const phoneNumberSchema = z.object({
  phoneE164: z
    .string()
    .trim()
    .refine((v) => isValidPhoneNumber(v), "Enter a valid phone number, including country code."),
});

export const otpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

// -----------------------------------------------------------------------------
// Step: Personal information
// -----------------------------------------------------------------------------
const GENDER_VALUES = ["MALE", "FEMALE"] as const;
const MARITAL_STATUS_VALUES = ["SINGLE", "DIVORCED", "WIDOWED", "SEPARATED"] as const;

export const personalInfoSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "Name is too long."),
  dateOfBirth: z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date.")
    .refine((v) => isAtLeast18(new Date(v)), {
      message: "You must be at least 18 years old to join.",
    }),
  gender: z.enum(GENDER_VALUES, { errorMap: () => ({ message: "Select a gender." }) }),
  country: z.string().trim().min(2, "Enter your country.").max(100),
  city: z.string().trim().min(1, "Enter your city.").max(100),
  maritalStatus: z.enum(MARITAL_STATUS_VALUES, {
    errorMap: () => ({ message: "Select your marital status." }),
  }),
  occupationTitle: z.string().trim().max(200).optional().or(z.literal("")),
  educationLevel: z
    .enum([
      "HIGH_SCHOOL",
      "SOME_COLLEGE",
      "ASSOCIATE",
      "BACHELORS",
      "MASTERS",
      "DOCTORATE",
      "TRADE_VOCATIONAL",
      "OTHER",
    ])
    .optional(),
});
export type PersonalInfoInput = z.infer<typeof personalInfoSchema>;

// -----------------------------------------------------------------------------
// Step: Values / faith
// -----------------------------------------------------------------------------
export const valuesSchema = z.object({
  faithImportance: z.enum(["CENTRAL", "VERY_IMPORTANT", "IMPORTANT", "EXPLORING"], {
    errorMap: () => ({ message: "Select how important faith is to you." }),
  }),
  denomination: z.string().trim().max(120).optional().or(z.literal("")),
  faithCommunity: z.string().trim().max(200).optional().or(z.literal("")),
});
export type ValuesInput = z.infer<typeof valuesSchema>;

// -----------------------------------------------------------------------------
// Step: Marriage intentions
// -----------------------------------------------------------------------------
export const marriageIntentionSchema = z.object({
  timeframe: z.enum(
    ["WITHIN_A_YEAR", "ONE_TO_TWO_YEARS", "TWO_PLUS_YEARS", "WHEN_RIGHT_PERSON_FOUND"],
    { errorMap: () => ({ message: "Select a timeframe." }) }
  ),
  wantsChildren: z.boolean().optional(),
  hasChildrenAlready: z.boolean().default(false),
});
export type MarriageIntentionInput = z.infer<typeof marriageIntentionSchema>;

// -----------------------------------------------------------------------------
// Helper: format the first Zod error into a single user-facing string
// -----------------------------------------------------------------------------
export function firstErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}
