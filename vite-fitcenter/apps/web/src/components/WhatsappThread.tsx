import type { WhatsappLogEvent } from "@/api/whatsapp"
import {
  conversationHasClientMessage,
  eventToBubbles,
  fmtAt,
  type ChatBubble,
} from "@/lib/whatsappConversation"

function BubbleView({ b }: { b: ChatBubble }) {
  const align =
    b.role === "bot" ? "items-end" : b.role === "sistema" ? "items-center" : "items-start"
  const box =
    b.role === "bot"
      ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-50"
      : b.role === "sistema"
        ? "border-amber-800/50 bg-amber-950/30 text-amber-50"
        : "border-sky-800/50 bg-sky-950/40 text-sky-50"
  const kickerColor =
    b.role === "bot" ? "text-emerald-300" : b.role === "sistema" ? "text-amber-300" : "text-sky-300"

  return (
    <li className={`flex flex-col ${align} px-3 py-2`}>
      <div className={`max-w-[92%] rounded-xl border px-3 py-2 sm:max-w-[80%] ${box}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${kickerColor}`}>
            {b.kicker}
          </span>
          <span className="text-[11px] text-zinc-500">{fmtAt(b.at)}</span>
          {b.status ? (
            <span className="text-[11px] text-zinc-400">· {b.status}</span>
          ) : null}
        </div>
        {b.fields && b.fields.length > 0 ? (
          <dl className="mt-2 space-y-1">
            {b.fields.map((f) => (
              <div key={f.label} className="text-sm">
                <dt className="text-[11px] text-zinc-400">{f.label}</dt>
                <dd className="whitespace-pre-wrap text-zinc-100">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {b.body ? (
          <p className={`whitespace-pre-wrap text-sm text-zinc-100 ${b.fields?.length ? "mt-2" : "mt-1"}`}>
            {b.body}
          </p>
        ) : null}
        {b.errorIt ? <p className="mt-1 text-xs text-red-300">{b.errorIt}</p> : null}
      </div>
    </li>
  )
}

export function WhatsappThread({
  events,
  emptyHint,
}: {
  events: WhatsappLogEvent[]
  emptyHint?: string
}) {
  const chronological = [...events].reverse()
  const bubbles = chronological.flatMap(eventToBubbles)
  const onlyForm = events.length > 0 && !conversationHasClientMessage(events)

  if (bubbles.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-zinc-500">
        {emptyHint || "Nessun messaggio in questa chat."}
      </div>
    )
  }

  return (
    <div>
      {onlyForm ? (
        <p className="border-b border-zinc-800/80 px-3 py-2 text-xs text-zinc-400">
          Il cliente non ha ancora scritto su WhatsApp. A sinistra la richiesta dal form, a destra
          cosa ha inviato il bot.
        </p>
      ) : null}
      <ul className="divide-y divide-zinc-800/40">{bubbles.map((b) => <BubbleView key={b.id} b={b} />)}</ul>
    </div>
  )
}
