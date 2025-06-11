# Better AI Agent for n8n

An improved AI Agent node for n8n that provides better memory management, modern AI SDK integration and a webhook option to push intermediate messages as they happen.

## Features

- **Conversation Memory that includes Tools** – every user message, tool call and tool result is stored.
- **Modern AI SDK Providers** – wraps OpenAI, Gemini and Anthropic through Vercel AI SDK.
- **Live Streaming Updates**: Intermediate Webhook URL lets you push each agent step in real-time

## Installation

```bash
npm install n8n-nodes-better-ai-agent
```

## Compatibility

This node is designed to be a drop-in replacement for the existing AI Agent node while providing enhanced functionality:

- ✅ Works with existing Language Model nodes
- ✅ Works with existing Memory nodes  
- ✅ Works with existing Tool nodes
- ✅ Works with existing Output Parser nodes
- ✅ Maintains same input/output interface

## Key Improvements Over Standard Agent

### 1. Memory Management
- **Problem**: Original agent doesn't save tool calls to memory
- **Solution**: Every interaction (human messages, AI responses, tool calls, tool results) is properly saved

### 2. Modern AI SDK
- **Problem**: Uses deprecated LangChain patterns
- **Solution**: Built on Vercel AI SDK for better performance and reliability

### 3. Simplified Configuration
- **Problem**: Complex agent type selection with lots of conditional logic
- **Solution**: Single, powerful agent that adapts to your needs

## Usage

### Basic Setup

1. **Add the node** to your workflow
2. **Connect a Language Model** (OpenAI, Anthropic, etc.)
3. **Optionally connect**:
   - Memory node for conversation persistence
   - Tool nodes for enhanced capabilities
   - Output Parser for structured responses

### Input Sources

Choose how to provide the user prompt:

- **Connected Chat Trigger Node**: Automatically uses `chatInput` from chat triggers
- **Define below**: Use expressions or static text

### Configuration Options

- **System Message**: Define the agent's behavior and personality
- **Max Tool Calls**: Limit the number of tool interaction rounds
- **Intermediate Webhook URL**: Send each partial reply/tool-call to an external workflow in real-time
- **Verbose Logs**: Enable/disable detailed console logging
- **Temperature**: Control response creativity (0.0 = deterministic, 1.0 = creative)
- **Max Tokens**: Set response length limits

### Example Workflow

```
Chat Trigger → Better AI Agent → Response
              ↗ OpenAI Model
              ↗ Buffer Memory
              ↗ Calculator Tool
              ↗ Web Search Tool
```

## Technical Details

### Tool Call Memory

Unlike the original agent, this node ensures that all tool interactions are preserved in memory:

```
User: "What's 25 * 47 and then search for that number"
Assistant: [calls calculator tool]
Tool: "1175"
Assistant: [calls web search tool with "1175"]
Tool: [search results]
Assistant: "The result is 1175. Here's what I found about it..."
```

All of these interactions are saved to memory for future reference.

### AI SDK Integration

Uses modern patterns from Vercel AI SDK:

- Built-in tool calling support
- Automatic conversation management
- Better error handling
- Real-time step streaming via `onStepFinish`

### Known Limitations

| Limitation | Work-around |
|------------|------------|
| n8n UI does not highlight the attached model or tool nodes because only the Agent executes code | Rely on the Agent output or streamed webhook messages for visibility |
| Tool nodes without an explicit Zod/JSON schema (e.g. raw HTTP Request) may receive incorrect argument keys | Wrap such tools in a **Custom Code Tool** and define a schema, or add few-shot examples |
| Streaming is step-level, not token-level; the n8n node outputs only when the Agent finishes | Use the Intermediate Webhook to push interim messages to a Chat, Slack, etc. |
| The node's dependencies must be available next to `~/.n8n/custom/BetterAiAgent.node.js` | Run `npm run deploy-local` (copies `package.json` and installs runtime deps) |

## Development

### Building from Source

```bash
git clone <repository>
cd better-ai-agent
npm install
npm run build
```

### Testing

```bash
npm test
```

### Publishing

```bash
npm run package
npm publish
```

## Troubleshooting

### Common Issues

1. **"No language model connected"**: Ensure you've connected a language model node
2. **Tool calls not working**: Verify your tools are properly configured and connected
3. **Memory not persisting**: Check that your memory node is correctly connected

### Debug Information

The node outputs additional debug information:

- `usage`: Token usage statistics
- `finishReason`: Why the generation stopped
- `toolCalls`: List of tools that were called
- `toolResults`: Results from tool executions

## Contributing

We welcome contributions! Please see our contributing guidelines for more information.

## License

MIT License - see LICENSE file for details.

## Support

- Create an issue for bugs or feature requests
- Join the n8n community for general support
- Check the documentation for detailed usage examples 