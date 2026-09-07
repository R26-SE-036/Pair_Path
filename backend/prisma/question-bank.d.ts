export interface ReviewPrompt {
    prompt: string;
    expected: boolean;
}
export interface BankQuestion {
    id: string;
    topicId: string;
    title: string;
    description: string;
    difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    conceptTags: string[];
    invitesErrors: string[];
    starterCode: string;
    referenceSolution: string;
    reviewQuestions: ReviewPrompt[];
}
export interface BankTopic {
    id: string;
    name: string;
    description: string;
}
export declare const PLATFORM_CONCEPT_TAGS: readonly ["loop_boundaries", "conditional_logic", "array_indexing", "string_comparison", "loop_control", "control_flow", "switch_statements", "statement_structure", "assignment_logic", "boolean_logic", "immutable_strings", "arithmetic_operations", "loop_initialization", "loop_termination"];
export declare const TOPICS: BankTopic[];
export declare const QUESTIONS: BankQuestion[];
