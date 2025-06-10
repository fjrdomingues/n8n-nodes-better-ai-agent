/** Rough token estimator (~4 chars per token) to avoid bringing in heavy encoders. */
function approximateTokens(messages: unknown[]): number {
  const text = JSON.stringify(messages);
  return Math.ceil(text.length / 4);
}

import type { CoreMessage } from 'ai';
import { AIMessage } from '@langchain/core/messages';
type StoredMessage = { content: string; _getType?: () => string };

export class ChatArrayMemory {
  constructor(
    private readonly memory: any, // BufferMemory or BufferWindowMemory
    private readonly maxContextTokens: number | null = null,
  ) {}

  /**
   * Load the stored chat array.  Performs legacy-format migration if needed.
   */
  async load(): Promise<CoreMessage[]> {
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
            if (Array.isArray(parsed)) return parsed as CoreMessage[];
          } catch {}
        }
      }
    }
    return [];
  }

  /** Save messages, performing optional trimming first */
  async save(messages: CoreMessage[]): Promise<void> {
    let finalMessages: CoreMessage[] = messages;
    if (this.maxContextTokens !== null) {
      finalMessages = this.trimToFit(messages, this.maxContextTokens);
    }
    if (this.memory.chatHistory && this.memory.chatHistory.addMessage) {
      await this.memory.chatHistory.addMessage(new AIMessage(JSON.stringify(finalMessages)));
    }
  }

  /**
   * Trim oldest messages until estimated token count fits under limit.
   * Very naive: drops oldest message one-by-one; can be improved later.
   */
  private trimToFit(messages: CoreMessage[], maxTokens: number): CoreMessage[] {
    const out = [...messages];
    while (out.length > 1 && approximateTokens(out) > maxTokens) {
      out.shift();
    }
    return out;
  }
} 