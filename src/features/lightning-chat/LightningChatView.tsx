import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Hash,
  KeyRound,
  MapPin,
  MessageCircle,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { lightningChatService } from "./service";
import {
  DEFAULT_LIGHTNING_CHAT_CHANNEL,
  type LightningChatChannel,
  type LightningChatMessage,
  type LightningChatPeer,
} from "./types";
import { useLightningChat } from "./use-lightning-chat";

type Conversation =
  | { kind: "channel"; channel: LightningChatChannel }
  | { kind: "nearby"; peer: LightningChatPeer }
  | { kind: "nostr"; pubkey: string };

export function LightningChatView() {
  const snapshot = useLightningChat();
  const [conversation, setConversation] = useState<Conversation>({
    kind: "channel",
    channel: DEFAULT_LIGHTNING_CHAT_CHANNEL,
  });
  const [rooms, setRooms] = useState<LightningChatChannel[]>([]);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<
    "join" | "dm" | "identity" | "panic" | null
  >(null);
  const [dialogValue, setDialogValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const conversationId = getConversationId(conversation);
  const messages = useMemo(
    () =>
      snapshot.messages.filter(
        (item) => item.conversation_id === conversationId,
      ),
    [conversationId, snapshot.messages],
  );
  const nostrConversations = useMemo(
    () =>
      Array.from(
        new Set(
          snapshot.messages
            .map((item) => item.conversation_id)
            .filter((id) => id.startsWith("private:")),
        ),
      ).map((id) => id.slice("private:".length)),
    [snapshot.messages],
  );

  useEffect(() => {
    void lightningChatService
      .markConversationRead(conversationId)
      .catch(() => undefined);
  }, [conversationId, messages.length]);

  const selectChannel = (channel: LightningChatChannel): void => {
    setConversation({ kind: "channel", channel });
    lightningChatService.joinChannel(channel);
  };

  const submitDialog = (): void => {
    try {
      if (dialog === "join") {
        const channel = channelFromGeohash(dialogValue);
        setRooms((current) =>
          current.some((item) => item.id === channel.id)
            ? current
            : [...current, channel],
        );
        selectChannel(channel);
      } else if (dialog === "dm") {
        setConversation({ kind: "nostr", pubkey: resolvePubkey(dialogValue) });
      }
      setDialog(null);
      setDialogValue("");
      setError(null);
    } catch (cause) {
      setError(messageFrom(cause));
    }
  };

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (body.startsWith("/")) {
        await runCommand(body, selectChannel, setRooms);
      } else if (conversation.kind === "channel") {
        await lightningChatService.sendChannelMessage(body);
      } else if (conversation.kind === "nearby") {
        await lightningChatService.sendNearbyMessage(
          conversation.peer.id,
          body,
        );
      } else {
        await lightningChatService.sendPrivateMessage(
          conversation.pubkey,
          body,
        );
      }
      setDraft("");
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyIdentity = async (): Promise<void> => {
    if (!snapshot.identity) return;
    await navigator.clipboard.writeText(snapshot.identity.npub);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <section className="relative flex min-h-[620px] flex-1 overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#07101b]/95 shadow-2xl shadow-black/20">
      <aside className="hidden w-[230px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.018] md:flex">
        <div className="border-b border-white/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-300/15 bg-sky-400/10">
              <Zap className="h-5 w-5 text-sky-200" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-white">
                Lightning Chat
              </h1>
              <Status
                status={snapshot.status}
                relays={snapshot.connected_relays}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <SectionLabel label="Channels" onAdd={() => setDialog("join")} />
          <ChannelRow
            channel={DEFAULT_LIGHTNING_CHAT_CHANNEL}
            active={
              conversation.kind === "channel" &&
              conversation.channel.id === "global"
            }
            onSelect={selectChannel}
          />
          {rooms.map((room) => (
            <ChannelRow
              key={room.id}
              channel={room}
              active={
                conversation.kind === "channel" &&
                conversation.channel.id === room.id
              }
              onSelect={selectChannel}
            />
          ))}

          <div className="mt-6">
            <SectionLabel label="People" onAdd={() => setDialog("dm")} />
            {snapshot.peers.map((peer) => (
              <PeerRow
                key={peer.id}
                peer={peer}
                active={
                  conversation.kind === "nearby" &&
                  conversation.peer.id === peer.id
                }
                onSelect={() => setConversation({ kind: "nearby", peer })}
              />
            ))}
            {nostrConversations.map((pubkey) => (
              <DmRow
                key={pubkey}
                pubkey={pubkey}
                active={
                  conversation.kind === "nostr" &&
                  conversation.pubkey === pubkey
                }
                onSelect={() => setConversation({ kind: "nostr", pubkey })}
              />
            ))}
            {snapshot.peers.length === 0 && nostrConversations.length === 0 ? (
              <p className="px-2 py-4 text-xs leading-5 text-slate-500">
                Nearby people appear automatically. Use + to open an internet
                DM.
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDialog("identity")}
          className="m-3 flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.05]"
        >
          <Avatar label={snapshot.identity?.nickname ?? "?"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-white">
              {snapshot.identity?.nickname ?? "anonymous"}
            </span>
            <span className="block truncate text-[10px] text-slate-500">
              {compact(snapshot.identity?.npub ?? "identity starting")}
            </span>
          </span>
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          conversation={conversation}
          onJoin={() => setDialog("join")}
          onDm={() => setDialog("dm")}
          onClear={() => lightningChatService.clearMessages(conversationId)}
        />
        <Timeline messages={messages} conversation={conversation} />
        <div className="border-t border-white/[0.06] p-3 sm:p-4">
          {error || snapshot.error ? (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/15 bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{error ?? snapshot.error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-[20px] border border-white/[0.09] bg-white/[0.035] p-2 focus-within:border-sky-300/25">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={
                conversation.kind === "channel"
                  ? `Message ${conversation.channel.label}`
                  : "Write an encrypted message"
              }
              className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-300 text-slate-950 transition hover:bg-sky-200 disabled:opacity-30"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 px-1 text-[10px] text-slate-600">
            /j geohash · /m npub message · /clear · /panic
          </p>
        </div>
      </main>

      <aside className="hidden w-[185px] shrink-0 border-l border-white/[0.06] bg-white/[0.012] p-3 xl:block">
        <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Privacy route
        </p>
        <Route
          icon={<Radio className="h-3.5 w-3.5" />}
          title="Nearby"
          detail={`${snapshot.peers.length} reachable`}
        />
        <Route
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Nostr"
          detail={`${snapshot.connected_relays}/${snapshot.relays.length} relays`}
        />
        <div className="mt-5 rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <KeyRound className="h-4 w-4 text-emerald-200" />
          <p className="mt-2 text-xs font-medium text-slate-200">No account</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            Your identity is generated on-device and held in protected storage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog("panic")}
          className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-rose-200/75 hover:bg-rose-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Emergency wipe
        </button>
      </aside>

      {dialog === "join" ? (
        <Modal title="Join location channel" onClose={() => setDialog(null)}>
          <p className="mb-4 text-xs leading-5 text-slate-400">
            Enter a geohash: 7 characters for a block, 6 for a neighborhood, 5
            for a city.
          </p>
          <ModalInput
            value={dialogValue}
            onChange={setDialogValue}
            placeholder="dr5rsj7"
            onSubmit={submitDialog}
          />
          <ModalAction label="Join channel" onClick={submitDialog} />
        </Modal>
      ) : null}
      {dialog === "dm" ? (
        <Modal title="New private message" onClose={() => setDialog(null)}>
          <p className="mb-4 text-xs leading-5 text-slate-400">
            Paste a contact’s npub or 64-character Nostr public key.
          </p>
          <ModalInput
            value={dialogValue}
            onChange={setDialogValue}
            placeholder="npub1…"
            onSubmit={submitDialog}
          />
          <ModalAction label="Open encrypted chat" onClick={submitDialog} />
        </Modal>
      ) : null}
      {dialog === "identity" ? (
        <Modal title="Lightning Chat identity" onClose={() => setDialog(null)}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Display name
          </p>
          <input
            defaultValue={snapshot.identity?.nickname ?? "anonymous"}
            onBlur={(event) =>
              lightningChatService.setNickname(event.currentTarget.value)
            }
            className="mt-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 text-sm text-white outline-none"
          />
          <button
            type="button"
            onClick={() => void copyIdentity()}
            className="mt-4 flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">
              {snapshot.identity?.npub ?? "Starting…"}
            </span>
            {copied ? (
              <Check className="h-4 w-4 text-emerald-200" />
            ) : (
              <Copy className="h-4 w-4 text-slate-500" />
            )}
          </button>
        </Modal>
      ) : null}
      {dialog === "panic" ? (
        <Modal title="Emergency wipe" onClose={() => setDialog(null)}>
          <p className="rounded-2xl border border-rose-400/15 bg-rose-500/[0.07] p-3 text-xs leading-5 text-rose-100">
            Permanently remove the Lightning Chat identity, nickname, messages,
            favorites, and blocked list from this device.
          </p>
          <button
            type="button"
            onClick={() => void lightningChatService.panicWipe()}
            className="mt-4 w-full rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
          >
            Wipe Lightning Chat now
          </button>
        </Modal>
      ) : null}
    </section>
  );
}

function ChatHeader({
  conversation,
  onJoin,
  onDm,
  onClear,
}: {
  conversation: Conversation;
  onJoin: () => void;
  onDm: () => void;
  onClear: () => void;
}) {
  const title =
    conversation.kind === "channel"
      ? conversation.channel.label
      : conversation.kind === "nearby"
        ? conversation.peer.label
        : compact(conversation.pubkey);
  const detail =
    conversation.kind === "channel"
      ? conversation.channel.geohash
        ? `${conversation.channel.scope} location channel`
        : "local-first nearby channel"
      : conversation.kind === "nearby"
        ? "direct over Lightning P2P"
        : "Authenticated private envelope";
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.04] text-sky-200">
        {conversation.kind === "channel" ? (
          conversation.channel.geohash ? (
            <MapPin className="h-4 w-4" />
          ) : (
            <Radio className="h-4 w-4" />
          )
        ) : (
          <MessageCircle className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
        <p className="truncate text-[11px] text-slate-500">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onJoin}
        className="glass-button hidden px-3 py-2 text-xs sm:block"
      >
        <Hash className="mr-1 inline h-3.5 w-3.5" />
        Join
      </button>
      <button
        type="button"
        onClick={onDm}
        className="glass-button hidden px-3 py-2 text-xs sm:block"
      >
        <Plus className="mr-1 inline h-3.5 w-3.5" />
        DM
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-xl p-2 text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
        aria-label="Clear conversation"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </header>
  );
}

function Timeline({
  messages,
  conversation,
}: {
  messages: LightningChatMessage[];
  conversation: Conversation;
}) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 text-center">
        <div className="max-w-xs">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/[0.07] bg-white/[0.025]">
            {conversation.kind === "channel" ? (
              <Users className="h-6 w-6 text-slate-500" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-emerald-200/65" />
            )}
          </span>
          <h3 className="mt-4 text-sm font-semibold text-white">
            {conversation.kind === "channel"
              ? "The room is quiet"
              : "Private by design"}
          </h3>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {conversation.kind === "channel"
              ? "Send the first message. Nearby stays local; location rooms use decentralized relays."
              : "Authenticated private envelopes use a fresh outer key for every message."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
      {messages.map((message) => (
        <Bubble key={message.id} message={message} />
      ))}
    </div>
  );
}

function Bubble({ message }: { message: LightningChatMessage }) {
  const outgoing = message.direction === "outgoing";
  return (
    <article
      className={`flex max-w-[82%] gap-2.5 ${outgoing ? "self-end" : "self-start"}`}
    >
      {!outgoing ? <Avatar label={message.author_name} small /> : null}
      <div>
        {!outgoing ? (
          <p className="mb-1 px-1 text-[10px] text-slate-500">
            {message.author_name}
          </p>
        ) : null}
        <div
          className={`rounded-[18px] px-3.5 py-2.5 text-[13px] leading-5 ${outgoing ? "rounded-br-md bg-sky-300 text-slate-950" : "rounded-bl-md border border-white/[0.06] bg-white/[0.055] text-slate-100"}`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <p
          className={`mt-1 px-1 text-[9px] text-slate-600 ${outgoing ? "text-right" : ""}`}
        >
          {formatTime(message.created_at)}
          {outgoing ? ` · ${message.delivery}` : ""}
        </p>
      </div>
    </article>
  );
}

function SectionLabel({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="rounded-lg p-1 text-slate-600 hover:bg-white/[0.05] hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChannelRow({
  channel,
  active,
  onSelect,
}: {
  channel: LightningChatChannel;
  active: boolean;
  onSelect: (channel: LightningChatChannel) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition ${active ? "bg-sky-300/10 text-sky-100" : "text-slate-400 hover:bg-white/[0.035]"}`}
    >
      {channel.geohash ? (
        <MapPin className="h-4 w-4" />
      ) : (
        <Radio className="h-4 w-4" />
      )}
      <span className="min-w-0 flex-1 truncate">{channel.label}</span>
    </button>
  );
}

function PeerRow({
  peer,
  active,
  onSelect,
}: {
  peer: LightningChatPeer;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`mb-1 flex items-center rounded-xl ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.035]"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
      >
        <Avatar label={peer.label} small />
        <span className="truncate text-xs text-slate-300">{peer.label}</span>
      </button>
      <button
        type="button"
        onClick={() => lightningChatService.toggleFavorite(peer.id)}
        className="p-1.5 text-slate-600 hover:text-amber-200"
        aria-label="Favorite"
      >
        <Star
          className={`h-3 w-3 ${peer.is_favorite ? "fill-amber-200 text-amber-200" : ""}`}
        />
      </button>
      <button
        type="button"
        onClick={() => lightningChatService.blockPeer(peer.id)}
        className="mr-1 p-1.5 text-slate-600 hover:text-rose-200"
        aria-label="Block"
      >
        <Ban className={`h-3 w-3 ${peer.is_blocked ? "text-rose-300" : ""}`} />
      </button>
    </div>
  );
}

function DmRow({
  pubkey,
  active,
  onSelect,
}: {
  pubkey: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${
        active ? "bg-white/[0.06]" : "hover:bg-white/[0.035]"
      }`}
    >
      <Avatar label={pubkey} small />
      <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
        {compact(pubkey)}
      </span>
      <ShieldCheck className="h-3 w-3 text-emerald-200/60" />
    </button>
  );
}

function Avatar({ label, small = false }: { label: string; small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400/70 to-indigo-500/50 font-semibold text-white ${small ? "h-8 w-8 text-[10px]" : "h-9 w-9 text-xs"}`}
    >
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Status({ status, relays }: { status: string; relays: number }) {
  const online = status === "online";
  return (
    <p
      className={`flex items-center gap-1 text-[10px] ${online ? "text-emerald-200/80" : "text-slate-500"}`}
    >
      {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {online ? `${relays} relays · nearby` : status}
    </p>
  );
}

function Route({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="mt-2 rounded-xl border border-sky-300/10 bg-sky-300/[0.04] p-2.5">
      <div className="flex items-center gap-2 text-sky-200">
        {icon}
        <p className="text-[11px] font-medium text-slate-300">{title}</p>
      </div>
      <p className="mt-1 pl-5 text-[9px] text-slate-600">{detail}</p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#030812]/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-[24px] border border-white/[0.09] bg-[#0b1724] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center">
          <h3 className="flex-1 text-sm font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-500 hover:bg-white/[0.05]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalInput({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit();
      }}
      placeholder={placeholder}
      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-sky-300/30"
    />
  );
}

function ModalAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-200"
    >
      {label}
    </button>
  );
}

