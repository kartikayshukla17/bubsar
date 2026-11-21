import { CopyCopiedIcon, CopyIcon, ExternalLinkSquareIcon, LockCloseIcon } from "@pikaicons/core-free";
import { useEffect, useRef, useState } from "react";
import { PikaIcon } from "~/components/icons";
import { NEW_TUNNEL } from "~/lib/board";

const CLEAR_AFTER = 30;

function CopyButton({ text, label, secret = false }: { text: string; label: string; secret?: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked: the label still tells the truth below */
    }
    setLeft(secret ? CLEAR_AFTER : 3);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      setLeft((n) => {
        if (n === null) return null;
        if (n <= 1) {
          if (timer.current) window.clearInterval(timer.current);
          if (secret) navigator.clipboard.writeText("").catch(() => {});
          return null;
        }
        return n - 1;
      });
    }, 1000);
  };

  const done = left !== null;
  return (
    <button type="button" className="bb-btn" onClick={copy} aria-live="polite">
      <PikaIcon icon={done ? CopyCopiedIcon : CopyIcon} size={15} strokeWidth={1.8} />
      <span key={String(done)} className="t-swap">
        {done ? (secret ? `Copied · clears in ${left}s` : "Copied") : label}
      </span>
    </button>
  );
}

/**
 * The strip busbar could not clear on its own, opened up.
 * It says why it stopped, gives the exact click, and waits.
 */
export function Handoff({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const callback = `${NEW_TUNNEL}/webhooks/whatsapp`;
  return (
    <div className="ml-[14px] mt-3 rounded-[6px] border border-rule bg-ink-3 p-5 sm:p-6">
      <div className="t-reveal max-w-[68ch]">
        <h4 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.015em] text-balance">
          Meta moved this form. Your turn.
        </h4>
        <p className="mt-2 text-mute">
          busbar opened WhatsApp → Configuration in your sandbox browser, but the Callback URL field isn't where
          the recipe expects it. Rather than guess on a live app, it stopped here. Google is queued behind this strip.
        </p>
        <ol className="mt-5 grid gap-4">
          <li className="grid gap-2 sm:grid-cols-[22px_1fr_auto] sm:items-center">
            <span className="font-display font-semibold text-signal">1</span>
            <span>
              Open <strong className="font-semibold">WhatsApp → Configuration → Webhook → Edit</strong>
            </span>
            <a
              className="bb-btn"
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noreferrer"
            >
              Open in sandbox browser
              <PikaIcon icon={ExternalLinkSquareIcon} size={15} strokeWidth={1.8} />
            </a>
          </li>
          <li className="grid gap-2 sm:grid-cols-[22px_1fr_auto] sm:items-center">
            <span className="font-display font-semibold text-signal">2</span>
            <span className="min-w-0">
              Callback URL
              <span className="mt-0.5 block truncate font-mono text-[12.5px] text-mute">{callback}</span>
            </span>
            <CopyButton text={callback} label="Copy URL" />
          </li>
          <li className="grid gap-2 sm:grid-cols-[22px_1fr_auto] sm:items-center">
            <span className="font-display font-semibold text-signal">3</span>
            <span>
              Verify token
              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-mute">
                <PikaIcon icon={LockCloseIcon} size={13} strokeWidth={1.8} />
                From vault slot WHATSAPP_VERIFY_TOKEN. Never shown here.
              </span>
            </span>
            <CopyButton text="demo-token-not-a-real-secret" label="Copy from vault" secret />
          </li>
          <li className="grid gap-2 sm:grid-cols-[22px_1fr] sm:items-center">
            <span className="font-display font-semibold text-signal">4</span>
            <span>
              Click <strong className="font-semibold">Verify and save</strong> in Meta, then come back here.
            </span>
          </li>
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button type="button" className="bb-btn bb-btn--primary" onClick={onDone}>
            I've saved it, check the handshake
          </button>
          <button type="button" className="bb-btn bb-btn--ghost" onClick={onSkip}>
            Skip this strip
          </button>
        </div>
      </div>
    </div>
  );
}
