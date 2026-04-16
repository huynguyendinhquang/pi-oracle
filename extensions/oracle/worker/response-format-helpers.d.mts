export interface OracleStructuredResponseInline {
  type?: string;
  kind?: string;
  text?: string;
  href?: string;
}

export interface OracleStructuredResponseListItem {
  text?: string;
  inlines?: OracleStructuredResponseInline[];
}

export interface OracleStructuredResponseBlock {
  type?: string;
  text?: string;
  language?: string;
  inlines?: OracleStructuredResponseInline[];
  items?: Array<string | OracleStructuredResponseListItem>;
  ordered?: boolean;
}

export interface OracleStructuredResponseReference {
  kind?: string;
  label?: string;
  text?: string;
  href: string;
}

export interface OracleStructuredResponse {
  plainText?: string;
  markdown?: string;
  blocks?: OracleStructuredResponseBlock[];
  links?: OracleStructuredResponseReference[];
  references?: OracleStructuredResponseReference[];
}

export declare function renderStructuredResponsePlainText(response: OracleStructuredResponse | undefined): string;
export declare function renderStructuredResponseMarkdown(response: OracleStructuredResponse | undefined): string;
export declare function buildResponseReferences(response: OracleStructuredResponse | undefined): OracleStructuredResponseReference[];
