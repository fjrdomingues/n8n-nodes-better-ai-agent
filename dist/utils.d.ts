import type { IExecuteFunctions } from 'n8n-workflow';
/**
 * Get text input from the node parameter based on prompt type
 */
export declare function getPromptInputByType({ ctx, i, inputKey, promptTypeKey, }: {
    ctx: IExecuteFunctions;
    i: number;
    inputKey: string;
    promptTypeKey: string;
}): string;
/**
 * Get connected tools from the workflow
 */
export declare function getConnectedTools(ctx: IExecuteFunctions): Promise<any[]>;
/**
 * Get connected memory instance
 */
export declare function getConnectedMemory(ctx: IExecuteFunctions): Promise<any>;
/**
 * Get connected language model
 */
export declare function getConnectedModel(ctx: IExecuteFunctions): Promise<any>;
/**
 * Get connected output parser
 */
export declare function getConnectedOutputParser(ctx: IExecuteFunctions): Promise<any>;
/**
 * Common descriptions for node properties
 */
export declare const promptTypeOptions: {
    displayName: string;
    name: string;
    type: "options";
    options: {
        name: string;
        value: string;
        description: string;
    }[];
    default: string;
};
export declare const textInput: {
    displayName: string;
    name: string;
    type: "string";
    required: boolean;
    default: string;
    placeholder: string;
    typeOptions: {
        rows: number;
    };
};
export declare const textFromPreviousNode: {
    displayName: string;
    name: string;
    type: "string";
    required: boolean;
    default: string;
    typeOptions: {
        rows: number;
    };
    displayOptions: {
        show: {
            promptType: string[];
        };
    };
};
