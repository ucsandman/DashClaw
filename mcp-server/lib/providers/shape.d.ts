export declare function objectShape(value: unknown, label: string): Record<string, any>;
export declare function arrayShape(value: unknown, label: string): any[];
export declare function stringField(value: Record<string, any>, key: string, label: string): string;
export declare function optionalStringField(value: Record<string, any>, key: string): string | undefined;
export declare function booleanField(value: Record<string, any>, key: string, label: string): boolean;
