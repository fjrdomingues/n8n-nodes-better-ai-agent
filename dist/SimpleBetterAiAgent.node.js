"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleBetterAiAgent = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const ai_1 = require("ai");
const openai_1 = require("@ai-sdk/openai");
const zod_1 = require("zod");
class SimpleBetterAiAgent {
    description = {
        displayName: 'Simple Better AI Agent',
        name: 'simpleBetterAiAgent',
        icon: 'fa:robot',
        iconColor: 'black',
        group: ['transform'],
        version: 1,
        description: 'A simplified Better AI Agent with Vercel AI SDK',
        defaults: {
            name: 'Simple Better AI Agent',
            color: '#1f77b4',
        },
        inputs: ['main'],
        outputs: ['main'],
        properties: [
            {
                displayName: 'OpenAI API Key',
                name: 'apiKey',
                type: 'string',
                typeOptions: { password: true },
                default: '',
                description: 'Your OpenAI API key',
                required: true,
            },
            {
                displayName: 'Prompt',
                name: 'prompt',
                type: 'string',
                default: '',
                placeholder: 'What would you like me to help you with?',
                description: 'The prompt to send to the AI',
                required: true,
                typeOptions: {
                    rows: 2,
                },
            },
            {
                displayName: 'System Message',
                name: 'systemMessage',
                type: 'string',
                default: 'You are a helpful AI assistant.',
                description: 'System message to define AI behavior',
                typeOptions: {
                    rows: 2,
                },
            },
            {
                displayName: 'Model',
                name: 'model',
                type: 'options',
                options: [
                    {
                        name: 'GPT-4o',
                        value: 'gpt-4o',
                    },
                    {
                        name: 'GPT-4o Mini',
                        value: 'gpt-4o-mini',
                    },
                    {
                        name: 'GPT-4 Turbo',
                        value: 'gpt-4-turbo',
                    },
                ],
                default: 'gpt-4o-mini',
                description: 'The model to use',
            },
            {
                displayName: 'Max Steps',
                name: 'maxSteps',
                type: 'number',
                default: 5,
                description: 'Maximum number of tool call steps',
                typeOptions: {
                    min: 1,
                    max: 10,
                },
            },
            {
                displayName: 'Temperature',
                name: 'temperature',
                type: 'number',
                default: 0.7,
                description: 'Controls randomness (0.0 = deterministic, 1.0 = creative)',
                typeOptions: {
                    min: 0,
                    max: 2,
                    step: 0.1,
                },
            },
        ],
    };
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // Get parameters
                const apiKey = this.getNodeParameter('apiKey', itemIndex);
                const prompt = this.getNodeParameter('prompt', itemIndex);
                const systemMessage = this.getNodeParameter('systemMessage', itemIndex);
                const modelName = this.getNodeParameter('model', itemIndex);
                const maxSteps = this.getNodeParameter('maxSteps', itemIndex);
                const temperature = this.getNodeParameter('temperature', itemIndex);
                if (!apiKey) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'OpenAI API key is required');
                }
                if (!prompt) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Prompt is required');
                }
                // Create OpenAI model instance
                const model = (0, openai_1.openai)(modelName, {
                    apiKey: apiKey,
                });
                // Define some example tools
                const tools = {
                    calculateMath: (0, ai_1.tool)({
                        description: 'Calculate a mathematical expression',
                        parameters: zod_1.z.object({
                            expression: zod_1.z.string().describe('The mathematical expression to calculate'),
                        }),
                        execute: async ({ expression }) => {
                            try {
                                // Simple math evaluation (be careful in production!)
                                const result = Function(`"use strict"; return (${expression})`)();
                                return { result: result.toString() };
                            }
                            catch (error) {
                                return { error: 'Invalid mathematical expression' };
                            }
                        },
                    }),
                    getCurrentTime: (0, ai_1.tool)({
                        description: 'Get the current date and time',
                        parameters: zod_1.z.object({}),
                        execute: async () => {
                            return {
                                currentTime: new Date().toISOString(),
                                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                            };
                        },
                    }),
                };
                // Combine system message and user prompt
                const fullPrompt = systemMessage ? `${systemMessage}\n\nUser: ${prompt}` : prompt;
                // Generate text with tools
                const { text, steps } = await (0, ai_1.generateText)({
                    model,
                    tools,
                    maxSteps,
                    temperature,
                    prompt: fullPrompt,
                });
                // Prepare output
                returnData.push({
                    json: {
                        response: text,
                        steps: steps || [],
                        totalSteps: steps?.length || 0,
                        model: modelName,
                        timestamp: new Date().toISOString(),
                    },
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
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
exports.SimpleBetterAiAgent = SimpleBetterAiAgent;
