import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/**
 * Get text input from the node parameter based on prompt type
 */
export function getPromptInputByType({
	ctx,
	i,
	inputKey,
	promptTypeKey,
}: {
	ctx: IExecuteFunctions;
	i: number;
	inputKey: string;
	promptTypeKey: string;
}): string {
	const promptType = ctx.getNodeParameter(promptTypeKey, i, 'auto') as string;

	if (promptType === 'auto') {
		// Try to get from chatInput field (from chat trigger)
		const input = ctx.evaluateExpression('{{ $json["chatInput"] }}', i) as string;
		if (input !== undefined) {
			return input;
		}
		// Fallback to the parameter
		return ctx.getNodeParameter(inputKey, i, '') as string;
	}

	// Use the defined input
	return ctx.getNodeParameter(inputKey, i, '') as string;
}

/**
 * Get connected tools from the workflow
 */
export async function getConnectedTools(ctx: IExecuteFunctions): Promise<any[]> {
	const tools: any[] = [];
	
	// Get all connected tool inputs - using the exact pattern from langchain nodes
	const toolConnections = await ctx.getInputConnectionData(NodeConnectionTypes.AiTool, 0);
	
	if (Array.isArray(toolConnections)) {
		tools.push(...toolConnections);
	} else if (toolConnections) {
		tools.push(toolConnections);
	}
	
	return tools;
}

/**
 * Get connected memory instance
 */
export async function getConnectedMemory(ctx: IExecuteFunctions): Promise<any> {
	return await ctx.getInputConnectionData(NodeConnectionTypes.AiMemory, 0);
}

/**
 * Get connected language model
 */
export async function getConnectedModel(ctx: IExecuteFunctions): Promise<any> {
	return await ctx.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, 0);
}

/**
 * Get connected output parser
 */
export async function getConnectedOutputParser(ctx: IExecuteFunctions): Promise<any> {
	return await ctx.getInputConnectionData(NodeConnectionTypes.AiOutputParser, 0);
}

/**
 * Common descriptions for node properties
 */
export const promptTypeOptions = {
	displayName: 'Source for Prompt (User Message)',
	name: 'promptType',
	type: 'options' as const,
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

export const textInput = {
	displayName: 'Prompt (User Message)',
	name: 'text',
	type: 'string' as const,
	required: true,
	default: '',
	placeholder: 'e.g. Hello, how can you help me?',
	typeOptions: {
		rows: 2,
	},
};

export const textFromPreviousNode = {
	displayName: 'Prompt (User Message)',
	name: 'text',
	type: 'string' as const,
	required: true,
	default: '={{ $json.chatInput }}',
	typeOptions: {
		rows: 2,
	},
	displayOptions: {
		show: { promptType: ['auto'] },
	},
}; 