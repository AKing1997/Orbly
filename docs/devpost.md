# Devpost draft

Replace the bracketed notes after testing on a headset.

## Description

### Inspiration

Most people who say they are not musical have never had an instrument that
could not play a wrong note. I wanted the feeling of making music without the
years of practice: reaching out, placing something, and hearing it become part
of a song.

Mixed reality makes that literal. In orbly the instrument is the space around
you. You sit down, and your room becomes a slow clock made of light.

### What it does

orbly is a spatial music toy, played seated and with hands alone. Pinch the air
to create an orb of light. A beam sweeps around you, and each orb sings as it
passes. Where you place an orb decides everything: its angle sets when it plays,
its height sets the note, and its distance chooses the instrument. Every note is
on a pentatonic scale, so nothing can sound wrong.

Throw an orb away to delete it. Turn your left palm up for a menu of tempo, undo,
colour scenes, save and more. Your walls and furniture catch waves of colour in
time with the music. Loops are saved as little glass worlds on the home screen,
and a new daily challenge gives you a reason to come back.

### How I built it

orbly runs in the browser on the Immersive Web SDK and WebXR, in TypeScript. All
audio is synthesized live with Web Audio: three instruments, a generated reverb
and HRTF spatialization for each orb. There are no samples. Notes are scheduled
ahead on the audio clock, so frame timing never affects the rhythm, and each orb
waits to flash until its note is actually heard.

Rendering stays small to fit a standalone headset: orbs are instanced, sparks are
computed in the vertex shader, and glow is written directly as light, with no
post-processing. The musical logic, gestures and saving are free of any
rendering code, and are covered by over 100 unit tests running on simulated hand
data.

### Challenges

I built orbly without a headset. [Update once tested on device.] The IWER
emulator made that possible by providing anatomically shaped hands that could be
scripted, so gestures were tested end to end rather than just by eye.

Throwing was the hardest gesture. Filtering a release for noise delays it, and by
then the hand has already slowed down, so throws read as gentle drops. The fix
was to measure speed at the moment the fingers start to part.

Staying seated was another. A loop that surrounds you has a part behind your
back, so a rotate control brings it around to you.

### What I learned

Polish in a hands-only experience comes down to forgiveness: thresholds with
hysteresis, buttons that only accept a press arriving from the front, and a hand
at rest on your lap that never does anything.

### What's next

Sharing loops with a link, more scales and instruments, and two people playing
the same ring in one room.

## How hand interactions are implemented

orbly reads WebXR hand joints every frame and turns them into gestures with its
own detectors, which are plain code with no rendering dependencies.

**Pinch** compares the thumb-to-index distance against two thresholds, 2.0 cm to
start and 3.6 cm to end, plus a short dwell. Noise cannot flicker it, and a brief
tracking loss does not drop what you hold. Pinches below lap height are ignored,
so resting hands stay quiet.

**Create and move.** A pinch within 7.5 cm of an orb grabs it; anywhere else
creates one. Orbs glow as a finger approaches, and on release they settle into
their cell of the musical grid and play.

**Throw** uses the hand's speed over the last 100 ms, measured as the fingers
part. Above 1.5 m/s the orb flies off and is deleted.

**Palm menu.** The palm direction comes from the wrist and knuckle joints. The
menu opens when an open hand faces up and towards your eyes for a moment, and
closes with looser thresholds, so it holds steady while you use it.

**Buttons** are pressed with the index finger. A press only counts when the
finger arrives from the front of that button, so brushing past or sliding across
the panel does nothing. The panel also nearly stops following your palm as your
finger approaches.

Controllers work but are never required.
