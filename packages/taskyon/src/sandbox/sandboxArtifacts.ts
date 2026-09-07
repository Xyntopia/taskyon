import { jinjaArtifact } from '@taskyon/common/modules/sandbox/jinjaArtifact'
import { pyodideArtifact } from './pyodideArtifact'

export const sandboxArtifacts = [pyodideArtifact, jinjaArtifact] as const
