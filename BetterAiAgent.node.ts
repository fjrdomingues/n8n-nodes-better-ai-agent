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
import { createGoogleGenerativeAI } from '@ai-sdk/google';
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
import { ChatArrayMemory } from './utils/chatArrayMemory';
import type { CoreMessage, ToolCallPart, ToolResultPart, TextPart } from 'ai';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { LangfuseExporter } from 'langfuse-vercel';
// @ts-ignore
import { AISDKExporter } from 'langsmith/vercel';

// Patch console.log once to respect global verbose flag
if (!(globalThis as any).__BAA_LOG_PATCHED) {
	const originalLog = console.log.bind(console);
	console.log = (...args: unknown[]): void => {
		if ((globalThis as any).__BAA_VERBOSE) {
			originalLog(...args);
		}
	};
	(globalThis as any).__BAA_LOG_PATCHED = true;
}

// --- OpenTelemetry tracing (Langfuse) ---
if (!(globalThis as any).__BAA_OTEL_INITIALIZED) {
	try {
		// Determine preferred trace exporter
		let traceExporter: any;
		let providerName = 'langfuse';
		if (process.env.LANGSMITH_TRACING === 'true' || process.env.LANGSMITH_API_KEY) {
			traceExporter = new AISDKExporter();
			providerName = 'langsmith';
		} else {
			traceExporter = new LangfuseExporter();
			providerName = 'langfuse';
		}

		const sdk = new NodeSDK({
			traceExporter,
			instrumentations: [getNodeAutoInstrumentations()],
		});
		sdk.start();
		(globalThis as any).__BAA_OTEL_INITIALIZED = sdk;
		(globalThis as any).__BAA_TRACE_PROVIDER = providerName;
		console.log(`✅ OpenTelemetry SDK initialized with ${providerName} exporter`);
	} catch (err) {
		console.warn('❌ Failed to initialize OpenTelemetry SDK:', err);
	}
}

