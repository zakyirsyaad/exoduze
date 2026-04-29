alter table prompt_artifacts
add column if not exists payload_json jsonb;
