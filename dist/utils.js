"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.textFromPreviousNode = exports.textInput = exports.promptTypeOptions = void 0;
exports.getPromptInputByType = getPromptInputByType;
exports.getConnectedTools = getConnectedTools;
exports.getConnectedMemory = getConnectedMemory;
exports.getConnectedModel = getConnectedModel;
exports.getConnectedOutputParser = getConnectedOutputParser;
const n8n_workflow_1 = require("n8n-workflow");
/**
 * Get text input from the node parameter based on prompt type
 */
function getPromptInputByType({ ctx, i, inputKey, promptTypeKey, }) {
    const promptType = ctx.getNodeParameter(promptTypeKey, i, 'auto');
    if (promptType === 'auto') {
        // Try to get from chatInput field (from chat trigger)
        const input = ctx.evaluateExpression('{{ $json["chatInput"] }}', i);
        if (input !== undefined) {
            return input;
        }
        // Fallback to the parameter
        return ctx.getNodeParameter(inputKey, i, '');
    }
    // Use the defined input
    return ctx.getNodeParameter(inputKey, i, '');
}
/**
 * Get connected tools from the workflow
 */
async function getConnectedTools(ctx) {
    const tools = [];
    // Get all connected tool inputs - using the exact pattern from langchain nodes
    const toolConnections = await ctx.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 0);
    if (Array.isArray(toolConnections)) {
        tools.push(...toolConnections);
    }
    else if (toolConnections) {
        tools.push(toolConnections);
    }
    return tools;
}
/**
 * Get connected memory instance
 */
async function getConnectedMemory(ctx) {
    return await ctx.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiMemory, 0);
}
/**
 * Get connected language model
 */
async function getConnectedModel(ctx) {
    return await ctx.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiLanguageModel, 0);
}
/**
 * Get connected output parser
 */
async function getConnectedOutputParser(ctx) {
    return await ctx.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiOutputParser, 0);
}
/**
 * Common descriptions for node properties
 */
exports.promptTypeOptions = {
    displayName: 'Source for Prompt (User Message)',
    name: 'promptType',
    type: 'options',
    options: [
        {
            name: 'Connected Chat Trigger Node',
            value: 'auto',
            description: "Looks for an input field called 'chatInput' that is coming from a directly connected Chat Trigger",
        },
        {
            name: 'Define below',
            value: 'define',
            description: 'Use an expression to reference data in previous nodes or enter static text',
        },
    ],
    default: 'auto',
};
exports.textInput = {
    displayName: 'Prompt (User Message)',
    name: 'text',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'e.g. Hello, how can you help me?',
    typeOptions: {
        rows: 2,
    },
};
exports.textFromPreviousNode = {
    displayName: 'Prompt (User Message)',
    name: 'text',
    type: 'string',
    required: true,
    default: '={{ $json.chatInput }}',
    typeOptions: {
        rows: 2,
    },
    displayOptions: {
        show: { promptType: ['auto'] },
    },
};
