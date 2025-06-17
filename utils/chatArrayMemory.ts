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

    // Remove any leading orphan `tool` messages (can appear after windowing)
    while (windowed.length > 0 && (windowed[0] as any).role === 'tool') {
      windowed.shift();
    }

    return windowed;
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