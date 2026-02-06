import { useState, useRef, useEffect, useCallback } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          size?: "compact" | "flexible" | "normal";
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface VibeFormProps {
  onSubmit: (text: string, authorName?: string, turnstileToken?: string) => Promise<void>;
  isSubmitting: boolean;
  turnstileSiteKey?: string;
}

export function VibeForm({ onSubmit, isSubmitting, turnstileSiteKey }: VibeFormProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastSubmitRef = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderWidget = useCallback(() => {
    if (!turnstileSiteKey || !window.turnstile || !containerRef.current) return;
    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch {}
      widgetIdRef.current = null;
    }
    tokenRef.current = null;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: turnstileSiteKey,
      size: "flexible",
      callback: (token: string) => { tokenRef.current = token; },
      "error-callback": () => { tokenRef.current = null; },
      "expired-callback": () => { tokenRef.current = null; },
    });
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    if (window.turnstile) {
      renderWidget();
      return;
    }
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        renderWidget();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [turnstileSiteKey, renderWidget]);

  const formRef = useRef<HTMLFormElement>(null);

  // iOS soft keyboard: keep form visible above keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (!formRef.current) return;
      const offsetBottom = window.innerHeight - vv.height - vv.offsetTop;
      formRef.current.style.bottom = `${Math.max(0, offsetBottom)}px`;
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      if (formRef.current) formRef.current.style.bottom = "";
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!text.trim() || isSubmitting) return;

    const now = Date.now();
    if (now - lastSubmitRef.current < 5000) {
      setError("Wait a few seconds between prompts.");
      return;
    }
    lastSubmitRef.current = now;

    try {
      await onSubmit(text, undefined, tokenRef.current ?? undefined);
      setText("");
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        tokenRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        tokenRef.current = null;
      }
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="fixed bottom-0 left-0 right-0 z-20 backdrop-blur-xl bg-zinc-950/90 border-t border-zinc-800 p-4"
    >
      <div className="max-w-2xl mx-auto">
        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        <div className="flex gap-3 items-end">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Shift the vibe... (e.g. 'make it feel like walking through rain')"
            maxLength={200}
            className="flex-1 bg-zinc-900/80 border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          />
          <button
            type="submit"
            disabled={!text.trim() || isSubmitting}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
          >
            {isSubmitting ? "Shifting..." : "Shift"}
          </button>
        </div>
        <div ref={containerRef} />
      </div>
    </form>
  );
}
