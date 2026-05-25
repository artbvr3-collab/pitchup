-- Seed: demo venues + matches + technical seed captains.
--
-- Seed captains use a clearly non-Google `google_sub` ("seed:captain-N")
-- and the `.invalid` TLD (RFC 2606) so they can never collide with a real
-- Google OAuth subject. They bypass the onboarding guard intentionally.
-- email_notifications = false so no future cron can email them.
--
-- All match start_times are computed relative to NOW() so the seed stays
-- evergreen — re-running on a fresh DB at any later date still yields a
-- mix of Open / AlmostFull / Full / InProgress / Ended / Cancelled.
--
-- Status derivation reminder (docs/spec/pitchup-spec-match.md "Match states"):
--   cancelled_at IS NOT NULL              → Cancelled
--   now >= start_time + duration*interval → Ended
--   now >= start_time                     → InProgress
--   else, by free slots:
--     free == 0       → Full
--     free <= 2       → AlmostFull
--     else            → Open
-- Slot math (docs/spec/pitchup-spec-global.md "Slot math"):
--   filled = 1 + captain_crew.length + Σ accepted JoinRequest (none yet — Layer 4)
--   free   = max(0, total_spots - filled)

-- CreateSeedCaptains
INSERT INTO "users" ("id", "google_sub", "email", "name", "avatar_url", "email_notifications", "is_admin") VALUES
  ('00000000-0000-0000-0000-000000000001', 'seed:captain-1', 'seed-captain-1@pitchup.invalid', '[seed] Demo Captain Alpha', '', false, false),
  ('00000000-0000-0000-0000-000000000002', 'seed:captain-2', 'seed-captain-2@pitchup.invalid', '[seed] Demo Captain Beta',  '', false, false);

-- CreateSeedVenues  (Prague, approximate coords)
INSERT INTO "venues" ("id", "name", "address", "lat", "lng", "google_maps_url", "surface", "cover_id", "active") VALUES
  ('10000000-0000-0000-0000-000000000001', 'Strahov — Field 3',     'Vaníčkova 2, 169 00 Praha 6',   50.0793, 14.3879, NULL, ARRAY['grass'],         'cover-001', true),
  ('10000000-0000-0000-0000-000000000002', 'Letná Sportcentrum',     'Korunovační 29, 170 00 Praha 7', 50.1029, 14.4263, NULL, ARRAY['hard'],          'cover-002', true),
  ('10000000-0000-0000-0000-000000000003', 'Smíchov Indoor Arena',   'Nádražní 32, 150 00 Praha 5',   50.0703, 14.4079, NULL, ARRAY['grass', 'hard'], 'cover-003', true);

-- CreateSeedMatches
-- Columns required: captain_id, venue_id, start_time, duration, total_spots, price, surface,
--                   studs_allowed, cover_id (snapshotted), updated_at.
INSERT INTO "matches" (
  "captain_id", "venue_id", "start_time", "duration", "total_spots", "price",
  "surface", "studs_allowed", "field_booked", "description", "captain_crew",
  "cancelled_at", "cancel_reason", "cover_id", "updated_at"
) VALUES
  -- Past (Ended) — 6 days ago, fully played
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   NOW() - INTERVAL '6 days', 90, 14, 250, 'grass', true,  true,
   'Sunday morning league warmup.', ARRAY[]::TEXT[],
   NULL, NULL, 'cover-001', NOW()),

  -- Past (Ended) — yesterday
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '1 day', 60, 10, 0, 'hard', false, false,
   'Casual pickup, no studs.', ARRAY[]::TEXT[],
   NULL, NULL, 'cover-002', NOW()),

  -- InProgress — started 30 min ago, 90 min duration
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
   NOW() - INTERVAL '30 minutes', 90, 12, 150, 'grass', true, true,
   'Indoor session, evening league.', ARRAY['Tomáš', 'Jakub']::TEXT[],
   NULL, NULL, 'cover-003', NOW()),

  -- Today evening — Open
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   NOW() + INTERVAL '4 hours', 90, 14, 200, 'grass', true, false,
   'Need a few more for tonight. Field not booked yet.', ARRAY[]::TEXT[],
   NULL, NULL, 'cover-001', NOW()),

  -- Tomorrow evening — Open with a couple stub players
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
   NOW() + INTERVAL '1 day' + INTERVAL '19 hours', 60, 10, 0, 'hard', false, true,
   'Free game tomorrow night. Studs not allowed.', ARRAY['Martin']::TEXT[],
   NULL, NULL, 'cover-002', NOW()),

  -- +2 days — Open
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003',
   NOW() + INTERVAL '2 days' + INTERVAL '20 hours', 90, 12, 180, 'hard', false, true,
   NULL, ARRAY[]::TEXT[],
   NULL, NULL, 'cover-003', NOW()),

  -- +3 days — AlmostFull (total_spots 14, crew 11 → filled 12, free 2)
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   NOW() + INTERVAL '3 days' + INTERVAL '18 hours', 90, 14, 250, 'grass', true, true,
   'Almost full — two spots left.',
   ARRAY['Petr','Honza','David','Lukáš','Filip','Adam','Marek','Pavel','Daniel','Ondřej','Václav']::TEXT[],
   NULL, NULL, 'cover-001', NOW()),

  -- +5 days — Full (total_spots 10, crew 9 → filled 10, free 0)
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
   NOW() + INTERVAL '5 days' + INTERVAL '19 hours', 60, 10, 0, 'hard', false, true,
   'Roster locked — full.',
   ARRAY['Jiří','Karel','Štěpán','Vojtěch','Radek','Zdeněk','Matěj','Aleš','Roman']::TEXT[],
   NULL, NULL, 'cover-002', NOW()),

  -- +7 days — Cancelled
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
   NOW() + INTERVAL '7 days' + INTERVAL '19 hours', 90, 12, 150, 'grass', true, true,
   'Was supposed to be a friendly.', ARRAY[]::TEXT[],
   NOW() - INTERVAL '1 day', 'Pitch flooded — closed for repairs.', 'cover-003', NOW());
