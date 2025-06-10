import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodeInputConfiguration,
	INodeInputFilter,
	NodeOperationError,
	NodeConnectionType,
	NodeConnectionTypes,
} from 'n8n-workflow';

import { generateText, tool } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import {
	getPromptInputByType,
	getConnectedTools,
	getConnectedMemory,
	getConnectedModel,
	getConnectedOutputParser,
	promptTypeOptions,
	textInput,
	textFromPreviousNode,
} from './utils';
import { ChatArrayMemory, ChatMessage } from './utils/chatArrayMemory';

// Helper function to convert n8n model to AI SDK compatible format
function convertN8nModelToAiSdk(n8nModel: any): any {
	if (!n8nModel) {
		throw new Error('No language model provided');
	}

	// Debug: Log the model properties to understand the structure
	console.log('n8n Model type:', n8nModel.constructor?.name);
	console.log('n8n Model properties:', Object.keys(n8nModel));
	
	// Extract model information from the LangChain model
	const modelName = n8nModel.modelName || n8nModel.model || 'gpt-4o-mini';
	
	// Check if it's an OpenAI-compatible model (OpenAI, Azure OpenAI, etc.)
	if (n8nModel.constructor?.name?.includes('ChatOpenAI') || 
		n8nModel.constructor?.name?.includes('OpenAI')) {
		
		// Extract settings from the LangChain model
		const settings: any = {};
		if (n8nModel.temperature !== undefined) settings.temperature = n8nModel.temperature;
		if (n8nModel.maxTokens !== undefined) settings.maxTokens = n8nModel.maxTokens;
		if (n8nModel.topP !== undefined) settings.topP = n8nModel.topP;
		if (n8nModel.frequencyPenalty !== undefined) settings.frequencyPenalty = n8nModel.frequencyPenalty;
		if (n8nModel.presencePenalty !== undefined) settings.presencePenalty = n8nModel.presencePenalty;
		
		// Extract API key from the LangChain model
		const apiKey = n8nModel.openAIApiKey || n8nModel.apiKey;
		console.log('OpenAI API Key found:', apiKey ? 'YES (length: ' + apiKey.length + ')' : 'NO');
		
		// Try to get API key from clientConfig if not found directly
		let finalApiKey = apiKey;
		if (!finalApiKey && n8nModel.clientConfig) {
			const clientApiKey = n8nModel.clientConfig.apiKey || n8nModel.clientConfig.openAIApiKey;
			console.log('Client config API key:', clientApiKey ? 'YES (length: ' + clientApiKey.length + ')' : 'NO');
			if (clientApiKey) {
				finalApiKey = clientApiKey;
			}
		}
		
		// Extract base URL if it exists (for Azure OpenAI, etc.)
		if (n8nModel.configuration?.baseURL) {
			settings.baseURL = n8nModel.configuration.baseURL;
		}
		
		// Use createOpenAI with explicit API key instead of openai()
		if (finalApiKey) {
			console.log('Using createOpenAI with explicit API key');
			const openaiProvider = createOpenAI({
				apiKey: finalApiKey,
				...settings
			});
			return openaiProvider(modelName);
		} else {
			console.log('No API key found, using default openai provider');
			return openai(modelName, settings);
		}
	}
	
	// Check if it's an Anthropic model
	if (n8nModel.constructor?.name?.includes('ChatAnthropic') || 
		n8nModel.constructor?.name?.includes('Anthropic')) {
		
		const settings: any = {};
		if (n8nModel.temperature !== undefined) settings.temperature = n8nModel.temperature;
		if (n8nModel.maxTokens !== undefined) settings.maxTokens = n8nModel.maxTokens;
		if (n8nModel.topP !== undefined) settings.topP = n8nModel.topP;
		
		// Extract API key for Anthropic
		const apiKey = n8nModel.anthropicApiKey || n8nModel.apiKey;
		
		// Use createAnthropic with explicit API key
		if (apiKey) {
			console.log('Using createAnthropic with explicit API key');
			const anthropicProvider = createAnthropic({
				apiKey: apiKey,
				...settings
			});
			return anthropicProvider(modelName);
		} else {
			console.log('No API key found, using default anthropic provider');
			return anthropic(modelName, settings);
		}
	}
	
	// Default fallback to OpenAI with a sensible model
	console.warn(`Unknown model type: ${n8nModel.constructor?.name}, defaulting to OpenAI`);
	return openai('gpt-4o-mini');
}

