import { useState, useCallback, useRef, useEffect } from "react";
import { useAgent } from "agents/react";
import type { VibeState, VibePrompt, RoomState, VibeMessage } from "../types";
import { SoundscapeEngine } from "../audio/engine";

export function useVibe() {
  const [vibeState, setVibeState] = useState<VibeState | null>(null);
  const [recentPrompts, setRecentPrompts] = useState<VibePrompt[]>([]);
  const [listenerCount, setListenerCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [turnstileKey, setTurnstileKey] = useState<string | undefined>();
  const engineRef = useRef<SoundscapeEngine | null>(null);
  const hasLoadedState = useRef(false);

  const agent = useAgent<RoomState>({
    agent: "vibe-room",
    name: "room",
    onStateUpdate: (state) => {
      setListenerCount(state.listenerCount);
    },
    onMessage: (event: MessageEvent) => {
      let msg: VibeMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "vibe_state":
          if (!hasLoadedState.current) {
            setVibeState(msg.state);
            setRecentPrompts(msg.recentPrompts);
            if (msg.turnstileKey) setTurnstileKey(msg.turnstileKey);
            hasLoadedState.current = true;
            // Apply to engine if already playing
            if (engineRef.current?.isStarted) {
              engineRef.current.applyState(msg.state);
            }
          }
          break;

        case "vibe_updated":
          setVibeState(msg.state);
          setRecentPrompts((prev) => [...prev, msg.prompt].slice(-20));
          setError(null);
          // Apply new state to audio engine
          if (engineRef.current?.isStarted) {
            engineRef.current.applyState(msg.state);
          }
          break;

        case "prompt_rejected":
          setError(msg.error);
          break;
      }
    },
  });

  const toggleAudio = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new SoundscapeEngine();
    }

    if (isPlaying) {
      engineRef.current.stop();
      setIsPlaying(false);
    } else {
      await engineRef.current.start();
      if (vibeState) {
        engineRef.current.applyState(vibeState);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, vibeState]);

  const submitPrompt = useCallback(
    async (text: string, authorName?: string, turnstileToken?: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        await agent.call("submitPrompt", [text, authorName, turnstileToken]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [agent]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  return {
    vibeState,
    recentPrompts,
    listenerCount,
    isSubmitting,
    isPlaying,
    error,
    turnstileKey,
    toggleAudio,
    submitPrompt,
  };
}
