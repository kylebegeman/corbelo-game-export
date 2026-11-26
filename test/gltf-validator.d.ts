declare module "gltf-validator" {
  export interface ValidationMessage {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
  }
  export interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidationMessage[] };
    info: Record<string, unknown>;
  }
  export function validateBytes(data: Uint8Array, options?: Record<string, unknown>): Promise<ValidationReport>;
}
