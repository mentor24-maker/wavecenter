-- Every action a member can take in WaveCenter, listed on the Game Manager
-- (Dane, 2026-11-01: "Update the complete list of possible actions members
-- can score points for ... Do a full sweep of the WaveCenter UI"). A sweep of
-- every server action under app/ found these not yet on the list.
--
-- Listed only: no part of WaveCenter records them yet, so each shows "Not
-- active yet" on Game > Manage and earns nothing. Dane chose (B) on the
-- ticket: wiring each one is its own ticket. 1 point each to start, as he
-- said; an admin can change any value on the Manage screen.
--
-- Each kind is what the Add form would make from the name (core/game.ts,
-- kindFromName), so an admin adding the same name later is refused as a
-- duplicate rather than listed twice. "Send a message to another member" was
-- already added on the live site through the Add form; it is here under the
-- same kind so a fresh database has it too, and the live row is left alone.
--
-- No new table. Safe to re-run: a kind already there is skipped, and no
-- existing row is touched. New rows go after whatever is there already.

insert into public.game_scoring_rules (kind, name, description, criteria, points, position)
select v.kind, v.name, v.description, v.criteria, v.points,
       (select coalesce(max(r.position), 0) from public.game_scoring_rules r) + v.ord
  from (values
  ('posted_a_comment',                  'Posted a comment',                  'Wrote a comment in a task''s discussion.',                     'A new comment is saved on a task.',                                1,  1),
  ('edited_a_comment',                  'Edited a comment',                  'Changed the words of a comment you wrote.',                    'A saved change to a comment.',                                     1,  2),
  ('deleted_a_comment',                 'Deleted a comment',                 'Removed a comment you wrote.',                                 'A comment is deleted on its own, not by deleting its task.',       1,  3),
  ('send_a_message_to_another_member',  'Send a message to another member',  'Sent a message to a member from Members or Your profile.',      'A message is saved for its recipient.',                            1,  4),
  ('made_a_team',                       'Made a team',                       'Started a new team on the Teams page.',                        'A new team is saved.',                                             1,  5),
  ('changed_a_team',                    'Changed a team',                    'Edited a team''s name or details.',                            'A saved change to a team.',                                        1,  6),
  ('deleted_a_team',                    'Deleted a team',                    'Removed a team.',                                              'A team is deleted.',                                               1,  7),
  ('added_a_member_to_a_team',          'Added a member to a team',          'Put a member on a team.',                                      'A member joins a team they were not on.',                          1,  8),
  ('removed_a_member_from_a_team',      'Removed a member from a team',      'Took a member off a team.',                                    'A member leaves a team, not by the team being deleted.',           1,  9),
  ('changed_a_member_s_role',           'Changed a member''s role',          'Gave a member a different role on the Members page.',          'A member''s role is saved as a different role.',                   1, 10),
  ('approved_a_proposed_task',          'Approved a proposed task',          'Approved a task a member proposed, so it joins the list.',     'A proposed task becomes a to-do. Credited to the admin who approved it.', 1, 11),
  ('joined_wavecenter',                 'Joined WaveCenter',                 'Made a WaveCenter account.',                                   'A new member''s account is created.',                              1, 12),
  ('changed_a_scoring_rule',            'Changed a scoring rule',            'Edited an action''s name, description, criteria or points on Game > Manage.', 'A saved change to a scoring rule.',              1, 13),
  ('added_a_scoring_action',            'Added a scoring action',            'Added a new action to the list on Game > Manage.',             'A new scoring rule is saved.',                                     1, 14)
  ) as v (kind, name, description, criteria, points, ord)
 order by v.ord
on conflict (kind) do nothing;
