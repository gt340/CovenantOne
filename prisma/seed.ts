/**
 * DEVELOPMENT SEED DATA — NOT PRODUCTION DATA
 * ============================================
 * Every row this script creates is synthetic and clearly marked as such
 * (email addresses under @seed.dev.invalid, display names prefixed "Seed:").
 * This script refuses to run unless NODE_ENV is explicitly "development" AND
 * a SEED_CONFIRM=yes-seed-dev-db environment variable is set, as a second
 * guard against ever pointing it at a staging/production DATABASE_URL by
 * accident.
 *
 * This file has NOT been executed in this sandbox (no network access to
 * install @prisma/client, no live Postgres to seed — see PHASE1_REPORT.md).
 * It is provided as the real script to run once the project has a working
 * Postgres connection: `npx prisma db seed`.
 */
import { PrismaClient, Role, Gender, FaithImportance, MarriageTimeframe } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function assertSafeToSeed() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "Refusing to seed: NODE_ENV must be 'development'. This script must never run against staging/production."
    );
  }
  if (process.env.SEED_CONFIRM !== "yes-seed-dev-db") {
    throw new Error(
      "Refusing to seed: set SEED_CONFIRM=yes-seed-dev-db to confirm you intend to seed THIS database."
    );
  }
  if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1|dev-db/.test(process.env.DATABASE_URL)) {
    throw new Error(
      "Refusing to seed: DATABASE_URL does not look like a local/dev database. Aborting."
    );
  }
}

// Placeholder for a real password hash. In app code this comes from the
// argon2id hashing utility in src/lib/auth (Phase 2) — this seed script does
// not implement its own hashing to avoid two sources of truth for it.
function placeholderPasswordHash(): string {
  return `argon2id$seed-placeholder$${randomBytes(8).toString("hex")}`;
}

async function main() {
  assertSafeToSeed();

  const seedMembers = [
    { name: "Seed: Grace Adebayo", gender: Gender.FEMALE, email: "grace.seed@seed.dev.invalid" },
    { name: "Seed: Daniel Okafor", gender: Gender.MALE, email: "daniel.seed@seed.dev.invalid" },
    { name: "Seed: Ruth Mensah", gender: Gender.FEMALE, email: "ruth.seed@seed.dev.invalid" },
    { name: "Seed: Josiah Kim", gender: Gender.MALE, email: "josiah.seed@seed.dev.invalid" },
  ];

  for (const m of seedMembers) {
    const user = await prisma.user.create({
      data: {
        role: Role.MEMBER,
        authIdentities: {
          create: {
            provider: "EMAIL_PASSWORD",
            email: m.email,
            passwordHash: placeholderPasswordHash(),
          },
        },
        memberProfile: {
          create: {
            displayName: m.name,
            gender: m.gender,
            dateOfBirth: new Date("1994-01-01"),
            bio: "Seed data for local development only.",
            isDiscoverable: true,
          },
        },
        emailVerification: {
          create: { email: m.email, status: "VERIFIED", verifiedAt: new Date() },
        },
        faithProfile: {
          create: { faithImportance: FaithImportance.IMPORTANT, denomination: "Seed Faith Community" },
        },
        marriageIntention: {
          create: { timeframe: MarriageTimeframe.ONE_TO_TWO_YEARS },
        },
      },
    });
    console.log(`Seeded user ${user.id} (${m.name})`);
  }

  // One seed admin, one seed safety moderator — needed to exercise the
  // moderation flows locally without granting real accounts elevated roles.
  await prisma.user.create({
    data: {
      role: Role.ADMIN,
      authIdentities: {
        create: {
          provider: "EMAIL_PASSWORD",
          email: "admin.seed@seed.dev.invalid",
          passwordHash: placeholderPasswordHash(),
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      role: Role.SAFETY_MODERATOR,
      authIdentities: {
        create: {
          provider: "EMAIL_PASSWORD",
          email: "safetymod.seed@seed.dev.invalid",
          passwordHash: placeholderPasswordHash(),
        },
      },
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
