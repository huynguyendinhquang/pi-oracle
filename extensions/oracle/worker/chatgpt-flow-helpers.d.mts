export interface OracleStableValueState {
  lastValue: string;
  stableCount: number;
}

export declare function assistantSnapshotSlice(snapshot: string, composerLabel: string, responseIndex: number): string | undefined;
export declare function stripUrlQueryAndHash(url: string | undefined): string;
export declare function isConversationPathUrl(url: string): boolean;
export declare function resolveStableConversationUrlCandidate(url: string, previousChatUrl?: string): string | undefined;
export declare function nextStableValueState(
  state: Partial<OracleStableValueState> | undefined,
  nextValue: string,
): OracleStableValueState;
