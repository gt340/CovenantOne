/**
 * INTEGRATION BOUNDARY — Audio/Video calling media transport
 * =============================================================
 *
 * What exists today: a complete, real signaling layer (the `calls` table
 * and the /api/connections/[id]/calls routes). Initiating, ringing,
 * accepting, declining, and ending a call are all genuinely tracked in
 * the database with correct authorization and timestamps. Call HISTORY
 * is real.
 *
 * What does NOT exist: actual audio/video media transport. There is no
 * WebRTC peer connection, no media server, and no third-party calling
 * SDK wired in anywhere in this codebase. No credentials for a calling
 * provider have been supplied. Nothing in the UI should claim a call is
 * "connecting" or "connected" in a way that implies real audio/video is
 * flowing — that would be exactly the "fake calling" this boundary
 * exists to avoid.
 *
 * To make calls actually carry audio/video, wire in ONE of these (all
 * are viable; pick based on budget and support needs):
 *
 * 1. Daily.co (https://www.daily.co) — simplest to integrate. Needs:
 *    - DAILY_API_KEY env var
 *    - Server-side: create a Daily "room" per call (POST to their REST
 *      API), return the room URL as `providerSessionId`
 *    - Client-side: Daily's prebuilt iframe embed, or their React SDK
 *      for a custom UI
 *
 * 2. Twilio Video (https://www.twilio.com/video) — more control, more
 *    setup. Needs:
 *    - TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET env vars
 *    - Server-side: generate a short-lived Access Token per participant
 *    - Client-side: twilio-video JS SDK to connect to the Room named by
 *      `providerSessionId`
 *
 * 3. Agora (https://www.agora.io) — similar shape to Twilio, often
 *    cheaper at scale. Needs APP_ID + APP_CERTIFICATE, server-side
 *    token generation, client-side Agora Web SDK.
 *
 * In every case, the pattern is the same and fits the existing `calls`
 * table without schema changes:
 * - On call initiate, call `createProviderSession()` below (once
 *   implemented) to get a session/room identifier, store it in
 *   `calls.providerSessionId`
 * - Give each participant a short-lived, participant-specific token to
 *   join that session (never a shared secret usable to join any call)
 * - The client SDK handles the actual media; this backend only ever
 *   issues tokens and tracks call state
 *
 * Until one of these is connected, `createProviderSession()` throws a
 * clear, typed error rather than returning a fake session — callers
 * (the calls API route) turn that into an honest "calling isn't
 * connected yet" response instead of pretending to ring.
 */

export class CallingProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "No calling provider is connected. Audio/video call signaling is tracked, but media transport requires wiring in a provider (Daily.co, Twilio Video, or Agora) — see src/lib/callingProvider.ts for exact integration steps."
    );
    this.name = "CallingProviderNotConfiguredError";
  }
}

export async function createProviderSession(_callId: string, _type: "AUDIO" | "VIDEO"): Promise<never> {
  throw new CallingProviderNotConfiguredError();
}
