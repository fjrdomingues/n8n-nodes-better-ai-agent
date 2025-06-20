import type { CoreMessage } from 'ai';
import { AIMessage } from '@langchain/core/messages';
type StoredMessage = { content: string; _getType?: () => string };

export class ChatArrayMemory {
  constructor(
    private readonly memory: any, // BufferMemory or BufferWindowMemory
    /**
     * Optional hard limit on the number of messages to keep. If provided, the
     * stored conversation will be truncated to the *last* `maxMessages` items
     * before persisting so that upstream BufferWindowMemory `k` setting is
     * respected.
     */
    private readonly maxMessages: number | null = null,
  ) {}

  /**
   * Load the stored chat array by concatenating every JSON array that was
   * persisted on previous turns.  This keeps the database lean (one delta per
   * turn) while still letting us reconstruct the full conversation for the
   * next prompt.  We apply an optional `maxMessages` window **after**
   * reconstruction so the caller controls how much context is sent to the
   * model without losing older history in the DB.
   */
  async load(): Promise<CoreMessage[]> {
    // Trigger potential BufferMemory wrappers so n8n logs the access
    try {
      if (typeof this.memory.loadMemoryVariables === 'function') {
        await this.memory.loadMemoryVariables({ input: '__load__' });
      }
    } catch {}

    if (!this.memory.chatHistory || !this.memory.chatHistory.getMessages) {
      return [];
    }

    const allStored: StoredMessage[] = await this.memory.chatHistory.getMessages();

    const combined: CoreMessage[] = [];
    for (const msg of allStored) {
      if ((msg as any)._getType?.() !== 'ai') continue;
      const text = (msg as any).content;
      if (typeof text !== 'string') continue;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          combined.push(...(parsed as CoreMessage[]));
        }
      } catch {
        // ignore parse errors – could be non-JSON messages
      }
    }

    // Apply runtime window if specified
    let windowed = combined;
    if (this.maxMessages !== null && this.maxMessages > 0 && combined.length > this.maxMessages) {
      windowed = combined.slice(-this.maxMessages);
    }

    // Remove problematic messages at the very start of the window – those are the
    // only ones that can become "orphaned" when we cut off history.
    let startIndex = 0;
    while (startIndex < windowed.length) {
      const msg = windowed[startIndex];

      // 1. Orphan tool result (first message is `tool` with no preceding assistant)
      if (msg.role === 'tool') {
        if ((globalThis as any).__BAA_VERBOSE) console.log('⚠️ Dropping leading orphan tool message');
        startIndex += 1;
        continue;
      }

      // 2. Assistant message that *only* contains tool-calls with no following tool
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasToolCalls = (msg.content as any[]).some(p => p.type === 'tool-call');
        if (hasToolCalls) {
          if ((globalThis as any).__BAA_VERBOSE) console.log('⚠️ Dropping leading assistant message with tool-call but no response');
          startIndex += 1;
          continue;
        }
      }

      // First message is safe – stop trimming
      break;
    }

    return windowed.slice(startIndex);
  }

  /**
   * Persist the messages produced in the *current* run (delta).  We expect the
   * caller to pass **only** the new messages, so we just insert them as a JSON
   * array.  Nothing is truncated – historical context remains intact in the DB.
   */
  async save(messages: CoreMessage[]): Promise<void> {
    if (!messages || messages.length === 0) return;

    if (this.memory.chatHistory && this.memory.chatHistory.addMessage) {
      await this.memory.chatHistory.addMessage(new AIMessage(JSON.stringify(messages)));
    }
  }
}