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

export class ChatArrayMemory {
  constructor(
    private readonly memory: {
      loadMemoryVariables: (vars: Record<string, unknown>) => Promise<Record<string, any>>;
      saveContext: (
        input: Record<string, unknown>,
        output: Record<string, unknown>,
      ) => Promise<void>;
    },
    private readonly key: string = 'chat_history_oai',
    private readonly maxContextTokens: number | null = null, // optional – no trimming when null
  ) {}

  /**
   * Load the stored chat array.  Performs legacy-format migration if needed.
   */
  async load(): Promise<ChatMessage[]> {
    const vars = await this.memory.loadMemoryVariables({});
    const raw = vars[this.key];
    if (!raw || typeof raw !== 'string') return [];

    try {
      // Normal path: valid JSON array.
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ChatMessage[];
      // Migration path: wrapper object from older implementation.
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as any).format === 'openai_messages' &&
        Array.isArray((parsed as any).messages)
      ) {
        return (parsed as any).messages as ChatMessage[];
      }
    } catch {
      // ignore parse errors – fallback to empty
    }
    return [];
  }

  /** Save messages, performing optional trimming first */
  async save(messages: ChatMessage[]): Promise<void> {
    let finalMessages: ChatMessage[] = messages;

    if (this.maxContextTokens !== null) {
      finalMessages = this.trimToFit(messages, this.maxContextTokens);
    }

    await this.memory.saveContext({}, { [this.key]: JSON.stringify(finalMessages) });
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