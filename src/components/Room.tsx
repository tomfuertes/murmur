import { useVibe } from "../hooks/useVibe";
import { VibeForm } from "./VibeForm";
import { VibeCanvas } from "./VibeCanvas";
import type { VibeState } from "../types";

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_API_KEY as string | undefined;

function VibeDisplay({ state }: { state: VibeState }) {
  return (
    <div className="text-center space-y-6 bg-zinc-950/60 backdrop-blur-sm rounded-xl p-6">
      <p className="text-zinc-300 text-lg italic max-w-lg mx-auto">
        "{state.description}"
      </p>
      <div className="flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          {state.tempo} BPM
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          {state.key} {state.mode}
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          reverb {Math.round(state.reverbMix * 100)}%
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          delay {Math.round(state.delayMix * 100)}%
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          filter {Math.round(state.filterCutoff)}Hz
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          density {Math.round(state.density * 100)}%
        </span>
        <span className="bg-zinc-900 px-3 py-1 rounded-full">
          brightness {Math.round(state.brightness * 100)}%
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-xs">
        {state.instruments.map((inst) => (
          <span
            key={inst}
            className="bg-indigo-900/40 text-indigo-300 px-3 py-1 rounded-full border border-indigo-800/30"
          >
            {inst}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Room() {
  const {
    vibeState,
    recentPrompts,
    listenerCount,
    isSubmitting,
    isPlaying,
    error,
    toggleAudio,
    submitPrompt,
  } = useVibe();

  return (
    <div className="min-h-screen text-white flex flex-col">
      <VibeCanvas vibeState={vibeState} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-zinc-800/50">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-200">
          Soundscape
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {listenerCount === 1 ? "Just you" : `${listenerCount} listening`}
          </span>
          <button
            onClick={toggleAudio}
            className="px-4 py-1.5 text-sm rounded-lg border transition-colors bg-zinc-900 border-zinc-700 hover:border-zinc-500 text-zinc-300"
          >
            {isPlaying ? "Mute" : "Unmute"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-32">
        {!vibeState ? (
          <p className="text-zinc-500">Connecting...</p>
        ) : (
          <>
            {!isPlaying && (
              <div className="mb-8">
                <button
                  onClick={toggleAudio}
                  className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-lg rounded-2xl transition-colors animate-pulse"
                >
                  Start Listening
                </button>
                <p className="text-zinc-500 text-xs mt-2 text-center">
                  Click to enable audio
                </p>
              </div>
            )}

            <VibeDisplay state={vibeState} />

            {/* Recent prompts */}
            {recentPrompts.length > 0 && (
              <div className="mt-10 w-full max-w-lg space-y-2 bg-zinc-950/60 backdrop-blur-sm rounded-xl p-4">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Recent vibes
                </h2>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {recentPrompts
                    .slice()
                    .reverse()
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <span className="text-zinc-500 text-xs shrink-0">
                          {p.author_name}
                        </span>
                        <span className="text-zinc-400">{p.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm mt-4">{error}</p>
            )}
          </>
        )}
      </main>

      <VibeForm
        onSubmit={submitPrompt}
        isSubmitting={isSubmitting}
        turnstileSiteKey={turnstileSiteKey}
      />
    </div>
  );
}
