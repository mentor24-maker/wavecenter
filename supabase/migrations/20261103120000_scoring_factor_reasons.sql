-- Why each action got each of its four factor scores, so the Admin page can
-- show the reason behind every E, V, R and F number (Dane, 2026-11-02: "make
-- each one of the factor values link to a popup that states why that score
-- was given for that particular task on that factor").
--
--   effort_reason     why it got its Effort (E)
--   value_reason      why it got its Value (V)
--   rarity_reason     why it got its Rarity (R)
--   farm_risk_reason  why it got its Farm risk (F)
--
-- Null means "no reason written yet", and the Admin page says so. The
-- reasons change no points and nothing in the formula reads them.
--
-- The table's row-level security is unchanged and covers the new columns:
-- members read, nobody writes the table directly (the grants in
-- 20261027120000_game_layer.sql are table-wide select only). Changing a
-- reason by hand on Game > Manage is a later ticket, through a function that
-- refuses a role without game.edit, as for the factors themselves.
--
-- The scoring trigger for "Changed a scoring rule" fires only when a rule's
-- name, description, criteria or points change, so filling these credits
-- nobody. Additive and safe to re-run: the fill below only touches a reason
-- that is still empty. docs/GRANULAR_SCORING_ALGORITHM.md ("Why each factor
-- got its score") holds the same 96 reasons; a test keeps the two in step.

alter table public.game_scoring_rules add column if not exists effort_reason text;
alter table public.game_scoring_rules add column if not exists value_reason text;
alter table public.game_scoring_rules add column if not exists rarity_reason text;
alter table public.game_scoring_rules add column if not exists farm_risk_reason text;

update public.game_scoring_rules r
   set effort_reason = coalesce(r.effort_reason, v.effort_reason),
       value_reason = coalesce(r.value_reason, v.value_reason),
       rarity_reason = coalesce(r.rarity_reason, v.rarity_reason),
       farm_risk_reason = coalesce(r.farm_risk_reason, v.farm_risk_reason)
  from (values
  ('made_task',                        'Typing a title and saving it is a short form: under a minute.',
                                       'Adds work the other members can read and pick up.',
                                       'Members make tasks many times a day.',
                                       'Paired with deleting it, so make-and-delete loops.'),
  ('changed_task',                     'An edit is a short form or a few words: under a minute.',
                                       'Keeps a task accurate, which tidies up the list.',
                                       'Tasks are edited many times a day.',
                                       'Any edit can be changed straight back, so it loops.'),
  ('finished_task',                    'The click records the hours of work done outside it.',
                                       'Delivers finished work the project planned.',
                                       'A member finishes a task a few times a week, not many times a day.',
                                       'Reopening the task and finishing it again loops.'),
  ('deleted_task',                     'One click.',
                                       'Housekeeping worth having: it tidies up the list.',
                                       'Tasks can be deleted many times a day.',
                                       'The undo half of the make-and-delete loop.'),
  ('attached_file',                    'Choosing a file and saving it takes under a minute.',
                                       'Gives the other members the picture or file they need.',
                                       'Files can be attached many times a day.',
                                       'Paired with removing it, so attach-and-remove loops.'),
  ('removed_file',                     'One click.',
                                       'Tidies up a task.',
                                       'Files can be removed many times a day.',
                                       'The undo half of the attach-and-remove loop.'),
  ('handed_to_agents',                 'One tick; WaveCenter files the ticket itself.',
                                       'Puts work into the build queue, which the other members rely on.',
                                       'It happens once per task, a few times a week.',
                                       'Once per task, so it cannot undo itself, but a new task to hand off takes seconds to make.'),
  ('switched_agents',                  'One click on a switch.',
                                       'A personal setting: it does nothing for anyone else.',
                                       'The switch can be flipped many times a day.',
                                       'A switch that flips back and forth, so it loops.'),
  ('changed_profile',                  'A few words in a short form: under a minute.',
                                       'Helps the other members know who you are.',
                                       'A member changes their profile a few times a week at most.',
                                       'Saving the same profile again loops.'),
  ('voted_on_task',                    'A quick judgment in a short form: under a minute.',
                                       'Sets what tasks are worth, which the other members rely on.',
                                       'Members vote many times a day.',
                                       'A vote can be cast, changed and withdrawn forever, so it loops.'),
  ('posted_a_comment',                 'A few words: under a minute.',
                                       'The other members read it on the task.',
                                       'Members comment many times a day.',
                                       'Paired with deleting it, so post-and-delete loops.'),
  ('edited_a_comment',                 'Changing a few words: under a minute.',
                                       'Corrects your own words, which tidies up the discussion.',
                                       'Comments can be edited many times a day.',
                                       'A comment can be edited back, so it loops.'),
  ('deleted_a_comment',                'One click.',
                                       'Tidies up the discussion.',
                                       'Comments can be deleted many times a day.',
                                       'The undo half of the post-and-delete loop.'),
  ('send_a_message_to_another_member', 'A few words: under a minute.',
                                       'Helps one other member, not the shared record.',
                                       'Members can send messages many times a day.',
                                       'Repeatable in seconds, but a sent message has no undo, so it cannot loop.'),
  ('made_a_team',                      'A name and a few details: under a minute.',
                                       'Gives members a group to work in.',
                                       'Teams are made a few times a week at most.',
                                       'Paired with deleting it, so make-and-delete loops.'),
  ('changed_a_team',                   'Editing a name or details: under a minute.',
                                       'Keeps a team accurate, which tidies up.',
                                       'A team can be edited many times a day.',
                                       'A team can be changed straight back, so it loops.'),
  ('deleted_a_team',                   'One click.',
                                       'Tidies up the list of teams.',
                                       'Teams are deleted a few times a week at most.',
                                       'The undo half of the make-and-delete loop.'),
  ('added_a_member_to_a_team',         'One click to put a member on a team.',
                                       'Brings a member into shared work the team relies on.',
                                       'Members can be added to teams many times a day.',
                                       'Paired with removing them, so add-and-remove loops.'),
  ('removed_a_member_from_a_team',     'One click.',
                                       'Tidies up who is on a team.',
                                       'Members can be taken off teams many times a day.',
                                       'The undo half of the add-and-remove loop.'),
  ('changed_a_member_s_role',          'Choosing a role takes under a minute.',
                                       'Governance the other members rely on.',
                                       'Roles change a few times a week at most, and only an admin can change one.',
                                       'A role can be changed straight back, so it loops.'),
  ('approved_a_proposed_task',         'Reading a proposal and approving it takes under a minute.',
                                       'Admits work to the list that the other members pick up.',
                                       'An admin can approve proposals many times a day.',
                                       'Each approval needs a proposal and cannot undo itself, but a proposal takes seconds to make.'),
  ('joined_wavecenter',                'Signing up is a short form: under a minute.',
                                       'New members are how the project grows; the value comes from what they do next, scored on its own.',
                                       'Once per member.',
                                       'Once per member, but accounts are cheap to make (the canon''s Sybil failure), so F is 1, not 0.'),
  ('changed_a_scoring_rule',           'Editing a rule''s wording or points: under a minute.',
                                       'Sets the values every member earns by.',
                                       'Rules change a few times a week at most, and only an admin can change one.',
                                       'A rule can be changed straight back, so it loops.'),
  ('added_a_scoring_action',           'A new action''s name and criteria take about a minute.',
                                       'Grows the list of what counts, which every member earns by.',
                                       'New actions are added a few times a week at most, and only by an admin.',
                                       'No rule can be deleted, so it cannot loop, but a new one takes a minute.')
  ) as v (kind, effort_reason, value_reason, rarity_reason, farm_risk_reason)
 where r.kind = v.kind;

notify pgrst, 'reload schema';
