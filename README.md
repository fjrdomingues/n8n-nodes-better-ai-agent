# Better AI Agent for n8n

An improved AI Agent node for n8n that provides better memory management, modern AI SDK integration, and proper tool call handling.

## Features

- 🧠 **Proper Memory Management**: Tool calls and responses are correctly saved to conversation memory
- 🚀 **Modern AI SDK**: Uses Vercel AI SDK instead of deprecated LangChain patterns
- 🔧 **Better Tool Integration**: Seamless compatibility with existing n8n tools
- ⚡ **Simplified Architecture**: Single agent type that handles all use cases
- 📝 **Structured Outputs**: Enhanced JSON schema support and validation
- 🔄 **Streaming Support**: Built-in streaming capabilities (future feature)

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
- Streaming capabilities (future)

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