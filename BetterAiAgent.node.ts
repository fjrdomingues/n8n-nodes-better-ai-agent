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

import { generateText, tool, jsonSchema } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

import {
	getPromptInputByType,
	getConnectedTools,
	getConnectedMemory,
	getConnectedModel,
	promptTypeOptions,
	textInput,
	textFromPreviousNode,
} from './utils';
import { ChatArrayMemory } from './utils/chatArrayMemory';
import type { CoreMessage } from 'ai';

// Message validation helper
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

function validateMessagesArray(messages: any[]): CoreMessage[] {
	if (!Array.isArray(messages)) {
		throw new Error('Messages must be an array');
	}
	
	const validMessages: CoreMessage[] = [];
	for (let i = 0; i < messages.length; i++) {
		if (validateCoreMessage(messages[i])) {
			validMessages.push(messages[i]);
		} else {
			console.warn(`⚠️ Skipping invalid message at index ${i}:`, messages[i]);
		}
	}
	
	return validMessages;
}
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
	let modelName = n8nModel.modelName || n8nModel.model || 'gpt-4o-mini';
	
	// Enhanced model name extraction for various providers
	if (!modelName || modelName === 'gpt-4o-mini') {
		// Try additional properties that might contain the model name
		modelName = n8nModel._model ||
					(n8nModel.kwargs && n8nModel.kwargs.model) ||
					(n8nModel.lc_kwargs && n8nModel.lc_kwargs.model) ||
					(n8nModel.options && n8nModel.options.model) ||
					(n8nModel.configuration && n8nModel.configuration.model) ||
					'gpt-4o-mini';
	}
	
	// Check if it's an OpenAI-compatible model (OpenAI, Azure OpenAI, OpenRouter, etc.)
	if (n8nModel.constructor?.name?.includes('ChatOpenAI') || 
		n8nModel.constructor?.name?.includes('OpenAI') ||
		n8nModel.constructor?.name?.includes('OpenRouter')) {
		
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
		let apiKey = n8nModel.openAIApiKey || n8nModel.apiKey;
		
		// Try to get API key from clientConfig if not found directly
		if (!apiKey && n8nModel.clientConfig) {
			apiKey = n8nModel.clientConfig.apiKey || n8nModel.clientConfig.openAIApiKey;
		}
		
		// Try additional locations for API key
		if (!apiKey) {
			apiKey = (n8nModel.kwargs && n8nModel.kwargs.apiKey) ||
					 (n8nModel.lc_kwargs && n8nModel.lc_kwargs.apiKey) ||
					 (n8nModel.configuration && n8nModel.configuration.apiKey);
		}
		
		console.log('API Key found:', apiKey ? 'YES (length: ' + apiKey.length + ', prefix: ' + apiKey.substring(0, 8) + ')' : 'NO');
		
		// Extract base URL from various possible locations
		let baseURL = n8nModel.configuration?.baseURL || 
					  n8nModel.baseURL ||
					  (n8nModel.clientConfig && n8nModel.clientConfig.baseURL) ||
					  (n8nModel.kwargs && n8nModel.kwargs.baseURL) ||
					  (n8nModel.lc_kwargs && n8nModel.lc_kwargs.baseURL);
		
		if (baseURL) {
			providerSettings.baseURL = baseURL;
		}
		
		// Special handling for OpenRouter
		const isOpenRouter = n8nModel.constructor?.name?.includes('OpenRouter') || 
							 baseURL?.includes('openrouter.ai') ||
							 apiKey?.startsWith('sk-or-');
		
		if (isOpenRouter) {
			// OpenRouter uses https://openrouter.ai/api/v1 as base URL
			if (!baseURL || !baseURL.includes('openrouter.ai')) {
				providerSettings.baseURL = 'https://openrouter.ai/api/v1';
				baseURL = providerSettings.baseURL;
			}
			console.log(`🔗 Using OpenRouter provider with model: ${modelName}`);
			console.log(`🔗 OpenRouter base URL: ${baseURL}`);
			console.log(`🔗 OpenRouter API key prefix: ${apiKey ? apiKey.substring(0, 8) + '...' : 'NOT FOUND'}`);
		}
		
		// Use createOpenAI with explicit API key instead of openai()
		if (apiKey) {
			console.log('Using createOpenAI with explicit API key');
			const openaiProvider = createOpenAI({
				apiKey: apiKey,
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
		
		// Enhanced model name extraction with multiple fallbacks
		const modelName = n8nModel.modelName || 
						  n8nModel.model || 
						  n8nModel._model ||
						  (n8nModel.kwargs && n8nModel.kwargs.model) ||
						  (n8nModel.lc_kwargs && n8nModel.lc_kwargs.model) ||
						  (n8nModel.options && n8nModel.options.model) ||
						  (n8nModel.clientOptions && n8nModel.clientOptions.model) ||
						  (n8nModel.configuration && n8nModel.configuration.model) ||
						  'gemini-2.5-flash'; // Updated default to current model
		
		console.log('Using Gemini model:', modelName);
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
	throw new Error(`Unsupported or unknown model type: ${n8nModel.constructor?.name}. Please connect a supported language model node or update convertN8nModelToAiSdk to handle this model.`);
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
	
	console.log('BetterAiAgent v1.6.13: Converting n8n tools to AI SDK format');
	
	const flatTools = Array.from(flattenTools(n8nTools));
	console.log(`Processing ${flatTools.length} tools`);
	
	for (const n8nTool of flatTools) {
		
		if (n8nTool && n8nTool.name) {
			// Create a more robust schema - handle ZodEffects and sanitize for AI SDK
			const isZod = (s: any) => !!s && typeof s === 'object' && (
				(typeof s.parse === 'function' && s._def && typeof s._def === 'object') ||
				(s['~standard'] && s['~standard'].vendor === 'zod')
			);
			const unwrapZodEffects = (s: any) => (s && s._def && s._def.schema) ? s._def.schema : s;
			
			let toolSchema: any;
			try {
				if (n8nTool.schema) {
					let base = unwrapZodEffects(n8nTool.schema);
					
					if (isZod(base)) {
						// Check if this is a problematic MCP tool with catchall
						const hasCatchall = base._def?.catchall;
						if (hasCatchall) {
							console.log(`Tool ${n8nTool.name}: Reconstructing schema without catchall`);
							// Extract the shape from the original schema and create a new one without catchall
							try {
								const shape = base._def.shape();
								toolSchema = z.object(shape).strict();
							} catch (shapeError) {
								console.warn(`Tool ${n8nTool.name}: Could not extract shape, using original`);
								toolSchema = base;
							}
						} else {
							// For Zod schemas without catchall, let the AI SDK handle them directly
							toolSchema = base;
						}
					} else if (typeof base === 'object' && base.type) {
						// This looks like a JSON schema already
						// Use jsonSchema helper from AI SDK to ensure compatibility
						try {
							toolSchema = jsonSchema(base);
						} catch (jsonErr) {
							console.warn(`Tool ${n8nTool.name}: jsonSchema conversion failed, using fallback`);
							toolSchema = z.record(z.unknown());
						}
					} else {
						// Unknown schema type - use a permissive schema
						toolSchema = z.record(z.unknown());
					}
				} else {
					// Default schema if none provided - use permissive schema
					toolSchema = z.record(z.unknown());
				}
			} catch (error) {
				console.warn(`Tool ${n8nTool.name}: Schema error, using fallback:`, error);
				toolSchema = z.record(z.unknown());
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

// Helper function to define the inputs based on n8n AI ecosystem
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
						const loadedMessages = await memoryAdapter.load();
						// Additional validation layer after loading from memory
						messages = validateMessagesArray(loadedMessages);
						console.log(`✅ Loaded ${messages.length} valid messages from conversation history.`);
					} catch (err) {
						console.warn('❌ Failed to load conversation history – starting fresh.', err);
						// Start fresh with empty conversation if memory is corrupted
						messages = [];
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
					// Provide the system prompt directly to the AI SDK when present
					...(options.systemMessage ? { system: options.systemMessage } : {}),
					onStepFinish: ({ text, toolCalls }: any) => {
						postIntermediate({
							version: 1,
							runId,
							step: stepCount,
							text,
							toolCalls,
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
				
				// Validate messages before sending to AI model
				const validatedMessages = validateMessagesArray(messages);
				genArgs.messages = validatedMessages;

				// Generate response - let n8n handle any errors and retries
				let result: any;
				try {
					result = await generateText(genArgs);
				} catch (err: any) {
					// Post error to webhook if configured
					postIntermediate({
						version: 1,
						runId,
						step: stepCount,
						error: (err as Error).message,
						done: true,
						failed: true,
					});
					
					// Throw error for n8n to handle (including retries, error workflows, etc.)
					throw new NodeOperationError(this.getNode(), `AI model generation failed: ${(err as Error).message}`, {
						itemIndex: 0,
						runIndex: 0,
					});
				}

				// Convert result steps to ChatMessage objects & persist
				if (memoryAdapter) {
					try {
						// Reconstruct the full exchange to be saved
						const messagesToSave: CoreMessage[] = [{ role: 'user', content: input }];
						
						// Aggregate toolCalls and toolResults (SDK may expose them only inside steps)
						const aggregatedToolCalls = (
							(result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : []) as any[]
						).concat(
							(result.steps || [])
								.flatMap((s: any) => (s.toolCalls ? s.toolCalls : []))
						);

						const aggregatedToolResults = (
							(result.toolResults && result.toolResults.length > 0 ? result.toolResults : []) as any[]
						).concat(
							(result.steps || [])
								.flatMap((s: any) => (s.toolResults ? s.toolResults : []))
						);

						// If there were tool calls, save them as separate assistant message
						if (aggregatedToolCalls.length > 0) {
							messagesToSave.push({
								role: 'assistant',
								content: aggregatedToolCalls.map((toolCall) => ({
									type: 'tool-call',
									toolCallId: toolCall.toolCallId || toolCall.id || toolCall.callId,
									toolName: toolCall.toolName || toolCall.name,
									args: toolCall.args || toolCall.arguments || toolCall.params,
								})),
							});
						}

						// If there were tool results, save them
						if (aggregatedToolResults.length > 0) {
							messagesToSave.push({
								role: 'tool',
								content: aggregatedToolResults.map((toolResult: any) => {
									// Build tool-result part
									const normalize = (): any => {
										const raw = toolResult.result ?? toolResult.data ?? toolResult.output ?? '';
										if (typeof raw === 'string') {
											const trimmed = raw.trim();
											if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
												try {
													return JSON.parse(trimmed);
												} catch {}
											}
										}
										return raw;
									};

									return {
										type: 'tool-result',
										toolCallId: toolResult.toolCallId || toolResult.id || toolResult.callId,
										toolName: toolResult.toolName || toolResult.name,
										result: normalize(),
									};
								}),
							});
						}

						// If there's a final text response, save it as separate assistant message
						if (result.text) {
							messagesToSave.push({ role: 'assistant', content: result.text });
						}

						await memoryAdapter.save(messagesToSave);
						console.log(`💾 Saved ${messagesToSave.length} messages (including new turn).`);
					} catch (err) {
						console.warn('❌ Failed to save conversation to memory:', err);
						// Note: We don't throw here as the AI generation was successful
						// Memory save failures are not critical to the node execution
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
				// Ensure we have a proper NodeOperationError for better n8n error handling
				let finalError = error;
				if (!(error instanceof NodeOperationError)) {
					finalError = new NodeOperationError(this.getNode(), `Unexpected error in Better AI Agent: ${(error as Error).message}`, {
						itemIndex,
						runIndex: 0,
					});
				}

				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (finalError as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw finalError;
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
