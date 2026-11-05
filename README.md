# orbly

A spatial music toy for Meta Quest. You sit down and, with nothing but your
hands, place orbs of light around you, or throw them at your real walls, table
and floor, where they stick and start to sing. A beam sweeps around the room
like a lighthouse, and each orb sounds as it passes. Because every surface plays
a different instrument, every room is a different band.

No musical knowledge needed: every position is in key, on the beat.

Built with the [Immersive Web SDK](https://iwsdk.dev) for the Meta VR Start
Developer Competition 2026 (Entertainment, New Experience). All sound is
synthesized live with the Web Audio API: there are no samples and no
third-party music.

## How the music works

| Where you place an orb | What it changes                                    |
| ---------------------- | -------------------------------------------------- |
| Angle around you       | When it plays (16 steps, quantized)                |
| Height                 | Which note (always on a pentatonic scale)          |
| Near / middle / far    | Which instrument: pluck, pad or bass               |

Throw an orb and the room takes over:

| Where it lands         | What it plays                                      |
| ---------------------- | -------------------------------------------------- |
| Wall, door, window     | Bell, rising in pitch from floor to ceiling        |
| Table, desk            | Marimba, rising in pitch away from you             |
| Floor                  | Soft drum                                          |
| Sofa, bed              | Muffled hum                                        |
| Nothing detected       | Breath of air, floating on an invisible dome       |

An orb's colour shows its instrument. It flashes on the note you hear.

**Sit back for a concert.** Lower your hands and, after a few seconds, the house
lights go down. orbly takes your song and turns it into a piece: chords, bass and
a soft pulse appear around it, layers enter and leave in sections, and the melody
draws itself across the dark room. Even a single orb becomes music. Your song
itself never changes, and raising a hand brings it straight back.

**Your room remembers your song.** The first orb to land pins the song to a
persistent anchor. Come back to the same room and it is already on your walls,
exactly where you left it, wherever you sit. Open it in another room and the
same song lands on that room's surfaces, as a different band.

## Controls

Hands only, seated, everything within arm's reach. Controllers also work, but
are never needed.

| Gesture                       | Action                                    |
| ----------------------------- | ----------------------------------------- |
| Pinch in empty air            | Create an orb at your fingertips          |
| Pinch an orb and drag         | Move it (you hear the pitch as it moves)  |
| Let go of an orb mid-throw    | It flies to the room and sticks there     |
| Point at a far orb until a line of light appears, then pinch | Call it back to your hand |
| Let go of an orb over your lap | Delete it (it fades as you lower it)     |
| Turn your left palm up        | Open the menu                             |
| Press a button with the other index finger | Use the menu                 |

The menu holds tempo, play/pause, undo, rotate, colour scene, room/starfield,
save, clear and home. **Rotate** turns the near ring a quarter turn, so the part
of the loop behind you can be reached without leaving your seat. Orbs on the
room stay where they are: they are stuck to it.

With controllers, the trigger pinches and X opens the menu.

## Fits every headset

Meta VR Glasses see far less than a Quest: 37 degrees to each side, 25 up and 43
down. All essential UI is designed for that narrowest view, so nothing needs a
separate version. The home screen and tutorial are laid out inside it, a unit
test fails if anything leaves it, and the palm menu and messages are pulled back
into view when a hand wanders off to the side.

To preview it, set `dev.emulator.device` to `metaVRGlasses` in
`iwsdk.config.json`: the emulator masks everything outside the glasses' view.

## Run it

Requires Node 20.19+, 22.12+ or 24+.

```sh
npm install
npm run dev
```

This opens a browser running IWER, IWSDK's WebXR emulator, so no headset is
needed. Click **Enter orbly**, then switch the input to hands in the emulator's
toolbar. Move a hand with its gizmo and use the **Pinch** control in the hand
panel. Full controls:
[IWER guide](https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls).

```sh
npm test            # unit tests
npm run typecheck
npm run build
```

## Try it on a Quest

Open the deployed HTTPS URL in the Meta Quest browser and press **Enter orbly**.
WebXR needs HTTPS, so for a development build use the network URL printed by
`npx @iwsdk/cli dev status` and accept the local certificate warning.

## Demo mode

`?demo=1` plays a self-running film for recording video. Ghost hands create,
drag, throw and press buttons through the same code paths as real hands, so what
you film is the real app. It loops, and takes about two minutes per pass.

- **`/?demo=1` in the emulator** plays in the passthrough room with the emulator
  UI hidden. Use this one to show mixed reality.
- **`?demo=1` anywhere else** (or `?demo=1&flat=1`) plays over the starfield.

Press **Start demo** first: browsers only allow sound after a click.

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on
every push to `main`. In the repository, set **Settings → Pages → Source** to
**GitHub Actions**. The workflow sets Vite's `base` from the repository name.

## Layout

```
src/audio/        Web Audio engine, pentatonic scale, lookahead step clock
src/sequencer/    Pure radial mapping and the concert arranger
src/interaction/  Pure gesture detection: pinch, grab, throw, aim, palm-up
src/room/         Pure room model: surfaces, raycasts, throw flight, room memory
src/visuals/      Instanced orbs, beam, floor ring, particles, room pulses
src/ui/           Palm menu, poke buttons, onboarding, home screen
src/state/        Composition, undo, persistence, daily challenge
src/app/          Wires it together; session lifecycle; demo director
```

`sequencer`, `room`, `state` and the detectors in `interaction` have no rendering
or WebXR dependencies, which is what lets them run under Vitest on simulated joint
data.

See [docs/quest-testing.md](docs/quest-testing.md) for the on-device checklist.
