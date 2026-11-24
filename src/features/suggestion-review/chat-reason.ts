// Streamer-facing next step for a DarveBot chat reason code.
export function chatReason(code: string | null | undefined) {
  const reasons: Record<string, string> = {
    bot_unconfigured:
      'DarveBot posting is not configured; ask an owner to connect the posting account and configure the collector binding.',
    bot_not_connected:
      'DarveBot is not connected; ask an owner administrator to reconnect the posting account.',
    bot_reauthorize: 'DarveBot needs new consent; ask an owner administrator to reconnect it.',
    bot_expired: 'DarveBot access expired; ask an owner administrator to refresh or reconnect it.',
    channel_bot_missing:
      'Allow DarveBot notices in Connections to grant this channel’s posting permission.',
    pin_scope_missing:
      'DarveBot lacks pin permission; ask an owner to reconnect it with the pin scope and make it a moderator in this channel.',
    pin_disabled:
      'This round did not allow replacing chat pins; notices can still be posted, and pin replacement can be allowed when starting the next collection.',
    automatic_pin_unsupported:
      'This platform supports ordinary notices; automatic chat pinning is unavailable.',
    binding:
      'DarveBot’s posting authorization could not be verified; ask an owner to check its account binding.',
    permission:
      'DarveBot lacks permission in this chat; check Allow DarveBot notices and ask an owner to verify the bot’s grants and moderator status.',
    unavailable:
      'The provider could not apply the chat change; check the channel and ask an owner to verify bot permissions before another action.',
    unknown: 'The provider result is unconfirmed; check chat before making another request.',
    dropped: 'The provider rejected the notice; check channel moderation and bot permission.',
    stale: 'The original stream or notice expired; start a fresh collection in the current stream.',
  };
  return code
    ? (reasons[code] ??
        'The chat provider could not confirm this action; check chat and refresh its status.')
    : null;
}