// Generic helper: pull a numeric or string setting from multiple possible paths on the LangChain model
function readModelSetting(model: any, key: string): any {
	if (!model) return undefined;
	if (model.options && model.options[key] !== undefined) return model.options[key];
	if (model[key] !== undefined) return model[key];
	if (model.clientConfig && model.clientConfig[key] !== undefined) return model.clientConfig[key];
	if (model.kwargs && model.kwargs[key] !== undefined) return model.kwargs[key];
	return undefined;
}

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
		
		// Settings that should be sent with the model invocation (generation parameters)
		const modelSettings: any = {};
		// Settings that belong to the provider (transport-level)
		const providerSettings: any = {};
		const temp = readModelSetting(n8nModel, 'temperature');
		const topP = readModelSetting(n8nModel, 'topP');
		const maxTokens = readModelSetting(n8nModel, 'maxTokens');
		const freqPen = readModelSetting(n8nModel, 'frequencyPenalty');
		const presPen = readModelSetting(n8nModel, 'presencePenalty');
		const reasoningEffort = readModelSetting(n8nModel, 'reasoningEffort');
		if (temp !== undefined && temp !== 0) {
			// User explicitly set a non-zero temperature – use it as is
			modelSettings.temperature = temp;
		} else if ((temp === undefined || temp === 0) && (/^o\d/.test(modelName) || /^gpt-4o/.test(modelName))) {
			// OpenAI "o" family (o1, o3, o4…) *and* gpt-4o models mandate temperature=1
			console.log('Auto-setting temperature=1 for o-family / gpt-4o model');
			modelSettings.temperature = 1;
		}
		if (maxTokens !== undefined) modelSettings.maxTokens = maxTokens;
		if (topP !== undefined) modelSettings.topP = topP;
		if (freqPen !== undefined) modelSettings.frequencyPenalty = freqPen;
		if (presPen !== undefined) modelSettings.presencePenalty = presPen;
		if (reasoningEffort !== undefined) modelSettings.reasoningEffort = reasoningEffort;
		
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
			providerSettings.baseURL = n8nModel.configuration.baseURL;
		}
		
		// Use createOpenAI with explicit API key instead of openai()
		if (finalApiKey) {
			console.log('Using createOpenAI with explicit API key');
			const openaiProvider = createOpenAI({
				apiKey: finalApiKey,
				...providerSettings,
			});
			return openaiProvider(modelName, modelSettings);
		} else {
			console.log('No API key found, using default openai provider');
			return openai(modelName, { ...providerSettings, ...modelSettings });
		}
	}
	
	// Check if it's a Google Generative AI model (Gemini) – case-insensitive to handle variations like ChatGoogleGenerativeAi
	const ctorName = n8nModel.constructor?.name?.toLowerCase() || '';
	if (ctorName.includes('googlegenerativeai') || ctorName.includes('gemini')) {

		const settings: any = {};
		const gemTemp = readModelSetting(n8nModel, 'temperature');
		const gemTopP = readModelSetting(n8nModel, 'topP');
		if (gemTemp !== undefined && gemTemp !== 0) settings.temperature = gemTemp;
		if (gemTopP !== undefined) settings.topP = gemTopP;

		const apiKey = n8nModel.apiKey || process.env.GOOGLE_AI_API_KEY;
		if (!apiKey) {
			throw new Error('Google Generative AI API key missing');
		}

		console.log('Using createGoogleGenerativeAI with explicit API key');
		const geminiProvider = createGoogleGenerativeAI({ apiKey, ...settings });
		const modelName = n8nModel.modelName || 'gemini-pro';
		return geminiProvider(modelName);
	}
	
	// Check if it's an Anthropic model
	if (n8nModel.constructor?.name?.includes('ChatAnthropic') || 
		n8nModel.constructor?.name?.includes('Anthropic')) {
		
		const settings: any = {};
		const aTemp = readModelSetting(n8nModel, 'temperature');
		const aTopP = readModelSetting(n8nModel, 'topP');
		const aMax = readModelSetting(n8nModel, 'maxTokens');
		const aReason = readModelSetting(n8nModel, 'reasoningEffort');
		if (aTemp !== undefined && aTemp !== 0) settings.temperature = aTemp;
		if (aMax !== undefined) settings.maxTokens = aMax;
		if (aTopP !== undefined) settings.topP = aTopP;
		if (aReason !== undefined) settings.reasoningEffort = aReason;
		
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

// Recursively flatten arrays or containers that expose a .tools array (e.g., McpToolkit)
function* flattenTools(toolOrArray: any): Iterable<any> {
	if (!toolOrArray) return;
	if (Array.isArray(toolOrArray)) {
		for (const t of toolOrArray) yield* flattenTools(t);
	} else if (toolOrArray.tools && Array.isArray(toolOrArray.tools)) {
		// MCP toolkit or similar wrapper
		yield* flattenTools(toolOrArray.tools);
	} else {
		yield toolOrArray;
	}
}

// Helper function to convert n8n tools to AI SDK tools
function convertN8nToolsToAiSdk(n8nTools: any[]): Record<string, any> {
	const tools: Record<string, any> = {};
	
	const flatTools = Array.from(flattenTools(n8nTools));
	console.log('Converting n8n tools to AI SDK format:');
	console.log('Number of tools after flatten:', flatTools.length);
	
	for (const n8nTool of flatTools) {
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
function convertResultToCoreMessages(result: any): CoreMessage[] {
	const out: CoreMessage[] = [];

	if (Array.isArray(result.steps) && result.steps.length > 0) {
		for (const step of result.steps) {
			const { text, toolCalls = [], toolResults = [] } = step;

			// ----- assistant message -----
			if (text || toolCalls.length > 0) {
				const parts: Array<TextPart | ToolCallPart> = [];
				if (text && text.trim()) {
					parts.push({ type: 'text', text });
				}
				for (const tc of toolCalls) {
					parts.push({
						type: 'tool-call',
						toolCallId: tc.toolCallId || tc.id || `call_${Date.now()}`,
						toolName: tc.toolName,
						args: tc.args ?? {},
					});
				}

				const assistantMsg: CoreMessage = {
					role: 'assistant',
					content: parts.length === 1 && parts[0].type === 'text' ? text : parts,
				} as CoreMessage;
				out.push(assistantMsg);
			}

			// ----- tool result message -----
			if (toolResults.length > 0) {
				const resultParts: ToolResultPart[] = toolResults.map((tr: any) => ({
					type: 'tool-result',
					toolCallId: tr.toolCallId || tr.id || tr.tool_call_id || 'unknown',
					toolName: tr.toolName,
					result: tr.result,
				}));

				out.push({
					role: 'tool',
					content: resultParts,
				} as CoreMessage);
			}
		}
	} else if (result.text) {
		out.push({ role: 'assistant', content: result.text } as CoreMessage);
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
		version: 16,
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
					{
						displayName: 'Intermediate Webhook URL',
						name: 'intermediateWebhookUrl',
						type: 'string',
						default: '',
						description: 'If set, the node POSTs every partial reply/tool-call as JSON to this URL while the agent is running',
					},
					{
						displayName: 'Verbose Logs',
						name: 'verboseLogs',
						type: 'boolean',
						default: false,
						description: 'Enable detailed console logging for debugging',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Determine verbose flag once (from first item options) so logs are suppressed before conversion
		const initialOpts = this.getNodeParameter('options', 0, {}) as { verboseLogs?: boolean };
		(globalThis as any).__BAA_VERBOSE = !!initialOpts.verboseLogs;

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
					intermediateWebhookUrl?: string;
					verboseLogs?: boolean;
				};

				// Helper to POST intermediate updates without blocking execution
				const runId = (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
				const postIntermediate = (payload: Record<string, unknown>): void => {
					if (!options.intermediateWebhookUrl) return;
					try {
						const fetchFn = (globalThis as any).fetch as (typeof fetch | undefined);
						if (fetchFn) {
							void fetchFn(options.intermediateWebhookUrl as string, {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify(payload),
							});
						}
					} catch (err) {
						console.warn('❌ Failed to post intermediate webhook:', err);
					}
				};

				// Initialize memory adapter
				let memoryAdapter: ChatArrayMemory | null = null;
				if (connectedMemory) {
					let messageLimit: number | null = null;
					try {
						// BufferWindowMemory instances expose the window size via `k`.
						if (typeof (connectedMemory as any).k === 'number') {
							messageLimit = (connectedMemory as any).k;
						}
					} catch {}

					memoryAdapter = new ChatArrayMemory(connectedMemory, messageLimit);
				}

				// Load previous messages (if any)
				let messages: CoreMessage[] = [];
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

				// If a message limit is defined on the memory adapter, ensure we do not exceed it
				if (memoryAdapter && (memoryAdapter as any).maxMessages) {
					const mm = (memoryAdapter as any).maxMessages as number;
					if (mm > 0 && messages.length > mm) {
						messages = messages.slice(-mm);
					}
				}

				// Generate response with AI SDK - using the pattern from the example
				// Note: temperature, maxTokens, etc. come from the connected model, not node parameters
				let stepCount = 0;
				const genArgs: any = {
					model: aiModel,
					maxSteps: options.maxSteps || 5,
					messages: messages as Array<CoreMessage>,
					onStepFinish: ({ text, toolCalls, toolResults }: any) => {
						postIntermediate({
							version: 1,
							runId,
							step: stepCount,
							text,
							toolCalls,
							toolResults,
							done: false,
						});
						stepCount += 1;
					},
				};

				// Extract generation settings from the model and pass them explicitly to generateText
				// This prevents AI SDK from using its own defaults (like temperature: 0)
				if (aiModel.settings) {
					if (aiModel.settings.temperature !== undefined) {
						genArgs.temperature = aiModel.settings.temperature;
					}
					if (aiModel.settings.topP !== undefined) {
						genArgs.topP = aiModel.settings.topP;
					}
					if (aiModel.settings.frequencyPenalty !== undefined) {
						genArgs.frequencyPenalty = aiModel.settings.frequencyPenalty;
					}
					if (aiModel.settings.presencePenalty !== undefined) {
						genArgs.presencePenalty = aiModel.settings.presencePenalty;
					}
					if (aiModel.settings.maxTokens !== undefined) {
						genArgs.maxTokens = aiModel.settings.maxTokens;
					}
					if (aiModel.settings.reasoningEffort !== undefined) {
						genArgs.reasoningEffort = aiModel.settings.reasoningEffort;
					}
				}

				if (Object.keys(aiTools).length > 0) {
					genArgs.tools = aiTools;
				}
				
				// Enable OpenTelemetry tracing for this generation (Langfuse / LangSmith)
				let telemetrySettings: any;
				if ((globalThis as any).__BAA_TRACE_PROVIDER === 'langsmith') {
					telemetrySettings = AISDKExporter.getSettings({
						runId,
						metadata: { n8nNodeName: this.getNode().name ?? 'BetterAiAgent' },
					});
				} else {
					telemetrySettings = {
						isEnabled: true,
						functionId: runId,
						metadata: { n8nNodeName: this.getNode().name ?? 'BetterAiAgent' },
					};
				}

				genArgs.experimental_telemetry = telemetrySettings;
				
				const result = await generateText(genArgs);

				// Convert result steps to ChatMessage objects & persist
				if (memoryAdapter) {
					try {
						const newMessages: CoreMessage[] = convertResultToCoreMessages(result);
						const deltaMessages: CoreMessage[] = [
							{ role: 'user', content: input },
							...newMessages,
						];
						await memoryAdapter.save(deltaMessages);
						console.log(`💾 Saved ${deltaMessages.length} messages (including new turn).`);
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

		// After processing all items, flush OpenTelemetry spans so that traces are exported promptly (important for short-lived executions such as n8n worker tasks)
		try {
			const otelSdk: any = (globalThis as any).__BAA_OTEL_INITIALIZED;
			if (otelSdk && typeof otelSdk.forceFlush === 'function') {
				await otelSdk.forceFlush();
				console.log('💾 OpenTelemetry spans flushed');
			}
		} catch (err) {
			console.warn('❌ Failed to flush OpenTelemetry spans:', err);
		}

		return [returnData];
	}
}
