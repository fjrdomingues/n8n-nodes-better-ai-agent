# Better AI Agent – Guide for LLM-powered Agents

Welcome, fellow agent!  This document gives you the context you need to collaborate with (or embed inside) the **Better AI Agent** node that lives in this repository.

---

## 1. Purpose
The *Better AI Agent* node turns any n8n workflow into a **tool-using conversational agent**.  It:
* Wraps *any* connected chat-model node (OpenAI, Anthropic, Ollama, etc.) in the [`ai-sdk`](https://github.com/vercel/ai) interface.
* Exposes every downstream **Tool** connection as a callable `tool()` function.
* Persists the entire conversation—including `tool_calls` and `tool` results—in strict **OpenAI message format** so future turns retain structured context.

If you are an LLM reasoning over this workspace you should understand the schema described below so you can read, write, or debug the JSON blobs the node produces.

---

## 2. Message Schema
The agent always speaks and stores history in OpenAI chat format.

```jsonc
{
  "role": "assistant",        // one of system | user | assistant | tool
  "content": "…",             // natural language (or null for tool calls)
  "tool_calls": [              // ↙ only present when the assistant is invoking tools
    {
      "id": "call_UUID",      // stable ID used to link request & result
      "type": "function",
      "function": {
        "name": "calculator",  // name of the connected n8n tool
        "arguments": "{\n  \"a\": 2,\n  \"b\": 3\n}"
      }
    }
  ]
}
```

When the *Better AI Agent* executes a tool, it immediately appends a corresponding **tool role** message:

```jsonc
{
  "role": "tool",
  "tool_call_id": "call_UUID",   // matches the assistant message above
  "content": "5"                 // raw result or JSON-stringified object
}
```

These pairs are stored under a wrapper the node calls *conversation data*:

```jsonc
{
  "format": "openai_messages",
  "messages": [ /* … full chat history … */ ],
  "timestamp": 1712339200000      // ms since epoch
}
```

The wrapper is saved as `JSON.stringify(conversationData)` inside the connected **Memory** node.

---

## 3. Reasoning Loop & Limits
When the node runs `generateText()` it passes:
* `model`: the wrapped chat model.
* `tools`: the converted n8n tools.
* `maxSteps`: default **5** – maximum assistant/tool cycles before aborting.
* `messages`: the assembled chat history (system, memory, new user input).

The `ai-sdk` library will synthesize an answer, optionally call tools, and return both:

```ts
{
  text: "Final assistant reply",
  steps: [
    {
      text: "intermediate thought",
      toolCalls: [{ … }],
      toolResults: [{ … }]
    }
  ]
}
```

Each step is logged and later persisted to memory.

---

## 4. Tool Contract
A connected n8n Tool node must export:

```ts
{
  name: "weather",
  description: "Get current weather by city",
  schema: z.object({ city: z.string() }),   // ← used to auto-validate arguments
  invoke: async (args) => { … }
}
```

The helper `convertN8nToolsToAiSdk()` automatically wraps that object into an `ai-sdk`-compatible `tool()`.

### Tips for LLMs when issuing a tool call
1. **Choose arguments that satisfy the Zod schema.** Otherwise validation will throw.
2. The assistant message `content` can be `null` or a short rationale; users won't see it.
3. After receiving the tool result, think how it answers the user's goal before speaking again.

---

## 5. Extending the Agent
* **Add a new model** – simply connect another LangChain chat-model node; the conversion helper will detect its class name and wrap it.
* **Add a new tool** – connect any node implementing the interface above to the *Tool* input.
* **Custom parser** – connect a node to the *Output Parser* input to post-process `result.text` before it leaves the agent.

---

## 6. Development Notes
* The agent node lives in `BetterAiAgent.node.ts` (≈580 lines).
* Conversion helpers: `convertN8nModelToAiSdk()` & `convertN8nToolsToAiSdk()`.
* Memory logic: `saveToMemory()` – stores the conversation in OpenAI format.
* Inputs are declared via `getInputs()` so n8n's UI shows Chat Model, Memory, Tool, and Output Parser connection points.

---

## 7. Quick Example
```
User ➜ "Add 2 + 3"
Assistant (tool call) ➜ { name:"calculator", arguments:"{\n  \"a\":2,\n  \"b\":3\n}" }
Tool ➜ "5"
Assistant ➜ "2 + 3 = 5"
```

Happy reasoning!  Feel free to improve, critique, or augment this agent—pull requests and PR-generated tool calls are welcome. 