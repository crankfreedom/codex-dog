export interface UpdateCandidate { id: string; version: string; fileName: string; sha512: string; size: number }
export interface UpdateArtifact { id: string; version: string; path: string; sha512: string; size: number }
export interface UpdateOperation { id: string; owner: string; key: string; digest: string; kind: 'download' | 'install'; state: 'accepted' | 'running' | 'awaiting_restart' | 'succeeded' | 'failed'; version: string; at: number; error: string | null }
export interface UpdateState {
  schemaVersion: 2; phase: 'idle' | 'available' | 'downloading' | 'ready' | 'installing' | 'awaiting_restart' | 'failed';
  candidate: UpdateCandidate | null; artifact: UpdateArtifact | null; operations: UpdateOperation[]; error: string | null;
  configuration:{revision:number;automaticCheck:boolean;intervalSeconds:number;automaticDownload:false};configurationOperations:Array<{scope:string;digest:string;result:Record<string,unknown>}>;
}
export interface UpdateStorePort { load(): Promise<UpdateState>; save(state: UpdateState): Promise<void> }
export interface UpdateBackendPort {
  supported(): boolean;
  check(): Promise<Omit<UpdateCandidate, 'id'> | null>;
  download(candidate: UpdateCandidate): Promise<Omit<UpdateArtifact, 'id'>>;
  verify(artifact: UpdateArtifact): Promise<void>;
  cancel(): void;
  diagnostics?(): { provider: string; downloadedBytes: number };
}
export interface UpdateLifecyclePort { prepare(operationId: string): Promise<void>; install(artifact: UpdateArtifact, finalGuard: () => void): Promise<void>;recoverPreparation?():Promise<void> }
export class UpdateError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export const emptyUpdateState = (): UpdateState => ({ schemaVersion: 2, phase: 'idle', candidate: null, artifact: null, operations: [], error: null,configuration:{revision:1,automaticCheck:false,intervalSeconds:3600,automaticDownload:false},configurationOperations:[] });
