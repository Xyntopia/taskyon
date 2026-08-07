import { jinjaArtifact } from './jinjaArtifact'
import { pyodideArtifact } from './pyodideArtifact'

export const sandboxArtifacts = [pyodideArtifact, jinjaArtifact] as const