// Helper function to convert n8n tools to AI SDK tools
function convertN8nToolsToAiSdk(n8nTools: any[]): Record<string, any> {
	const tools: Record<string, any> = {};
	
	console.log('Converting n8n tools to AI SDK format:');
	console.log('Number of tools:', n8nTools.length);
	
	for (const n8nTool of n8nTools) {
		console.log('n8n Tool:', {
			name: n8nTool?.name,
			description: n8nTool?.description,
			schema: n8nTool?.schema,
			keys: Object.keys(n8nTool || {})
		});
		
		if (n8nTool && n8nTool.name) {
			// Create a more robust schema - handle ZodEffects
			let toolSchema;
			try {
				if (n8nTool.schema) {
					// Check if it's a ZodEffects and extract the underlying schema
					if (n8nTool.schema._def && n8nTool.schema._def.schema) {
						console.log('Extracting schema from ZodEffects');
						toolSchema = n8nTool.schema._def.schema;
					} else {
						toolSchema = n8nTool.schema;
					}
				} else {
					// Default schema if none provided
					toolSchema = z.object({
						input: z.string().describe('Tool input'),
					});
				}
				
				console.log('Final tool schema:', toolSchema);
			} catch (error) {
				console.warn(`Invalid schema for tool ${n8nTool.name}, using default:`, error);
				toolSchema = z.object({
					input: z.string().describe('Tool input'),
				});
			}
			
			tools[n8nTool.name] = tool({
				description: n8nTool.description || `Execute ${n8nTool.name}`,
				parameters: toolSchema,
				execute: async (parameters: any) => {
					console.log(`Executing tool ${n8nTool.name} with parameters:`, parameters);
					try {
						// Call the n8n tool
						const result = await n8nTool.invoke(parameters);
						console.log(`Tool ${n8nTool.name} result:`, result);
						return result;
					} catch (error) {
						console.error(`Tool ${n8nTool.name} execution failed:`, error);
						throw error;
					}
				},
			});
			
			console.log(`Successfully converted tool: ${n8nTool.name}`);
		} else {
			console.warn('Skipping invalid tool:', n8nTool);
		}
	}
	
	console.log(`Total tools converted: ${Object.keys(tools).length}`);
	return tools;
}

// Helper function to save conversation to memory using proper OpenAI message format
async function saveToMemory(memory: any, userInput: string, result: any): Promise<void> {
	if (!memory || !memory.saveContext) return;

	try {
		console.log('=== SAVING TO MEMORY (OpenAI Format) ===');
		console.log('User input:', userInput);
		console.log('Result steps:', result.steps?.length || 0);
		console.log('Result text:', result.text);

		// Build proper OpenAI message format
		const messages: any[] = [];

		// Add user message
		messages.push({
			role: 'user',
			content: userInput
		});

		// Process each step to build proper message sequence
		if (result.steps && result.steps.length > 0) {
			for (let i = 0; i < result.steps.length; i++) {
				const step = result.steps[i];
				console.log(`Step ${i + 1}:`, {
					text: step.text,
					toolCalls: step.toolCalls?.length || 0,
					toolResults: step.toolResults?.length || 0
				});

				// Add assistant message with tool calls (if any)
				if (step.toolCalls && step.toolCalls.length > 0) {
					const assistantMessage: any = {
						role: 'assistant',
						content: step.text || null,
						tool_calls: step.toolCalls.map((toolCall: any) => ({
							id: toolCall.toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
							type: 'function',
							function: {
								name: toolCall.toolName,
								arguments: JSON.stringify(toolCall.args)
							}
						}))
					};
					messages.push(assistantMessage);

					// Add tool result messages
					if (step.toolResults && step.toolResults.length > 0) {
						for (const toolResult of step.toolResults) {
							messages.push({
								role: 'tool',
								tool_call_id: assistantMessage.tool_calls.find((tc: any) => 
									tc.function.name === toolResult.toolName
								)?.id || `call_${Date.now()}`,
								content: typeof toolResult.result === 'string' 
									? toolResult.result 
									: JSON.stringify(toolResult.result)
							});
							console.log('Tool result message:', toolResult.toolName, toolResult.result);
						}
					}
				} else if (step.text && step.text.trim()) {
					// Add regular assistant message without tool calls
					messages.push({
						role: 'assistant',
						content: step.text
					});
				}
			}
		} else if (result.text && result.text.trim()) {
			// Add final assistant message if no steps
			messages.push({
				role: 'assistant',
				content: result.text
			});
		}

		// Save the message sequence to memory
		// Use a special format to preserve the OpenAI message structure
		const conversationData = {
			format: 'openai_messages',
			messages: messages,
			timestamp: Date.now()
		};

		await memory.saveContext(
			{ input: userInput },
			{ output: JSON.stringify(conversationData) }
		);
		
		console.log('✅ Successfully saved conversation in OpenAI format');
		console.log('Total messages saved:', messages.length);
		console.log('Message types:', messages.map(m => m.role).join(', '));
	} catch (error) {
		console.warn('❌ Failed to save conversation to memory:', error);
	}
}

