## 2026-11-27 — Update UI of the operational emails (#227)

The emails WaveCenter's accounts send were plain Supabase emails. Only the
password reset had any WaveCenter look, and a new member's very first email,
"confirm your email", had none. Now all three look the same:

- confirm your email
- confirm a new email address
- reset your password

In each one, the water-drop picture fills the background and the logo and
name sit at the top. The message and its button are inside a frosted white
pod. They come from **WaveCenter Admin**, the sender name Dane chose.

Some email programs block pictures, and some cannot show see-through colours.
Those still get a readable email: a plain dark-blue background, a solid white
pod and the same words.

The text colours were checked against the darkest spot in the picture, so
the words stay easy to read wherever they land. The link blue was darkened
for that reason.

The live site gets the new look once Dane pastes the three designs into
Supabase and changes the sender name. `docs/EMAIL_SETUP.md`, steps 4 and 5,
gives the exact clicks.
