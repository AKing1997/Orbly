# Devpost draft

Replace the bracketed notes after testing on a headset.

**Tagline (140 characters max):** Throw light at your room and hear it sing. Every wall, table and sofa plays a different instrument, so every room is a different band.

**Target launch date:** [Your date. Spring 2027, alongside Meta VR Glasses, would be a natural fit.]

## Description

### Inspiration

Most people who say they are not musical have never had an instrument that
could not play a wrong note. And most mixed reality apps would play the same if
you turned your room off.

I wanted both problems gone at once: an instrument you cannot play badly, made
out of the room you are actually sitting in.

### What it does

orbly is played seated, with hands alone. Pinch the air and an orb of light
appears. Flick your wrist and it flies across the room and sticks to whatever it
hits, and that surface starts to sing. Walls ring like bells, tables knock like
a marimba, the floor is a soft drum, the sofa hums.

A beam sweeps your real walls like a lighthouse, and each orb sounds as it
passes. Its angle sets when it plays and its height sets the note, always on a
pentatonic scale, so nothing can sound wrong. Point at a far orb to call it back
to your hand, or keep some on a ring within reach.

Then sit back. Lower your hands and the house lights fall: chords and a soft
pulse grow around your song, sections rise and ebb, and the melody draws itself
across the dark room. Raise a hand and it is yours again.

Your room remembers. Come back tomorrow and your song is still on your walls.
Open it somewhere else and it lands on that room's surfaces instead, as a
different band.

### How I built it

orbly runs in the browser on the Immersive Web SDK and WebXR, in TypeScript.
Detected planes become a model of the room: throws are simulated ahead of time
against it, then snapped to the beat so the beam meets each orb exactly as it
sounds. A persistent anchor pins each song to its room. All audio is synthesized live, with eight instruments and HRTF spatialization
per orb. There are no samples.

Rendering stays small for a standalone headset: orbs are instanced and the room's
light is a single merged mesh. The logic runs under more than 200 unit tests on
simulated hands and rooms.

### Challenges

I built orbly without a headset. [Update once tested on device.] The IWER
emulator provided scripted, anatomically shaped hands and a detected room, so
gestures were tested end to end rather than by eye.

Hands were the hard part. The point between your fingers jumps the moment they
open, which bent every throw upward and dropped orbs a note too high. Measuring
from a knuckle fixed both. Pointing was subtler: anyone pinching in the air is
also pointing at a wall, so calling an orb back had to become deliberate.

### What I learned

Polish in a hands-only experience is forgiveness: hysteresis, a slight aim assist
towards your gaze, and a hand resting on your lap that never does anything.

### What's next

Sharing a song by link, so it lands in a friend's room as their own band.

## How hand interactions are implemented

orbly reads WebXR hand joints every frame and turns them into gestures with its
own detectors, which are plain code with no rendering dependencies.

**Pinch** compares the thumb-to-index distance against two thresholds, 2.0 cm to
start and 3.6 cm to end, plus a short dwell. Noise cannot flicker it, and a brief
tracking loss does not drop what you hold. Pinches below lap height are ignored,
so resting hands stay quiet.

**Create and move.** A pinch within 7.5 cm of an orb grabs it; anywhere else
creates one. Orbs glow as a finger approaches. When you let go, the orb stays
where it was as your fingers began to part, not where they ended up.

**Throw** uses the hand's speed over the last 100 ms, measured at a knuckle as
the fingers part. Above 1.5 m/s the orb launches, leaning slightly towards your
gaze, and lands on the first surface along its arc.

**Reaching across the room.** Hold your hand pointed at a far orb for a third of
a second and a line of light appears; pinch and it flies to your hand. Without
that pause, every pinch in the air would risk taking an orb from the wall.

**Palm menu.** The menu opens when an open left hand faces up and towards your
eyes, and closes with looser thresholds, so it holds steady while you use it.

**Buttons** only count a press arriving from the front of that button, and the
panel nearly stops following your palm as your finger approaches.

**Delete** is letting go over your lap: the orb fades as you lower it, as a
warning, and undo brings it back.

**Listening.** Hands that are still, resting or out of tracking for nine seconds
start the concert, so there is nothing to learn. Any hand that rises and moves
ends it within a fraction of a second.

**Narrow views.** Essential UI is designed for the narrowest Meta VR view, and a
panel follows your palm only as far as your view allows, so a hand held out to
the side never takes the menu out of sight.

Controllers work but are never required.