// Function to define the inputs based on n8n AI ecosystem
function getInputs(): Array<NodeConnectionType | INodeInputConfiguration> {
	interface SpecialInput {
		type: NodeConnectionType;
		filter?: INodeInputFilter;
		required?: boolean;
	}

	const getInputData = (
		inputs: SpecialInput[],
	): Array<NodeConnectionType | INodeInputConfiguration> => {
		const displayNames: { [key: string]: string } = {
			[NodeConnectionTypes.AiLanguageModel]: 'Chat Model',
			[NodeConnectionTypes.AiMemory]: 'Memory',
			[NodeConnectionTypes.AiTool]: 'Tool', 
			[NodeConnectionTypes.AiOutputParser]: 'Output Parser',
		};

		return inputs.map(({ type, filter, required }) => {
			const input: INodeInputConfiguration = {
				type,
				displayName: displayNames[type] || type,
				required: required || type === NodeConnectionTypes.AiLanguageModel,
				maxConnections: [NodeConnectionTypes.AiLanguageModel, NodeConnectionTypes.AiMemory, NodeConnectionTypes.AiOutputParser].includes(
					type as any,
				)
					? 1
					: undefined,
			};

			if (filter) {
				input.filter = filter;
			}

			return input;
		});
	};

	const specialInputs: SpecialInput[] = [
		{
			type: NodeConnectionTypes.AiLanguageModel,
			required: true,
			filter: {
				nodes: [
					'@n8n/n8n-nodes-langchain.lmChatAnthropic',
					'@n8n/n8n-nodes-langchain.lmChatAzureOpenAi',
					'@n8n/n8n-nodes-langchain.lmChatAwsBedrock',
					'@n8n/n8n-nodes-langchain.lmChatMistralCloud',
					'@n8n/n8n-nodes-langchain.lmChatOllama',
					'@n8n/n8n-nodes-langchain.lmChatOpenAi',
					'@n8n/n8n-nodes-langchain.lmChatGroq',
					'@n8n/n8n-nodes-langchain.lmChatGoogleVertex',
					'@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
					'@n8n/n8n-nodes-langchain.lmChatDeepSeek',
					'@n8n/n8n-nodes-langchain.lmChatOpenRouter',
					'@n8n/n8n-nodes-langchain.lmChatXAiGrok',
					'@n8n/n8n-nodes-langchain.code',
				],
			},
		},
		{
			type: NodeConnectionTypes.AiMemory,
		},
		{
			type: NodeConnectionTypes.AiTool,
		},
		{
			type: NodeConnectionTypes.AiOutputParser,
		},
	];

	return ['main', ...getInputData(specialInputs)];
}

/** Helper: convert ai-sdk result to OpenAI-style messages */
function convertResultToChatMessages(result: any): ChatMessage[] {
	const out: ChatMessage[] = [];
	if (result.steps && result.steps.length > 0) {
		for (const step of result.steps) {
			if (step.toolCalls && step.toolCalls.length > 0) {
				const assistantMsg: ChatMessage = {
					role: 'assistant',
					content: step.text || null,
					tool_calls: step.toolCalls.map((tc: any) => ({
						id: tc.toolCallId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
						type: 'function',
						function: {
							name: tc.toolName,
							arguments: JSON.stringify(tc.args ?? {})
						}
					}))
				};
				out.push(assistantMsg);

				if (step.toolResults && step.toolResults.length > 0) {
					for (const toolResult of step.toolResults) {
						const callId = assistantMsg.tool_calls?.find(tc => tc.function.name === toolResult.toolName)?.id || assistantMsg.tool_calls?.[0]?.id || '';
						out.push({
							role: 'tool',
							content: typeof toolResult.result === 'string' ? toolResult.result : JSON.stringify(toolResult.result),
							tool_call_id: callId
						} as ChatMessage);
					}
				}
			} else if (step.text && step.text.trim()) {
				out.push({ role: 'assistant', content: step.text } as ChatMessage);
			}
		}
	} else if (result.text) {
		out.push({ role: 'assistant', content: result.text } as ChatMessage);
	}
	return out;
}

