-- The second sweep of every action a member can take in WaveCenter, listed
-- on Game > Manage (Dane, 2026-11-22, WC-188: "A good deal of new
-- functionality has been added to the application over the last few weeks.
-- Identify all possible forms of engagement a user has available, and update
-- the actions table accordingly."). A sweep of every server action under app/
-- since the first sweep (20261102120000_scoring_actions_sweep.sql) found
-- these not yet on the list: chats, the Forum's topics and tags, proposals,
-- Home's boxes, starring a message, and the admin's scoring tools.
--
-- Listed only, as in the first sweep, where Dane chose (B): nothing records
-- them yet, so each shows "Not active yet" on Game > Manage and earns nothing
-- until its own "<action> earns its point" ticket wires it. 1 point each to
-- start; an admin can change any value on the Manage screen. No factors yet,
-- so the Admin page's batch shows each as "not scored yet".
--
-- Each kind is what the Add form would make from the name (core/game.ts,
-- kindFromName), so an admin adding the same name later is refused as a
-- duplicate rather than listed twice.
--
-- No new table. Safe to re-run: a kind already there is skipped, and no
-- existing row is touched. New rows go after whatever is there already.

insert into public.game_scoring_rules (kind, name, description, criteria, points, position)
select v.kind, v.name, v.description, v.criteria, v.points,
       (select coalesce(max(r.position), 0) from public.game_scoring_rules r) + v.ord
  from (values
  ('started_a_chat',                    'Started a chat',                    'Opened a new chat with another member, on its own or about a task.', 'A new chat is saved. Opening a chat that already exists does not count.', 1,  1),
  ('added_a_forum_topic',               'Added a forum topic',               'Added a topic for members to discuss on the Forum.',            'A new topic is saved on the Forum.',                               1,  2),
  ('added_a_forum_tag',                 'Added a forum tag',                 'Added a tag for sorting the Forum''s discussions.',             'A new tag is saved on the Forum.',                                 1,  3),
  ('made_a_proposal',                   'Made a proposal',                   'Put forward an idea for a change on the Proposals page.',       'A new proposal is saved.',                                         1,  4),
  ('changed_a_proposal',                'Changed a proposal',                'Edited a proposal''s title, notes, points, priority or status.', 'A saved change to a proposal.',                                    1,  5),
  ('deleted_a_proposal',                'Deleted a proposal',                'Removed a proposal.',                                           'A proposal is deleted.',                                           1,  6),
  ('changed_a_home_box',                'Changed a Home box',                'Changed the words in one of the boxes on the Home page.',       'A saved change to a Home box''s words.',                           1,  7),
  ('starred_a_message',                 'Starred a message',                 'Starred a message on Your profile > Messages, to mark it as important.', 'A message that was not starred becomes starred.',          1,  8),
  ('scored_an_action_s_factors',        'Scored an action''s factors',       'Gave an action its four factor scores on Game > Manage.',       'A saved change to an action''s factors.',                          1,  9),
  ('gave_a_reason_for_a_factor',        'Gave a reason for a factor',        'Wrote why an action got one of its factor scores on Game > Manage.', 'A saved change to a factor''s reason.',                       1, 10),
  ('added_a_token_size',                'Added a token size',                'Added a token size on Game > Manage.',                          'A new token size is saved.',                                       1, 11),
  ('changed_a_token_size',              'Changed a token size',              'Edited a token size''s name, size, colour or point level.', 'A saved change to a token size.',                                  1, 12),
  ('deleted_a_token_size',              'Deleted a token size',              'Removed a token size.',                                         'A token size is deleted.',                                         1, 13),
  ('rescored_past_points',              'Rescored past points',              'Brought points already earned up to today''s values on the Admin page.', 'A rescore is saved for at least one action.',             1, 14),
  ('made_points_final',                 'Made points final',                 'Ended the provisional phase of scoring on the Admin page.',     'Scoring is declared final. This can happen only once.',            1, 15)
  ) as v (kind, name, description, criteria, points, ord)
 order by v.ord
on conflict (kind) do nothing;
