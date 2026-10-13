-- One task was handed to the AI agents by hand before the loop-handoff lane
-- existed (Dane, 2026-10-12, 8:05pm): his task "Update task add to include
-- textarea for details, parent task, priority, files/images, etc." became two
-- Loop Queue tickets, 86bch5jmu (the add form) and 86bch5jnc (uploads).
-- Record the uploads ticket, the one that finishes it, so the lane never files
-- it a third time; the task is marked done only when 86bch5jnc goes Live.
--
-- Safe to re-run, and does nothing on a database without that row: it only
-- touches the task while it still has no ticket.

update public.tasks
   set agent_ticket_url = 'https://app.clickup.com/t/86bch5jnc',
       status = 'doing',
       tool = 'loop-handoff'
 where id = '12d70c06-a520-460e-9581-2b2e976923e7'
   and agent_ticket_url is null;
