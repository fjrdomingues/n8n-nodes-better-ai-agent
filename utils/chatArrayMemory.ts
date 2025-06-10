/** Rough token estimator (~4 chars per token) to avoid bringing in heavy encoders. */
function approximateTokens(messages: unknown[]): number {
  const text = JSON.stringify(messages);
  return Math.ceil(text.length / 4);
}

/**
 * Lightweight wrapper that stores an array of OpenAI-style chat messages inside any
 * n8n/LangChain memory implementation.  This preserves tool_calls & tool role
 * data that would otherwise be lost by LangChain's default message classes.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  // assistant role when invoking functions
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  // tool role when responding
  tool_call_id?: string;
}

type BaseMessage = { content: string; _getType(): string };

export class ChatArrayMemory {
  constructor(
    private readonly memory: any, // BufferMemory or BufferWindowMemory
    private readonly maxContextTokens: number | null = null,
  ) {}

  /**
   * Load the stored chat array.  Performs legacy-format migration if needed.
   */
  async load(): Promise<ChatMessage[]> {
    if (!this.memory.chatHistory || !this.memory.chatHistory.getMessages) {
      return [];
    }
    const msgs: BaseMessage[] = await this.memory.chatHistory.getMessages();
    // Find last AIMessage whose content parses as array
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if ((m as any)._getType?.() === 'ai') {
        const text = (m as any).content;
        if (typeof text === 'string') {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed as ChatMessage[];
          } catch {}
        }
      }
    }
    return [];
  }

  /** Save messages, performing optional trimming first */
  async save(messages: ChatMessage[]): Promise<void> {
    let finalMessages: ChatMessage[] = messages;
    if (this.maxContextTokens !== null) {
      finalMessages = this.trimToFit(messages, this.maxContextTokens);
    }
    if (this.memory.chatHistory && this.memory.chatHistory.addMessage) {
      const msg: BaseMessage = {
        content: JSON.stringify(finalMessages),
        _getType() { return 'ai'; }
      } as any;
      await this.memory.chatHistory.addMessage(msg);
    }
  }

  /**
   * Trim oldest messages until estimated token count fits under limit.
   * Very naive: drops oldest message one-by-one; can be improved later.
   */
  private trimToFit(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    const out = [...messages];
    while (out.length > 1 && approximateTokens(out) > maxTokens) {
      out.shift();
    }
    return out;
  }
} 