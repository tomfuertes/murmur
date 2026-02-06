# Murmur

A shared ambient soundscape that evolves through collective imagination.

**[murmur.tomfuertes.com](https://murmur.tomfuertes.com)**

## The Idea

What if a room full of strangers could shape music together — not by playing instruments, but by describing feelings?

Murmur is a shared space where everyone hears the same evolving generative music. Type a phrase like *"walking through rain"* or *"late night in Tokyo"* and the soundscape shifts for everyone listening. An AI interprets your words into musical parameters — tempo slows, reverb deepens, new instruments fade in — and the visual shader behind the UI morphs to match.

No accounts. No history. Just a living, breathing ambient room that sounds like whatever its listeners are feeling right now.

## Inspiration

- **Brian Eno's generative music** — systems that create ever-changing music from simple rules. Murmur's engine uses seeded randomness and musical scales to produce ambient compositions that never repeat.
- **Winamp / Milkdrop visualizers** — the hypnotic kaleidoscopic visuals of early 2000s music players. Murmur's WebGL shader uses similar techniques: noise fields, radial symmetry, and zoom-feedback trails that respond to the musical parameters.
- **Shared spaces** — the feeling of being in a room where everyone contributes to the atmosphere. Like a campfire, but for sound.

## How It Works

You type a prompt. An LLM interprets it as changes to musical parameters (tempo, key, reverb, delay, density, brightness, instruments). Those parameters flow to every connected listener simultaneously. Each browser synthesizes the audio locally using Tone.js — there's no audio streaming, just shared state. The WebGL visualization maps the same parameters to shader uniforms, so you see what you hear.

## Stack

Cloudflare Workers, Durable Objects, Workers AI, React, Tone.js, WebGL2.