function channelFromGeohash(value: string): LightningChatChannel {
  const geohash = value.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9b-hjkmnp-z]{2,12}$/.test(geohash))
    throw new Error("Enter a valid 2–12 character geohash.");
  const scope =
    geohash.length >= 7
      ? "block"
      : geohash.length === 6
        ? "neighborhood"
        : geohash.length === 5
          ? "city"
          : geohash.length === 4
            ? "province"
            : "region";
  return { id: `geo:${geohash}`, label: `#${geohash}`, geohash, scope };
}

function resolvePubkey(value: string): string {
  const recipient = value.trim();
  if (/^[0-9a-f]{64}$/i.test(recipient)) return recipient.toLowerCase();
  const decoded = nip19.decode(recipient);
  if (decoded.type !== "npub")
    throw new Error("Enter a valid npub or public key.");
  return decoded.data;
}

async function runCommand(
  body: string,
  selectChannel: (channel: LightningChatChannel) => void,
  setRooms: React.Dispatch<React.SetStateAction<LightningChatChannel[]>>,
): Promise<void> {
  const [command, ...parts] = body.split(/\s+/);
  if (command === "/j" || command === "/join") {
    const channel = channelFromGeohash(parts[0] ?? "");
    setRooms((current) =>
      current.some((item) => item.id === channel.id)
        ? current
        : [...current, channel],
    );
    selectChannel(channel);
  } else if (command === "/m" || command === "/msg") {
    await lightningChatService.sendPrivateMessage(
      parts.shift() ?? "",
      parts.join(" "),
    );
  } else if (command === "/clear") {
    lightningChatService.clearMessages();
  } else if (command === "/panic") {
    await lightningChatService.panicWipe();
  } else {
    throw new Error("Unknown command. Try /j, /m, /clear, or /panic.");
  }
}

function getConversationId(conversation: Conversation): string {
  if (conversation.kind === "channel")
    return `channel:${conversation.channel.id}`;
  if (conversation.kind === "nearby") return `nearby:${conversation.peer.id}`;
  return `private:${conversation.pubkey}`;
}

function compact(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "Lightning Chat could not complete that action.";
}
