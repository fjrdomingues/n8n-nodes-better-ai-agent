import type { CoreMessage } from 'ai';
import { AIMessage } from '@langchain/core/messages';
type StoredMessage = { content: string; _getType?: () => string };

// Message validation (duplicated from main file to avoid circular imports)
function validateCoreMessage(msg: any): msg is CoreMessage {
	if (!msg || typeof msg !== 'object') return false;
	if (!msg.role || typeof msg.role !== 'string') return false;
	if (!['user', 'assistant', 'tool', 'system'].includes(msg.role)) return false;
	
	// Content validation based on role
	if (msg.role === 'user' || msg.role === 'system') {
		return typeof msg.content === 'string';
	} else if (msg.role === 'assistant') {
		return typeof msg.content === 'string' || Array.isArray(msg.content);
	} else if (msg.role === 'tool') {
		return Array.isArray(msg.content) && msg.content.every((part: any) => 
			part && typeof part === 'object' && part.type === 'tool-result'
		);
	}
	return false;
}

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
          // Validate each message before adding to prevent corruption
          const validMessages = parsed.filter(validateCoreMessage);
          if (validMessages.length < parsed.length) {
            console.warn(`⚠️ Filtered out ${parsed.length - validMessages.length} invalid messages from memory`);
          }
          combined.push(...validMessages);
        }
      } catch {
        console.warn('⚠️ Skipping corrupted message in memory (invalid JSON)');
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

    // Validate all messages before saving to prevent memory corruption
    const validMessages = messages.filter(validateCoreMessage);
    if (validMessages.length === 0) {
      console.warn('⚠️ No valid messages to save to memory');
      return;
    }
    
    if (validMessages.length < messages.length) {
      console.warn(`⚠️ Filtered out ${messages.length - validMessages.length} invalid messages before saving to memory`);
    }

    if (this.memory.chatHistory && this.memory.chatHistory.addMessage) {
      await this.memory.chatHistory.addMessage(new AIMessage(JSON.stringify(validMessages)));
    }
  }
}