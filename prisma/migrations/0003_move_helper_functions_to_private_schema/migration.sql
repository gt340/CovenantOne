-- Move RLS helper/trigger functions out of the `public` schema so PostgREST
-- stops exposing them as callable RPC endpoints (/rest/v1/rpc/...). This does
-- NOT break existing policies or triggers referencing them: Postgres resolves
-- policy/trigger definitions to the function's OID at creation time, not by
-- re-parsing the schema-qualified name, so moving schema is safe.
--
-- Applied for real against CovenantOne (opgcjnejfvzyqefmvrsi) — this file is
-- a record of that migration, matching what Supabase's own migration history
-- shows for "0003_move_helper_functions_to_private_schema".

CREATE SCHEMA IF NOT EXISTS private;

ALTER FUNCTION public.current_user_role() SET SCHEMA private;
ALTER FUNCTION public.is_moderator_tier() SET SCHEMA private;
ALTER FUNCTION public.is_safety_moderator_tier() SET SCHEMA private;
ALTER FUNCTION public.is_admin_tier() SET SCHEMA private;
ALTER FUNCTION public.is_connection_participant(uuid) SET SCHEMA private;
ALTER FUNCTION public.is_conversation_participant(uuid) SET SCHEMA private;
ALTER FUNCTION public.enforce_role_assignment_rules() SET SCHEMA private;
ALTER FUNCTION public.handle_new_auth_user() SET SCHEMA private;

-- authenticated/anon still need to be able to invoke them (RLS policy checks
-- run as the querying role), just not as a public RPC endpoint -- PostgREST
-- only exposes functions in its configured "exposed schemas" (public by
-- default), so `private` is invisible to the REST API regardless of grants.
GRANT USAGE ON SCHEMA private TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, anon;
