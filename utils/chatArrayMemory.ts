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
   * Load the stored chat array.  Performs legacy-format migration if needed.
   */
  async load(): Promise<CoreMessage[]> {
    // 1) Trigger BufferMemory wrapper (and therefore n8n Postgres node logging)
    try {
      if (typeof this.memory.loadMemoryVariables === 'function') {
        await this.memory.loadMemoryVariables({ input: '__load__' });
      }
    } catch (e) {
      // non-fatal – continue with manual fetch
    }

    if (!this.memory.chatHistory || !this.memory.chatHistory.getMessages) {
      return [];
    }

    const msgs: StoredMessage[] = await this.memory.chatHistory.getMessages();
    // Find last AIMessage whose content parses as array
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if ((m as any)._getType?.() === 'ai') {
        const text = (m as any).content;
        if (typeof text === 'string') {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              const arr = parsed as CoreMessage[];
              if (this.maxMessages !== null && this.maxMessages > 0 && arr.length > this.maxMessages) {
                return arr.slice(-this.maxMessages);
              }
              return arr;
            }
          } catch {}
        }
      }
    }
    return [];
  }

  /** Save messages, performing optional trimming first */
  async save(messages: CoreMessage[]): Promise<void> {
    let finalMessages: CoreMessage[] = messages;

    // Respect message limit (if provided) by keeping only the most recent ones
    if (this.maxMessages !== null && this.maxMessages > 0) {
      finalMessages = messages.slice(-this.maxMessages);
    }

    // --- Sanitize conversation to avoid orphan `tool` messages ---------------
    // If truncation cut off the preceding assistant/tool_calls pair, we might
    // start the window with a lone `tool` message.  Simply drop *leading*
    // `tool` messages until the first message is not a tool.

    while (finalMessages.length > 0 && finalMessages[0].role === 'tool') {
      finalMessages.shift();
    }

    if (this.memory.chatHistory && this.memory.chatHistory.addMessage) {
      await this.memory.chatHistory.addMessage(new AIMessage(JSON.stringify(finalMessages)));
    }
  }
} 