export class BetterAiAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Better AI Agent',
		name: 'betterAiAgent',
		icon: 'fa:robot',
		iconColor: 'black',
		group: ['transform'],
		version: 13,
		description: 'Advanced AI Agent with improved memory management and modern AI SDK (OpenAI Message Format)',
		defaults: {
			name: 'Better AI Agent',
			color: '#1f77b4',
		},
		inputs: getInputs(),
		outputs: ['main'],
		properties: [
			{
				displayName: 'Tip: This node uses modern AI SDK with proper tool call memory management',
				name: 'notice_tip',
				type: 'notice',
				default: '',
			},
			{
				...promptTypeOptions,
			},
			{
				...textFromPreviousNode,
				displayOptions: {
					show: { promptType: ['auto'] },
				},
			},
			{
				...textInput,
				displayOptions: {
					show: { promptType: ['define'] },
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'System Message',
						name: 'systemMessage',
						type: 'string',
						default: 'You are a helpful AI assistant. Use the available tools when necessary to help the user accomplish their goals.',
						description: 'The system message that defines the agent behavior',
						typeOptions: {
							rows: 4,
						},
					},
					{
						displayName: 'Max Steps',
						name: 'maxSteps',
						type: 'number',
						default: 5,
						description: 'Maximum number of tool call steps before stopping',
						typeOptions: {
							min: 1,
							max: 20,
						},
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get connected components
		const connectedModel = await getConnectedModel(this);
		const connectedMemory = await getConnectedMemory(this);
		const connectedTools = await getConnectedTools(this);
		const connectedOutputParser = await getConnectedOutputParser(this);

		if (!connectedModel) {
			throw new NodeOperationError(this.getNode(), 'No language model connected');
		}

		// Convert n8n model to AI SDK model
		const aiModel = convertN8nModelToAiSdk(connectedModel);
		
		// Convert n8n tools to AI SDK tools
		const aiTools = convertN8nToolsToAiSdk(connectedTools);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Get input text
				const input = getPromptInputByType({
					ctx: this,
					i: itemIndex,
					inputKey: 'text',
					promptTypeKey: 'promptType',
				});

				if (!input) {
					throw new NodeOperationError(this.getNode(), 'No input text provided');
				}

				// Get options
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					systemMessage?: string;
					maxSteps?: number;
				};

				// Initialize memory adapter
				let memoryAdapter: ChatArrayMemory | null = null;
				if (connectedMemory) {
					memoryAdapter = new ChatArrayMemory(connectedMemory);
				}

				// Load previous messages (if any)
				let messages: ChatMessage[] = [];
				if (memoryAdapter) {
					try {
						messages = await memoryAdapter.load();
						console.log(`✅ Loaded ${messages.length} messages from conversation history.`);
					} catch (err) {
						console.warn('❌ Failed to load conversation history – starting fresh.', err);
					}
				}

				// Add system message if provided and not already present at top
				if (options.systemMessage) {
					if (!messages.length || messages[0].role !== 'system') {
						messages.unshift({ role: 'system', content: options.systemMessage });
					}
				}

				// Append current user input
				messages.push({ role: 'user', content: input });

				// Generate response with AI SDK - using the pattern from the example
				// Note: temperature, maxTokens, etc. come from the connected model, not node parameters
				const result = await generateText({
					model: aiModel, // Model settings (temperature, maxTokens) come from the connected model
					tools: aiTools,
					maxSteps: options.maxSteps || 5,
					messages: messages as any, // cast to satisfy type compatibility
				});

				// Convert result steps to ChatMessage objects & persist
				if (memoryAdapter) {
					try {
						const newMessages: ChatMessage[] = convertResultToChatMessages(result);
						messages.push(...newMessages);
						await memoryAdapter.save(messages);
						console.log(`💾 Saved ${messages.length} messages (including new turn).`);
					} catch (err) {
						console.warn('❌ Failed to save conversation to memory:', err);
					}
				}

				// Prepare output
				returnData.push({
					json: {
						output: result.text,
						steps: result.steps || [],
						// Include debug information
						totalSteps: result.steps?.length || 0,
					},
				});

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
